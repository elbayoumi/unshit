import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';
import { collectPathLiteralRefTargets } from '../src/detectors/path-literals.js';
import type { DetectorContext } from '../src/contracts.js';

const EXPORT_RULES = new Set(['ts/unused-export', 'ts/unused-type-export']);

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-pathexport-r17-'));
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

async function exportHits(dir: string, file: string): Promise<string[]> {
  const scan = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
  return scan.findings.filter((f) => EXPORT_RULES.has(f.ruleId) && f.file === file).map((f) => `${f.ruleId}:${f.message}`);
}

/* ------------------------------------------------------------------ *
 * Positive case: a file handed by explicit relative path literal to a
 * call has consumers we cannot see; nothing in it is asserted dead.
 * ------------------------------------------------------------------ */

test('hono-like repro: default export of a file loaded by path string is not reported', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'runtime-tests/workerd/index.ts': [
      "const app = { fetch() { return new Response('ok'); } };",
      'export default app;',
      'export const named = 1;',
      'export type Worker = { fetch(): unknown };',
      '',
    ].join('\n'),
    'runtime-tests/workerd/index.test.ts': [
      "import { unstable_dev } from 'wrangler';",
      'const worker = await unstable_dev(\'./runtime-tests/workerd/index.ts\', { port: 8787 });',
      'console.log(worker);',
      '',
    ].join('\n'),
  }, async (dir) => {
    assert.deepEqual(await exportHits(dir, 'runtime-tests/workerd/index.ts'), []);
  });
});

test('path literal resolves relative to the referencing file directory', async () => {
  await withTempProject({
    'src/loader.ts': "export const l = load('./worker.ts');\n",
    'src/worker.ts': 'export default 1;\nexport const extra = 2;\n',
    'src/main.ts': "import { l } from './loader.js';\nconsole.log(l);\n",
  }, async (dir) => {
    assert.deepEqual(await exportHits(dir, 'src/worker.ts'), []);
  });
});

test('parent-relative (../) path literal is honoured', async () => {
  await withTempProject({
    'src/tests/loader.test.ts': "const w = load('../worker.ts');\nconsole.log(w);\n",
    'src/worker.ts': 'export default 1;\n',
  }, async (dir) => {
    assert.deepEqual(await exportHits(dir, 'src/worker.ts'), []);
  });
});

/* ------------------------------------------------------------------ *
 * Negative cases: nothing is protected without an explicit, resolvable
 * relative code-path literal inside a call.
 * ------------------------------------------------------------------ */

test('negative: non-literal argument is not a path reference', async () => {
  await withTempProject({
    'src/loader.ts': [
      "const name = './worker.ts';",
      'const worker = load(name);',
      "const other = load('./worker' + '.ts');",
      "const computed = load(`./worker.${'ts'}`);",
      'const dyn = load(name + suffix);',
      'export const used = [worker, other, computed, dyn];',
      "const suffix = '.ts';",
      '',
    ].join('\n'),
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: template substitution literal is not a path reference', async () => {
  await withTempProject({
    'src/loader.ts': [
      "const stem = 'worker';",
      'const worker = load(`./${stem}.ts`);',
      'export const used = worker;',
      '',
    ].join('\n'),
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: literal only assigned to a variable is data, not a reference', async () => {
  await withTempProject({
    'src/loader.ts': [
      "const workerPath = './worker.ts';",
      'export const p = workerPath;',
      '',
    ].join('\n'),
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { p } from './loader.js';\nconsole.log(p);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: unresolved path protects nothing', async () => {
  await withTempProject({
    'src/loader.ts': "const w = load('./does-not-exist.ts');\nexport const used = w;\n",
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: string without ./ or ../ prefix is not a path reference', async () => {
  await withTempProject({
    'src/loader.ts': "const w = load('worker.ts');\nexport const used = w;\n",
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: extensionless ./ string is not a path reference', async () => {
  await withTempProject({
    'src/loader.ts': "const w = load('./worker');\nexport const used = w;\n",
    'src/worker.ts': 'export default 1;\n',
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/worker.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export')), `default should be reported: ${hits}`);
  });
});

test('negative: ordinary unused default export still reported', async () => {
  await withTempProject({
    'src/worker.ts': 'export default function nope() { return 1; }\n',
    'src/main.ts': 'export const ok = 1;\n',
    'package.json': JSON.stringify({ name: 'demo' }),
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
    const hits = scan.findings.filter((f) => f.ruleId === 'ts/unused-export' && f.file === 'src/worker.ts');
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /Default export/);
  });
});

/* ------------------------------------------------------------------ *
 * ONE shared implementation between unused-file and unused-export.
 * ------------------------------------------------------------------ */

test('shared collectPathLiteralRefTargets drives both detectors identically', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/worker.ts': 'export default 1;\n',
    'src/loader.ts': "const w = load('./worker.ts');\nexport const used = w;\n",
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
  };
  await withTempProject(files, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
    // unused-file sees no finding for the path-literal target...
    assert.ok(!scan.findings.some((f) => f.ruleId === 'ts/unused-file' && f.file === 'src/worker.ts'));
    // ...and neither does unused-export.
    assert.ok(!scan.findings.some((f) => f.ruleId === 'ts/unused-export' && f.file === 'src/worker.ts'));
    // The shared collector resolves the same target.
    const ctx: DetectorContext = { rootDir: dir, config: DEFAULT_CONFIG, files: scan.files, manifests: scan.manifests };
    assert.ok(collectPathLiteralRefTargets(ctx).has('src/worker.ts'));
  });
});

/* ------------------------------------------------------------------ *
 * Module-loading syntax that `handleCallExpression`/`handleDynamicImport`
 * already models precisely (`import(...)`, bare `require(...)`) must NOT
 * trigger whole-file `*` protection; dead sibling exports stay reported.
 * ------------------------------------------------------------------ */

test('destructured require keeps precise member tracking; dead sibling still reported', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/cj.ts': 'export const used2 = 1;\nexport const deadTwo = 2;\n',
    'src/index.ts': "const { used2 } = require('./cj.ts');\nexport function run() { return used2; }\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/cj.ts');
    assert.ok(!hits.some((h) => h.includes('`used2`')), `used2 should be consumed: ${hits}`);
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export') && h.includes('`deadTwo`')), `deadTwo should be reported: ${hits}`);
  });
});

test('require().member keeps precise member tracking; dead sibling still reported', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/lazy.ts': 'export const used = 1;\nexport const deadOne = 2;\n',
    'src/index.ts': "export function run() { return require('./lazy.ts').used; }\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/lazy.ts');
    assert.ok(!hits.some((h) => h.includes('`used`')), `used should be consumed: ${hits}`);
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export') && h.includes('`deadOne`')), `deadOne should be reported: ${hits}`);
  });
});

