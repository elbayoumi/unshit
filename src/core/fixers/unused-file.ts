import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import type { DetectorContext, FileEntry, Finding } from '../../contracts.js';
import { entryPointFileSet } from '../../detectors/dead-exports.js';
import { buildImportGraph, createTsSpecResolver } from '../import-graph.js';
import type { ScanResult } from '../scanner.js';

const execFileAsync = promisify(execFile);
const RULE = 'ts/unused-file';

export function isUnusedFileRule(ruleId: string): boolean {
  return ruleId === RULE;
}

export interface UnusedFileDeletion {
  relPath: string;
  absPath: string;
  content: string;
  ruleId: string;
  line: number;
}

interface UnusedFileSkip {
  file: string;
  ruleId: string;
  line: number;
  reason: string;
}

interface UnusedFilePlan {
  deletions: UnusedFileDeletion[];
  skipped: UnusedFileSkip[];
}

/** Paths a fixer must never delete, even if a stale finding says otherwise. */
const PROTECTED_PATH_RE = /(?:^|\/)(?:__tests__|__mocks__|tests?|e2e|cypress|playwright|bin|scripts)\/|\.(?:test|spec|d)\.[cm]?[jt]sx?$|(?:^|\/)[\w.-]+\.(?:config|rc)\.[cm]?[jt]sx?$|^docs\/|^benchmarks?\/|^examples?\/|^fixtures?\/|^__fixtures__\//i;

function posixDirname(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function posixJoin(dir: string, spec: string): string {
  const parts = [...(dir ? dir.split('/') : []), ...spec.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Targets of static imports, re-exports, require, side-effect imports and dynamic import(). */
function referencedFiles(scan: ScanResult): Set<string> {
  const ctx: DetectorContext = {
    rootDir: scan.rootDir,
    config: scan.config,
    files: scan.files,
    manifests: scan.manifests,
  };
  const refs = new Set<string>();
  const graph = buildImportGraph(ctx);
  for (const file of scan.files) {
    for (const source of graph.incomingOf(file.relPath)) refs.add(file.relPath);
  }

  const resolve = createTsSpecResolver(ctx);
  const consider = (spec: string, from: FileEntry): void => {
    const res = resolve(spec, from);
    if (res.internal && res.target) refs.add(res.target);
  };
  const visit = (file: FileEntry, node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImport || isRequire) && arg && ts.isStringLiteralLike(arg)) consider(arg.text, file);
    }
    ts.forEachChild(node, (child) => visit(file, child));
  };
  const fileSet = new Set(scan.files.map((f) => f.relPath));
  const suffixes = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.mts', '/index.cts', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'];
  const fallback = (spec: string, from: FileEntry): void => {
    if (!spec.startsWith('.')) return;
    const base = posixJoin(posixDirname(from.relPath), spec);
    for (const suffix of suffixes) {
      if (fileSet.has(base + suffix)) refs.add(base + suffix);
    }
  };
  for (const file of scan.files) {
    if (file.sourceFile) {
      visit(file, file.sourceFile);
    } else {
      for (const m of file.content.matchAll(/\b(?:import|require|from)\s*\(?\s*["']([^"']+)["']/g)) {
        fallback(m[1] ?? '', file);
      }
    }
    for (const m of file.content.matchAll(/import\.meta\.glob\(\s*["']([^"']+)["']/g)) {
      fallback(m[1] ?? '', file);
    }
  }
  return refs;
}

/**
 * Repo-root-relative paths with any uncommitted change (staged, unstaged or
 * untracked). Silently returns an empty set outside a git repository.
 */
export async function gitDirtyFiles(rootDir: string): Promise<Set<string>> {
  const dirty = new Set<string>();
  let prefix = '';
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir });
    const rel = relative(stdout.trim(), rootDir).replaceAll('\\', '/');
    if (rel && rel !== '.') prefix = rel;
  } catch {
    return dirty;
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '-z', '--untracked-files=all'],
      { cwd: rootDir, maxBuffer: 32 * 1024 * 1024 },
    );
    for (const entry of stdout.split('\0')) {
      if (!entry || entry.length < 4) continue;
      let file = entry.slice(3).replaceAll('\\', '/');
      if (prefix) {
        const p = `${prefix}/`;
        if (file.startsWith(p)) file = file.slice(p.length);
      }
      if (file) dirty.add(file);
    }
  } catch {
    // Not a git repository (or git unavailable): nothing is dirty.
  }
  return dirty;
}

function liveFileReason(
  file: FileEntry,
  entries: Set<string>,
  refs: Set<string>,
  dirtyFiles: Set<string>,
): string | null {
  if (entries.has(file.relPath)) return 'entry point, config, script or test file';
  if (PROTECTED_PATH_RE.test(file.relPath)) return 'protected path (config, test, docs or script directory)';
  if (refs.has(file.relPath)) return 'still referenced by a scanned file (import, require, re-export or dynamic import)';
  if (dirtyFiles.has(file.relPath)) return 'git working tree is dirty for this file';
  return null;
}

/**
 * Plans deletions for files the detector flagged, re-checking every reason a
 * file might still be alive at fix time. No file is removed here.
 */
export function planUnusedFileDeletions(
  scan: ScanResult,
  findings: Finding[],
  dirtyFiles: Set<string>,
  patchedFiles: Set<string>,
): UnusedFilePlan {
  const deletions: UnusedFileDeletion[] = [];
  const skipped: UnusedFileSkip[] = [];
  if (findings.length === 0) return { deletions, skipped };

  const skip = (finding: Finding, reason: string): void => {
    skipped.push({ file: finding.file, ruleId: finding.ruleId, line: finding.span.line, reason });
  };
  const ctx: DetectorContext = {
    rootDir: scan.rootDir,
    config: scan.config,
    files: scan.files,
    manifests: scan.manifests,
  };
  const entries = entryPointFileSet(ctx, scan.files);
  const refs = referencedFiles(scan);
  const fileMap = new Map(scan.files.map((f) => [f.relPath, f]));
  const seen = new Set<string>();

  for (const finding of findings) {
    if (seen.has(finding.file)) continue;
    seen.add(finding.file);
    // A file another deterministic fix edits in this run is not a deletion
    // candidate: let that fix land first and re-scan before considering it.
    if (patchedFiles.has(finding.file)) continue;
    const file = fileMap.get(finding.file);
    if (!file) {
      skip(finding, 'file is no longer part of the scanned file set');
      continue;
    }
    const reason = liveFileReason(file, entries, refs, dirtyFiles);
    if (reason) {
      skip(finding, reason);
      continue;
    }
    let current: string;
    try {
      current = readFileSync(file.absPath, 'utf8');
    } catch {
      skip(finding, 'file could not be read from disk');
      continue;
    }
    if (current !== file.content) {
      skip(finding, 'file changed on disk since the scan');
    } else {
      deletions.push({
        relPath: file.relPath,
        absPath: file.absPath,
        content: file.content,
        ruleId: finding.ruleId,
        line: finding.span.line,
      });
    }
  }
  return { deletions, skipped };
}
