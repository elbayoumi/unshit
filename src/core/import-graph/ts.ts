import path from 'node:path';
import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import type { TsConfigInfo, ResolvedImport } from './types.js';
import { TS_EXTS, COMPONENT_EXTS, TS_SUFFIXES, VITE_SOURCE_ROOTS } from './constants.js';
import { normalizeRel, toRel, findNearestConfigFile, resolveFromBase } from './util.js';

const COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  module: ts.ModuleKind.NodeNext,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  resolveJsonModule: true,
};

export function loadTsConfigInfo(
  startDir: string,
  rootDir: string,
  configCache: Map<string, TsConfigInfo>,
): TsConfigInfo {
  const tsconfigPath = findNearestConfigFile(path.resolve(startDir), rootDir, 'tsconfig.json');
  const jsconfigPath = tsconfigPath
    ? null
    : findNearestConfigFile(path.resolve(startDir), rootDir, 'jsconfig.json');
  const configPath = tsconfigPath ?? jsconfigPath;
  const cacheKey = configPath ?? `<none:${path.resolve(rootDir)}>`;
  const cached = configCache.get(cacheKey);
  if (cached) return cached;

  let info: TsConfigInfo;
  if (!configPath) {
    info = { configPath: null, options: COMPILER_OPTIONS, pathPatterns: [] };
  } else {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    // Only compiler options are needed; never let the parser walk the filesystem.
    const host = { ...ts.sys, readDirectory: () => [] };
    const parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      host,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    const options: ts.CompilerOptions = {
      ...COMPILER_OPTIONS,
      ...parsed.options,
      ...(jsconfigPath ? { allowJs: true } : {}),
    };
    info = { configPath, options, pathPatterns: Object.keys(options.paths ?? {}) };
  }
  configCache.set(cacheKey, info);
  return info;
}

export function getResolutionCache(
  info: TsConfigInfo,
  rootDir: string,
  resolutionCaches: Map<string, ts.ModuleResolutionCache>,
): ts.ModuleResolutionCache {
  const key = info.configPath ?? '<default>';
  const existing = resolutionCaches.get(key);
  if (existing) return existing;
  const getCanonicalFileName = (fileName: string): string =>
    ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
  const created = ts.createModuleResolutionCache(path.resolve(rootDir), getCanonicalFileName, info.options);
  resolutionCaches.set(key, created);
  return created;
}

function matchesPathPattern(pattern: string, spec: string): boolean {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === spec;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return spec.startsWith(prefix) && spec.endsWith(suffix)
    && spec.length >= prefix.length + suffix.length;
}

export function loadPackageNames(ctx: DetectorContext, rootDir: string): string[] {
  const names = new Set<string>();
  for (const manifest of ctx.manifests ?? []) {
    if (!/(^|\/)package\.json$/.test(manifest)) continue;
    try {
      const text = ts.sys.readFile(path.join(rootDir, manifest));
      if (!text) continue;
      const parsed = JSON.parse(text) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name) names.add(parsed.name);
    } catch {
      // Ignore malformed or unreadable manifests.
    }
  }
  return [...names];
}

export function tryResolveTs(
  spec: string,
  containingAbs: string,
  info: TsConfigInfo,
  resolutionCache: ts.ModuleResolutionCache,
  absToRel: Map<string, string>,
  fileSet: Set<string>,
  rootDir: string,
): string | null {
  if (typeof spec !== 'string' || spec.trim() === '') return null;
  try {
    const resolved = ts.resolveModuleName(
      spec, containingAbs, info.options, ts.sys, resolutionCache,
    );
    const resolvedFileName = resolved.resolvedModule?.resolvedFileName;
    if (!resolvedFileName) return null;
    const resolvedAbs = path.resolve(resolvedFileName);
    const direct = absToRel.get(resolvedAbs);
    if (direct) return direct;
    const rel = toRel(rootDir, resolvedAbs);
    return rel && fileSet.has(rel) ? rel : null;
  } catch {
    return null;
  }
}

