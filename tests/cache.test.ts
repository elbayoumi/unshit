import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FindingCache, hashContent } from '../src/core/cache.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-cache-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('cached and uncached scans return identical findings', async () => {
  await withTempProject(
    {
      'a.ts': 'export function a(x: any) { return x; }\n',
      'b.ts': 'export function b() { try { return 1; } catch (e) { throw e; } }\n',
      'c.css': '.btn { color: red !important; }\n.btn { color: blue; }\n',
    },
    async (dir) => {
      const config = { ...DEFAULT_CONFIG };

      const uncached = await runScan(dir, config, [], { noCache: true });
      const cold = await runScan(dir, config, [], { noCache: false });
      const warm = await runScan(dir, config, [], { noCache: false });

      const normalize = (findings: typeof uncached.findings) =>
        findings.map((f) => ({ ...f })).sort((a, b) =>
          a.file.localeCompare(b.file)
          || a.span.line - b.span.line
          || a.ruleId.localeCompare(b.ruleId)
          || a.message.localeCompare(b.message),
        );

      assert.deepEqual(normalize(cold.findings), normalize(uncached.findings));
      assert.deepEqual(normalize(warm.findings), normalize(uncached.findings));
    },
  );
});

test('editing a file invalidates only that file cache entry', async () => {
  await withTempProject(
    {
      'a.ts': 'export const a: any = 1;\n',
      'b.ts': 'export const b: any = 2;\n',
    },
    async (dir) => {
      const config = { ...DEFAULT_CONFIG };
      await runScan(dir, config);

      const aBefore = 'export const a: any = 1;\n';
      const bContent = 'export const b: any = 2;\n';
      const aHashBefore = hashContent(aBefore);
      const bHash = hashContent(bContent);
      const cacheDir = join(dir, '.unshit', 'cache');
      const filesBefore = (await readdir(cacheDir)).sort();
      assert.ok(filesBefore.includes(`${aHashBefore}.json`));
      assert.ok(filesBefore.includes(`${bHash}.json`));

      await writeFile(join(dir, 'a.ts'), 'export const a: number = 1;\n', 'utf8');
      const aAfter = 'export const a: number = 1;\n';
      const aHashAfter = hashContent(aAfter);

      const scan = await runScan(dir, config);
      const filesAfter = (await readdir(cacheDir)).sort();
      assert.ok(filesAfter.includes(`${bHash}.json`), 'unchanged file cache entry should remain');
      assert.ok(filesAfter.includes(`${aHashAfter}.json`), 'edited file should get new cache entry');

      const aFindings = scan.findings.filter((f) => f.file === 'a.ts' && f.ruleId === 'ts/no-explicit-any');
      const bFindings = scan.findings.filter((f) => f.file === 'b.ts' && f.ruleId === 'ts/no-explicit-any');
      assert.equal(aFindings.length, 0);
      assert.equal(bFindings.length, 1);
    },
  );
});

test('FindingCache ignores entries from different config', async () => {
  await withTempProject(
    {
      'a.ts': 'export const a: any = 1;\n',
    },
    async (dir) => {
      const configA = { ...DEFAULT_CONFIG };
      const configB = { ...DEFAULT_CONFIG, disabledRules: ['ts/no-explicit-any'] };
      const scanA = await runScan(dir, configA);
      assert.ok(scanA.findings.some((f) => f.ruleId === 'ts/no-explicit-any'));

      const scanB = await runScan(dir, configB);
      assert.equal(scanB.findings.some((f) => f.ruleId === 'ts/no-explicit-any'), false);

      // Cache object also respects config hash directly.
      const cacheA = new FindingCache(dir, configA);
      const cacheB = new FindingCache(dir, configB);
      const hash = hashContent('export const a: any = 1;\n');
      // cacheB last wrote; cacheA should miss due to cfg hash mismatch
      assert.equal(cacheA.get(hash, 'a.ts'), undefined);
      assert.ok(Array.isArray(cacheB.get(hash, 'a.ts')));
    },
  );
});
