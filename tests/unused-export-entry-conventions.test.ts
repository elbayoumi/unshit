import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

async function hits(files: Record<string, string>, rule = 'ts/unused-export'): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-entry-'));
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

test('HTML <script type="module" src> marks the target as entry', async () => {
  const r = await hits({
    'index.html': '<html><head><script type="module" src="/src/main.tsx"></script></head></html>',
    'src/main.tsx': 'export const mainThing = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('HTML script without module type does not mark the target as entry', async () => {
  const r = await hits({
    'index.html': '<script src="/src/classic.js"></script>',
    'src/classic.js': 'export const classicThing = 1;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /classicThing/);
});

test('package.json scripts running files mark them as entry', async () => {
  const r = await hits({
    'package.json': JSON.stringify({ name: 'fixture', scripts: { start: 'tsx src/server.ts' } }),
    'src/server.ts': 'export const serve = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('workspace package.json main/bin mark files as entry', async () => {
  const r = await hits({
    'package.json': JSON.stringify({ name: 'root' }),
    'packages/a/package.json': JSON.stringify({ name: 'a', main: './dist/a.js', bin: { a: './bin/a.js' } }),
    'packages/a/dist/a.js': 'export const fromA = 1;\n',
    'packages/a/bin/a.js': 'export const aCli = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('Next pages/ files are entry points', async () => {
  const r = await hits({
    'pages/index.tsx': 'export const pageThing = 1;\n',
    'src/lib/dead.ts': 'export const deadLib = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /deadLib/);
});

test('SvelteKit src/routes/+ files are entry points', async () => {
  const r = await hits({
    'src/routes/+server.ts': 'export const handler = 1;\n',
    'src/routes/todos/+page.server.ts': 'export const load = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('__mocks__ and e2e/cypress/playwright files are entry points', async () => {
  const r = await hits({
    'src/__mocks__/db.ts': 'export const dbMock = 1;\n',
    'e2e/checkout.ts': 'export const e2eFlow = 1;\n',
    'cypress/app.cy.ts': 'export const cyTest = 1;\n',
    'playwright/ui.spec.ts': 'export const pwTest = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('*.stories.* files are entry points', async () => {
  const r = await hits({
    'src/App.stories.tsx': 'export const story = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('vitest config setupFiles/globalSetup mark files as entry', async () => {
  const r = await hits({
    'vitest.config.ts':
      "export default { test: { setupFiles: ['setup/env.ts'], globalSetup: 'g.ts' } };\n",
    'setup/env.ts': 'export const envSetup = 1;\n',
    'g.ts': 'export const globalSetup = 1;\n',
    'src/util.ts': 'export const unusedUtil = 2;\n',
  });
  assert.equal(r.length, 1);
  assert.match(r[0]!, /unusedUtil/);
});
