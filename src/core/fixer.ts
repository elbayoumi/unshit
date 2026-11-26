import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Finding, Patch } from '../contracts.js';
import { runAiFixesInWorktrees } from './ai-worktree.js';
import { formatUnifiedDiff, type FileDiff } from './fixers/diff.js';
import {
  isUnusedDependencyRule,
  planUnusedDependencyFixes,
} from './fixers/unused-dependency.js';
import {
  isUnusedFileRule,
  gitDirtyFiles,
  planUnusedFileDeletions,
  type UnusedFileDeletion,
} from './fixers/unused-file.js';
import { runScan } from './scanner.js';
import { isUnusedExportRule, planUnusedExportFixes } from './fixers/unused-export.js';
import { isMagicTimerRule, planMagicTimerFixes } from './fixers/magic-timer.js';
import { groupFindingsByFile, type PlanForFile } from './fixers/plan-by-file.js';
import type { FixSkip } from './fixers/skip.js';
import type { ScanResult } from './scanner.js';

interface FixOptions {
  apply: boolean;
  ai: boolean;
  maxAiFiles?: number;
}

interface FixSummary {
  deterministicPatches: Patch[];
  appliedCount: number;
  aiAttempted: string[];
  aiReverted: string[];
  /** Warnings from the AI phase, e.g. when worktree isolation is unavailable. */
  aiMessages: string[];
  dryRun: boolean;
  /** Unified diff of all deterministic patches; always computed, printed by the CLI on dry runs. */
  diff: string;
  /** Fixes that were deliberately not made, with the reason for each. */
  skipped: FixSkip[];
  /** Files a `ts/unused-file` fix would delete (dry run) or deleted (apply). */
  deletions: string[];
  deletedCount: number;
}

function applyEdits(content: string, patches: Patch[]): string {
  const edits = patches.flatMap((p) => p.edits).sort((a, b) => b.startOffset - a.startOffset);
  let next = content;
  for (const e of edits) {
    next = next.slice(0, e.startOffset) + e.replacement + next.slice(e.endOffset);
  }
  return next;
}

type FilePatches = Map<string, Patch[]>;

function collectDeterministicPatches(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  detectorMap: Map<string, ScanResult['detectors'][number]>,
  skipped: FixSkip[],
): { patches: Patch[]; patchesByFile: FilePatches } {
  const patches: Patch[] = [];

  const plans: Array<{ matches: (ruleId: string) => boolean; plan: PlanForFile }> = [
    { matches: isUnusedExportRule, plan: planUnusedExportFixes },
    { matches: isMagicTimerRule, plan: planMagicTimerFixes },
  ];
  for (const { matches, plan } of plans) {
    for (const [relPath, findings] of groupFindingsByFile(scan.findings, matches)) {
      const file = fileMap.get(relPath);
      if (!file) continue;
      const result = plan(file, findings);
      patches.push(...result.patches);
      skipped.push(...result.skipped);
    }
  }

  const dependencyFindings = scan.findings.filter((f) => isUnusedDependencyRule(f.ruleId));
  if (dependencyFindings.length > 0) {
    const plan = planUnusedDependencyFixes(scan, dependencyFindings);
    patches.push(...plan.patches);
    skipped.push(...plan.skipped);
  }

  for (const finding of scan.findings) {
    if (isUnusedExportRule(finding.ruleId)
      || isMagicTimerRule(finding.ruleId)
      || isUnusedDependencyRule(finding.ruleId)
      || isUnusedFileRule(finding.ruleId)) continue;
    const detector = detectorMap.get(finding.ruleId);
    const file = fileMap.get(finding.file);
    if (!detector?.fix || !file) continue;
    const patch = detector.fix(file, finding);
    if (patch && patch.edits.length > 0) patches.push(patch);
  }

  const patchesByFile: FilePatches = new Map();
  for (const patch of patches) {
    const list = patchesByFile.get(patch.file) ?? [];
    list.push(patch);
    patchesByFile.set(patch.file, list);
  }
  return { patches, patchesByFile };
}

