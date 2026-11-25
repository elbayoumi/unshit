import path from 'node:path';
import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../contracts.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const COMPONENT_EXTS = new Set(['.vue', '.svelte']);
const TS_SUFFIXES = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs',
  '/index.vue', '/index.svelte',
];
const JS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const NON_GRAPHABLE_RE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|json|html|md|txt|css|scss|less)$/i;
const VITE_SOURCE_ROOTS = ['src', 'resources/js', 'resources/ts', 'app/javascript'];
const RUST_SUFFIXES = ['', '.rs', '/mod.rs'];
const RUST_USE_PREFIXES = new Set(['crate', 'super', 'self']);
const RUST_MOD_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/;
const RUST_USE_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?use\s+(.+)$/;

export interface ImportEdge {
  from: string;
  to: string;
  source: string;
  target: string;
  line?: number;
  spec?: string;
}

type ImportGraph = Map<string, string[]> & {
  nodes: string[];
  files: string[];
  vertices: string[];
  edges: ImportEdge[];
  links: ImportEdge[];
  adjacency: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  imports: Record<string, string[]>;
  dependencies: Record<string, string[]>;
  dependents: Record<string, string[]>;
  stats: { internalSpecs: number; resolved: number; graphedFiles: number };
  get(file: string): string[];
  has(file: string): boolean;
  incomingOf(file: string): string[];
  outgoingOf(file: string): string[];
};

interface TsConfigInfo {
  configPath: string | null;
  options: ts.CompilerOptions;
  pathPatterns: string[];
}

interface PubspecInfo {
  rootRel: string;
  name: string;
}

interface ResolvedImport {
  spec: string;
  target: string | null;
  line: number;
  internal: boolean;
}

type Emit = (
  from: string,
  spec: string,
  target: string | null,
  line: number | undefined,
  internal: boolean,
) => void;

const cache = new WeakMap<DetectorContext, ImportGraph>();
const filesCache = new WeakMap<FileEntry[], ImportGraph>();

const COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  module: ts.ModuleKind.NodeNext,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  resolveJsonModule: true,
};

function normalizeRel(p: string): string {
  return p.replaceAll('\\', '/');
}

