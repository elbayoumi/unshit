import type { Detector, DetectorContext, Finding } from '../contracts.js';
import { isTsLikeFile, tokenize, type TokenUnit } from './clones-tokenize.js';

interface CloneWindow {
  file: string;
  startLine: number;
  endLine: number;
  startToken: number;
  endToken: number;
}

const LOGIC_DENSITY_MIN = 3;
const SAME_FILE_LOGIC_MIN = 6;

function mergeWindows(windows: CloneWindow[]): CloneWindow[] {
  const sorted = windows
    .map((window) => ({ ...window }))
    .sort((a, b) => a.startToken - b.startToken || a.startLine - b.startLine);
  const merged: CloneWindow[] = [];

  for (const window of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push(window);
      continue;
    }
    const overlapsTokens = window.startToken <= last.endToken;
    const adjacentLines = window.startLine <= last.endLine + 1;
    if (overlapsTokens || adjacentLines) {
      last.startToken = Math.min(last.startToken, window.startToken);
      last.endToken = Math.max(last.endToken, window.endToken);
      last.startLine = Math.min(last.startLine, window.startLine);
      last.endLine = Math.max(last.endLine, window.endLine);
    } else {
      merged.push(window);
    }
  }
  return merged;
}

function buildLogicPrefix(tokens: TokenUnit[]): number[] {
  const prefix = new Array<number>(tokens.length + 1).fill(0);
  for (let i = 0; i < tokens.length; i++) prefix[i + 1] = prefix[i]! + (tokens[i]!.logic ? 1 : 0);
  return prefix;
}

function addTokenWindows(
  file: string,
  tokens: TokenUnit[],
  logicPrefix: number[],
  windowSize: number,
  buckets: Map<string, CloneWindow[]>,
): void {
  for (let i = 0; i <= tokens.length - windowSize; i += 1) {
    const end = i + windowSize;
    if (logicPrefix[end]! - logicPrefix[i]! < LOGIC_DENSITY_MIN) continue;
    const signature = tokens.slice(i, end).map((token) => token.norm).join(' ');
    const list = buckets.get(signature) ?? [];
    list.push({ file, startLine: tokens[i]!.line, endLine: tokens[end - 1]!.line, startToken: i, endToken: end });
    buckets.set(signature, list);
  }
}

function recordSameFilePair(
  sameFile: Map<string, { earlier: CloneWindow[]; later: CloneWindow[] }>,
  file: string,
  earlier: CloneWindow,
  later: CloneWindow,
): void {
  const entry = sameFile.get(file) ?? { earlier: [], later: [] };
  entry.earlier.push(earlier);
  entry.later.push(later);
  sameFile.set(file, entry);
}

function analyzeBucket(
  occurrences: CloneWindow[],
  windowSize: number,
  pairs: Map<string, { first: string; second: string; windows: CloneWindow[] }>,
  sameFile: Map<string, { earlier: CloneWindow[]; later: CloneWindow[] }>,
): void {
  const byFile = new Map<string, CloneWindow[]>();
  for (const occurrence of occurrences) {
    const list = byFile.get(occurrence.file) ?? [];
    list.push(occurrence);
    byFile.set(occurrence.file, list);
  }
  for (const [file, list] of byFile) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.startToken - b.startToken);
    for (let j = 1; j < sorted.length; j++) {
      const earlier = sorted.find((w) => sorted[j]!.startToken - w.startToken >= windowSize);
      if (!earlier) continue;
      recordSameFilePair(sameFile, file, earlier, sorted[j]!);
    }
  }
  const fileNames = [...byFile.keys()].sort();
  if (fileNames.length < 2) return;
  for (let a = 0; a < fileNames.length; a++) {
    for (let b = a + 1; b < fileNames.length; b++) {
      const first = fileNames[a]!;
      const second = fileNames[b]!;
      const key = `${first}\u0000${second}`;
      let entry = pairs.get(key);
      if (!entry) {
        entry = { first, second, windows: [] };
        pairs.set(key, entry);
      }
      entry.windows.push(...byFile.get(first)!, ...byFile.get(second)!);
    }
  }
}

