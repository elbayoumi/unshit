import { join } from 'node:path';
import type { Finding } from '../contracts.js';
import type { ScanResult } from './scanner.js';
import {
  cleanupWorktrees,
  countLines,
  createWorktree,
  git,
  runAiRunner,
  runVerify,
  runWithInput,
} from './swarm-runtime.js';

/** Outcome of the isolated single-file AI fix pass. */
interface AiFixOutcome {
  attempted: string[];
  landed: string[];
  reverted: string[];
  messages: string[];
}

interface AiRunState {
  rootDir: string;
  runId: string;
  baseSha: string;
  config: ScanResult['config'];
  outcome: AiFixOutcome;
}

const AI_MAX_DIFF_LINES = 300;
const NO_GIT_MESSAGE = 'unshit fix --ai: skipped AI fixes because isolated worktree execution requires a git repository (no .git found at the scan root); the working tree was left untouched.';
const NO_HEAD_MESSAGE = 'unshit fix --ai: skipped AI fixes because the git repository has no commit to base a worktree on; the working tree was left untouched.';

function isGitRepo(rootDir: string): Promise<boolean> {
  return git(['rev-parse', '--is-inside-work-tree'], rootDir)
    .then(({ stdout }) => stdout.trim() === 'true')
    .catch(() => false);
}

async function changedFiles(wtPath: string): Promise<string[]> {
  const { stdout } = await git(['diff', '--name-only'], wtPath);
  return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function headMatches(rootDir: string, baseSha: string): Promise<boolean> {
  try {
    const { stdout } = await git(['rev-parse', 'HEAD'], rootDir);
    return stdout.trim() === baseSha;
  } catch {
    return false;
  }
}

async function applyPatch(rootDir: string, patch: string): Promise<boolean> {
  if (patch.trim() === '') return false;
  try {
    await runWithInput('git', ['apply', '--check', '--3way'], rootDir, patch, 120_000);
    await runWithInput('git', ['apply', '--3way'], rootDir, patch, 120_000);
    return true;
  } catch {
    return false;
  }
}

/** Run one AI fix in a detached worktree and land it only after every gate passes. */
async function runOneFile(
  state: AiRunState,
  relPath: string,
  findings: Finding[],
  index: number,
): Promise<void> {
  const { rootDir, runId, baseSha, config, outcome } = state;
  const wtPath = join(rootDir, '.unshit', 'wt', `${runId}-${index}`);
  try {
    await createWorktree(rootDir, wtPath, baseSha);
    const aiOk = await runAiRunner(config, wtPath, relPath, findings);
    if (!aiOk) {
      outcome.reverted.push(relPath);
      return;
    }
    const changed = await changedFiles(wtPath);
    if (changed.length !== 1 || changed[0] !== relPath) {
      outcome.reverted.push(relPath);
      return;
    }
    const { stdout: patch } = await git(['diff'], wtPath);
    if (countLines(patch) > AI_MAX_DIFF_LINES) {
      outcome.reverted.push(relPath);
      return;
    }
    if (!(await runVerify(wtPath, config.verifyCommand))) {
      outcome.reverted.push(relPath);
      return;
    }
    if (!(await headMatches(rootDir, baseSha)) || !(await applyPatch(rootDir, patch))) {
      outcome.reverted.push(relPath);
      return;
    }
    outcome.landed.push(relPath);
  } catch {
    outcome.reverted.push(relPath);
  }
}

/** Group AI-fixable findings by file, skipping rules with deterministic fixes. */
function groupAiFindings(scan: ScanResult): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of scan.findings) {
    if (finding.fixability !== 'ai') continue;
    if (finding.ruleId.startsWith('ts/unused-file')
      || finding.ruleId.startsWith('deps/unused-dependency')) continue;
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  return byFile;
}

/**
 * Single-file `fix --ai` parity with `fix --swarm`: each AI edit runs in a
 * temporary detached worktree, is verified there, and is only applied to the
 * user's tree through a compare-and-swap patch landing.
 */
export async function runAiFixesInWorktrees(
  scan: ScanResult,
  fileMap: Map<string, ScanResult['files'][number]>,
  maxFiles: number,
): Promise<AiFixOutcome> {
  const outcome: AiFixOutcome = { attempted: [], landed: [], reverted: [], messages: [] };
  if (!(await isGitRepo(scan.rootDir))) {
    outcome.messages.push(NO_GIT_MESSAGE);
    return outcome;
  }
  const byFile = groupAiFindings(scan);
  const entries = [...byFile.entries()]
    .filter(([relPath]) => fileMap.has(relPath))
    .slice(0, maxFiles);
  if (entries.length === 0) return outcome;

  let baseSha = '';
  try {
    const { stdout } = await git(['rev-parse', 'HEAD'], scan.rootDir);
    baseSha = stdout.trim();
  } catch {
    outcome.messages.push(NO_HEAD_MESSAGE);
    return outcome;
  }
  const state: AiRunState = {
    rootDir: scan.rootDir,
    runId: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    baseSha,
    config: scan.config,
    outcome,
  };
  try {
    for (const [index, [relPath, findings]] of entries.entries()) {
      outcome.attempted.push(relPath);
      await runOneFile(state, relPath, findings, index);
    }
  } finally {
    await cleanupWorktrees(scan.rootDir);
  }
  return outcome;
}
