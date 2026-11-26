import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const RULE = 'ts/unused-file';

async function hits(files: Record<string, string>): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-unused-file-r9-'));
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

test('type-only imports keep files alive', async () => {
  const r = await hits({
    'src/index.ts': "import type { Used } from './types';\nexport const x: Used = { v: 1 };\n",
    'src/types.ts': 'export interface Used { v: number }\n',
  });
  assert.deepEqual(r, []);
});

test('type-only re-exports keep files alive', async () => {
  const r = await hits({
    'src/index.ts': "export type { Used } from './types';\nexport const x = 1;\n",
    'src/types.ts': 'export interface Used { v: number }\n',
  });
  assert.deepEqual(r, []);
});

test('package.json exports dist targets map to src source files', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }),
    'src/index.ts': 'export const pub = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('node --test script glob marks matched files as entry points', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      scripts: { test: 'node --test "test/!(helpers)/*.js"' },
    }),
    'test/unit/feature.js': "import test from 'node:test';\ntest('x', () => {});\n",
    'test/helpers/util.js': 'export const h = 1;\n',
  });
  // helpers/util.js is not matched by the glob and is not imported - it may be reported.
  // feature.js is matched by the glob and must not be reported.
  assert.equal(r.includes('test/unit/feature.js'), false);
});

test('*.test-d.ts files are entry points', async () => {
  const r = await hits({
    'test-d/types.test-d.ts': "import type { X } from '../src/index';\nconst x: X = 'ok';\n",
    'src/index.ts': 'export type X = string;\n',
  });
  assert.deepEqual(r, []);
});

test('__tests__ files are entry points', async () => {
  const r = await hits({
    'src/__tests__/thing.ts': 'export const t = 1;\n',
  });
  assert.deepEqual(r, []);
});
