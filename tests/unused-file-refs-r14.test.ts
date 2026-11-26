import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const RULE = 'ts/unused-file';

async function hits(files: Record<string, string>): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-unused-file-refs-r14-'));
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

test('package.json script reference keeps the file alive', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      scripts: { bench: 'node packages/bench/index.ts' },
    }),
    'packages/bench/index.ts': 'export const bench = 1;\n',
    'src/orphan.ts': 'export const orphan = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('./ prefixed and nested package.json script references keep files alive', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      scripts: { start: 'tsx ./src/cli.ts' },
    }),
    'src/cli.ts': 'export const cli = 1;\n',
    'packages/foo/package.json': JSON.stringify({
      name: 'foo',
      scripts: { start: 'tsx src/index.ts' },
    }),
    'packages/foo/src/index.ts': 'export const foo = 1;\n',
    'src/orphan.ts': 'export const orphan = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('scanned config string reference keeps the file alive', async () => {
  const r = await hits({
    'vitest.config.ts': "export default { test: { projects: ['./vitest.compile.config.ts'] } };\n",
    'vitest.compile.config.ts': 'export const compile = 1;\n',
    'src/orphan.ts': 'export const orphan = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('config string reference resolves relative to the config directory', async () => {
  const r = await hits({
    'packages/api/vitest.config.ts': "export default { test: { setupFiles: ['./setup.ts'] } };\n",
    'packages/api/setup.ts': 'export const setup = 1;\n',
  });
  assert.deepEqual(r, []);
});

test('substring script tokens do not mark a differently named file alive', async () => {
  const r = await hits({
    'package.json': JSON.stringify({
      name: 'demo',
      scripts: { dev: 'tsx playground.ts' },
    }),
    'play.ts': 'export const play = 1;\n',
  });
  assert.deepEqual(r, ['play.ts']);
});

test('substring config tokens do not mark a differently named file alive', async () => {
  const r = await hits({
    'vitest.config.ts': "export default { test: { projects: ['./play'] } };\n",
    'play.ts': 'export const play = 1;\n',
  });
  assert.deepEqual(r, ['play.ts']);
});

test('path strings in ordinary source files do not keep files alive', async () => {
  const r = await hits({
    'src/main.ts': 'const loader = "./orphan.ts";\nconsole.log(loader);\n',
    'src/orphan.ts': 'export const orphan = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});

test('sources whose names merely contain rc. are not treated as configs', async () => {
  const r = await hits({
    'src/torc.ts': 'export const loader = "./orphan.ts";\n',
    'src/index.ts': "import { loader } from './torc.js';\nconsole.log(loader);\n",
    'src/orphan.ts': 'export const orphan = 1;\n',
  });
  assert.deepEqual(r, ['src/orphan.ts']);
});
