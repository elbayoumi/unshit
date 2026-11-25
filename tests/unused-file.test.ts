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

test('nested index.html module scripts and vite/laravel `input` entries are entry points', async () => {
  const r = await hits({
    'package.json': JSON.stringify({ name: 'demo' }, null, 2),
    'apps/shell/index.html': '<script type="module" src="/src/main.tsx"></script>\n',
    'apps/shell/src/main.tsx': 'export const m = 1;\n',
    'vite.config.ts': "export default { plugins: [laravel({ input: ['resources/js/app.js'] })] };\n",
    'resources/js/app.js': 'export const a = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('next.config files are entry points', async () => {
  const r = await hits({
    'next.config.ts': "import type { NextConfig } from 'next';\nconst config: NextConfig = {};\nexport default config;\n",
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('next app router files and middleware are entry points', async () => {
  const r = await hits({
    'app/page.tsx': 'export const pageThing = 1;\nexport default function Page() { return null; }\n',
    'app/blog/[slug]/page.tsx': 'export const blogThing = 1;\nexport default function Blog() { return null; }\n',
    'src/middleware.ts': 'export const middlewareThing = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('vite.config input and vitest setupFiles mark files as entry points', async () => {
  const r = await hits({
    'vite.config.ts': "export default { build: { rollupOptions: { input: './src/main.tsx' } } };\n",
    'src/main.tsx': 'export const m = 1;\n',
    'vitest.config.ts': "export default { test: { setupFiles: ['setupTests.ts'] } };\n",
    'setupTests.ts': 'export const setup = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('storybook stories files are entry points', async () => {
  const r = await hits({
    'src/ui/Button.stories.tsx': 'export const story = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('jest config setupFiles and moduleNameMapper keep files alive', async () => {
  const r = await hits({
    'jest.config.js': [
      'module.exports = {',
      "  setupFiles: ['setupTests.ts'],",
      "  moduleNameMapper: { '^app/(.*)': '<rootDir>/app/$1' },",
      '};',
      '',
    ].join('\n'),
    'setupTests.ts': 'export const setup = 1;\n',
    'app/thing.ts': 'export const thing = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('playwright and cypress configs and e2e directories are entry points', async () => {
  const r = await hits({
    'playwright.config.ts': 'export default {};\n',
    'cypress.config.ts': 'export default {};\n',
    'e2e/checkout.ts': 'export const flow = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('tailwind and postcss configs are entry points', async () => {
  const r = await hits({
    'tailwind.config.js': "export default { plugins: ['@tailwindcss/typography'] };\n",
    'postcss.config.js': "export default { plugins: { tailwindcss: {} } };\n",
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('github workflow script references keep files alive', async () => {
  const r = await hits({
    '.github/workflows/ci.yml': [
      'name: ci',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: node scripts/build.ts',
      '',
    ].join('\n'),
    'scripts/build.ts': 'export const build = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('package.json bin and script file references are entry points', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      bin: { demo: './bin/cli.ts' },
      scripts: { start: 'tsx bin/cli.ts' },
    }),
    'bin/cli.ts': 'export const cli = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('astro, remix, nuxt and sveltekit route convention files are entry points', async () => {
  const r = await hits({
    'src/pages/index.tsx': 'export const pageThing = 1;\nexport default function P() { return null; }\n',
    'src/layouts/Layout.tsx': 'export const layoutThing = 1;\n',
    'app/routes/things/[id].tsx': 'export const handler = 1;\n',
    'src/orphan.ts': 'export const o = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});
