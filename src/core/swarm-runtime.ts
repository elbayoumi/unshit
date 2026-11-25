import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Finding } from '../contracts.js';
import type { ScanResult } from './scanner.js';

const execFileAsync = promisify(execFile);

export function runWithInput(
  file: string,
  args: string[],
  cwd: string,
  input: string,
  timeout = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdin.write(input);
    child.stdin.end();
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout'));
    }, timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(stderr || `exit ${code}`), { code, stdout, stderr }));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export interface SwarmWorkerResult {
  index: number;
  relPath: string;
  worktree: string;
  status: 'ok' | 'failed';
  ok: boolean;
  reason?: string;
  patchHash?: string;
  diffLines?: number;
  changedFiles?: string[];
}

export interface SwarmFixSummary {
  runId: string;
  baseSha: string;
  workers: SwarmWorkerResult[];
  applied: string[];
  appliedCount: number;
  dryRun: boolean;
  journalPath: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function countLines(text: string): number {
  if (text === '') return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

export async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export async function runVerify(cwd: string, verifyCommand?: string): Promise<boolean> {
  if (!verifyCommand) return true;
  try {
    await execFileAsync('sh', ['-c', verifyCommand], { cwd, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

export async function symlinkNodeModules(rootDir: string, wtPath: string): Promise<void> {
  const src = join(rootDir, 'node_modules');
  const dest = join(wtPath, 'node_modules');
  try {
    await access(src);
  } catch {
    return;
  }
  try {
    await access(dest);
    return;
  } catch {
    /* not present */
  }
  try {
    await symlink(src, dest, 'dir');
  } catch {
    /* ignore */
  }
}

export async function runAiRunner(
  config: ScanResult['config'],
  cwd: string,
  relPath: string,
  findings: Finding[],
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
    if (config.aiRunner === 'claude') {
      await execFileAsync('claude', ['-p', prompt, '--allowedTools', 'Edit', 'Read'], { cwd, timeout: 180_000 });
    } else {
      const args = ['run'];
      if (config.aiModel) args.push('-m', config.aiModel);
      args.push('--auto', prompt);
      await execFileAsync('opencode', args, { cwd, timeout: 180_000 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function cleanupWorktrees(rootDir: string): Promise<void> {
  const wtDir = join(rootDir, '.unshit', 'wt');
  let entries: string[] = [];
  try {
    entries = await readdir(wtDir);
  } catch {
    /* no dir */
  }
  for (const name of entries) {
    const p = join(wtDir, name);
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', p], { cwd: rootDir, timeout: 120_000 });
    } catch {
      /* ignore */
    }
    await rm(p, { recursive: true, force: true }).catch(() => {});
  }
  await rm(wtDir, { recursive: true, force: true }).catch(() => {});
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: rootDir, timeout: 120_000 });
  } catch {
    /* ignore */
  }
}

export async function fillPatchHash(
  result: SwarmWorkerResult,
  wtPath: string,
  resetLinesOnError: boolean,
): Promise<void> {
  if (result.patchHash) return;
  try {
    const { stdout } = await git(['diff'], wtPath);
    result.patchHash = sha256(stdout);
    result.diffLines = countLines(stdout);
  } catch {
    result.patchHash = sha256('');
    if (resetLinesOnError) result.diffLines = 0;
  }
}

export async function abortSwarmFix(rootDir: string): Promise<number> {
  const wtDir = join(rootDir, '.unshit', 'wt');
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(wtDir);
  } catch {
    /* no dir */
  }
  for (const name of entries) {
    const p = join(wtDir, name);
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', p], { cwd: rootDir, timeout: 120_000 });
    } catch {
      /* ignore */
    }
    await rm(p, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  await rm(wtDir, { recursive: true, force: true }).catch(() => {});
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: rootDir, timeout: 120_000 });
  } catch {
    /* ignore */
  }
  await rm(join(rootDir, '.unshit', 'lock'), { force: true }).catch(() => {});
  return removed;
}
