import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-passes-r12-'));
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

test('fix reports passes: dry run is one pass, a cascading apply needs more, a converged tree needs one', async () => {
  await withTempProject(
    { 'src/lib.ts': 'export const dead = 1;\nexport type Dead = { x: number };\n' },
    async (dir) => {
      const dry = await fix(dir, false);
      assert.equal(dry.passes, 1);

      const first = await fix(dir, true);
      assert.ok(first.passes >= 2, `expected >= 2 passes, got ${first.passes}`);

      const second = await fix(dir, true);
      assert.equal(second.passes, 1);
    },
  );
});