export function resolveRelativeTs(spec: string, fromRel: string, fileSet: Set<string>): string | null {
  return resolveFromBase(path.posix.dirname(fromRel), spec, fileSet, TS_SUFFIXES);
}

export function resolveAliasFallback(spec: string, fileSet: Set<string>): string | null {
  if (spec.startsWith('/')) {
    return resolveFromBase('', spec.slice(1), fileSet, TS_SUFFIXES);
  }
  if (!spec.startsWith('@/')) return null;
  const target = spec.slice(2);
  for (const root of VITE_SOURCE_ROOTS) {
    const hit = resolveFromBase(root, target, fileSet, TS_SUFFIXES);
    if (hit) return hit;
  }
  return null;
}

export function isInternalTsSpec(
  spec: string,
  info: TsConfigInfo,
  rootDir: string,
  packageNames: string[],
  fileSet: Set<string>,
): boolean {
  if (!spec) return false;
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(spec)) return false; // node:, https:, file:, ...
  if (info.pathPatterns.some((pattern) => matchesPathPattern(pattern, spec))) return true;
  if (packageNames.some((name) => spec === name || spec.startsWith(`${name}/`))) return true;
  if (info.options.baseUrl) {
    // A bare spec is only internal under baseUrl when a project file actually sits there.
    for (const suffix of TS_SUFFIXES) {
      const rel = toRel(rootDir, path.resolve(info.options.baseUrl, spec + suffix));
      if (rel && fileSet.has(rel)) return true;
    }
  }
  return false;
}

function getScriptKindFromLang(lang: string | undefined): ts.ScriptKind {
  const value = (lang ?? '').trim().toLowerCase();
  if (value === 'tsx') return ts.ScriptKind.TSX;
  if (value === 'jsx') return ts.ScriptKind.JSX;
  if (value === 'js' || value === 'javascript') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Extracts every `<script ...>...</script>` body with its original starting line. */
export function extractScriptBlocks(file: FileEntry): Array<{ sourceFile: ts.SourceFile; lineOffset: number }> {
  const blocks: Array<{ sourceFile: ts.SourceFile; lineOffset: number }> = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of file.content.matchAll(scriptRe)) {
    const openTagEnd = match[0].indexOf('>');
    if (openTagEnd < 0) continue;
    const bodyStart = (match.index ?? 0) + openTagEnd + 1;
    const body = match[2] ?? '';
    if (!body.trim()) continue;
    const langMatch = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1] ?? '');
    const lang = langMatch?.[1] ?? langMatch?.[2] ?? langMatch?.[3];
    const lineOffset = file.content.slice(0, bodyStart).split('\n').length - 1;
    const sourceFile = ts.createSourceFile(
      `${file.relPath}#script-${blocks.length}`,
      body,
      ts.ScriptTarget.Latest,
      true,
      getScriptKindFromLang(lang),
    );
    blocks.push({ sourceFile, lineOffset });
  }
  return blocks;
}

/** Shared static import/export/require extractor for TS/JS files and component script blocks. */
export function collectTsJsEdges(
  sf: ts.SourceFile,
  emitSpec: (spec: string, line: number) => void,
  lineOffset: number,
): void {
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset;

  for (const stmt of sf.statements) {
    let moduleSpecifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const elements = clause.namedBindings.elements;
        if (elements.length > 0 && elements.every((element) => element.isTypeOnly)) continue;
      }
      moduleSpecifier = stmt.moduleSpecifier;
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      moduleSpecifier = stmt.moduleSpecifier;
    }
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;
    emitSpec(moduleSpecifier.text, lineOf(moduleSpecifier));
  }

  // Static CommonJS require('...') calls, including nested ones.
  const visitRequires = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments.length > 0) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) emitSpec(arg.text, lineOf(arg));
    }
    ts.forEachChild(node, visitRequires);
  };
  visitRequires(sf);
}