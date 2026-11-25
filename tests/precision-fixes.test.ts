import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

async function scanFixture(files: Record<string, string>, rule: string, config = DEFAULT_CONFIG): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-precision-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    const scan = await runScan(dir, config);
    return scan.findings.filter((f) => f.ruleId === rule).map((f) => `${f.file}:${f.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('ts/unused-export skips package.json public entry points, integrations/, and Next app-router conventions', async () => {
  const hits = await scanFixture({
    'package.json': JSON.stringify({ name: 'x', exports: { '.': { types: './dist/src/api.d.ts', import: './dist/src/api.js' } } }),
    'src/api.ts': 'export const publicApi = 1;\n',
    'src/integrations/plugin.ts': 'export const hook = 1;\n',
    'app/page.tsx': 'export const dynamic = "force-dynamic";\nexport default function P() { return null; }\n',
    'src/internal.ts': 'export const orphan = 1;\n',
  }, 'ts/unused-export');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!, /internal\.ts/);
});

test('ts/unused-type-export reports locally used types (drop `export`) and skips *Props', async () => {
  const hits = await scanFixture({
    'src/a.ts': 'export interface Opts { a: number }\nexport function f(o: Opts) { return o.a; }\nexport type ButtonProps = { x: 1 };\nexport type Dead = { z: 1 };\n',
  }, 'ts/unused-type-export');
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => /Opts.*used only locally/.test(h)));
  assert.ok(hits.some((h) => /Dead.*zero references/.test(h)));
  assert.ok(!hits.some((h) => /ButtonProps/.test(h)));
});

test('react/god-file ignores Python tests/generated Dart and uses a higher polyglot limit', async () => {
  const big = Array.from({ length: 500 }, (_, i) => `x${i} = ${i}`).join('\n');
  const hits = await scanFixture({
    'tests/test_big.py': big,
    'pkg/test_other.py': big,
    'lib/model.g.dart': Array.from({ length: 500 }, (_, i) => `var a${i} = ${i};`).join('\n'),
    'pkg/ok.py': big,
    'pkg/huge.py': Array.from({ length: 800 }, (_, i) => `y${i} = ${i}`).join('\n'),
  }, 'react/god-file');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!, /huge\.py/);
});

test('arch/import-cycle: Python `from . import sibling` does not create a package-level cycle', async () => {
  const hits = await scanFixture({
    'pkg/__init__.py': 'from . import a\n',
    'pkg/a.py': 'from . import b\n',
    'pkg/b.py': 'X = 1\n',
  }, 'arch/import-cycle');
  assert.deepEqual(hits, []);
});

test('css/duplicate-selector ignores :root and same class in separate files', async () => {
  const hits = await scanFixture({
    'a.css': ':root { --a: 1; }\n.card { color: red; }\n',
    'b.css': ':root { --b: 1; }\n.card { color: blue; }\n',
  }, 'css/duplicate-selector');
  assert.deepEqual(hits, []);
});

test('walker skips static/lib vendored code and generated .g.dart files by default', async () => {
  const hits = await scanFixture({
    'static/lib/vendor.js': 'var a = 1 as any;\n',
    'addons/web/static/lib/dart.dart': 'dynamic y = 1;\n',
    'lib/m.g.dart': 'dynamic x = 1;\nvoid f(){ print(x); }\n',
  }, 'dart/dynamic');
  assert.deepEqual(hits, []);
});
