import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Finding } from '../src/contracts.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-deps-test-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function findingsFor(scan: Awaited<ReturnType<typeof runScan>>, ruleId: string): Finding[] {
  return scan.findings.filter((f) => f.ruleId === ruleId);
}

test('deps/unused-dependency flags declared deps that are never used, sparing tooling and scripts', async () => {
  const packageJson = JSON.stringify({
    name: 'demo',
    scripts: { start: 'mytool', lint: 'xo' },
    dependencies: {
      'unused-pkg': '^1.0.0',
      'mytool': '^1.0.0',
      lodash: '^4.0.0',
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      'unused-dev': '^1.0.0',
      'xo': '^1.0.0',
      'eslint-plugin-foo': '^1.0.0',
    },
  }, null, 2);

  await withTempProject({
    'package.json': packageJson,
    'src/index.ts': [
      "import fs from 'node:fs';",
      "import { some } from 'lodash';",
      'export const x = some + String(fs);',
    ].join('\n'),
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const findings = findingsFor(scan, 'deps/unused-dependency');
    const names = new Set(findings.map((f) => f.evidence));

    assert.ok(names.has('unused-pkg'));
    assert.ok(names.has('unused-dev'));
    assert.ok(!names.has('lodash'), 'lodash is imported by src/index.ts');
    assert.ok(!names.has('@types/node'), 'node is used via the node:fs builtin import');
    assert.ok(!names.has('mytool'), 'mytool is referenced in scripts');
    assert.ok(!names.has('xo'), 'xo is referenced in scripts');
    assert.ok(!names.has('eslint-plugin-foo'), 'eslint* tooling is ignored');
    assert.ok(findings.every((f) => f.file === 'package.json'));

    const lineOf = (key: string): number =>
      packageJson.split('\n').findIndex((line) => line.trimStart().startsWith(`"${key}":`)) + 1;
    for (const name of names) {
      const finding = findings.find((f) => f.evidence === name);
      assert.equal(finding?.span.line, lineOf(name), `span line of key "${name}"`);
    }
  });
});

test('deps/unlisted-dependency flags bare imports missing from package.json', async () => {
  const packageJson = JSON.stringify({
    name: 'demo',
    dependencies: { 'listed-pkg': '^1.0.0' },
    peerDependencies: { 'peer-pkg': '^3.0.0' },
    optionalDependencies: { 'opt-pkg': '^1.0.0' },
    devDependencies: { '@scope/pkg': '^2.0.0' },
  }, null, 2);

  const indexTs = [
    "import { a } from 'listed-pkg';",
    "import { b } from 'peer-pkg';",
    "import { c } from 'opt-pkg';",
    "import { d } from '@scope/pkg/sub';",
    "import { e } from 'unlisted-pkg';",
    "import fs from 'node:fs';",
    "import relative from './relative';",
    "const dyn = await import('also-unlisted');",
    "const r = require('third-unlisted');",
  ].join('\n');

  await withTempProject({
    'package.json': packageJson,
    'src/index.ts': indexTs,
    'src/relative.ts': 'export const rel = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const findings = findingsFor(scan, 'deps/unlisted-dependency');
    const specs = new Set(findings.map((f) => f.evidence.replace(/^import '(.*)'$/, '$1')));

    assert.equal(findings.length, 3);
    assert.ok(specs.has('unlisted-pkg'));
    assert.ok(specs.has('also-unlisted'));
    assert.ok(specs.has('third-unlisted'));
    assert.ok(!specs.has('listed-pkg'));
    assert.ok(!specs.has('peer-pkg'));
    assert.ok(!specs.has('opt-pkg'));
    assert.ok(!specs.has('@scope/pkg/sub'), 'scoped subpath of a declared package is fine');
    assert.ok(!specs.has('node:fs'), 'builtin specs are not packages');
    assert.ok(!specs.has('relative'), 'relative specs are not packages');
    assert.ok(findings.every((f) => f.file === 'src/index.ts'));

    const unlistedLine = indexTs.split('\n').findIndex((l) => l.includes("from 'unlisted-pkg'")) + 1;
    const finding = findings.find((f) => f.evidence === "import 'unlisted-pkg'");
    assert.equal(finding?.span.line, unlistedLine);
  });
});

test('deps/unlisted-dependency stays silent without a package.json at the scan root', async () => {
  await withTempProject({
    'src/index.ts': "import { anything } from 'anything-unlisted';\n",
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(findingsFor(scan, 'deps/unlisted-dependency').length, 0);
  });
});

test('deps/unlisted-dependency ignores tsconfig path aliases and the project own name', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { 'demo-dep': '^1.0.0' } }, null, 2),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }, null, 2),
    'src/index.ts': [
      "import { a } from '@/thing';",
      "import { b } from 'demo';",
      "import { c } from 'demo-dep';",
    ].join('\n'),
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const findings = findingsFor(scan, 'deps/unlisted-dependency');
    assert.equal(findings.length, 0);
  });
});

test('deps/unlisted-dependency ignores bare Node builtins like fs and path/posix', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo', dependencies: {} }),
    'src/a.ts': "import fs from 'fs';\nimport { posix } from 'path/posix';\nexport const x = [fs, posix];\n",
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(findingsFor(scan, 'deps/unlisted-dependency').length, 0);
  });
});

