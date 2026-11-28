import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../contracts.js';
import { basenameOf, directoryOf } from '../core/project-paths.js';

// ONE shared walker + exact resolver for explicit relative code-path literals handed to calls
// (e.g. `unstable_dev('./worker.ts')`). `ts/unused-file` uses every match; `ts/unused-export` uses
// only matches from OTHER callees, because `import(...)` and bare `require(...)` are already
// modeled precisely by `handleCallExpression`/`handleDynamicImport`. Conservative rule: the string
// must be `ts.isStringLiteralLike` (no `${}` substitution), a call argument, explicit `./`/`../`,
// carry a JS/TS code extension, resolve exactly to a scanned file (then retry from package root);
// a literal merely assigned to a variable, a bare specifier, or an unresolved path protects nothing.
// NOT every path literal is a load: `console.log`/`fs.readFileSync`/`path.join`/test fixtures count.
// All exports are protected, not just `default`; dynamic or unscanned paths are invisible.

/** Explicit relative paths with a code extension; bare specifiers never match. */
const CODE_PATH_REF_RE = /^\.\.?\/[^\n"'`]*\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

const CODE_REF_LIKE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

interface PathLiteralRef {
  /** Resolved scanned-file target (POSIX relPath), or null when unresolved. */
  target: string | null;
  /** Call is itself module loading: `import(...)` or bare `require(...)`. */
  isModuleLoading: boolean;
}

function posixJoinRel(from: string, to: string): string {
  const parts: string[] = [];
  for (const segment of [...from.split('/'), ...to.split('/')]) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** Exact relative-path resolution only; no substring, glob or basename-only matching. */
export function resolveExactRef(baseRel: string, spec: string, fileSet: Set<string>): string | null {
  const clean = (spec ?? '').trim().split('?')[0] ?? '';
  let target = clean;
  if (target.startsWith('./')) target = target.slice(2);
  if (!target || target === '.') return null;
  const joined = posixJoinRel(baseRel, target);
  if (!joined) return null;
  return fileSet.has(joined) ? joined : null;
}

/** Directories containing a package.json (scanned files are always POSIX-relative). */
function packageRootDirs(ctx: DetectorContext): Set<string> {
  const roots = new Set<string>();
  for (const rel of ctx.manifests ?? []) {
    if (/(^|\/)package\.json$/.test(rel)) roots.add(directoryOf(rel));
  }
  for (const file of ctx.files) {
    if (basenameOf(file.relPath) === 'package.json') roots.add(directoryOf(file.relPath));
  }
  return roots;
}

/** Nearest enclosing package root, or the scan root (`''`) when there is none. */
function nearestPackageRoot(dir: string, roots: Set<string>, memo: Map<string, string>): string {
  let current = dir;
  const visited: string[] = [];
  for (;;) {
    const cached = memo.get(current);
    if (cached !== undefined) {
      for (const seen of visited) memo.set(seen, cached);
      return cached;
    }
    visited.push(current);
    if (roots.has(current) || current === '') {
      for (const seen of visited) memo.set(seen, current);
      return current;
    }
    current = directoryOf(current);
  }
}

/** `import(...)` or bare `require(...)` — already modeled precisely by `handleDynamicImport`. */
function isModuleLoadingCall(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && node.expression.text === 'require');
}

const refsCache = new WeakMap<DetectorContext, PathLiteralRef[]>();

/**
 * Shared walker + resolver: every explicit relative code-path literal passed to a call in a scanned
 * JS/TS source, with its resolution and whether the call is itself module loading. Memoized per ctx.
 */
function collectPathLiteralRefs(ctx: DetectorContext): PathLiteralRef[] {
  const cached = refsCache.get(ctx);
  if (cached) return cached;
  const out: PathLiteralRef[] = [];
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const roots = packageRootDirs(ctx);
  const rootMemo = new Map<string, string>();
  const addLiteral = (file: FileEntry, literal: string, isModuleLoading: boolean): void => {
    if (literal.includes('${') || !CODE_PATH_REF_RE.test(literal)) return;
    const fileDir = directoryOf(file.relPath);
    const fromFile = resolveExactRef(fileDir, literal, fileSet);
    let target = fromFile;
    if (!target) {
      const packageRoot = nearestPackageRoot(fileDir, roots, rootMemo);
      target = resolveExactRef(packageRoot, literal, fileSet);
    }
    out.push({ target, isModuleLoading });
  };
  for (const file of ctx.files) {
    if (!CODE_REF_LIKE.has(file.ext) || !file.sourceFile) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const isModuleLoading = isModuleLoadingCall(node);
        for (const arg of node.arguments) {
          if (ts.isStringLiteralLike(arg)) addLiteral(file, arg.text, isModuleLoading);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.sourceFile);
  }
  refsCache.set(ctx, out);
  return out;
}

/** Verbatim `ts/unused-file` set: resolved targets from ALL calls, incl. `import`/`require`. */
export function collectPathLiteralRefTargets(ctx: DetectorContext): Set<string> {
  const used = new Set<string>();
  for (const ref of collectPathLiteralRefs(ctx)) if (ref.target) used.add(ref.target);
  return used;
}

/** Export side: resolved targets from calls that are NOT `import(...)`/bare `require(...)`. */
export function collectNonModuleLoadingPathTargets(ctx: DetectorContext): Set<string> {
  const used = new Set<string>();
  for (const ref of collectPathLiteralRefs(ctx)) if (ref.target && !ref.isModuleLoading) used.add(ref.target);
  return used;
}
