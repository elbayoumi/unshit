import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  formatPrJson,
  formatPrHuman,
  formatPrMarkdown,
  isGitWorkTree,
  resolvePrBaseRef,
  reviewPullRequest,
  type PrReport,
} from '../src/core/pr-review.js';
import { runScan } from '../src/core/scanner.js';

const execFileAsync = promisify(execFile);

const BASE_FILE = 'export function f(x: unknown): string {\n  return String(x);\n}\n';
const BRANCH_FILE = 'export function f(x: unknown): string {\n  try {\n    return String(x);\n  } catch (e: any) {\n    return "err";\n  }\n}\nconst payload = data as unknown as BridgePayload;\n';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-pr-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function scanDir(dir: string) {
  return runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
}

async function snapshotFiles(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  };
  await walk(dir);
  return out;
}

async function runCli(dir: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const cliPath = resolve(import.meta.dirname, '../../bin/unshit.js');
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('reviewPullRequest reports no findings on a clean branch', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), 'export const value = 1;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);
    const report = await reviewPullRequest(dir, await scanDir(dir));
    assert.equal(report.verdict, 'pass');
    assert.deepEqual(report.findings, []);
    assert.equal(report.errorCount, 0);
    assert.equal(report.warnCount, 0);
  });
});

test('a branch introducing an explicit any is flagged with a fix suggestion', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), BASE_FILE, 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'base']);
    await git(dir, ['checkout', '-qb', 'feature']);
    await writeFile(join(dir, 'a.ts'), BRANCH_FILE, 'utf8');
    await git(dir, ['commit', '-qam', 'feature change']);

    const report = await reviewPullRequest(dir, await scanDir(dir));
    const anyFinding = report.findings.find((f) => f.ruleId === 'ts/no-explicit-any');
    assert.ok(anyFinding, 'expected a ts/no-explicit-any finding');
    assert.equal(anyFinding!.severity, 'warn');
    assert.ok(anyFinding!.suggestion && anyFinding!.suggestion.length > 0);
    assert.match(anyFinding!.suggestion!, /unknown/);
    assert.equal(report.verdict, 'warn');
  });
});

test('a branch introducing an explicit double-cast is flagged on a changed line', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), BASE_FILE, 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'base']);
    await git(dir, ['checkout', '-qb', 'feature']);
    await writeFile(join(dir, 'a.ts'), BRANCH_FILE, 'utf8');
    await git(dir, ['commit', '-qam', 'feature change']);

    const report = await reviewPullRequest(dir, await scanDir(dir));
    const castFinding = report.findings.find((f) => f.ruleId === 'ts/no-double-cast');
    assert.ok(castFinding, 'expected a ts/no-double-cast finding');
    assert.equal(castFinding!.line, 8);
    assert.equal(castFinding!.severity, 'warn');
  });
});

test('findings on pre-existing lines are not reported', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), 'const pre: any = 1;\nexport const g = 2;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'base']);
    await git(dir, ['checkout', '-qb', 'feature']);
    await writeFile(join(dir, 'a.ts'), 'const pre: any = 1;\nexport const g = 2;\n// branch change\n', 'utf8');
    await git(dir, ['commit', '-qam', 'feature change']);
    const report = await reviewPullRequest(dir, await scanDir(dir));
    assert.equal(report.findings.length, 0);
    assert.equal(report.verdict, 'pass');
  });
});

test('formatPrMarkdown emits a paste-ready PR comment shape', () => {
  const report: PrReport = {
    baseRef: 'main',
    verdict: 'warn',
    findings: [
      {
        file: 'src/a.ts',
        ruleId: 'ts/no-explicit-any',
        severity: 'warn',
        line: 4,
        message: 'Avoid explicit `any`; use `unknown` or a concrete type.',
        suggestion: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2,3 +2,3 @@\n context\n-old\n+new\n',
      },
      {
        file: 'src/b.ts',
        ruleId: 'arch/layer',
        severity: 'error',
        line: 9,
        message: 'Cross-layer import.',
        suggestion: '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-a\n+b\n@@ -5 +5 @@\n-c\n+d\n',
      },
     ],
    errorCount: 1,
    warnCount: 1,
    infoCount: 0,
    scoreDelta: 2,
  };
  const md = formatPrMarkdown(report);
  assert.match(md, /^## PR Review — WARN \(base: main\)/);
  assert.ok(md.includes('| File | Rule | Severity | Line | Message |'));
  assert.ok(md.includes('```suggestion'));
  assert.ok(md.includes('```diff'));
  assert.ok(md.includes('src/a.ts:4'));
  const parsed = JSON.parse(formatPrJson(report));
  assert.equal(parsed.baseRef, 'main');
  assert.equal(parsed.findings.length, 2);
  assert.match(formatPrHuman(report), /unshit pr: WARN/);
  assert.ok(formatPrHuman(report).includes('src/a.ts:4'));
});

test('reviewPullRequest leaves the tree unmodified', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), BASE_FILE, 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'base']);
    await git(dir, ['checkout', '-qb', 'feature']);
    await writeFile(join(dir, 'a.ts'), BRANCH_FILE, 'utf8');
    await git(dir, ['commit', '-qam', 'feature change']);
    const scan = await scanDir(dir);
    const before = await snapshotFiles(dir);
    const report = await reviewPullRequest(dir, scan);
    assert.ok(report.findings.length > 0);
    assert.deepEqual(await snapshotFiles(dir), before);
  });
});

test('resolvePrBaseRef falls back to HEAD when no other base ref exists', async () => {
  await withTempDir(async (dir) => {
    await git(dir, ['init', '-q', '-b', 'trunk']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);
    assert.equal(await resolvePrBaseRef(dir), 'HEAD');
    const report = await reviewPullRequest(dir, await scanDir(dir));
    assert.equal(report.baseRef, 'HEAD');
  });
});

test('isGitWorkTree returns false outside a git repository', async () => {
  await withTempDir(async (dir) => {
    assert.equal(await isGitWorkTree(dir), false);
  });
});

test('unshit pr CLI prints a clear message on non-git directories (exit 2)', async () => {
  await withTempDir(async (dir) => {
    const { status, stderr } = await runCli(dir, ['pr', dir]);
    assert.equal(status, 2);
    assert.match(stderr, /not a git work tree/);
  });
});

test('unshit pr CLI exits 0 on a clean branch and 1 when error findings exist', async () => {
  await withTempDir(async (dir) => {
    await initRepo(dir);
    await writeFile(join(dir, 'a.ts'), BASE_FILE, 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'base']);

    const clean = await runCli(dir, ['pr', dir]);
    assert.equal(clean.status, 0);

    await git(dir, ['checkout', '-qb', 'feature']);
    await writeFile(join(dir, 'a.ts'), 'const label = isAr ? "yes" : "no";\n', 'utf8');
    await git(dir, ['commit', '-qam', 'feature change']);
    const flagged = await runCli(dir, ['pr', dir]);
    assert.equal(flagged.status, 1);
    assert.match(flagged.stdout, /i18n\/no-inline-ternary/);
  });
});
