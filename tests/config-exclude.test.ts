import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

const EXCLUDED_DIRS = ['docs', 'research', 'fixtures', '__fixtures__'];

async function withFixture(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-config-exclude-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(dir, relPath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('default exclude covers docs, research, and fixture directories', () => {
  for (const dir of EXCLUDED_DIRS) {
    assert.ok(DEFAULT_CONFIG.exclude.includes(dir), `default exclude is missing ${dir}`);
  }
});

test('default-config scan reports no findings from docs/research benchmark fixtures', async () => {
  const doubleCast = 'export const probe = {} as unknown as string;\n';
  await withFixture(
    {
      'docs/research/bench/src/probe.ts': doubleCast,
      'research/bench/src/probe.ts': doubleCast,
      'fixtures/probe.ts': doubleCast,
      '__fixtures__/probe.ts': doubleCast,
      'src/keep.ts': doubleCast,
    },
    async (dir) => {
      const scan = await runScan(dir, DEFAULT_CONFIG);
      assert.deepEqual(
        scan.files.map((file) => file.relPath),
        ['src/keep.ts'],
      );
      assert.ok(
        scan.findings.some((f) => f.file === 'src/keep.ts' && f.ruleId === 'ts/no-double-cast'),
        'the double cast in the scanned file should still be reported',
      );
      assert.equal(
        scan.findings.filter((f) => EXCLUDED_DIRS.some((d) => f.file === d || f.file.startsWith(`${d}/`))).length,
        0,
      );
    },
  );
});
