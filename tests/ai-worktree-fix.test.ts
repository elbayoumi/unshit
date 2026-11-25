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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initGitRepo(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  const gitCmd = (args: string[]): Promise<unknown> => execFileAsync('git', args, { cwd: dir });
  await gitCmd(['init', '-q']);
  await gitCmd(['config', 'user.email', 'test@example.com']);
  await gitCmd(['config', 'user.name', 'Test']);
  await gitCmd(['add', '-A']);
  await gitCmd(['commit', '-qm', 'init']);
}

async function installFakeAi(binDir: string, markerPath: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const script = [
    '#!/bin/sh',
    `pwd > "${markerPath}"`,
    `printf '${FIXED.replace(/\n/g, '\\n')}' > target.ts`,
    `if [ "$UNSHIT_FAKE_AI_MODE" = "extra" ]; then printf 'extra\\n' > extra.ts; fi`,
    'exit 0',
    '',
  ].join('\n');
  const scriptPath = join(binDir, 'opencode');
  await writeFile(scriptPath, script, 'utf8');
  await chmod(scriptPath, 0o755);
}

interface FakeAiCtx {
  dir: string;
  scan: Awaited<ReturnType<typeof runScan>>;
  markerPath: string;
}

async function withFakeAiRepo(
  options: { git: boolean; verifyCommand?: string; mode?: string },
  fn: (ctx: FakeAiCtx) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-ai-wt-'));
  const binDir = await mkdtemp(join(tmpdir(), 'unshit-fake-bin-'));
  const markerPath = join(binDir, 'ran-in');
  const savedPath = process.env.PATH;
  const savedMode = process.env.UNSHIT_FAKE_AI_MODE;
  try {
    const files = {
      'target.ts': ORIGINAL,
      'extra.ts': 'export const extra = 1;\n',
    };
    if (options.git) await initGitRepo(dir, files);
    else {
      for (const [name, content] of Object.entries(files)) {
        await writeFile(join(dir, name), content, 'utf8');
      }
    }
    await installFakeAi(binDir, markerPath);
    process.env.PATH = `${binDir}${delimiter}${savedPath ?? ''}`;
    if (options.mode) process.env.UNSHIT_FAKE_AI_MODE = options.mode;
    else delete process.env.UNSHIT_FAKE_AI_MODE;
    const config = {
      ...DEFAULT_CONFIG,
      disabledRules: ['ts/unused-file', 'ts/unused-export', 'ts/unused-type-export'],
      aiRunner: 'opencode' as const,
      verifyCommand: options.verifyCommand,
    };
    const scan = await runScan(dir, config);
    assert.ok(scan.findings.some((f) => f.ruleId === 'ts/no-double-cast' && f.file === 'target.ts'));
    await fn({ dir, scan, markerPath });
  } finally {
    process.env.PATH = savedPath;
    if (savedMode === undefined) delete process.env.UNSHIT_FAKE_AI_MODE;
    else process.env.UNSHIT_FAKE_AI_MODE = savedMode;
    await rm(dir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
}

test('fix --ai lands a verified patch from an isolated worktree and cleans up', async () => {
  await withFakeAiRepo({ git: true, verifyCommand: 'true' }, async ({ dir, scan, markerPath }) => {
    const summary = await runFix(scan, { apply: true, ai: true });
    assert.deepEqual(summary.aiAttempted, ['target.ts']);
    assert.deepEqual(summary.aiReverted, []);
    assert.deepEqual(summary.aiMessages, []);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), FIXED);
    const ranIn = (await readFile(markerPath, 'utf8')).trim();
    assert.notEqual(ranIn, dir);
    assert.match(ranIn, /\.unshit\/wt\//);
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: dir });
    assert.equal(stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length, 1);
  });
});

test('fix --ai discards an unverified patch and leaves the working tree untouched', async () => {
  await withFakeAiRepo({ git: true, verifyCommand: 'false' }, async ({ dir, scan, markerPath }) => {
    const summary = await runFix(scan, { apply: true, ai: true });
    assert.deepEqual(summary.aiAttempted, ['target.ts']);
    assert.deepEqual(summary.aiReverted, ['target.ts']);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), ORIGINAL);
    assert.ok(await exists(markerPath));
  });
});

test('fix --ai dry-run never invokes the AI runner', async () => {
  await withFakeAiRepo({ git: true, verifyCommand: 'true' }, async ({ dir, scan, markerPath }) => {
    const summary = await runFix(scan, { apply: false, ai: true });
    assert.equal(summary.dryRun, true);
    assert.deepEqual(summary.aiAttempted, []);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), ORIGINAL);
    assert.equal(await exists(markerPath), false);
  });
});

test('fix --ai without a git repo skips AI with a clear message', async () => {
  await withFakeAiRepo({ git: false, verifyCommand: 'true' }, async ({ dir, scan, markerPath }) => {
    const summary = await runFix(scan, { apply: true, ai: true });
    assert.deepEqual(summary.aiAttempted, []);
    assert.match(summary.aiMessages.join('\n'), /requires a git repository/);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), ORIGINAL);
    assert.equal(await exists(markerPath), false);
  });
});

test('fix --ai rejects patches that touch files outside the allowlist', async () => {
  await withFakeAiRepo({ git: true, verifyCommand: 'true', mode: 'extra' }, async ({ dir, scan }) => {
    const summary = await runFix(scan, { apply: true, ai: true });
    assert.deepEqual(summary.aiAttempted, ['target.ts']);
    assert.deepEqual(summary.aiReverted, ['target.ts']);
    assert.equal(await readFile(join(dir, 'target.ts'), 'utf8'), ORIGINAL);
    assert.equal(await readFile(join(dir, 'extra.ts'), 'utf8'), 'export const extra = 1;\n');
  });
});
