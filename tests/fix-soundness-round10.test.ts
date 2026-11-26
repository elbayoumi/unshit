import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-fs-r10-'));
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

test('ts/no-explicit-any: does not auto-fix catch(any) when binding is used', async () => {
  await withTempProject(
    {
      'catch-used.ts': `export function run() {
  try { throw new Error('x'); }
  catch (err: any) { console.log(err.message); }
}
`,
      'main.ts': `import { run } from './catch-used';\nconsole.log(run());\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const anyFinding = scan.findings.find((f) => f.ruleId === 'ts/no-explicit-any');
      assert.ok(anyFinding, 'should report no-explicit-any');
      assert.notEqual(anyFinding.fixability, 'safe');
      const applied = await runFix(scan, { apply: true, ai: false });
      const updated = await readFile(join(dir, 'catch-used.ts'), 'utf8');
      assert.match(updated, /catch \(err: any\)/);
      assert.ok(!applied.deterministicPatches.some((p) => p.ruleId === 'ts/no-explicit-any'));
    },
  );
});

test('ts/unused-export: skips removal when noUnusedLocals would make it an unused local', async () => {
  await withTempProject(
    {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, noUnusedLocals: true },
        include: ['*.ts'],
      }),
      'a.ts': `export const ONLY_EXPORTED = 1;\n`,
      'b.ts': `export const USED = 2;\nconsole.log(USED);\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dry = await runFix(scan, { apply: false, ai: false });
      const skipped = dry.skipped.filter((s) => s.ruleId === 'ts/unused-export');
      assert.ok(skipped.some((s) => /noUnusedLocals/.test(s.reason)));
      // USED is referenced locally, so removing export is safe even under noUnusedLocals
      const usedSkip = skipped.find((s) => /USED/.test(s.reason));
      assert.equal(usedSkip, undefined);
    },
  );
});

test('ts/unused-file: does not delete files referenced by package.json exports in gitignored manifests', async () => {
  await withTempProject(
    {
      '.gitignore': 'packages/zod/package.json\n',
      'packages/zod/package.json': JSON.stringify({
        name: 'zod-pkg',
        exports: { './mini': './src/mini/index.ts' },
      }),
      'packages/zod/src/mini/index.ts': `export const mini = 1;\n`,
      'packages/zod/src/unused.ts': `export const nope = 1;\n`,
    },
    async (dir) => {
      // The gitignored package.json should still protect its export targets
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const unusedFiles = scan.findings.filter((f) => f.ruleId === 'ts/unused-file').map((f) => f.file);
      assert.ok(!unusedFiles.includes('packages/zod/src/mini/index.ts'));
      assert.ok(unusedFiles.includes('packages/zod/src/unused.ts'));
    },
  );
});
