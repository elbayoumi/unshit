import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

async function withProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-deep-'));
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

function unused(scan: Awaited<ReturnType<typeof runScan>>): string[] {
  return scan.findings
    .filter((f) => f.ruleId === 'ts/unused-export' || f.ruleId === 'ts/unused-type-export')
    .map((f) => `${f.ruleId}:${f.file}:${f.message}`)
    .sort();
}

test('deep: barrel re-export consumed reports no finding', async () => {
  await withProject({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023' }, include: ['src'] }),
    'src/main.ts': "import { used } from './barrel.js';\nconsole.log(used);\n",
    'src/barrel.ts': "export { used, used as aliasUsed } from './inner.js';\nexport * from './other.js';\n",
    'src/inner.ts': 'export const used = 1;\nexport const dead = 2;\n',
    'src/other.ts': 'export const otherUsed = 3;\n',
  }, async (dir) => {
    // barrel.ts is consumed by main.ts through barrel; main imports used, so used is live.
    // otherUsed is exported via export * from barrel but never imported by anyone - should be reported.
    // dead is never imported - should be reported.
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const hits = unused(scan);
    assert.ok(hits.some((h) => h.includes('src/inner.ts') && h.includes('dead')), `expected dead in ${hits}`);
    assert.ok(hits.some((h) => h.includes('src/other.ts') && h.includes('otherUsed')), `expected otherUsed in ${hits}`);
    assert.ok(!hits.some((h) => h.includes('src/inner.ts') && h.includes('`used`')), `used should not be reported: ${hits}`);
  });
});

test('deep: alias import does not report consumed export', async () => {
  await withProject({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023' }, include: ['src'] }),
    'src/main.ts': "import { orig as renamed } from './lib.js';\nconsole.log(renamed);\n",
    'src/lib.ts': 'export const orig = 1;\nexport const nope = 2;\n',
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const hits = unused(scan);
    assert.ok(!hits.some((h) => h.includes('`orig`')), `orig should be consumed: ${hits}`);
    assert.ok(hits.some((h) => h.includes('`nope`')), `nope should be reported: ${hits}`);
  });
});

test('deep: truly unused export is reported', async () => {
  await withProject({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023' }, include: ['src'] }),
    'src/main.ts': "import { kept } from './lib.js';\nconsole.log(kept);\n",
    'src/lib.ts': 'export const kept = 1;\nexport const unused = 2;\n',
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const hits = unused(scan);
    assert.deepEqual(hits.filter((h) => h.includes('src/lib.ts')), [
      'ts/unused-export:src/lib.ts:Exported symbol `unused` has zero references; safe to delete.',
    ]);
  });
});

test('deep: missing tsconfig falls back to sensible defaults', async () => {
  await withProject({
    'src/main.ts': "import { kept } from './lib';\nconsole.log(kept);\n",
    'src/lib.ts': 'export const kept = 1;\nexport const ghost = 2;\n',
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const hits = unused(scan);
    assert.ok(hits.some((h) => h.includes('`ghost`')), `expected ghost finding: ${hits}`);
    assert.ok(!hits.some((h) => h.includes('`kept`')), `kept should be consumed: ${hits}`);
  });
});

test('non-deep scan output is unchanged', async () => {
  await withProject({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023' }, include: ['src'] }),
    'src/main.ts': "import { kept } from './lib.js';\nconsole.log(kept);\n",
    'src/lib.ts': 'export const kept = 1;\nexport const unused = 2;\n',
  }, async (dir) => {
    const normal = await runScan(dir, DEFAULT_CONFIG, [], { deep: false });
    const deep = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const normalUnused = unused(normal);
    const deepUnused = unused(deep);
    // For this simple case they should agree; key assertion is normal is unchanged by deep code existing.
    assert.deepEqual(normalUnused, [
      'ts/unused-export:src/lib.ts:Exported symbol `unused` has zero references; safe to delete.',
    ]);
    // deep should also find it
    assert.ok(deepUnused.some((h) => h.includes('`unused`')));
    // ensure no duplicates
    const keys = deep.findings.map((f) => `${f.ruleId}|${f.file}|${f.span.line}|${f.span.column}`);
    assert.equal(keys.length, new Set(keys).size, 'duplicate findings');
  });
});

test('deep: broken tsconfig falls back to sensible defaults', async () => {
  await withProject({
    'tsconfig.json': '{ not json',
    'src/main.ts': "import { kept } from './lib';\nconsole.log(kept);\n",
    'src/lib.ts': 'export const kept = 1;\nexport const ghost = 2;\n',
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const hits = unused(scan);
    assert.ok(hits.some((h) => h.includes('`ghost`')), `expected ghost: ${hits}`);
    assert.ok(!hits.some((h) => h.includes('`kept`')), `kept should be consumed: ${hits}`);
  });
});

test('deep: replaces syntactic unused-export findings for same files without duplicates', async () => {
  await withProject({
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023' }, include: ['src'] }),
    'src/main.ts': "import { a } from './lib.js';\nconsole.log(a);\n",
    'src/lib.ts': 'export const a = 1;\nexport const b = 2;\n',
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { deep: true });
    const unusedFindings = scan.findings.filter((f) => f.ruleId === 'ts/unused-export' || f.ruleId === 'ts/unused-type-export');
    const keys = unusedFindings.map((f) => `${f.ruleId}|${f.file}|${f.span.line}|${f.span.column}`);
    assert.equal(keys.length, new Set(keys).size, `duplicates: ${keys}`);
    assert.equal(unusedFindings.filter((f) => f.file === 'src/lib.ts').length, 1);
  });
});
