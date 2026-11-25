import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { BaselineSnapshot, Finding } from '../contracts.js';
import { findingFingerprint, type ScanResult } from './scanner.js';
import { computeScore } from './scorer.js';

const execFileAsync = promisify(execFile);

export const BASELINE_FILENAME = 'unshit.baseline.json';

/** Inclusive line range (1-based) of a change in a file. */
export interface LineRange {
  start: number;
  end: number;
}

const DIFF_ARGS = [
  '-c',
  'core.quotepath=off',
  'diff',
  '--unified=0',
  '--no-color',
  '--no-ext-diff',
  '--relative',
  '--no-renames',
];

/** When running from a subdirectory, git status paths are relative to the repo root. */
async function getPathPrefix(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir });
    const rel = relative(stdout.trim(), rootDir).replaceAll('\\', '/');
    return rel && rel !== '.' ? rel : '';
  } catch {
    /* Not a git repo */
    return '';
  }
}

function normalizeChangedPath(raw: string): string | null {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      path = JSON.parse(path) as string;
    } catch {
      path = path.slice(1, -1);
    }
  }
  if (path === '/dev/null') return null;
  if (path.startsWith('b/')) path = path.slice(2);
  return path.replaceAll('\\', '/') || null;
}

function addChangedRange(map: Map<string, LineRange[]>, file: string, range: LineRange): void {
  const ranges = map.get(file);
  if (ranges) ranges.push(range);
  else map.set(file, [range]);
}

function normalizeChangedRanges(map: Map<string, LineRange[]>): Map<string, LineRange[]> {
  for (const [file, ranges] of map) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: LineRange[] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    map.set(file, merged);
  }
  return map;
}

/** Parses `@@ -a,b +c,d @@` hunks from a `git diff --unified=0` output. */
function parseDiffRanges(stdout: string, map: Map<string, LineRange[]>): void {
  let currentFile: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      currentFile = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      currentFile = normalizeChangedPath(line.slice(4));
      continue;
    }
    if (!currentFile) continue;
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    // `+c,0` is a pure deletion: there are no current-file lines to guard.
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 1 || count < 1) continue;
    addChangedRange(map, currentFile, { start, end: start + count - 1 });
  }
}

/** Lists untracked files, which have no diff hunks but are wholly in scope. */
async function getUntrackedFiles(rootDir: string, prefix: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: rootDir });
  const files: string[] = [];
  const entries = stdout.split('\0');
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i] ?? '';
    i += 1;
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    let file = entry.slice(3);
    if (/[RC]/.test(status)) {
      // Skip the original-path entry that follows for renames/copies.
      i += 1;
    }
    if (!status.includes('?') || !file) continue;
    file = file.replaceAll('\\', '/');
    if (prefix) {
      const p = prefix + '/';
      if (file.startsWith(p)) file = file.slice(p.length);
    }
    if (file) files.push(file);
  }
  return files;
}

async function assertMergeBase(rootDir: string, baseRef: string): Promise<void> {
  if (baseRef === 'HEAD') return;
  try {
    await execFileAsync('git', ['merge-base', baseRef, 'HEAD'], { cwd: rootDir });
  } catch {
    throw new Error(`unshit guard: unable to compute merge base for base ref "${baseRef}" (shallow checkout?). Re-run with fetch-depth: 0.`);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Captures a characterization baseline (`unshit.baseline.json`) before edits.
 */
export async function createBaseline(scan: ScanResult): Promise<BaselineSnapshot> {
  const fileHashes: Record<string, string> = {};
  for (const f of scan.files) {
    fileHashes[f.relPath] = sha256(f.content);
  }
  const snapshot: BaselineSnapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    rootDir: scan.rootDir,
    score: computeScore(scan.files, scan.findings),
    fingerprints: scan.findings.map(findingFingerprint),
    fileHashes,
  };
  await writeFile(join(scan.rootDir, BASELINE_FILENAME), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return snapshot;
}

function isBaselineSnapshot(value: unknown): value is BaselineSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.createdAt === 'string' &&
    typeof v.rootDir === 'string' &&
    typeof v.score === 'object' &&
    v.score !== null &&
    Array.isArray(v.fingerprints) &&
    typeof v.fileHashes === 'object' &&
    v.fileHashes !== null
  );
}

export async function loadBaseline(rootDir: string): Promise<BaselineSnapshot | null> {
  const filePath = join(rootDir, BASELINE_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT') {
      return null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt ${BASELINE_FILENAME}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isBaselineSnapshot(parsed)) {
    throw new Error(`Corrupt ${BASELINE_FILENAME}: invalid baseline snapshot`);
  }
  return parsed;
}

export interface GuardResult {
  passed: boolean;
  baselineScore: number;
  currentScore: number;
  newFindings: Finding[];
  resolvedCount: number;
}

/**
 * Lists relative paths changed vs `baseRef` plus uncommitted working-tree changes.
 */
