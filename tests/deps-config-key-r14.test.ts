import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const RULE = 'deps/unused-dependency';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-deps-config-key-'));
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

interface Hit { file: string; evidence: string }

async function unusedDependencyHits(files: Record<string, string>): Promise<Hit[]> {
  let hits: Hit[] = [];
  await withTempProject(files, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    hits = scan.findings
      .filter((f) => f.ruleId === RULE)
      .map((f) => ({ file: f.file, evidence: f.evidence }))
      .sort((a, b) => {
        const ka = `${a.file}:${a.evidence}`;
        const kb = `${b.file}:${b.evidence}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
  });
  return hits;
}

const TRIVIAL_SRC = 'export const a = 1;\n';

function j(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

function pkg(extra: Record<string, unknown>, deps: Record<string, string>, section = 'devDependencies'): string {
  return JSON.stringify({ name: 'demo', [section]: deps, ...extra }, null, 2);
}

/* ------------------------------------------------------------------ *
 * Positive: still flagged when unused and no matching key
 * ------------------------------------------------------------------ */

test('positive: devDependency is still flagged when unused and no top-level key matches', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({}, { 'lint-staged': '^15.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: 'lint-staged' }]);
});

test('positive: nested-only key does not count', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({ wrapper: { 'lint-staged': { '*.ts': [] } }, nested: { eslintConfig: {} } }, { 'lint-staged': '^15.0.0', '@babel/core': '^7.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [
    { file: 'package.json', evidence: '@babel/core' },
    { file: 'package.json', evidence: 'lint-staged' },
  ]);
});

/* ------------------------------------------------------------------ *
 * Negative: key present -> not flagged
 * ------------------------------------------------------------------ */

test('negative: exact package name as a top-level key of the same package.json -> not flagged (lint-staged case)', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({ 'lint-staged': { '*.ts': ['biome format'] } }, { 'lint-staged': '^15.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits.filter((h) => h.evidence === 'lint-staged'), []);
});

test('negative: a genuinely unused dependency alongside a configured one is still flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({ 'lint-staged': { '*.ts': ['biome format'] } }, { 'lint-staged': '^15.0.0', 'left-pad': '^1.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: 'left-pad' }]);
});

test('negative: dependency declared in dependencies (not just devDependencies) with matching key -> not flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({ nyc: { all: true } }, { nyc: '^15.0.0' }, 'dependencies'),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, []);
});

/* ------------------------------------------------------------------ *
 * Known tools: documented config key
 * ------------------------------------------------------------------ */

const KNOWN_TOOL_CASES: ReadonlyArray<readonly [dep: string, key: string]> = [
  ['eslint', 'eslintConfig'],
  ['prettier', 'prettier'],
  ['jest', 'jest'],
  ['@babel/core', 'babel'],
  ['stylelint', 'stylelint'],
  ['commitlint', 'commitlint'],
  ['lint-staged', 'lint-staged'],
  ['nyc', 'nyc'],
  ['ava', 'ava'],
  ['c8', 'c8'],
  ['xo', 'xo'],
  ['browserslist', 'browserslist'],
  ['remark-cli', 'remarkConfig'],
];

for (const [dep, key] of KNOWN_TOOL_CASES) {
  test(`known tool: ${dep} + top-level key "${key}" -> not flagged`, async () => {
    const hits = await unusedDependencyHits({
      'package.json': pkg({ [key]: {} }, { [dep]: '^1.0.0' }),
      'src/index.ts': TRIVIAL_SRC,
    });
    assert.deepEqual(hits.filter((h) => h.evidence === dep), []);
  });
}

test('known tool: @babel/core without a babel key is still flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({}, { '@babel/core': '^7.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: '@babel/core' }]);
});

test('known tool: remark-cli without remarkConfig is still flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({}, { 'remark-cli': '^12.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: 'remark-cli' }]);
});

test('known tool: lint-staged without a lint-staged key is still flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({}, { 'lint-staged': '^15.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: 'lint-staged' }]);
});

test('known tool: @babel/core with only the documented key alias babel -> not flagged, but babel-core key does not count', async () => {
  const withBabel = await unusedDependencyHits({
    'package.json': pkg({ babel: { presets: [] } }, { '@babel/core': '^7.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(withBabel, []);

  const withBabelCore = await unusedDependencyHits({
    'package.json': pkg({ 'babel-core': {} }, { '@babel/core': '^7.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(withBabelCore, [{ file: 'package.json', evidence: '@babel/core' }]);
});

test('known tool: remark-cli is configured by remarkConfig, not a remarkConfigs/remark key', async () => {
  const hits = await unusedDependencyHits({
    'package.json': pkg({ remarkConfigs: {}, remark: {} }, { 'remark-cli': '^12.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits, [{ file: 'package.json', evidence: 'remark-cli' }]);
});

/* ------------------------------------------------------------------ *
 * Exact key match only, no substring matching
 * ------------------------------------------------------------------ */

test('exact match only: similar-but-different key name still flagged', async () => {
  const variants: Array<[string, string, string]> = [
    ['lint-staged', 'lint-staged', 'lint-staged-extra'], // key is a superstring
    ['lint-staged', 'lint-staged', 'lintStaged'], // camelCase variant
    ['lint-staged', 'lint-staged', 'Lint-Staged'], // case differs
    ['lint-staged', 'lint-staged', 'staged'], // key is a substring of the package name
    ['nyc', 'nyc', 'nyc-config'], // near-miss suffix
    ['nyc', 'nyc', 'nycConfig'], // near-miss camelCase
    ['xo', 'xo', 'xoxo'], // key contains the name
    ['xo', 'xo', 'x'], // key is a substring of the name
    ['browserslist', 'browserslist', 'browserslists'],
    ['remark-cli', 'remarkConfig', 'remarkConfigX'],
  ];
  for (const [dep, , similarKey] of variants) {
    const hits = await unusedDependencyHits({
      'package.json': pkg({ [similarKey]: {} }, { [dep]: '^1.0.0' }),
      'src/index.ts': TRIVIAL_SRC,
    });
    assert.deepEqual(
      hits.filter((h) => h.evidence === dep),
      [{ file: 'package.json', evidence: dep }],
      `dep ${dep} with similar key ${similarKey} must still be flagged`,
    );
  }
});

test('exact match only: wrong documented alias does not count', async () => {
  // eslint's documented key is eslintConfig, not "eslintconfig"; @babel/core's is babel, not "babeljs".
  const eslintHits = await unusedDependencyHits({
    'package.json': pkg({ eslintconfig: {} }, { eslint: '^9.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  // eslint itself is common tooling; assert the key variant does not create anything either way.
  assert.deepEqual(eslintHits.filter((h) => h.evidence === 'eslint'), []);

  const babelHits = await unusedDependencyHits({
    'package.json': pkg({ babeljs: {} }, { '@babel/core': '^7.0.0' }),
    'src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(babelHits, [{ file: 'package.json', evidence: '@babel/core' }]);
});

/* ------------------------------------------------------------------ *
 * Monorepo: which package.json counts
 * ------------------------------------------------------------------ */

test('monorepo: matching key in the SAME package.json -> not flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': j({ name: 'mono', workspaces: ['packages/*'] }),
    'packages/foo/package.json': j({ name: 'foo', devDependencies: { 'lint-staged': '^15.0.0' }, 'lint-staged': { '*.ts': [] } }),
    'packages/foo/src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits.filter((h) => h.file === 'packages/foo/package.json'), []);
});

test('monorepo: key in a DIFFERENT (non-root) package.json does not count', async () => {
  const hits = await unusedDependencyHits({
    'package.json': j({ name: 'mono', workspaces: ['packages/*'] }),
    'packages/foo/package.json': j({ name: 'foo', devDependencies: { 'lint-staged': '^15.0.0' } }),
    'packages/foo/src/index.ts': TRIVIAL_SRC,
    'packages/bar/package.json': j({ name: 'bar', 'lint-staged': { '*.ts': [] } }),
    'packages/bar/src/index.ts': 'export const b = 1;\n',
  });
  assert.deepEqual(
    hits.filter((h) => h.evidence === 'lint-staged'),
    [{ file: 'packages/foo/package.json', evidence: 'lint-staged' }],
  );
});

test('monorepo: key in the ROOT package.json counts for a dependency declared in a workspace package', async () => {
  const hits = await unusedDependencyHits({
    'package.json': j({ name: 'mono', workspaces: ['packages/*'], 'lint-staged': { '*.ts': [] } }),
    'packages/foo/package.json': j({ name: 'foo', devDependencies: { 'lint-staged': '^15.0.0' } }),
    'packages/foo/src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(hits.filter((h) => h.evidence === 'lint-staged'), []);
});

test('monorepo: key in a workspace package does not count for a dependency declared in root', async () => {
  const hits = await unusedDependencyHits({
    'package.json': j({ name: 'mono', workspaces: ['packages/*'], devDependencies: { 'lint-staged': '^15.0.0' } }),
    'packages/foo/package.json': j({ name: 'foo', 'lint-staged': { '*.ts': [] } }),
    'packages/foo/src/index.ts': TRIVIAL_SRC,
    'src/root.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(
    hits.filter((h) => h.evidence === 'lint-staged'),
    [{ file: 'package.json', evidence: 'lint-staged' }],
  );
});

test('monorepo: root key matches exactly too, no substring matching', async () => {
  const hits = await unusedDependencyHits({
    'package.json': j({ name: 'mono', workspaces: ['packages/*'], 'lint-staged-config': {} }),
    'packages/foo/package.json': j({ name: 'foo', devDependencies: { 'lint-staged': '^15.0.0' } }),
    'packages/foo/src/index.ts': TRIVIAL_SRC,
  });
  assert.deepEqual(
    hits.filter((h) => h.evidence === 'lint-staged'),
    [{ file: 'packages/foo/package.json', evidence: 'lint-staged' }],
  );
});

test('a dependency named like a standard package.json field is still flagged', async () => {
  const hits = await unusedDependencyHits({
    'package.json': JSON.stringify({
      name: 'demo',
      module: 'dist/index.mjs',
      dependencies: { module: '1.0.0' },
    }, null, 2),
    'src/index.ts': 'export const x = 1;\n',
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.file, 'package.json');
});
