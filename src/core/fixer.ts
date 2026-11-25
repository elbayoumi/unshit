import { execFile } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Finding, Patch } from '../contracts.js';
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
import { isUnusedExportRule, planUnusedExportFixes } from './fixers/unused-export.js';
import type { ScanResult } from './scanner.js';

const execFileAsync = promisify(execFile);

interface FixOptions {
  apply: boolean;
  ai: boolean;
  maxAiFiles?: number;
}

/** A fix that was deliberately not made, with the reason. */
interface FixSkip {
  file: string;
  ruleId: string;
  line: number;
  reason: string;
}

interface FixSummary {
  deterministicPatches: Patch[];
  appliedCount: number;
  aiAttempted: string[];
  aiReverted: string[];
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

async function runVerify(rootDir: string, verifyCommand?: string): Promise<boolean> {
  if (!verifyCommand) return true;
  try {
    await execFileAsync('sh', ['-c', verifyCommand], { cwd: rootDir, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

async function runAiFixForFile(
  rootDir: string,
  relPath: string,
  findings: Finding[],
  runner: 'opencode' | 'claude',
  model?: string,
): Promise<boolean> {
  const summary = findings
    .slice(0, 12)
    .map((f) => `- [${f.ruleId}] line ${f.span.line}: ${f.message}`)
    .join('\n');
  const prompt = [
    `Fix ONLY the following unshit findings in ${relPath}. Keep behavior identical and do not add 'any', '@ts-ignore', or inline i18n ternaries.`,
    summary,
  ].join('\n');

  try {
    if (runner === 'claude') {
      await execFileAsync('claude', ['-p', prompt, '--allowedTools', 'Edit', 'Read'], { cwd: rootDir, timeout: 180_000 });
    } else {
      const args = ['run'];
      if (model) args.push('-m', model);
      args.push('--auto', prompt);
      await execFileAsync('opencode', args, { cwd: rootDir, timeout: 180_000 });
    }
    return true;
  } catch {
    return false;
  }
}

type FilePatches = Map<string, Patch[]>;

function collectDeterministicPatches(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  detectorMap: Map<string, ScanResult['detectors'][number]>,
  skipped: FixSkip[],
): { patches: Patch[]; patchesByFile: FilePatches } {
  const patches: Patch[] = [];

  const unusedByFile = new Map<string, Finding[]>();
  for (const finding of scan.findings) {
    if (!isUnusedExportRule(finding.ruleId)) continue;
    const list = unusedByFile.get(finding.file) ?? [];
    list.push(finding);
    unusedByFile.set(finding.file, list);
  }
  for (const [relPath, findings] of unusedByFile) {
    const file = fileMap.get(relPath);
    if (!file) continue;
    const plan = planUnusedExportFixes(file, findings);
    patches.push(...plan.patches);
    skipped.push(...plan.skipped);
  }

  const dependencyFindings = scan.findings.filter((f) => isUnusedDependencyRule(f.ruleId));
  if (dependencyFindings.length > 0) {
    const plan = planUnusedDependencyFixes(scan, dependencyFindings);
    patches.push(...plan.patches);
    skipped.push(...plan.skipped);
  }

  for (const finding of scan.findings) {
    if (isUnusedExportRule(finding.ruleId)
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
): Promise<UnusedFileDeletion[]> {
  const findings = scan.findings.filter((f) => isUnusedFileRule(f.ruleId));
  if (findings.length === 0) return [];
  const dirty = await gitDirtyFiles(scan.rootDir);
  const plan = planUnusedFileDeletions(scan, findings, dirty, new Set(patchesByFile.keys()));
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

async function runAiFixes(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  opts: FixOptions,
): Promise<{ attempted: string[]; reverted: string[] }> {
  const attempted: string[] = [];
  const reverted: string[] = [];
  const aiByFile = new Map<string, Finding[]>();
  for (const finding of scan.findings) {
    // These rules have deterministic fixes and must never be handed to an AI runner.
    if (isUnusedFileRule(finding.ruleId) || isUnusedDependencyRule(finding.ruleId)) continue;
    if (finding.fixability !== 'ai') continue;
    const list = aiByFile.get(finding.file) ?? [];
    list.push(finding);
    aiByFile.set(finding.file, list);
  }
  const maxFiles = opts.maxAiFiles ?? 5;
  for (const [relPath, findings] of [...aiByFile.entries()].slice(0, maxFiles)) {
    const target = fileMap.get(relPath);
    if (!target) continue;
    const snapshot = await readFile(target.absPath, 'utf8');
    attempted.push(relPath);
    const ok = await runAiFixForFile(
      scan.rootDir,
      relPath,
      findings,
      scan.config.aiRunner,
      scan.config.aiModel,
    );
    const verified = ok && (await runVerify(scan.rootDir, scan.config.verifyCommand));
    if (!verified) {
      reverted.push(relPath);
      await writeFile(target.absPath, snapshot, 'utf8');
    }
  }
  return { attempted, reverted };
}

/**
 * Applies deterministic safe patches first (including unused dependency keys
 * and provably unreferenced files), then optionally runs gated AI fixes.
 */
export async function runFix(scan: ScanResult, opts: FixOptions): Promise<FixSummary> {
  const detectorMap = new Map(scan.detectors.map((d) => [d.id, d]));
  const fileMap = new Map(scan.files.map((f) => [f.relPath, f]));
  const manifestSet = new Set(scan.manifests ?? []);
  const skipped: FixSkip[] = [];

  const { patches, patchesByFile } = collectDeterministicPatches(scan, fileMap, detectorMap, skipped);
  const deletionPlan = await planDeletions(scan, patchesByFile, skipped);
  const diff = await buildDiff(scan, fileMap, manifestSet, patchesByFile, deletionPlan);

  let appliedCount = 0;
  let deletedCount = 0;
  if (opts.apply) {
    ({ appliedCount, deletedCount } = await applyDeterministicPatches(
      scan, fileMap, manifestSet, patchesByFile, deletionPlan, skipped,
    ));
  }

  const aiAttempted: string[] = [];
  const aiReverted: string[] = [];
  if (opts.apply && opts.ai) {
    const ai = await runAiFixes(scan, fileMap, opts);
    aiAttempted.push(...ai.attempted);
    aiReverted.push(...ai.reverted);
  }

  return {
    deterministicPatches: patches,
    appliedCount,
    aiAttempted,
    aiReverted,
    dryRun: !opts.apply,
    diff,
    skipped,
    deletions: deletionPlan.map((d) => d.relPath),
    deletedCount,
  };
}