function toRel(rootDir: string, absPath: string): string | null {
  const rel = path.relative(rootDir, absPath).replaceAll('\\', '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

/** Finds the nearest config file at or above `startDir`, stopping at `rootDir`. */
function findNearestConfigFile(startDir: string, rootDir: string, filename: string): string | null {
  let current = path.resolve(startDir);
  const boundary = path.resolve(rootDir);
  for (;;) {
    const candidate = path.join(current, filename);
    if (ts.sys.fileExists(candidate)) return candidate;
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function loadTsConfigInfo(
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

function getResolutionCache(
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

function loadPackageNames(ctx: DetectorContext, rootDir: string): string[] {
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

function tryResolveTs(
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

function resolveFromBase(
  baseRel: string,
  target: string,
  fileSet: Set<string>,
  suffixes: string[],
): string | null {
  const cand = normalizeRel(path.posix.normalize(path.posix.join(baseRel, target)));
  for (const suffix of suffixes) {
    const candidate = cand + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  const ext = path.posix.extname(cand);
  if (JS_EXTS.has(ext)) {
    const stem = cand.slice(0, -ext.length);
    for (const suffix of suffixes) {
      const candidate = stem + suffix;
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

function resolveRelativeTs(spec: string, fromRel: string, fileSet: Set<string>): string | null {
  return resolveFromBase(path.posix.dirname(fromRel), spec, fileSet, TS_SUFFIXES);
}

function resolveAliasFallback(spec: string, fileSet: Set<string>): string | null {
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

function isInternalTsSpec(
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

function loadPubspecInfo(
  startDir: string,
  rootDir: string,
  pubspecCache: Map<string, PubspecInfo | null>,
): PubspecInfo | null {
  const dirKey = path.resolve(startDir);
  if (pubspecCache.has(dirKey)) return pubspecCache.get(dirKey) ?? null;

  const configPath = findNearestConfigFile(dirKey, rootDir, 'pubspec.yaml');
  let info: PubspecInfo | null = null;
  if (configPath) {
    const text = ts.sys.readFile(configPath) ?? '';
    const nameMatch = /^\s*name:\s*['"]?([^\s'"#]+)/m.exec(text);
    const rootRel = toRel(rootDir, path.dirname(configPath));
    if (nameMatch?.[1] && rootRel !== null) {
      info = { rootRel: normalizeRel(rootRel), name: nameMatch[1] };
    }
  }
  pubspecCache.set(dirKey, info);
  return info;
}

function isInternalDartSpec(spec: string, pubspec: PubspecInfo | null): boolean {
  const match = /^package:([^/]+)/.exec(spec);
  if (match) return !!pubspec && match[1] === pubspec.name;
  if (/^[a-z][a-z\d+.-]*:/i.test(spec)) return false; // dart:, http:, ...
  // Dart relative URIs may omit a leading "./".
  return true;
}

function resolveDartSpec(
  spec: string,
  fromRel: string,
  pubspec: PubspecInfo | null,
  fileSet: Set<string>,
): string | null {
  const clean = spec.split('?')[0] ?? spec;
  const match = /^package:([^/]+)(?:\/(.+))?$/.exec(clean);
  if (match) {
    if (!pubspec || match[1] !== pubspec.name || !match[2]) return null;
    return resolveFromBase(
      path.posix.join(pubspec.rootRel, 'lib'), match[2], fileSet, ['', '.dart'],
    );
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(clean)) return null;
  return resolveFromBase(path.posix.dirname(fromRel), clean, fileSet, ['', '.dart']);
}

function parseDartImports(
  file: FileEntry,
  pubspec: PubspecInfo | null,
  fileSet: Set<string>,
): ResolvedImport[] {
  const results: ResolvedImport[] = [];
  for (let i = 0; i < file.lines.length; i++) {
    const trimmed = (file.lines[i] ?? '').trim();
    const match = /^(?:import|export)\s+r?(['"])([^'"]+)\1/.exec(trimmed);
    const spec = match?.[2];
    if (!spec) continue;
    const internal = isInternalDartSpec(spec, pubspec);
    results.push({
      spec,
      target: internal ? resolveDartSpec(spec, file.relPath, pubspec, fileSet) : null,
      line: i + 1,
      internal,
    });
  }
  return results;
}

function tryPyPath(base: string, fileSet: Set<string>): string | null {
  const norm = normalizeRel(base);
  for (const candidate of [`${norm}.py`, `${norm}/__init__.py`, norm]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/** Recognises src/<pkg> and lib/<pkg> layouts in addition to a flat package at the root. */
function pythonPackageRoots(fileSet: Set<string>): string[] {
  const roots = new Set<string>(['']);
  for (const file of fileSet) {
    if (!file.endsWith('.py')) continue;
    const parts = file.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === 'src' || parts[i] === 'lib') {
        roots.add(parts.slice(0, i + 1).join('/'));
      }
    }
  }
  return [...roots].sort((a, b) => b.length - a.length);
}

function relativePyBase(fromRel: string, level: number, mod: string): string {
  let base = path.posix.dirname(fromRel);
  for (let i = 1; i < level; i++) base = path.posix.dirname(base);
  const parts = mod.split('.').filter(Boolean);
  return parts.length ? path.posix.join(base, ...parts) : base;
}

function resolvePyModule(
  fromRel: string,
  mod: string,
  level: number,
  roots: string[],
  fileSet: Set<string>,
): string | null {
  if (level > 0) return tryPyPath(relativePyBase(fromRel, level, mod), fileSet);
  const parts = mod.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  for (const root of roots) {
    const hit = tryPyPath(path.posix.join(root, ...parts), fileSet);
    if (hit) return hit;
  }
  return null;
}

function splitPyNames(raw: string): string[] {
  return raw
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter((name) => name !== '' && name !== '*');
}

interface PythonParseState {
  results: ResolvedImport[];
  skipIndent: number | null;
  file: FileEntry;
  fileSet: Set<string>;
  roots: string[];
}

function pushPyImport(
  state: PythonParseState,
  spec: string,
  target: string | null,
  line: number,
  internal: boolean,
): void {
  state.results.push({ spec, target, line, internal });
}

function pyPackageBase(moduleFile: string): string {
  return moduleFile.replace(/\/__init__\.py$/, '').replace(/\.py$/, '');
}

function parseRelativePyImport(state: PythonParseState, trimmed: string, line: number): boolean {
  const match = /^from\s+(\.+)([^\s]*)\s+import\s+(.+)$/.exec(trimmed);
  if (!match) return false;
  const level = match[1].length;
  const mod = (match[2] ?? '').replace(/^\.+/, '');
  const spec = '.'.repeat(level) + mod;
  const baseTarget = resolvePyModule(state.file.relPath, mod, level, state.roots, state.fileSet);
  const base = baseTarget ? pyPackageBase(baseTarget) : relativePyBase(state.file.relPath, level, mod);
  let resolvedNames = 0;
  for (const name of splitPyNames(match[3] ?? '')) {
    const hit = tryPyPath(path.posix.join(base, name), state.fileSet);
    if (hit) {
      pushPyImport(state, `${spec}.${name}`, hit, line, true);
      resolvedNames++;
    }
  }
  // `from . import sibling` depends on the sibling modules, not on the package __init__ itself.
  if (mod !== '' || resolvedNames === 0) {
    pushPyImport(state, spec, baseTarget, line, level > 0 || baseTarget !== null);
  }
  return true;
}

function parseFromPyImport(state: PythonParseState, trimmed: string, line: number): boolean {
  const match = /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(trimmed);
  if (!match) return false;
  const mod = match[1]!;
  if (mod === '__future__') return true;
  const baseTarget = resolvePyModule(state.file.relPath, mod, 0, state.roots, state.fileSet);
  pushPyImport(state, mod, baseTarget, line, baseTarget !== null);
  if (baseTarget) {
    const base = pyPackageBase(baseTarget);
    for (const name of splitPyNames(match[2] ?? '')) {
      const hit = tryPyPath(path.posix.join(base, name), state.fileSet);
      if (hit) pushPyImport(state, `${mod}.${name}`, hit, line, true);
    }
  }
  return true;
}

function parsePlainPyImport(state: PythonParseState, trimmed: string, line: number): void {
  const match = /^import\s+(.+)$/.exec(trimmed);
  if (!match) return;
  for (const rawMod of (match[1] ?? '').split(',')) {
    let mod = rawMod.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
    if (!mod) continue;
    let level = 0;
    if (mod.startsWith('.')) {
      level = mod.match(/^\.+/)?.[0].length ?? 1;
      mod = mod.slice(level);
    }
    const target = resolvePyModule(state.file.relPath, mod, level, state.roots, state.fileSet);
    pushPyImport(state, level ? '.'.repeat(level) + mod : mod, target, line, level > 0 || target !== null);
  }
}

function parsePythonLine(state: PythonParseState, raw: string, indent: number, line: number): void {
  const trimmed = raw.trim();
  if (state.skipIndent !== null) {
    if (trimmed === '' || indent > state.skipIndent) return;
    state.skipIndent = null;
  }
  if (/^if\s+(?:[\w.]+\.)?TYPE_CHECKING\s*:/.test(trimmed)) {
    state.skipIndent = indent;
    return;
  }
  if (parseRelativePyImport(state, trimmed, line)) return;
  if (parseFromPyImport(state, trimmed, line)) return;
  parsePlainPyImport(state, trimmed, line);
}

function parsePythonImports(file: FileEntry, fileSet: Set<string>, roots: string[]): ResolvedImport[] {
  const state: PythonParseState = { results: [], skipIndent: null, file, fileSet, roots };
  for (let i = 0; i < file.lines.length; i++) {
    const raw = file.lines[i] ?? '';
    parsePythonLine(state, raw, raw.length - raw.trimStart().length, i + 1);
  }
  return state.results;
}

function getScriptKindFromLang(lang: string | undefined): ts.ScriptKind {
  const value = (lang ?? '').trim().toLowerCase();
  if (value === 'tsx') return ts.ScriptKind.TSX;
  if (value === 'jsx') return ts.ScriptKind.JSX;
  if (value === 'js' || value === 'javascript') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Extracts every `<script ...>...</script>` body with its original starting line. */
function extractScriptBlocks(file: FileEntry): Array<{ sourceFile: ts.SourceFile; lineOffset: number }> {
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
function collectTsJsEdges(
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

function tryRustPath(base: string, fileSet: Set<string>): string | null {
  const norm = normalizeRel(path.posix.normalize(base));
  for (const suffix of RUST_SUFFIXES) {
    const candidate = suffix === '' ? norm : norm + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function resolveRustPathParts(baseDir: string, parts: string[], fileSet: Set<string>): string | null {
  for (let len = parts.length; len > 0; len--) {
    const hit = tryRustPath(path.posix.join(baseDir, ...parts.slice(0, len)), fileSet);
    if (hit) return hit;
  }
  return null;
}

/** Directory holding a module's child modules (`src/foo.rs` owns `src/foo/`). */
function rustChildModuleDir(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  const stem = path.posix.basename(relPath, '.rs');
  if (stem === 'mod' || stem === 'lib' || stem === 'main') return dir;
  return path.posix.join(dir, stem);
}

function rustCrateSrcRoots(ctx: DetectorContext, fileSet: Set<string>): string[] {
  const roots = new Set<string>();
  for (const manifest of ctx.manifests ?? []) {
    const norm = normalizeRel(manifest);
    if (!/(^|\/)Cargo\.toml$/.test(norm)) continue;
    const dir = path.posix.dirname(norm);
    roots.add(dir === '.' ? 'src' : path.posix.join(dir, 'src'));
  }
  if (!roots.has('src') && [...fileSet].some((file) => file.startsWith('src/'))) roots.add('src');
  return [...roots].sort((a, b) => b.length - a.length);
}

function nearestRustCrateRoot(relPath: string, roots: string[]): string {
  for (const root of roots) {
    if (relPath === root || relPath.startsWith(`${root}/`)) return root;
  }
  return roots.find((root) => root === 'src') ?? 'src';
}

function splitRustUseList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '(' || char === '[') depth++;
    else if (char === '}' || char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Expands `crate::{a, b::c}` into individual module paths. */
function expandRustUseTree(text: string): string[] {
  const trimmed = text.trim().replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
  const grouped = /^([^{}]*)\{([\s\S]*)\}$/.exec(trimmed);
  if (!grouped) return trimmed ? [trimmed] : [];
  const prefix = (grouped[1] ?? '').replace(/::\s*$/, '').trim();
  const expanded: string[] = [];
  for (const part of splitRustUseList(grouped[2] ?? '')) {
    const item = part.trim().replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
    if (!item || item === '*') continue;
    const combined = !prefix ? item : item === 'self' ? prefix : `${prefix}::${item}`;
    expanded.push(...expandRustUseTree(combined));
  }
  return expanded;
}

function parseRustImports(
  file: FileEntry,
  fileSet: Set<string>,
  crateRoots: string[],
): ResolvedImport[] {
  const results: ResolvedImport[] = [];
  const crateRoot = nearestRustCrateRoot(file.relPath, crateRoots);
  const childDir = rustChildModuleDir(file.relPath);
  const containingDir = path.posix.dirname(file.relPath);

  for (let i = 0; i < file.lines.length; i++) {
    const trimmed = (file.lines[i] ?? '').trim();
    const line = i + 1;

    const modMatch = RUST_MOD_RE.exec(trimmed);
    if (modMatch) {
      const name = modMatch[1]!;
      const target = tryRustPath(path.posix.join(childDir, name), fileSet)
        ?? tryRustPath(path.posix.join(containingDir, name), fileSet)
        ?? tryRustPath(path.posix.join(crateRoot, name), fileSet);
      results.push({ spec: `mod ${name}`, target, line, internal: true });
      continue;
    }

    const useMatch = RUST_USE_RE.exec(trimmed);
    if (!useMatch) continue;
    let body = useMatch[1] ?? '';
    let endLine = i;
    while (!body.includes(';') && endLine + 1 < file.lines.length) {
      endLine += 1;
      body += ` ${file.lines[endLine]?.trim() ?? ''}`;
    }
    const semi = body.indexOf(';');
    const statement = (semi === -1 ? body : body.slice(0, semi)).trim();
    const parts = statement.split('::').map((part) => part.trim()).filter(Boolean);
    const first = parts[0];
    if (!first || !RUST_USE_PREFIXES.has(first)) {
      i = endLine;
      continue;
    }

    let baseDir = first === 'crate' ? crateRoot : childDir;
    let prefixLen = first === 'crate' ? 1 : 0;
    while (parts[prefixLen] === 'super' || parts[prefixLen] === 'self') {
      if (parts[prefixLen] === 'super') baseDir = path.posix.dirname(baseDir);
      prefixLen += 1;
    }
    const rest = expandRustUseTree(parts.slice(prefixLen).join('::'));
    for (const expanded of rest) {
      const moduleParts = expanded.split('::').map((part) => part.trim()).filter(Boolean);
      if (moduleParts.length === 0) continue;
      const target = resolveRustPathParts(baseDir, moduleParts, fileSet);
      results.push({ spec: statement, target, line, internal: true });
    }
    i = endLine;
  }

  return results;
}

function computeGraph(ctx: DetectorContext): ImportGraph {
  const rootDir = ctx.rootDir;
  const filesSorted = [...ctx.files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const absToRel = new Map(ctx.files.map((f) => [path.resolve(f.absPath), f.relPath]));

  const outgoing = new Map<string, Set<string>>();
  for (const f of ctx.files) outgoing.set(f.relPath, new Set());

  const edgeDetails = new Map<string, { line?: number; spec?: string }>();
  let internalSpecs = 0;
  let resolved = 0;

  const emit: Emit = (from, spec, target, line, internal) => {
    if (!internal) return;
    internalSpecs++;
    if (!target || !fileSet.has(target)) return;
    resolved++;
    if (target === from) return;
    outgoing.get(from)!.add(target);
    const key = `${from}\u0000${target}`;
    if (!edgeDetails.has(key)) edgeDetails.set(key, { line, spec });
  };

  const tsconfigCache = new Map<string, TsConfigInfo>();
  const resolutionCaches = new Map<string, ts.ModuleResolutionCache>();
  const pubspecCache = new Map<string, PubspecInfo | null>();
  const packageNames = loadPackageNames(ctx, rootDir);

  const processTsSource = (
    fromRel: string,
    containingAbs: string,
    sf: ts.SourceFile,
    lineOffset: number,
  ): void => {
    const info = loadTsConfigInfo(path.dirname(containingAbs), rootDir, tsconfigCache);
    const resolutionCache = getResolutionCache(info, rootDir, resolutionCaches);

    const emitSpec = (spec: string, line: number): void => {
      const clean = spec.split('?')[0] ?? spec;
      if (!clean) return;
      const isComponentSpec = COMPONENT_EXTS.has(path.posix.extname(clean).toLowerCase());
      if (NON_GRAPHABLE_RE.test(clean) && !isComponentSpec) return;
      if (!isInternalTsSpec(clean, info, rootDir, packageNames, fileSet)) return;
      let target = tryResolveTs(
        clean, containingAbs, info, resolutionCache, absToRel, fileSet, rootDir,
      );
      if (!target || !fileSet.has(target)) {
        target = resolveRelativeTs(clean, fromRel, fileSet)
          ?? resolveAliasFallback(clean, fileSet);
      }
      // A component that is not a scanned file is an asset, not a broken import.
      if (isComponentSpec && !target) return;
      emit(fromRel, clean, target, line, true);
    };

    collectTsJsEdges(sf, emitSpec, lineOffset);
  };

  // TS/JS edges
  for (const file of ctx.files) {
    if (!TS_EXTS.has(file.ext) || !file.sourceFile) continue;
    processTsSource(file.relPath, file.absPath, file.sourceFile, 0);
  }

  // Vue/Svelte <script> edges
  for (const file of ctx.files) {
    if (!COMPONENT_EXTS.has(file.ext)) continue;
    for (const block of extractScriptBlocks(file)) {
      processTsSource(file.relPath, file.absPath, block.sourceFile, block.lineOffset);
    }
  }

  // Rust edges
  const rustRoots = rustCrateSrcRoots(ctx, fileSet);
  for (const file of ctx.files) {
    if (file.ext !== '.rs') continue;
    for (const imp of parseRustImports(file, fileSet, rustRoots)) {
      emit(file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }

  // Dart edges
  for (const file of ctx.files) {
    if (file.ext !== '.dart') continue;
    const pubspec = loadPubspecInfo(path.dirname(file.absPath), rootDir, pubspecCache);
    for (const imp of parseDartImports(file, pubspec, fileSet)) {
      emit(file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }

  // Python edges
  const pyRoots = pythonPackageRoots(fileSet);
  for (const file of ctx.files) {
    if (file.ext !== '.py') continue;
    for (const imp of parsePythonImports(file, fileSet, pyRoots)) {
      emit(file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }

  const sortedNodes = filesSorted.map((f) => f.relPath);
  const graph = new Map<string, string[]>() as ImportGraph;
  for (const node of sortedNodes) {
    graph.set(node, [...outgoing.get(node)!].sort());
  }

  const edges: ImportEdge[] = [];
  for (const from of sortedNodes) {
    for (const to of graph.get(from)!) {
      const details = edgeDetails.get(`${from}\u0000${to}`);
      edges.push({
        from,
        to,
        source: from,
        target: to,
        ...(details?.line !== undefined ? { line: details.line } : {}),
        ...(details?.spec !== undefined ? { spec: details.spec } : {}),
      });
    }
  }
  edges.sort((a, b) =>
    a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || (a.line ?? 0) - (b.line ?? 0));

  const incoming = new Map<string, string[]>();
  for (const node of sortedNodes) incoming.set(node, []);
  for (const edge of edges) {
    incoming.get(edge.to)!.push(edge.from);
  }
  for (const node of sortedNodes) {
    incoming.get(node)!.sort();
  }

  const importsRecord: Record<string, string[]> = {};
  const dependentsRecord: Record<string, string[]> = {};
  for (const node of sortedNodes) {
    importsRecord[node] = graph.get(node)!;
    dependentsRecord[node] = incoming.get(node)!;
  }

  const mapGet = graph.get.bind(graph);

  graph.nodes = sortedNodes;
  graph.files = sortedNodes;
  graph.vertices = sortedNodes;
  graph.edges = edges;
  graph.links = edges;
  graph.adjacency = new Map(graph);
  graph.outgoing = graph.adjacency;
  graph.incoming = incoming;
  graph.imports = importsRecord;
  graph.dependencies = importsRecord;
  graph.dependents = dependentsRecord;
  graph.stats = { internalSpecs, resolved, graphedFiles: sortedNodes.length };
  graph.get = (file: string): string[] => {
    const value = mapGet(file);
    return value ? [...value] : [];
  };
  graph.has = (file: string): boolean => mapGet(file) !== undefined;
  graph.incomingOf = (file: string): string[] => [...(incoming.get(file) ?? [])];
  graph.outgoingOf = (file: string): string[] => {
    const value = mapGet(file);
    return value ? [...value] : [];
  };

  return graph;
}

export function buildImportGraph(ctx: DetectorContext): ImportGraph {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const filesCached = filesCache.get(ctx.files);
  if (filesCached) {
    cache.set(ctx, filesCached);
    return filesCached;
  }
  const graph = computeGraph(ctx);
  cache.set(ctx, graph);
  filesCache.set(ctx.files, graph);
  return graph;
}

interface TsSpecResolution {
  /** True when the specifier points at project code (relative, alias, workspace package), false for npm/node builtins. */
  internal: boolean;
  /** Project file the specifier resolves to, when it could be resolved. */
  target: string | null;
}

/**
 * Resolver for TS/JS module specifiers using the same rules as the import graph
 * (tsconfig paths, workspace packages, relative and `@/` fallbacks).
 */
export function createTsSpecResolver(ctx: DetectorContext): (spec: string, from: FileEntry) => TsSpecResolution {
  const rootDir = ctx.rootDir;
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const absToRel = new Map(ctx.files.map((f) => [path.resolve(f.absPath), f.relPath]));
  const tsconfigCache = new Map<string, TsConfigInfo>();
  const resolutionCaches = new Map<string, ts.ModuleResolutionCache>();
  const packageNames = loadPackageNames(ctx, rootDir);

  return (rawSpec, from) => {
    const clean = rawSpec.split('?')[0] ?? rawSpec;
    if (!clean) return { internal: false, target: null };
    const info = loadTsConfigInfo(path.dirname(from.absPath), rootDir, tsconfigCache);
    if (!isInternalTsSpec(clean, info, rootDir, packageNames, fileSet)) return { internal: false, target: null };
    const resolutionCache = getResolutionCache(info, rootDir, resolutionCaches);
    let target = tryResolveTs(clean, from.absPath, info, resolutionCache, absToRel, fileSet, rootDir);
    if (!target || !fileSet.has(target)) {
      target = resolveRelativeTs(clean, from.relPath, fileSet) ?? resolveAliasFallback(clean, fileSet);
    }
    return { internal: true, target: target && fileSet.has(target) ? target : null };
  };
}
