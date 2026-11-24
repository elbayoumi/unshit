import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BaselineSnapshot, Finding } from '../contracts.js';
import { findingFingerprint, type ScanResult } from './scanner.js';
import { computeScore } from './scorer.js';

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
 * Compares current scan against pinned baseline; fails on any new unwaived findings.
 */
export function evaluateGuard(scan: ScanResult, baseline: BaselineSnapshot): GuardResult {
  const pinnedSet = new Set(baseline.fingerprints);
  const currentSet = new Set(scan.findings.map(findingFingerprint));
  const newFindings = scan.findings.filter((f) => !pinnedSet.has(findingFingerprint(f)));
  let resolvedCount = 0;
  for (const fp of pinnedSet) {
    if (!currentSet.has(fp)) resolvedCount += 1;
  }
  const currentScore = computeScore(scan.files, scan.findings).score;
  return {
    passed: newFindings.length === 0 && currentScore >= baseline.score.score,
    baselineScore: baseline.score.score,
    currentScore,
    newFindings,
    resolvedCount,
  };
}
