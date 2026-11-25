import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-file-fix-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fix(dir: string, apply: boolean) {
  const scan = await runScan(dir, DEFAULT_CONFIG);
  return runFix(scan, { apply, ai: false });
}

// The orphan has no exports so only ts/unused-file (not ts/unused-export) applies.
const fixture = {
  'src/main.ts': "import { used } from './used';\nconsole.log(used);\n",
  'src/used.ts': 'export const used = 1;\n',
  'src/orphan.ts': 'const orphan = 2;\nconsole.log(orphan);\n',
};

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

test('unused-file fixes are dry-run by default: deletion plan printed, disk untouched', async () => {
  await withTempProject(fixture, async (dir) => {
    const before = await readFile(join(dir, 'src/orphan.ts'), 'utf8');
    const summary = await fix(dir, false);

    assert.equal(summary.dryRun, true);
    assert.equal(summary.appliedCount, 0);
    assert.equal(summary.deletedCount, 0);
    assert.deepEqual(summary.deletions, ['src/orphan.ts']);
    assert.match(summary.diff, /--- a\/src\/orphan\.ts/);
    assert.match(summary.diff, /-const orphan = 2;/);
    assert.equal(await readFile(join(dir, 'src/orphan.ts'), 'utf8'), before);
  });
});

test('--apply deletes only the flagged unreferenced file and is idempotent', async () => {
  await withTempProject(fixture, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.dryRun, false);
    assert.equal(summary.deletedCount, 1);
    assert.deepEqual(summary.deletions, ['src/orphan.ts']);
    assert.equal(await exists(join(dir, 'src/orphan.ts')), false);
    assert.equal(await exists(join(dir, 'src/used.ts')), true);

    const second = await fix(dir, true);
    assert.equal(second.deterministicPatches.length, 0);
    assert.equal(second.deletions.length, 0);
    assert.equal(second.deletedCount, 0);
    assert.equal(second.diff, '');
    assert.equal(await exists(join(dir, 'src/used.ts')), true);
  });
});

test('a stale finding for a file imported dynamically after the scan is skipped', async () => {
  await withTempProject(fixture, async (dir) => {
    const stale = await runScan(dir, DEFAULT_CONFIG);
    const flagged = stale.findings.filter((f) => f.ruleId === 'ts/unused-file');
    assert.deepEqual(flagged.map((f) => f.file), ['src/orphan.ts']);

    await writeFile(
      join(dir, 'src/main.ts'),
      "const m = await import('./orphan');\nconsole.log(m);\n",
      'utf8',
    );
    const fresh = await runScan(dir, DEFAULT_CONFIG);
    const summary = await runFix({ ...fresh, findings: flagged }, { apply: true, ai: false });

    assert.equal(summary.deletedCount, 0);
    assert.equal(summary.deletions.length, 0);
    assert.ok(summary.skipped.some((s) => /dynamic import/.test(s.reason)));
    assert.equal(await exists(join(dir, 'src/orphan.ts')), true);
  });
});

test('a stale finding for a file referenced by a package.json script is skipped', async () => {
  await withTempProject(fixture, async (dir) => {
    const stale = await runScan(dir, DEFAULT_CONFIG);
    const flagged = stale.findings.filter((f) => f.ruleId === 'ts/unused-file');
    assert.deepEqual(flagged.map((f) => f.file), ['src/orphan.ts']);

    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'demo',
      scripts: { start: 'node src/orphan.ts' },
    }, null, 2), 'utf8');
    const fresh = await runScan(dir, DEFAULT_CONFIG);
    const summary = await runFix({ ...fresh, findings: flagged }, { apply: true, ai: false });

    assert.equal(summary.deletedCount, 0);
    assert.ok(summary.skipped.some((s) => /entry point/.test(s.reason)));
    assert.equal(await exists(join(dir, 'src/orphan.ts')), true);
  });
});

test('a file with a dirty git working tree is never deleted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-file-fix-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    for (const [name, content] of Object.entries(fixture)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    execFileSync('git', ['add', 'src/main.ts', 'src/used.ts', 'src/orphan.ts'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'initial'], { cwd: dir });
    await writeFile(join(dir, 'src/orphan.ts'), 'const orphan = 3;\n', 'utf8');

    const summary = await fix(dir, true);
    assert.equal(summary.deletedCount, 0);
    assert.ok(summary.skipped.some((s) => /dirty/.test(s.reason)));
    assert.equal(await readFile(join(dir, 'src/orphan.ts'), 'utf8'), 'const orphan = 3;\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('config, test and script files are protected even when a stale finding targets them', async () => {
  await withTempProject(fixture, async (dir) => {
    const stale = await runScan(dir, DEFAULT_CONFIG);
    const flagged = ['src/orphan.ts', 'src/orphan.test.ts', 'vite.config.ts', 'scripts/build.ts']
      .map((file) => ({ ...stale.findings[0]!, file, span: { line: 1, column: 1 } }));
    for (const name of ['src/orphan.test.ts', 'vite.config.ts', 'scripts/build.ts']) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), 'export const x = 1;\n', 'utf8');
    }
    const fresh = await runScan(dir, DEFAULT_CONFIG);
    const summary = await runFix({ ...fresh, findings: flagged }, { apply: true, ai: false });

    assert.deepEqual(summary.deletions, ['src/orphan.ts']);
    assert.equal(summary.deletedCount, 1);
    assert.equal(summary.skipped.length, 3);
    for (const name of ['src/orphan.test.ts', 'vite.config.ts', 'scripts/build.ts']) {
      assert.equal(await exists(join(dir, name)), true, name);
    }
  });
});