export async function getChangedFiles(rootDir: string, baseRef = 'HEAD'): Promise<Set<string>> {
  const changed = new Set<string>();
  const addLines = (stdout: string): void => {
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) changed.add(trimmed.replaceAll('\\', '/'));
    }
  };

  await assertMergeBase(rootDir, baseRef);

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--relative', '--name-only', `${baseRef}...HEAD`], { cwd: rootDir });
    addLines(stdout);
  } catch {
    /* Detached or single-commit repo without baseRef...HEAD */
  }
  try {
    const prefix = await getPathPrefix(rootDir);
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: rootDir });
    const entries = stdout.split('\0');
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i] ?? '';
      i += 1;
      if (!entry || entry.length < 4) continue;
      const status = entry.slice(0, 2);
      const file = entry.slice(3);
      if (/[RC]/.test(status)) {
        // Skip the original-path entry that follows for renames/copies.
        i += 1;
      }
      if (!file) continue;
      if (status.includes('D')) continue;
      let relFile = file.replaceAll('\\', '/');
      if (prefix) {
        const p = prefix + '/';
        if (relFile.startsWith(p)) relFile = relFile.slice(p.length);
      }
      changed.add(relFile);
    }
  } catch {
    /* Not a git repo */
  }
  return changed;
}

/**
 * Lists changed line ranges relative to `baseRef...HEAD` plus the working tree.
 * Untracked files are treated as wholly changed.
 */
export async function getChangedLineRanges(rootDir: string, baseRef = 'HEAD'): Promise<Map<string, LineRange[]>> {
  const ranges = new Map<string, LineRange[]>();
  await assertMergeBase(rootDir, baseRef);

  const targets: string[] = [];
  if (baseRef !== 'HEAD') targets.push(`${baseRef}...HEAD`);
  targets.push('HEAD');

  for (const target of targets) {
    try {
      const { stdout } = await execFileAsync('git', [...DIFF_ARGS, target, '--'], { cwd: rootDir, maxBuffer: 32 * 1024 * 1024 });
      parseDiffRanges(stdout, ranges);
    } catch {
      /* Not a git repo, unborn HEAD, or an unavailable base ref. */
    }
  }

  const prefix = await getPathPrefix(rootDir);
  try {
    for (const file of await getUntrackedFiles(rootDir, prefix)) {
      addChangedRange(ranges, file, { start: 1, end: Number.MAX_SAFE_INTEGER });
    }
  } catch {
    /* Not a git repo */
  }

  return normalizeChangedRanges(ranges);
}

/**
 * Compares current scan against pinned baseline; fails on any new unwaived findings.
 * When `changedFiles` is provided, only findings in those files are evaluated.
 * When `changedLineRanges` is provided, only findings overlapping one of those ranges are evaluated.
 */
export function evaluateGuard(
  scan: ScanResult,
  baseline: BaselineSnapshot | null,
  changedFiles?: Set<string>,
  changedLineRanges?: Map<string, LineRange[]>,
): GuardResult {
  const scopedFindings = scan.findings.filter((f) => {
    if (changedFiles && !changedFiles.has(f.file)) return false;
    if (!changedLineRanges) return true;
    const ranges = changedLineRanges.get(f.file);
    if (!ranges || ranges.length === 0) return false;
    const start = f.span.line;
    const end = f.span.endLine ?? f.span.line;
    return ranges.some((range) => start <= range.end && end >= range.start);
  });
  const currentScore = computeScore(scan.files, scan.findings).score;

  if (!baseline) {
    const blocking = scopedFindings.filter((f) => f.severity === 'error' || f.severity === 'warn');
    return {
      passed: blocking.length === 0,
      baselineScore: currentScore,
      currentScore,
      newFindings: blocking,
      resolvedCount: 0,
    };
  }

  const baselineCounts = new Map<string, number>();
  for (const fp of baseline.fingerprints) {
    baselineCounts.set(fp, (baselineCounts.get(fp) ?? 0) + 1);
  }
  const currentCounts = new Map<string, number>();
  for (const f of scan.findings) {
    const fp = findingFingerprint(f);
    currentCounts.set(fp, (currentCounts.get(fp) ?? 0) + 1);
  }

  let resolvedCount = 0;
  for (const [fp, count] of baselineCounts) {
    const current = currentCounts.get(fp) ?? 0;
    resolvedCount += Math.max(0, count - current);
  }

  const consumed = new Map<string, number>();
  const newFindings = scopedFindings.filter((f) => {
    const fp = findingFingerprint(f);
    const baselineCount = baselineCounts.get(fp) ?? 0;
    const seen = consumed.get(fp) ?? 0;
    consumed.set(fp, seen + 1);
    return seen >= baselineCount;
  });

  const scoreOk = changedFiles || changedLineRanges ? true : currentScore >= baseline.score.score;
  return {
    passed: newFindings.length === 0 && scoreOk,
    baselineScore: baseline.score.score,
    currentScore,
    newFindings,
    resolvedCount,
  };
}