test('await import() does not add whole-file protection; dead sibling still reported', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/lazy.ts': 'export const used = 1;\nexport const deadOne = 2;\n',
    'src/index.ts': "export const r = await import('./lazy.ts').then((m) => m.used);\n",
  }, async (dir) => {
    const hits = await exportHits(dir, 'src/lazy.ts');
    assert.ok(hits.some((h) => h.startsWith('ts/unused-export') && h.includes('`deadOne`')), `deadOne should be reported: ${hits}`);
  });
});

test('non-module-loading call does NOT lose precision because my rule is excluded for import/require', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/cj.ts': 'export const used2 = 1;\nexport const deadTwo = 2;\n',
    'src/lazy.ts': 'export const used = 1;\nexport const deadOne = 2;\n',
    // reviewer repro (CommonJS-style): require + destructured require + require().member
    'src/index.ts': [
      "const { used2 } = require('./cj.ts');",
      'export function run() { return used2 + require(\'./lazy.ts\').used; }',
      '',
    ].join('\n'),
  }, async (dir) => {
    const cj = await exportHits(dir, 'src/cj.ts');
    const lazy = await exportHits(dir, 'src/lazy.ts');
    assert.ok(cj.some((h) => h.includes('`deadTwo`')), `deadTwo: ${cj}`);
    assert.ok(lazy.some((h) => h.includes('`deadOne`')), `deadOne: ${lazy}`);
    assert.ok(!cj.some((h) => h.includes('`used2`')), `used2 consumed: ${cj}`);
    assert.ok(!lazy.some((h) => h.includes('`used`')), `used consumed: ${lazy}`);
  });
});

/* ------------------------------------------------------------------ *
 * Requirement 3: `unshit fix` can never remove or unexport a protected
 * export. Dry-run AND apply; fixer relies on no finding being emitted.
 * ------------------------------------------------------------------ */

const protectedFixture = {
  'package.json': JSON.stringify({ name: 'demo' }),
  'src/loader.ts': "const w = load('./worker.ts');\nexport const used = w;\n",
  'src/worker.ts': 'export default 1;\nexport const named = 2;\nexport const other = 3;\n',
  'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
};

test('unshit fix (dry-run and --apply) never unexports or deletes anything in a path-literal load target', async () => {
  await withTempProject(protectedFixture, async (dir) => {
    const before = await readFile(join(dir, 'src/worker.ts'), 'utf8');
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
    // no finding at all for the protected file
    assert.ok(!scan.findings.some((f) => EXPORT_RULES.has(f.ruleId) && f.file === 'src/worker.ts'));

    for (const apply of [false, true]) {
      const summary = await runFix(scan, { apply, ai: false });
      assert.ok(!summary.deterministicPatches.some((p) => p.file === 'src/worker.ts'), `apply=${apply}`);
      assert.ok(!summary.deletions.includes('src/worker.ts'), `apply=${apply}`);
      assert.equal(await readFile(join(dir, 'src/worker.ts'), 'utf8'), before);
    }
  });
});

// Requirement 3 note: `src/core/fixers/unused-export.ts` is intentionally NOT
// hardened with extra state. The fixer only acts on findings from the current
// scan, and no finding is emitted for protected files, so there is nothing to
// act on; `fix --apply` (and dry-run) leave a protected file untouched.

test('fix still unexports inside a non-protected file (protection is not blanket)', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'demo' }),
    'src/worker.ts': 'export default 1;\nexport const named = 2;\n',
    'src/loader.ts': "const w = load('./worker.ts');\nexport const used = w;\n",
    'src/main.ts': "import { used } from './loader.js';\nconsole.log(used);\n",
    // protected file plus an independent dead export elsewhere
    'src/free.ts': 'export const dead = 1;\nexport default 2;\n',
    'src/free-main.ts': "export const ok = 1;\n",
  }, async (dir) => {
    const summary = await runFix(await runScan(dir, DEFAULT_CONFIG, [], { noCache: true }), { apply: true, ai: false });
    // protected file untouched
    assert.equal(await readFile(join(dir, 'src/worker.ts'), 'utf8'), 'export default 1;\nexport const named = 2;\n');
    // independent non-protected dead export still fixed
    assert.ok(summary.deterministicPatches.some((p) => p.file === 'src/free.ts'));
  });
});
