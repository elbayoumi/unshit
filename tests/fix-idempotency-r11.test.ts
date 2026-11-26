import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-idem-r11-'));
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

test('fix --apply converges: a single run removes a cascading unused export and file, second run is a no-op', async () => {
  await withTempProject(
    { 'src/lib.ts': 'export const dead = 1;\nexport type Dead = { x: number };\n' },
    async (dir) => {
      const first = await fix(dir, true);
      assert.equal(first.appliedCount, 2);
      assert.equal(first.deletedCount, 1);
      await assert.rejects(() => readFile(join(dir, 'src/lib.ts'), 'utf8'));

      const second = await fix(dir, true);
      assert.equal(second.deterministicPatches.length, 0);
      assert.equal(second.appliedCount, 0);
      assert.equal(second.deletedCount, 0);
      assert.equal(second.deletions.length, 0);
      assert.equal(second.diff, '');
    },
  );
});

test('fix --apply converges: cascading unused files are removed in one run', async () => {
  await withTempProject(
    {
      'src/a.ts': 'export const x = 1;\n',
      'src/b.ts': "export { x } from './a';\n",
    },
    async (dir) => {
      const first = await fix(dir, true);
      assert.equal(first.deletedCount, 2);
      await assert.rejects(() => readFile(join(dir, 'src/a.ts'), 'utf8'));
      await assert.rejects(() => readFile(join(dir, 'src/b.ts'), 'utf8'));

      const second = await fix(dir, true);
      assert.equal(second.deterministicPatches.length, 0);
      assert.equal(second.appliedCount, 0);
      assert.equal(second.deletedCount, 0);
      assert.equal(second.deletions.length, 0);
      assert.equal(second.diff, '');
    },
  );
});