async function planDeletions(
  scan: ScanResult,
  patchesByFile: FilePatches,
  skipped: FixSkip[],
  dirtyFiles?: Set<string>,
  patchedFiles?: Set<string>,
): Promise<UnusedFileDeletion[]> {
  const findings = scan.findings.filter((f) => isUnusedFileRule(f.ruleId));
  if (findings.length === 0) return [];
  const dirty = dirtyFiles ?? (await gitDirtyFiles(scan.rootDir));
  const patched = patchedFiles ?? new Set(patchesByFile.keys());
  const plan = planUnusedFileDeletions(scan, findings, dirty, patched);
  skipped.push(...plan.skipped);
  return plan.deletions;
}

/** Scanned files and manifests are the only files a deterministic patch may touch. */
function originalContent(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  manifestSet: Set<string>,
  relPath: string,
): Promise<string | null> {
  const file = fileMap.get(relPath);
  if (file) return Promise.resolve(file.content);
  if (manifestSet.has(relPath) && relPath.endsWith('package.json') && !relPath.includes('..')) {
    return readFile(join(scan.rootDir, relPath), 'utf8').catch(() => null);
  }
  return Promise.resolve(null);
}

function absolutePath(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  manifestSet: Set<string>,
  relPath: string,
): string | null {
  const file = fileMap.get(relPath);
  if (file) return file.absPath;
  if (manifestSet.has(relPath) && relPath.endsWith('package.json') && !relPath.includes('..')) {
    return join(scan.rootDir, relPath);
  }
  return null;
}

async function buildDiff(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  manifestSet: Set<string>,
  patchesByFile: FilePatches,
  deletions: UnusedFileDeletion[],
): Promise<string> {
  const inputs: FileDiff[] = [];
  for (const [relPath, patches] of patchesByFile) {
    const before = await originalContent(scan, fileMap, manifestSet, relPath);
    if (before === null) continue;
    const updated = applyEdits(before, patches);
    if (updated !== before) inputs.push({ file: relPath, before, after: updated });
  }
  for (const deletion of deletions) {
    inputs.push({ file: deletion.relPath, before: deletion.content, after: '' });
  }
  return formatUnifiedDiff(inputs);
}

async function applyDeterministicPatches(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  manifestSet: Set<string>,
  patchesByFile: FilePatches,
  deletions: UnusedFileDeletion[],
  skipped: FixSkip[],
): Promise<{ appliedCount: number; deletedCount: number }> {
  let appliedCount = 0;
  let deletedCount = 0;
  for (const [relPath, patches] of patchesByFile) {
    const before = await originalContent(scan, fileMap, manifestSet, relPath);
    const absPath = absolutePath(scan, fileMap, manifestSet, relPath);
    if (before === null || !absPath) continue;
    const updated = applyEdits(before, patches);
    if (updated !== before) {
      await writeFile(absPath, updated, 'utf8');
      appliedCount += patches.length;
    }
  }
  for (const deletion of deletions) {
    const current = await readFile(deletion.absPath, 'utf8').catch(() => null);
    if (current !== deletion.content) {
      skipped.push({
        file: deletion.relPath,
        ruleId: deletion.ruleId,
        line: deletion.line,
        reason: 'file changed on disk since the fix plan',
      });
      continue;
    }
    await unlink(deletion.absPath);
    deletedCount += 1;
  }
  return { appliedCount, deletedCount };
}

const MAX_ROUNDS = 10;

