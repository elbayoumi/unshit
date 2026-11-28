import ts from 'typescript';
import { join } from 'node:path';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';
import { buildImportGraph, createTsSpecResolver } from '../core/import-graph.js';
import { entryPointFileSet } from './dead-exports.js';
import { collectModuleSpecs, safeReadText } from './deps-shared.js';
import { collectPathLiteralRefTargets, resolveExactRef } from './path-literals.js';
import { basenameOf, directoryOf as posixDirname } from '../core/project-paths.js';

const TS_LIKE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CODE_REF_LIKE = new Set([...TS_LIKE, '.mts', '.cts']);

/** Explicit relative paths with a code extension; bare specifiers never match. */
const CODE_PATH_REF_RE = /^\.\.?\/[^\n"'`]*\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

const SCRIPT_TOKEN_SPLIT_RE = /[\s"'`]+/;

/**
 * Basename matcher for tooling configs that may carry path string literals,
 * e.g. `vitest.config.ts`. Dotfile rc configs are never walked, so plain
 * sources whose names merely contain `rc.` (`src.ts`, `torc.ts`) must not match.
 */
const CONFIG_BASENAME_RE = /\.config\./;

// basenameOf, posixDirname and resolveExactRef are shared from `path-literals.ts`.
const scriptRefCache = new WeakMap<DetectorContext, Set<string>>();
const configRefCache = new WeakMap<DetectorContext, Set<string>>();

function packageScriptsOf(content: string): Record<string, unknown> | null {
  let pkg: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      pkg = parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  return scripts as Record<string, unknown>;
}

/** Every scanned-file path a single package's script values point at. */
function scriptTargetsFor(dir: string, scripts: Record<string, unknown>, fileSet: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string') continue;
    for (const token of value.split(SCRIPT_TOKEN_SPLIT_RE)) {
      const target = resolveExactRef(dir, token, fileSet);
      if (target) found.add(target);
    }
  }
  return found;
}

function collectScriptRefTargets(ctx: DetectorContext): Set<string> {
  const cached = scriptRefCache.get(ctx);
  if (cached) return cached;
  const used = new Set<string>();
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const sources = new Map<string, string>();
  for (const rel of ctx.manifests ?? []) sources.set(rel, safeReadText(join(ctx.rootDir, rel)));
  for (const file of ctx.files) {
    if (!/(^|\/)package\.json$/.test(file.relPath)) continue;
    sources.set(file.relPath, file.content);
  }
  for (const [rel, content] of sources) {
    const scripts = packageScriptsOf(content);
    if (!scripts) continue;
    for (const target of scriptTargetsFor(posixDirname(rel), scripts, fileSet)) used.add(target);
  }
  scriptRefCache.set(ctx, used);
  return used;
}

function collectConfigRefTargets(ctx: DetectorContext): Set<string> {
  const cached = configRefCache.get(ctx);
  if (cached) return cached;
  const used = new Set<string>();
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const stringLiteralRe = /["'`]([^"'`\n]*)["'`]/g;
  for (const file of ctx.files) {
    if (!CONFIG_BASENAME_RE.test(basenameOf(file.relPath))) continue;
    const dir = posixDirname(file.relPath);
    for (const m of file.content.matchAll(stringLiteralRe)) {
      const target = resolveExactRef(dir, m[1] ?? '', fileSet);
      if (target) used.add(target);
    }
  }
  configRefCache.set(ctx, used);
  return used;
}

/** Resolved targets of dynamic `import()` calls, reusing the memoized spec collection. */
function dynamicImportTargets(ctx: DetectorContext): Set<string> {
  const resolve = createTsSpecResolver(ctx);
  const targets = new Set<string>();
  for (const file of ctx.files) {
    if (!file.sourceFile) continue;
    for (const spec of collectModuleSpecs(file)) {
      if (spec.kind !== 'dynamic-import') continue;
      const res = resolve(spec.text, file);
      if (res.internal && res.target) targets.add(res.target);
    }
  }
  return targets;
}

function isAllTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const namedBindings = clause.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings) || clause.name) return false;
  return namedBindings.elements.length > 0 && namedBindings.elements.every((el) => el.isTypeOnly);
}

function isAllTypeOnlyExport(stmt: ts.ExportDeclaration): boolean {
  if (stmt.isTypeOnly) return true;
  const clause = stmt.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((el) => el.isTypeOnly);
}

/**
 * Resolved targets of type-only imports/exports. The runtime import graph
 * intentionally skips them, but a file referenced only by `import type` is
 * still used and must not be reported as unused.
 */
function typeOnlyImportTargets(ctx: DetectorContext): Set<string> {
  const resolve = createTsSpecResolver(ctx);
  const targets = new Set<string>();
  const add = (spec: string, file: FileEntry): void => {
    const res = resolve(spec, file);
    if (res.internal && res.target) targets.add(res.target);
  };
  for (const file of ctx.files) {
    if (!file.sourceFile) continue;
    for (const stmt of file.sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        if (isAllTypeOnlyImport(stmt.importClause)) add(stmt.moduleSpecifier.text, file);
      } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        if (isAllTypeOnlyExport(stmt)) add(stmt.moduleSpecifier.text, file);
      }
    }
  }
  return targets;
}

/**
 * Flags source files that no other scanned file imports (static, dynamic,
 * `require`, export-from or side-effect imports), that no scanned package.json
 * script or tooling config string literal points at, that no explicit relative
 * code-path literal passed to a call in a scanned JS/TS file resolves to, and
 * that are not entry points.
 */
export const unusedFileDetector: Detector = {
  id: 'ts/unused-file',
  category: 'dead-code',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Flags source files that no other scanned file imports and that are not entry points.',
  detect(ctx: DetectorContext): Finding[] {
    const graph = buildImportGraph(ctx);
    const entries = entryPointFileSet(ctx, ctx.files);
    const dynamic = dynamicImportTargets(ctx);
    const typeOnly = typeOnlyImportTargets(ctx);
    const scriptRefs = collectScriptRefTargets(ctx);
    const configRefs = collectConfigRefTargets(ctx);
    const pathLitRefs = collectPathLiteralRefTargets(ctx);
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!TS_LIKE.has(file.ext) || file.relPath.endsWith('.d.ts')) continue;
      if (entries.has(file.relPath)) continue;
      if (graph.incomingOf(file.relPath).length > 0 || dynamic.has(file.relPath) || typeOnly.has(file.relPath)) continue;
      if (scriptRefs.has(file.relPath) || configRefs.has(file.relPath) || pathLitRefs.has(file.relPath)) continue;
      findings.push({
        ruleId: this.id,
        category: 'dead-code',
        tier: 'structural',
        severity: 'warn',
        fixability: 'ai',
        confidence: 0.8,
        file: file.relPath,
        span: { line: 1, column: 1 },
        message: 'File is never imported by any other scanned file.',
        evidence: 'no incoming imports',
      });
    }
    findings.sort((a, b) => a.file.localeCompare(b.file));
    return findings;
  },
};
