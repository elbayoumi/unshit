import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const RULE = 'ts/unused-file';

async function hits(files: Record<string, string>): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-unused-file-pathlit-r16-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    const scan = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
    return scan.findings.filter((f) => f.ruleId === RULE).map((f) => f.file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('hono-like loader ref resolves from the package root', async () => {
  const r = await hits({
    'package.json': JSON.stringify({ name: 'demo' }),
    'runtime-tests/workerd/index.ts': 'export default { fetch() { return new Response("ok"); } };\n',
    'runtime-tests/workerd/index.test.ts': [
      'const worker = await unstable_dev(\'./runtime-tests/workerd/index.ts\', { port: 8787 });',
      'console.log(worker);',
      '',
    ].join('\n'),
  });
  assert.deepEqual(r, []);
});

test('nested package root resolves a root-relative loader ref', async () => {
  const r = await hits({
    'packages/app/package.json': JSON.stringify({ name: 'app' }),
    'packages/app/runtime/worker.ts': 'export const worker = 1;\n',
    'packages/app/runtime/tests/loader.test.ts': "const w = load('./runtime/worker.ts');\nconsole.log(w);\n",
  });
  assert.deepEqual(r, []);
});

test('loader ref resolves relative to the referencing file directory', async () => {
  const r = await hits({
    'src/loader.ts': "const w = load('./worker.ts');\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.deepEqual(r, ['src/loader.ts']);
});

test('parent-relative loader ref resolves exactly', async () => {
  const r = await hits({
    'src/tests/loader.ts': "const w = load('../worker.ts');\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.ok(!r.includes('src/worker.ts'));
});

test('string without a ./ or ../ prefix is not a path reference', async () => {
  const r = await hits({
    'src/loader.ts': "const w = load('worker.ts');\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.deepEqual(r, ['src/loader.ts', 'src/worker.ts']);
});

test('extensionless ./ string is not a path reference', async () => {
  const r = await hits({
    'src/loader.ts': "const w = load('./worker');\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.deepEqual(r, ['src/loader.ts', 'src/worker.ts']);
});

test('path to a missing file does not crash and leaves the target flagged', async () => {
  const r = await hits({
    'src/loader.ts': "const w = load('./missing.ts');\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.deepEqual(r, ['src/loader.ts', 'src/worker.ts']);
});

test('substitution template literals are ignored', async () => {
  const r = await hits({
    'src/loader.ts': "const suffix = 'worker';\nconst w = load(`./${suffix}.ts`);\nconsole.log(w);\n",
    'src/worker.ts': 'export const w = 1;\n',
  });
  assert.deepEqual(r, ['src/loader.ts', 'src/worker.ts']);
});
