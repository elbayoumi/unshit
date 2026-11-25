import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Finding } from '../contracts.js';
import type { ScanResult } from './scanner.js';
import {
  cleanupWorktrees,
  countLines,
  createWorktree,
  fillPatchHash,
  git,
  runAiRunner,
  runVerify,
  runWithInput,
  sha256,
  type SwarmFixSummary,
  type SwarmWorkerResult,
} from './swarm-runtime.js';

export { abortSwarmFix } from './swarm-runtime.js';

interface SwarmOpts {
  apply: boolean;
  concurrency?: number;
  maxFiles?: number;
  maxDiffLines?: number;
}

interface SwarmRunState {
  rootDir: string;
  runId: string;
  baseSha: string;
  config: ScanResult['config'];
  maxDiffLines: number;
  patches: Map<string, string>;
  worktrees: string[];
}

async function runSwarmWorker(
  state: SwarmRunState,
  relPath: string,
  findings: Finding[],
  index: number,
): Promise<SwarmWorkerResult> {
  const { rootDir, runId, baseSha, config, maxDiffLines, patches, worktrees } = state;
  const wtPath = join(rootDir, '.unshit', 'wt', `${runId}-${index}`);
  const result: SwarmWorkerResult = {
    index,
    relPath,
    worktree: wtPath,
    status: 'failed',
    ok: false,
  };
  try {
    await createWorktree(rootDir, wtPath, baseSha);
    worktrees.push(wtPath);

    const aiOk = await runAiRunner(config, wtPath, relPath, findings);
    if (!aiOk) {
      result.reason = 'ai runner failed';
    } else {
      const { stdout: namesOut } = await git(['diff', '--name-only'], wtPath);
      const changed = namesOut
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      result.changedFiles = changed;

      const { stdout: diffOut } = await git(['diff'], wtPath);
      const patch = diffOut;
      const lines = countLines(patch);
      result.diffLines = lines;
      result.patchHash = sha256(patch);

      if (changed.length !== 1 || changed[0] !== relPath) {
        result.reason = `changed files not allowlisted: ${changed.join(', ')}`;
      } else if (lines > maxDiffLines) {
        result.reason = `diff lines ${lines} > ${maxDiffLines}`;
      } else {
        const verified = await runVerify(wtPath, config.verifyCommand);
        if (!verified) {
          result.reason = 'verifyCommand failed';
        } else {
          result.status = 'ok';
          result.ok = true;
          patches.set(relPath, patch);
        }
      }
    }

    if (result.status !== 'ok') {
      // ensure patch hash captured even on ai failure
      await fillPatchHash(result, wtPath, true);
    }
  } catch (err) {
    result.reason = err instanceof Error ? err.message : String(err);
    await fillPatchHash(result, wtPath, false);
  }
  return result;
}

async function applyPatchBatch(
  stagingPath: string,
  patches: Map<string, string>,
  relPaths: string[],
): Promise<string[]> {
  const applied: string[] = [];
  for (const relPath of relPaths) {
    const patch = patches.get(relPath)!;
    let checkOk = true;
    try {
      await runWithInput('git', ['apply', '--check', '--3way'], stagingPath, patch, 120_000);
    } catch {
      checkOk = false;
    }
    if (!checkOk) continue; // drop conflicting
    try {
      await runWithInput('git', ['apply', '--3way'], stagingPath, patch, 120_000);
      applied.push(relPath);
    } catch {
      // drop: attempt reverse
      await runWithInput('git', ['apply', '-R'], stagingPath, patch, 120_000).catch(() => {});
    }
  }
  return applied;
}

/** Compare-and-swap landing: only land while HEAD still matches the pinned base. */
async function landPatches(
  rootDir: string,
  stagingPath: string,
  baseSha: string,
  applied: string[],
): Promise<string[]> {
  const { stdout: headNow } = await git(['rev-parse', 'HEAD'], rootDir);
  if (headNow.trim() !== baseSha) return [];
  if (applied.length === 0) return applied;
  const { stdout: combined } = await git(['diff'], stagingPath);
  if (combined.trim() === '') return applied;
  try {
    await runWithInput('git', ['apply', '--3way'], rootDir, combined, 120_000);
  } catch {
    await git(['checkout', '--', '.'], rootDir).catch(() => {});
    await git(['clean', '-fd'], rootDir).catch(() => {});
    return [];
  }
  return applied;
}