function emitCrossFileFindings(
  detector: Detector,
  pairs: Map<string, { first: string; second: string; windows: CloneWindow[] }>,
  findings: Finding[],
): void {
  for (const { first, second, windows } of pairs.values()) {
    const firstRegions = mergeWindows(windows.filter((window) => window.file === first));
    const secondRegions = mergeWindows(windows.filter((window) => window.file === second));
    if (firstRegions.length === 0 || secondRegions.length === 0) continue;
    for (let i = 0; i < secondRegions.length; i++) {
      const source = firstRegions[Math.min(i, firstRegions.length - 1)]!;
      const target = secondRegions[i]!;
      const tokenCount = target.endToken - target.startToken;
      findings.push({
        ruleId: detector.id, category: detector.category, tier: detector.tier, severity: detector.severity,
        fixability: 'ai', confidence: 0.82, file: target.file,
        span: { line: target.startLine, column: 1, endLine: target.endLine },
        message: `Duplicate logic block (~${tokenCount} tokens) matches ${source.file}:${source.startLine}-${source.endLine}.`,
        evidence: `${target.file}:${target.startLine}-${target.endLine} <-> ${source.file}:${source.startLine}-${source.endLine}`,
      });
    }
  }
}

function isSameFileTarget(
  target: CloneWindow,
  sources: CloneWindow[],
  reported: CloneWindow[],
  logicByFile: Map<string, number[]>,
  windowSize: number,
  file: string,
): boolean {
  const size = target.endToken - target.startToken;
  const overlap = (w: CloneWindow): number => Math.max(0, Math.min(target.endToken, w.endToken) - Math.max(target.startToken, w.startToken));
  if (sources.some((w) => overlap(w) * 2 > size) || reported.some((w) => overlap(w) > 0)) return false;
  if (target.endToken - target.startToken < windowSize * 1.5) return false;
  const prefix = logicByFile.get(file)!;
  return prefix[target.endToken]! - prefix[target.startToken]! >= SAME_FILE_LOGIC_MIN;
}

function emitSameFileFindings(
  detector: Detector,
  sameFile: Map<string, { earlier: CloneWindow[]; later: CloneWindow[] }>,
  logicByFile: Map<string, number[]>,
  windowSize: number,
  findings: Finding[],
): void {
  for (const [file, { earlier, later }] of sameFile) {
    const sources = mergeWindows(earlier);
    const reported: CloneWindow[] = [];
    const targets = mergeWindows(later).sort((a, b) => (b.endToken - b.startToken) - (a.endToken - a.startToken));
    for (const target of targets) {
      if (!isSameFileTarget(target, sources, reported, logicByFile, windowSize, file)) continue;
      reported.push(target);
      const source = sources.find((src) => src.endToken <= target.startToken) ?? sources[0]!;
      const tokenCount = target.endToken - target.startToken;
      findings.push({
        ruleId: detector.id, category: detector.category, tier: detector.tier, severity: detector.severity,
        fixability: 'ai', confidence: 0.7, file,
        span: { line: target.startLine, column: 1, endLine: target.endLine },
        message: `Duplicate logic block (~${tokenCount} tokens) repeats ${file}:${source.startLine}-${source.endLine} in the same file.`,
        evidence: `${file}:${target.startLine}-${target.endLine} <-> ${file}:${source.startLine}-${source.endLine}`,
      });
    }
  }
}

/**
 * jscpd-inspired rolling token-window clone detector.
 */
export const duplicateBlockDetector: Detector = {
  id: 'code/duplicate-block',
  category: 'duplication',
  tier: 'structural',
  severity: 'info',
  description: 'Detects copy-pasted structural token blocks across and within source files.',
  detect(ctx: DetectorContext): Finding[] {
    const windowSize = Math.max(1, Math.floor(ctx.config.cloneMinTokens));
    const buckets = new Map<string, CloneWindow[]>();
    const logicByFile = new Map<string, number[]>();

    for (const file of ctx.files) {
      if (!isTsLikeFile(file) || /\.(test|spec|d)\./.test(file.relPath)) continue;
      const tokens = tokenize(file);
      if (tokens.length < windowSize) continue;
      const logicPrefix = buildLogicPrefix(tokens);
      logicByFile.set(file.relPath, logicPrefix);
      addTokenWindows(file.relPath, tokens, logicPrefix, windowSize, buckets);
    }

    const pairs = new Map<string, { first: string; second: string; windows: CloneWindow[] }>();
    const sameFile = new Map<string, { earlier: CloneWindow[]; later: CloneWindow[] }>();
    for (const occurrences of buckets.values()) analyzeBucket(occurrences, windowSize, pairs, sameFile);

    const findings: Finding[] = [];
    emitCrossFileFindings(this, pairs, findings);
    emitSameFileFindings(this, sameFile, logicByFile, windowSize, findings);
    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.span.line - b.span.line);
  },
};