async function applyDeterministicToFixedPoint(
  scan: ScanResult,
  skipped: FixSkip[],
): Promise<{
  deterministicPatches: Patch[];
  deletions: string[];
  diff: string;
  appliedCount: number;
  deletedCount: number;
}> {
  const initialDirty = await gitDirtyFiles(scan.rootDir);
  const deterministicPatches: Patch[] = [];
  const deletions: string[] = [];
  let diff = '';
  let appliedCount = 0;
  let deletedCount = 0;

  let currentScan = scan;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const detectorMap = new Map(currentScan.detectors.map((d) => [d.id, d]));
    const fileMap = new Map(currentScan.files.map((f) => [f.relPath, f]));
    const manifestSet = new Set(currentScan.manifests ?? []);

    const roundSkipped: FixSkip[] = [];
    const { patches, patchesByFile } = collectDeterministicPatches(
      currentScan, fileMap, detectorMap, roundSkipped,
    );
    const patchedForDeletion = new Set<string>(patchesByFile.keys());
    const deletionPlan = await planDeletions(
      currentScan, patchesByFile, roundSkipped, initialDirty, patchedForDeletion,
    );
    const roundDiff = await buildDiff(
      currentScan, fileMap, manifestSet, patchesByFile, deletionPlan,
    );
    if (roundDiff) diff += diff ? `\n${roundDiff}` : roundDiff;

    let roundApplied = 0;
    let roundDeleted = 0;
    if (patches.length > 0 || deletionPlan.length > 0) {
      ({ appliedCount: roundApplied, deletedCount: roundDeleted } =
        await applyDeterministicPatches(
          currentScan, fileMap, manifestSet, patchesByFile, deletionPlan, roundSkipped,
        ));
      appliedCount += roundApplied;
      deletedCount += roundDeleted;
    }

    deterministicPatches.push(...patches);
    deletions.push(...deletionPlan.map((d) => d.relPath));

    const madeChanges = roundApplied > 0 || roundDeleted > 0;
    if (round === 0 || madeChanges) {
      const seenSkips = new Set(skipped.map((s) => `${s.ruleId}|${s.file}|${s.line}|${s.reason}`));
      for (const s of roundSkipped) {
        const key = `${s.ruleId}|${s.file}|${s.line}|${s.reason}`;
        if (!seenSkips.has(key)) {
          seenSkips.add(key);
          skipped.push(s);
        }
      }
    }

    if (!madeChanges) break;
    currentScan = await runScan(currentScan.rootDir, currentScan.config, [], { noCache: true });
  }

  return { deterministicPatches, deletions, diff, appliedCount, deletedCount };
}

async function runDeterministicDryRun(
  scan: ScanResult,
  skipped: FixSkip[],
): Promise<{
  deterministicPatches: Patch[];
  deletions: string[];
  diff: string;
  appliedCount: number;
  deletedCount: number;
}> {
  const fileMap = new Map(scan.files.map((f) => [f.relPath, f]));
  const manifestSet = new Set(scan.manifests ?? []);
  const detectorMap = new Map(scan.detectors.map((d) => [d.id, d]));
  const { patches, patchesByFile } = collectDeterministicPatches(scan, fileMap, detectorMap, skipped);
  const deletionPlan = await planDeletions(scan, patchesByFile, skipped);
  const diff = await buildDiff(scan, fileMap, manifestSet, patchesByFile, deletionPlan);
  return {
    deterministicPatches: patches,
    deletions: deletionPlan.map((d) => d.relPath),
    diff,
    appliedCount: 0,
    deletedCount: 0,
  };
}

export async function runFix(scan: ScanResult, opts: FixOptions): Promise<FixSummary> {
  const fileMap0 = new Map(scan.files.map((f) => [f.relPath, f]));
  const skipped: FixSkip[] = [];

  const outcome = opts.apply
    ? await applyDeterministicToFixedPoint(scan, skipped)
    : await runDeterministicDryRun(scan, skipped);

  const aiAttempted: string[] = [];
  const aiReverted: string[] = [];
  const aiMessages: string[] = [];
  if (opts.apply && opts.ai) {
    const ai = await runAiFixesInWorktrees(scan, fileMap0, opts.maxAiFiles ?? 5);
    aiAttempted.push(...ai.attempted);
    aiReverted.push(...ai.reverted);
    aiMessages.push(...ai.messages);
    for (const message of aiMessages) console.warn(message);
  }

  return {
    deterministicPatches: outcome.deterministicPatches,
    appliedCount: outcome.appliedCount,
    aiAttempted,
    aiReverted,
    aiMessages,
    dryRun: !opts.apply,
    diff: outcome.diff,
    skipped,
    deletions: outcome.deletions,
    deletedCount: outcome.deletedCount,
  };
}
