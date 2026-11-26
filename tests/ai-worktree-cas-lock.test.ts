import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

const execFileAsync = promisify(execFile);
const ORIGINAL = 'const value = ({} as unknown as number);\nvoid value;\n';
const FIXED = 'const value = 2;\nvoid value;\n';

async function initGitRepo(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-qm', 'init'], { cwd: dir });
}

async function setupFakeAi(
  binDir: string,
  scriptBody: string[],
): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const script = ['#!/bin/sh', ...scriptBody, ''].join('\n');
  const scriptPath = join(binDir, 'opencode');
  await writeFile(scriptPath, script, 'utf8');
  await chmod(scriptPath, 0o755);
}

function makeConfig(dir: string, verifyCommand?: string) {
  return {
    ...DEFAULT_CONFIG,
    disabledRules: ['ts/unused-file', 'ts/unused-export', 'ts/unused-type-export'],
    aiRunner: 'opencode' as const,
    verifyCommand,
  };
}

test('fix --ai refuses landing when HEAD moves during the run (CAS)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-cas-'));
  const binDir = await mkdtemp(join(tmpdir(), 'unshit-fake-bin-'));
  const savedPath = process.env.PATH;
  try {
    await initGitRepo(dir, { 'target.ts': ORIGINAL, 'extra.ts': 'export const extra = 1;\n' });
    await setupFakeAi(binDir, [
      `printf '${FIXED.replace(/\n/g, '\\n')}' > target.ts`,
      `git -C '${dir}' commit --allow-empty -qm race`,
    ]);
    process.env.PATH = `${binDir}${delimiter}${savedPath ?? ''}`;
    const config = makeConfig(dir, 'true');
    const scan = await runScan(dir, config);
    const before = await readFile(join(dir, 'target.ts'), 'utf8');
    const summary = await runFix(scan, { apply: true, ai: true });
    assert.deepEqual(summary.aiAttempted, ['target.ts']);
    assert.deepEqual(summary.aiReverted, ['target.ts']);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), before);
  } finally {
    process.env.PATH = savedPath;
    await rm(dir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test('fix --ai takes the swarm lock so concurrent runs cannot land together', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-lock-'));
  const binDir = await mkdtemp(join(tmpdir(), 'unshit-fake-bin-'));
  const savedPath = process.env.PATH;
  try {
    await initGitRepo(dir, { 'target.ts': ORIGINAL, 'extra.ts': 'export const extra = 1;\n' });
    await setupFakeAi(binDir, [
      'sleep 1',
      `printf '${FIXED.replace(/\n/g, '\\n')}' > target.ts`,
    ]);
    process.env.PATH = `${binDir}${delimiter}${savedPath ?? ''}`;
    const config = makeConfig(dir, 'true');
    const scan1 = await runScan(dir, config);
    const scan2 = await runScan(dir, config);

    const results = await Promise.allSettled([
      runFix(scan1, { apply: true, ai: true }),
      runFix(scan2, { apply: true, ai: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one run should land');
    assert.equal(rejected.length, 1, 'the other should be rejected by the lock');
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.match(String(reason?.message ?? reason), /lockfile exists/);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), FIXED);
  } finally {
    process.env.PATH = savedPath;
    await rm(dir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});