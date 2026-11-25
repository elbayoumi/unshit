import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

async function hits(files: Record<string, string>, rule = 'ts/unused-export'): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-bind-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    const scan = await runScan(dir, DEFAULT_CONFIG);
    return scan.findings.filter((f) => f.ruleId === rule).map((f) => `${f.file}:${f.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const main = 'src/main.ts';

test('default import does not keep a same-named export alive', async () => {
  const r = await hits({
    [main]: "import i18n from './i18n';\nconsole.log(i18n);\n",
    'src/i18n.ts': 'export const translations = {};\nexport default {};\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /translations/);
});

test('side-effect import consumes no export', async () => {
  const r = await hits({
    [main]: "import './setup';\n",
    'src/setup.ts': 'export const unused = 1;\n',
  });
  assert.equal(r.length, 1);
});

test('named import marks only that export', async () => {
  const r = await hits({
    [main]: "import { a as renamed } from './lib';\nconsole.log(renamed);\n",
    'src/lib.ts': 'export const a = 1;\nexport const b = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /`b`/);
});

test('export * chains propagate usage', async () => {
  const r = await hits({
    [main]: "import { deep } from './barrel';\nconsole.log(deep);\n",
    'src/barrel.ts': "export * from './inner';\n",
    'src/inner.ts': 'export const deep = 1;\nexport const dead = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /`dead`/);
});

test('renamed re-export propagates to the original export', async () => {
  const r = await hits({
    [main]: "import { pub } from './barrel';\nconsole.log(pub);\n",
    'src/barrel.ts': "export { impl as pub } from './impl';\n",
    'src/impl.ts': 'export const impl = 1;\nexport const other = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /`other`/);
});

test('namespace import consumes only accessed members', async () => {
  const r = await hits({
    [main]: "import * as u from './utils';\nconsole.log(u.one);\n",
    'src/utils.ts': 'export const one = 1;\nexport const two = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /`two`/);
});

test('escaping namespace import consumes everything', async () => {
  const r = await hits({
    [main]: "import * as u from './utils';\nconsole.log(u);\n",
    'src/utils.ts': 'export const one = 1;\nexport const two = 2;\n',
  });
  assert.deepEqual(r, []);
});

test('dynamic import() and require() consume the module', async () => {
  const r = await hits({
    [main]: "const m = await import('./lazy');\nconst c = require('./cjs');\nconsole.log(m, c);\n",
    'src/lazy.ts': 'export const a = 1;\n',
    'src/cjs.ts': 'export const b = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('same identifier in another file is not a use', async () => {
  const r = await hits({
    [main]: "import { x } from './a';\nconst helper = 1;\nconsole.log(x, helper);\n",
    'src/a.ts': 'export const x = 1;\n',
    'src/b.ts': 'export const helper = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /b\.ts/);
});

test('unused default export is reported', async () => {
  const r = await hits({
    [main]: "import { a } from './m';\nconsole.log(a);\n",
    'src/m.ts': 'export const a = 1;\nexport default function Unused() {}\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /Default export/);
});

test('type export imported via `import type` is used', async () => {
  const r = await hits({
    [main]: "import type { T } from './t';\nlet v: T | undefined;\nconsole.log(v);\n",
    'src/t.ts': 'export type T = { a: 1 };\nexport type Dead = { b: 1 };\n',
  }, 'ts/unused-type-export');
  assert.equal(r.length, 1);
  assert.match(r[0]!, /Dead/);
});

test('JSON/asset imports do not hide an unused default export', async () => {
  const r = await hits({
    [main]: "import './i18n';\n",
    'src/i18n.ts': "import data from './data.json';\nconsole.log(data);\nexport default {};\n",
    'src/data.json': '{}',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /Default export/);
});
