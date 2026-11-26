import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

async function loadLib(): Promise<any> {
  // dist/tests/* -> ../../benchmark/recall/lib.mjs resolves to repo root benchmark.
  return import(new URL('../../benchmark/recall/lib.mjs', import.meta.url).href);
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-recall-r11-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeMiniProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'mini', version: '1.0.0', dependencies: {} }, null, 2) + '\n', 'utf8');
  for (let i = 0; i < 6; i++) {
    await writeFile(join(dir, 'src', `mod${i}.ts`), `export function mod${i}(x: number): number {\n  if (x > ${i}) return x + ${i};\n  return x - ${i};\n}\n`, 'utf8');
  }
  await writeFile(join(dir, 'src', 'index.ts'), `export { mod0 } from './mod0.js';\n`, 'utf8');
}

test('mulberry32 PRNG is deterministic for same seed', async () => {
  const { mulberry32 } = await loadLib();
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.deepEqual(seqA, seqB);
  const c = mulberry32(54321);
  const seqC = Array.from({ length: 10 }, () => c());
  assert.notDeepEqual(seqA, seqC);
});

test('shuffle and pickN are deterministic with same PRNG seed', async () => {
  const { mulberry32, shuffle, pickN } = await loadLib();
  const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(shuffle(arr, mulberry32(7)), shuffle(arr, mulberry32(7)));
  assert.deepEqual(pickN(arr, 3, mulberry32(7)), pickN(arr, 3, mulberry32(7)));
  assert.notDeepEqual(pickN(arr, 3, mulberry32(7)), pickN(arr, 3, mulberry32(8)));
});

test('injectAll is deterministic for same seed and corpus', async () => {
  const { injectAll } = await loadLib();
  await withTempDir(async (base) => {
    const a = join(base, 'a');
    const b = join(base, 'b');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await makeMiniProject(a);
    await makeMiniProject(b);
    const counts = { unusedExport: 3, unusedFile: 3, unusedDependency: 3, noExplicitAny: 3, magicTimer: 3, duplicateBlock: 2 };
    const injA = injectAll(a, 20261126, counts);
    const injB = injectAll(b, 20261126, counts);
    assert.deepEqual(injA, injB);
    assert.equal(injA.length, 17);
    const kinds = new Set(injA.map((x: any) => x.kind));
    assert.deepEqual([...kinds].sort(), ['duplicate-block', 'magic-timer', 'no-explicit-any', 'unused-dependency', 'unused-export', 'unused-file']);
  });
});

test('injectAll produces files/markers that exist on disk', async () => {
  const { injectAll } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const counts = { unusedExport: 2, unusedFile: 2, unusedDependency: 2, noExplicitAny: 2, magicTimer: 2, duplicateBlock: 1 };
    const inj = injectAll(dir, 99, counts);
    for (const item of inj) {
      if (item.kind === 'unused-dependency') {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        assert.equal(pkg.dependencies[item.marker], '1.0.0');
      } else if (item.kind === 'unused-file') {
        const content = await readFile(join(dir, item.file), 'utf8');
        assert.match(content, /__unshitRecallUnusedFile_/);
      } else {
        const content = await readFile(join(dir, item.file), 'utf8');
        assert.match(content, new RegExp(item.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  });
});

test('wilson95 returns sane bounds', async () => {
  const { wilson95 } = await loadLib();
  const zero = wilson95(0, 20);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0 && zero.high < 0.3);
  const full = wilson95(20, 20);
  assert.equal(full.high, 1);
  assert.ok(full.low > 0.7);
  const mid = wilson95(10, 20);
  assert.ok(mid.low < 0.5 && mid.high > 0.5);
});

test('bin/unshit.js scan --format json drains stdout for piped output', async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }) + '\n', 'utf8');
    for (let i = 0; i < 40; i++) {
      await writeFile(join(dir, 'src', `f${i}.ts`), `export function f${i}(x: any): any { return x; }\n`, 'utf8');
    }
    const bin = new URL('../../bin/unshit.js', import.meta.url).pathname;
    const r = spawnSync(process.execPath, [bin, 'scan', dir, '--format', 'json', '--no-cache'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length > 0);
  });
});