async function applyApprovedPatches(
  state: SwarmRunState,
  workerResults: SwarmWorkerResult[],
): Promise<string[]> {
  const { rootDir, runId, baseSha, patches, worktrees } = state;
  const gated = workerResults
    .filter((w) => w.status === 'ok')
    .map((w) => w.relPath)
    .sort();
  const nonEmptyGated = gated.filter((rp) => (patches.get(rp) ?? '').trim() !== '');
  if (nonEmptyGated.length === 0) return [];

  const stagingPath = join(rootDir, '.unshit', 'wt', `${runId}-staging`);
  await createWorktree(rootDir, stagingPath, baseSha);
  worktrees.push(stagingPath);

  const applied = await applyPatchBatch(stagingPath, patches, nonEmptyGated);
  return landPatches(rootDir, stagingPath, baseSha, applied);
}

export async function runSwarmFix(scan: ScanResult, opts: SwarmOpts): Promise<SwarmFixSummary> {
  const rootDir = scan.rootDir;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const maxFiles = Math.max(1, opts.maxFiles ?? 5);
  const maxDiffLines = opts.maxDiffLines ?? 300;

  const unshitDir = join(rootDir, '.unshit');
  const runsDir = join(unshitDir, 'runs');
  const lockPath = join(unshitDir, 'lock');

  let lockAcquired = false;
  let workerResults: SwarmWorkerResult[] = [];
  const patches = new Map<string, string>();
  const worktrees: string[] = [];
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const journalPath = join(runsDir, `${runId}.json`);
  const startedAt = new Date().toISOString();
  let baseSha = '';

  try {
    // Refuse on dirty working tree.
    const { stdout: statusOut } = await git(['status', '--porcelain'], rootDir);
    if (statusOut.trim() !== '') {
      throw new Error('Refusing to start swarm fix: dirty working tree');
    }

    await mkdir(runsDir, { recursive: true });

    // Acquire single-writer lock.
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' });
      lockAcquired = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') {
        throw new Error('Swarm fix already running: lockfile exists');
      }
      throw err;
    }

    const { stdout: baseOut } = await git(['rev-parse', 'HEAD'], rootDir);
    baseSha = baseOut.trim();
    const state: SwarmRunState = {
      rootDir,
      runId,
      baseSha,
      config: scan.config,
      maxDiffLines,
      patches,
      worktrees,
    };

    // Group ai findings by disjoint relPath.
    const aiByFile = new Map<string, Finding[]>();
    for (const f of scan.findings) {
      if (f.fixability !== 'ai') continue;
      const list = aiByFile.get(f.file) ?? [];
      list.push(f);
      aiByFile.set(f.file, list);
    }
    const relPaths = [...aiByFile.keys()].sort().slice(0, maxFiles);

    // Run workers with concurrency limit.
    const items = relPaths.map((rp, i) => ({ rp, findings: aiByFile.get(rp) ?? [], i }));
    workerResults = new Array(items.length);
    let next = 0;
    async function runner(): Promise<void> {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        const item = items[idx]!;
        workerResults[idx] = await runSwarmWorker(state, item.rp, item.findings, item.i);
      }
    }
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
    await Promise.all(runners);

    // Apply phase.
    const applied = opts.apply ? await applyApprovedPatches(state, workerResults) : [];

    // Write journal.
    const journal = {
      runId,
      baseSha,
      rootDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      concurrency,
      maxFiles,
      maxDiffLines,
      apply: opts.apply,
      applied,
      appliedCount: applied.length,
      workers: workerResults,
    };
    await writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n', 'utf8');

    return {
      runId,
      baseSha,
      workers: workerResults,
      applied,
      appliedCount: applied.length,
      dryRun: !opts.apply,
      journalPath,
    };
  } finally {
    await cleanupWorktrees(rootDir);
    if (lockAcquired) {
      await rm(lockPath, { force: true }).catch(() => {});
    }
  }
}


