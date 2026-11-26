import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FindingCache, hashContent } from '../src/core/cache.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-perf-r14-'));
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

function normalize(findings: Array<{ ruleId: string; file: string; span: { line: number; column: number }; message: string }>) {
  return findings
    .map((f) => ({ ruleId: f.ruleId, file: f.file, line: f.span.line, column: f.span.column, message: f.message }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId) || a.message.localeCompare(b.message));
}

test('cross-file findings stay identical across warm scans', async () => {
  await withTempProject(
    {
      'src/a.ts': 'export function a() { return 1; }\nimport { b } from "./b";\nconsole.log(b());\n',
      'src/b.ts': 'export function b() { return 2; }\nexport function unusedB() { return 3; }\n',
      'src/c.ts': 'export function c() { return a(); }\nimport { a } from "./a";\nconsole.log(c());\n',
    },
    async (dir) => {
      const config = { ...DEFAULT_CONFIG };
      const uncached = await runScan(dir, config, [], { noCache: true });
      const cold = await runScan(dir, config, [], { noCache: false });
      const warm = await runScan(dir, config, [], { noCache: false });
      assert.deepEqual(normalize(cold.findings), normalize(uncached.findings));
      assert.deepEqual(normalize(warm.findings), normalize(uncached.findings));
    },
  );
});

test('cross-file findings invalidate when any file content changes', async () => {
  await withTempProject(
    {
      'src/a.ts': 'export function used() { return 1; }\n',
      'src/b.ts': 'import { used } from "./a";\nexport function b() { return used(); }\n',
    },
    async (dir) => {
      const config = { ...DEFAULT_CONFIG };
      await runScan(dir, config);

      // Change b.ts so it no longer imports used() - makes used() unused-export.
      await writeFile(join(dir, 'src/b.ts'), 'export function b() { return 1; }\n', 'utf8');
      const after = await runScan(dir, config);
      const uncached = await runScan(dir, config, [], { noCache: true });
      assert.deepEqual(normalize(after.findings), normalize(uncached.findings));
      assert.ok(after.findings.some((f) => f.ruleId === 'ts/unused-export' && f.file === 'src/a.ts'));
    },
  );
});

test('warm scan reflects manifest content changes', async () => {
  await withTempProject(
    {
      'package.json': '{"name":"x","dependencies":{"lodash":"1"}}\n',
      'main.ts': 'import _ from "lodash";\nconsole.log(_);\n',
    },
    async (dir) => {
      const config = { ...DEFAULT_CONFIG };
      await runScan(dir, config);

      await writeFile(join(dir, 'package.json'), '{"name":"x","dependencies":{}}\n', 'utf8');
      const after = await runScan(dir, config);
      const uncached = await runScan(dir, config, [], { noCache: true });
      assert.deepEqual(normalize(after.findings), normalize(uncached.findings));
      assert.ok(after.findings.some((f) => f.ruleId === 'deps/unlisted-dependency'));
    },
  );
});

test('FindingCache index fast path preserves per-file cache semantics', async () => {
  await withTempProject({ 'a.ts': 'export const a: any = 1;\n' }, async (dir) => {
    const config = { ...DEFAULT_CONFIG };
    const cache = new FindingCache(dir, config);
    const hash = hashContent('export const a: any = 1;\n');
    cache.set(hash, [
      {
        ruleId: 'ts/no-explicit-any',
        category: 'types',
        tier: 'structural',
        severity: 'warn',
        fixability: 'manual',
        confidence: 0.9,
        file: 'a.ts',
        span: { line: 1, column: 17, endLine: 1, endColumn: 20 },
        message: 'any',
        evidence: 'any',
      },
    ]);
    cache.flush();

    const cache2 = new FindingCache(dir, config);
    const hit = cache2.get(hash, 'a.ts');
    assert.ok(hit);
    assert.equal(hit[0]?.file, 'a.ts');
    assert.equal(hit[0]?.ruleId, 'ts/no-explicit-any');
  });
});
