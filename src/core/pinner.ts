import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

export async function loadBaseline(rootDir: string): Promise<BaselineSnapshot | null> {
  try {
    const raw = await readFile(join(rootDir, BASELINE_FILENAME), 'utf8');
    return JSON.parse(raw) as BaselineSnapshot;
  } catch {
    return null;
  }
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

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { cwd: rootDir });
    addLines(stdout);
  } catch {
    /* Detached or single-commit repo without baseRef...HEAD */
  }
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootDir });
    for (const line of stdout.split(/\r?\n/)) {
      if (line.length > 3) {
        const file = line.slice(3).replace(/^.* -> /, '').trim();
        if (file) changed.add(file.replaceAll('\\', '/'));
      }
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

  const pinnedSet = new Set(baseline.fingerprints);
  const currentSet = new Set(scan.findings.map(findingFingerprint));
  const newFindings = scopedFindings.filter((f) => !pinnedSet.has(findingFingerprint(f)));
  let resolvedCount = 0;
  for (const fp of pinnedSet) {
    if (!currentSet.has(fp)) resolvedCount += 1;
  }
  const scoreOk = changedFiles ? true : currentScore >= baseline.score.score;
  return {
    passed: newFindings.length === 0 && scoreOk,
    baselineScore: baseline.score.score,
    currentScore,
    newFindings,
    resolvedCount,
  };
}
