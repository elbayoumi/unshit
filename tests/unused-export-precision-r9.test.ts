import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

function hits(scan: Awaited<ReturnType<typeof runScan>>, rule: string): string[] {
  return scan.findings.filter((f) => f.ruleId === rule).map((f) => `${f.file}:${f.message}`);
}

test('package.json exports dist targets treat src exports as public API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-unused-export-r9-'));
  try {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }), 'utf8');
    await writeFile(join(dir, 'src/index.ts'), 'export const pub = 1;\nexport type Pub = { v: number };\n', 'utf8');
    const scan = await runScan(dir, DEFAULT_CONFIG);
    assert.deepEqual(hits(scan, 'ts/unused-export'), []);
    assert.deepEqual(hits(scan, 'ts/unused-type-export'), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
