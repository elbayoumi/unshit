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

  if (baseRef !== 'HEAD') {
    try {
      await execFileAsync('git', ['merge-base', baseRef, 'HEAD'], { cwd: rootDir });
    } catch {
      throw new Error(`unshit guard: unable to compute merge base for base ref "${baseRef}" (shallow checkout?). Re-run with fetch-depth: 0.`);
    }
  }

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--relative', '--name-only', `${baseRef}...HEAD`], { cwd: rootDir });
    addLines(stdout);
  } catch {
    /* Detached or single-commit repo without baseRef...HEAD */
  }
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: rootDir });
    let prefix = '';
    try {
      const { stdout: top } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir });
      const rel = relative(top.trim(), rootDir).replaceAll('\\', '/');
      if (rel && rel !== '.') prefix = rel;
    } catch {
      /* Not a git repo */
    }
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
 * Compares current scan against pinned baseline; fails on any new unwaived findings.
 * When `changedFiles` is provided, only findings in those files are evaluated.
 */
export function evaluateGuard(
  scan: ScanResult,
  baseline: BaselineSnapshot | null,
  changedFiles?: Set<string>,
): GuardResult {
  const scopedFindings = changedFiles
    ? scan.findings.filter((f) => changedFiles.has(f.file))
    : scan.findings;
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

  const scoreOk = changedFiles ? true : currentScore >= baseline.score.score;
  return {
    passed: newFindings.length === 0 && scoreOk,
    baselineScore: baseline.score.score,
    currentScore,
    newFindings,
    resolvedCount,
  };
}