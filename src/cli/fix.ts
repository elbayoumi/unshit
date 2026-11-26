import type { ScanResult } from '../core/scanner.js';
import { errorMessage, getFlag, getOpt, type CommandContext } from './shared.js';

export async function runAbortCommand(targetDir: string): Promise<number> {
  try {
    const { abortSwarmFix } = await import('../core/swarm-fixer.js');
    const removed = await abortSwarmFix(targetDir);
    console.log(`unshit fix --abort: removed ${removed} stale worktree(s), pruned, lock cleared.`);
    return 0;
  } catch (err) {
    console.error(`unshit fix --abort: ${errorMessage(err)}`);
    return 2;
  }
}

async function runSwarmCommand(scan: ScanResult, rest: string[], apply: boolean): Promise<number> {
  try {
    const concurrencyRaw = getOpt(rest, '--concurrency');
    const maxFilesRaw = getOpt(rest, '--max-files');
    const maxDiffLinesRaw = getOpt(rest, '--max-diff-lines');
    const concurrency = concurrencyRaw ? Number.parseInt(concurrencyRaw, 10) : undefined;
    const maxFiles = maxFilesRaw ? Number.parseInt(maxFilesRaw, 10) : undefined;
    const maxDiffLines = maxDiffLinesRaw ? Number.parseInt(maxDiffLinesRaw, 10) : undefined;
    const { runSwarmFix } = await import('../core/swarm-fixer.js');
    const summary = await runSwarmFix(scan, {
      apply,
      concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
      maxFiles: Number.isFinite(maxFiles) ? maxFiles : undefined,
      maxDiffLines: Number.isFinite(maxDiffLines) ? maxDiffLines : undefined,
    });
    console.log(
      `unshit fix --swarm (${summary.dryRun ? 'dry-run' : 'applied'}): ${summary.workers.length} workers, ${summary.appliedCount} applied`,
    );
    const failed = summary.workers.some((w) => !w.ok);
    return failed ? 1 : 0;
  } catch (err) {
    console.error(`unshit fix --swarm: ${errorMessage(err)}`);
    return 2;
  }
}

async function runFixCommand(scan: ScanResult, rest: string[], apply: boolean, ai: boolean): Promise<number> {
  const { runFix } = await import('../core/fixer.js');
  const summary = await runFix(scan, { apply, ai });
  if (summary.dryRun) {
    if (summary.diff) process.stdout.write(summary.diff);
    for (const file of summary.deletions) {
      console.log(`  DELETE ${file} — would be removed by --apply`);
    }
  }
  for (const skip of summary.skipped) {
    console.log(`  SKIP [${skip.ruleId}] ${skip.file}:${skip.line} — ${skip.reason}`);
  }
  console.log(
    `unshit fix (${summary.dryRun ? 'dry-run' : 'applied'}): ${summary.deterministicPatches.length} deterministic patches (${summary.appliedCount} applied), deletions: ${summary.deletions.length} (${summary.deletedCount} deleted), skipped: ${summary.skipped.length}, AI attempted: ${summary.aiAttempted.length}, reverted: ${summary.aiReverted.length}, passes: ${summary.passes}`,
  );
  return summary.aiReverted.length > 0 ? 1 : 0;
}

export async function runFixDispatch({ rest, config, scan }: CommandContext): Promise<number> {
  const apply = getFlag(rest, '--apply');
  const ai = getFlag(rest, '--ai');
  const runner = getOpt(rest, '--runner');
  if (runner === 'claude' || runner === 'opencode') config.aiRunner = runner;
  const model = getOpt(rest, '--model');
  if (model) config.aiModel = model;

  if (getFlag(rest, '--swarm')) return runSwarmCommand(scan, rest, apply);
  return runFixCommand(scan, rest, apply, ai);
}
