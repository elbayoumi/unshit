import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-export-fix-'));
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

const localFixture = {
  'src/main.ts': "import { kept } from './lib';\nconsole.log(kept);\n",
  'src/lib.ts': 'export const dead = 1;\nexport interface Dead { x: number }\nexport const kept = 2;\n',
};

test('unused-export fixes are dry-run by default: unified diff printed, disk untouched', async () => {
  await withTempProject(localFixture, async (dir) => {
    const before = await readFile(join(dir, 'src/lib.ts'), 'utf8');
    const summary = await fix(dir, false);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.appliedCount, 0);
    assert.equal(summary.deterministicPatches.length, 2);
    assert.match(summary.diff, /--- a\/src\/lib\.ts/);
    assert.match(summary.diff, /-export const dead = 1;/);
    assert.match(summary.diff, /\+const dead = 1;/);
    assert.match(summary.diff, /-export interface Dead \{ x: number \}/);
    assert.match(summary.diff, /\+interface Dead \{ x: number \}/);
    assert.equal(await readFile(join(dir, 'src/lib.ts'), 'utf8'), before);
  });
});

test('--apply removes only the export modifier and keeps the declarations', async () => {
  await withTempProject(localFixture, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.dryRun, false);
    assert.equal(summary.appliedCount, 2);
    assert.equal(
      await readFile(join(dir, 'src/lib.ts'), 'utf8'),
      'const dead = 1;\ninterface Dead { x: number }\nexport const kept = 2;\n',
    );
  });
});

test('listed exports, default exports and types in exported signatures are skipped with reasons', async () => {
  const before = [
    'const listed = 1;',
    'export { listed };',
    'export default function Default() {}',
    'export interface Config { x: number }',
    'export function make(): Config { return { x: 1 }; }',
    '',
  ].join('\n');
  await withTempProject({
    'src/main.ts': "import { make } from './skip';\nconsole.log(make());\n",
    'src/skip.ts': before,
  }, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.deterministicPatches.length, 0);
    assert.equal(summary.appliedCount, 0);
    assert.equal(summary.skipped.length, 3);
    assert.ok(summary.skipped.some((s) => /listed export clause/.test(s.reason)));
    assert.ok(summary.skipped.some((s) => /default export/.test(s.reason)));
    assert.ok(summary.skipped.some((s) => /declaration emit/.test(s.reason) && /Config/.test(s.reason)));
    assert.equal(await readFile(join(dir, 'src/skip.ts'), 'utf8'), before);
  });
});

test('a file that became unreferenced after --apply is deleted on the next pass, then settles', async () => {
  await withTempProject({
    'src/lib.ts': 'export const dead = 1;\nexport type Dead = { x: number };\n',
  }, async (dir) => {
    const first = await fix(dir, true);
    assert.equal(first.appliedCount, 2);
    assert.equal(first.deletedCount, 0, 'a file patched in this run is never deleted in the same run');
    const afterFirst = await readFile(join(dir, 'src/lib.ts'), 'utf8');
    assert.equal(afterFirst, 'const dead = 1;\ntype Dead = { x: number };\n');

    const second = await fix(dir, true);
    assert.equal(second.deterministicPatches.length, 0);
    assert.deepEqual(second.deletions, ['src/lib.ts']);
    assert.equal(second.deletedCount, 1);
    await assert.rejects(() => readFile(join(dir, 'src/lib.ts'), 'utf8'));

    const third = await fix(dir, true);
    assert.equal(third.deterministicPatches.length, 0);
    assert.equal(third.deletions.length, 0);
    assert.equal(third.diff, '');
  });
});

test('both producer and consumer are fixed together when neither stays exported', async () => {
  await withTempProject({
    'src/model.ts': 'export interface Config { x: number }\nexport function make(): Config { return { x: 1 }; }\n',
  }, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.skipped.length, 0);
    assert.equal(summary.appliedCount, 2);
    assert.equal(
      await readFile(join(dir, 'src/model.ts'), 'utf8'),
      'interface Config { x: number }\nfunction make(): Config { return { x: 1 }; }\n',
    );
  });
});
