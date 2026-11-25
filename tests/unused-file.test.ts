import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const RULE = 'ts/unused-file';

async function hits(files: Record<string, string>): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-unused-file-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    const scan = await runScan(dir, DEFAULT_CONFIG);
    return scan.findings.filter((f) => f.ruleId === RULE).map((f) => f.file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('unused file is reported', async () => {
  const r = await hits({
    'src/main.ts': "import { used } from './used';\nconsole.log(used);\n",
    'src/used.ts': 'export const used = 1;\n',
    'src/orphan.ts': 'export const orphan = 2;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('entry points are not reported', async () => {
  const r = await hits({
    'package.json': JSON.stringify({ name: 'fixture', main: './src/entry.ts' }),
    'src/entry.ts': 'export const fromMain = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('framework routing files are not reported', async () => {
  const r = await hits({
    'pages/index.tsx': 'export const pageThing = 1;\n',
    'src/routes/+server.ts': 'export const handler = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('test, spec and .d.ts files are not reported', async () => {
  const r = await hits({
    'src/main.ts': 'export const mainThing = 1;\n',
    'src/thing.test.ts': 'export const thing = 1;\n',
    'src/thing.spec.tsx': 'export const specThing = 1;\n',
    'src/types.d.ts': 'export type Thing = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('file dynamically imported with import() is not reported', async () => {
  const r = await hits({
    'src/main.ts': "const m = await import('./lazy');\nconsole.log(m);\n",
    'src/lazy.ts': 'export const lazy = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('require() and side-effect imports keep files alive', async () => {
  const r = await hits({
    'src/main.ts': "require('./cjs');\nimport './side';\nconsole.log(1);\n",
    'src/cjs.ts': 'export const cjsThing = 1;\n',
    'src/side.ts': 'export const sideThing = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('barrel re-export chain keeps inner files alive', async () => {
  const r = await hits({
    'src/main.ts': "import { deep } from './barrel';\nconsole.log(deep);\n",
    'src/barrel.ts': "export * from './inner';\n",
    'src/inner.ts': 'export const deep = 1;\n',
  });
  assert.deepEqual(r, []);
});