test('deps/unlisted-dependency respects workspace package.json files and workspace package names', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'apps/web/package.json': JSON.stringify({ name: '@m/web', dependencies: { react: '^18.0.0', '@m/core': '*' } }),
    'apps/web/src/a.ts': "import React from 'react';\nimport { c } from '@m/core';\nimport z from 'zod';\nexport const x = [React, c, z];\n",
    'packages/core/package.json': JSON.stringify({ name: '@m/core' }),
    'packages/core/src/index.ts': 'export const c = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const names = findingsFor(scan, 'deps/unlisted-dependency').map((f) => f.evidence);
    assert.deepEqual(names, ["import 'zod'"]);
  });
});

test('deps/unused-dependency spares @types packages and deps named in root config file contents', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo', devDependencies: { autoprefixer: '^10.0.0', '@types/node': '^22.0.0', 'really-unused': '^1.0.0' } }, null, 2),
    'postcss.config.js': "module.exports = { plugins: { autoprefixer: {} } };\n",
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.deepEqual(findingsFor(scan, 'deps/unused-dependency').map((f) => f.evidence), ['really-unused']);
  });
});

test('deps/unused-dependency counts CSS @plugin and @import references as usage', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { '@tw/typography': '^1.0.0' } }, null, 2),
    'src/index.css': '@plugin "@tw/typography";\n',
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.deepEqual(findingsFor(scan, 'deps/unused-dependency').map((f) => f.evidence), []);
  });
});

test('deps/unlisted-dependency skips docs and fixture directories', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }, null, 2),
    'docs/example.ts': "import x from 'left-pad';\nexport default x;\n",
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.deepEqual(findingsFor(scan, 'deps/unlisted-dependency'), []);
  });
});

test('deps/unused-dependency analyses each workspace package separately', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'], dependencies: { lodash: '1' } }, null, 2),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '1', 'left-pad': '1' } }, null, 2),
    'apps/web/src/a.ts': "import React from 'react';\nexport default React;\n",
    'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { react: '1', express: '1' } }, null, 2),
    'apps/api/src/b.ts': "import express from 'express';\nexport default express;\n",
    'src/root.ts': "import _ from 'lodash';\nexport default _;\n",
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const hits = findingsFor(scan, 'deps/unused-dependency').map((f) => `${f.file}:${f.evidence}`).sort();
    assert.deepEqual(hits, ['apps/api/package.json:react', 'apps/web/package.json:left-pad']);
  });
});

test('deps/unused-dependency flags @types/x only when x is declared and unused in the same package', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }, null, 2),
    'packages/ui/package.json': JSON.stringify({
      name: 'ui',
      dependencies: { 'react-dom': '1', lodash: '1' },
      devDependencies: { '@types/react-dom': '1', '@types/lodash': '1', '@types/node': '1', '@types/jest': '1' },
    }, null, 2),
    'packages/ui/src/a.ts': "import _ from 'lodash';\nexport default _;\n",
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const hits = findingsFor(scan, 'deps/unused-dependency').map((f) => `${f.file}:${f.evidence}`).sort();
    assert.deepEqual(hits, ['packages/ui/package.json:@types/react-dom', 'packages/ui/package.json:react-dom']);
  });
});

test('deps/unused-dependency spares packages referenced only by CI workflow scripts', async () => {
  const packageJson = JSON.stringify({
    name: 'demo',
    devDependencies: { cypress: '^13.0.0', 'left-pad': '^1.0.0' },
  }, null, 2);

  await withTempProject({
    'package.json': packageJson,
    '.github/workflows/e2e.yml': [
      'name: e2e',
      'on: push',
      'jobs:',
      '  e2e:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npx cypress run',
      '',
    ].join('\n'),
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const findings = findingsFor(scan, 'deps/unused-dependency');
    assert.deepEqual(findings.map((f) => f.evidence), ['left-pad']);
  });
});

test('deps/unused-dependency spares a dependency referenced by a tsconfig manifest', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo', devDependencies: { 'tsconfig-pkg': '^1.0.0', 'left-pad': '^1.0.0' } }, null, 2),
    'tsconfig.json': JSON.stringify({ extends: 'tsconfig-pkg' }, null, 2),
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const hits = findingsFor(scan, 'deps/unused-dependency').map((f) => f.evidence);
    assert.deepEqual(hits, ['left-pad']);
  });
});

test('deps/unlisted-dependency ignores runtime builtin specifiers for bun and deno', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }, null, 2),
    'src/a.ts': "import { test } from 'bun:test';\nimport { assertEquals } from '@std/assert';\nexport const a = 1;\n",
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(findingsFor(scan, 'deps/unlisted-dependency').length, 0);
  });
});

test('deps/unused-dependency spares packages referenced only by tailwind/postcss configs, flagging nearby dead deps', async () => {
  const packageJson = JSON.stringify({
    name: 'demo',
    devDependencies: { '@tailwindcss/typography': '^0.5.0', 'left-pad': '^1.0.0' },
  }, null, 2);

  await withTempProject({
    'package.json': packageJson,
    'tailwind.config.js': "export default { plugins: ['@tailwindcss/typography'] };\n",
    'src/a.ts': 'export const a = 1;\n',
  }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.deepEqual(findingsFor(scan, 'deps/unused-dependency').map((f) => f.evidence), ['left-pad']);
  });
});
