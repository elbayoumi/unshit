import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import { runScan, type ScanResult } from '../src/core/scanner.js';

async function withProject(
  files: Record<string, string>,
  fn: (scan: ScanResult) => Promise<void> | void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-mts-cts-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    const scan = await runScan(dir, DEFAULT_CONFIG);
    await fn(scan);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function findingsFor(scan: ScanResult, ruleId: string): string[] {
  return scan.findings.filter((f) => f.ruleId === ruleId).map((f) => f.file).sort();
}

function targetsFrom(scan: ScanResult, from: string): string[] {
  const graph = buildImportGraph({
    rootDir: scan.rootDir,
    config: scan.config,
    files: scan.files,
    manifests: scan.manifests,
  });
  return graph.outgoingOf(from).sort();
}

function complexDeclaration(name: string): string {
  const body = Array.from({ length: 30 }, (_, i) => `  if (x > ${i}) { return x; }`).join('\n');
  return `export function ${name}(x: number): number {\n${body}\n  return x;\n}\n`;
}

test('default config scans .mts and .cts files', async () => {
  await withProject({
    'src/a.mts': 'export const a = 1;\n',
    'src/b.cts': 'export const b = 2;\n',
    'src/c.ts': 'export const c = 3;\n',
  }, async (scan) => {
    assert.deepEqual(
      scan.files.map((f) => f.relPath).filter((rel) => rel.startsWith('src/')),
      ['src/a.mts', 'src/b.cts', 'src/c.ts'],
    );
    assert.ok(scan.files.find((f) => f.relPath === 'src/a.mts')?.sourceFile);
    assert.ok(scan.files.find((f) => f.relPath === 'src/b.cts')?.sourceFile);
  });
});

test('./x.mjs resolves to x.mts and ./x.cjs resolves to x.cts', async () => {
  await withProject({
    'src/main.mts': "import './x.mjs';\nimport './y.cjs';\nconsole.log(1);\n",
    'src/x.mts': 'export const x = 1;\n',
    'src/y.cts': 'export const y = 2;\n',
  }, async (scan) => {
    assert.deepEqual(targetsFrom(scan, 'src/main.mts'), ['src/x.mts', 'src/y.cts']);
    const unused = findingsFor(scan, 'ts/unused-file');
    assert.ok(!unused.includes('src/x.mts'), `x.mts should be used: ${unused}`);
    assert.ok(!unused.includes('src/y.cts'), `y.cts should be used: ${unused}`);
  });
});

test('a real .mjs file wins over .mts for ./x.mjs', async () => {
  await withProject({
    'src/main.mts': "import './x.mjs';\nconsole.log(1);\n",
    'src/x.mts': 'export const fromMts = 1;\n',
    'src/x.mjs': 'export const fromMjs = 2;\n',
  }, async (scan) => {
    assert.deepEqual(targetsFrom(scan, 'src/main.mts'), ['src/x.mjs']);
  });
});

test('an unused .mts file is reported as unused', async () => {
  await withProject({
    'src/main.ts': "import { used } from './used.mjs';\nconsole.log(used);\n",
    'src/used.mts': 'export const used = 1;\n',
    'src/orphan.mts': 'export const orphan = 2;\n',
  }, async (scan) => {
    assert.deepEqual(findingsFor(scan, 'ts/unused-file'), ['src/orphan.mts']);
  });
});

test('.d.mts and .d.cts are treated like .d.ts', async () => {
  const declarations = ['src/types.d.cts', 'src/types.d.mts'];
  await withProject({
    'src/keep.ts': 'export const keep = 1;\n',
    'src/types.d.mts': `${complexDeclaration('mtsComplex')}export declare const mtsAny: any;\n`,
    'src/types.d.cts': `${complexDeclaration('ctsComplex')}export declare const ctsAny: any;\n`,
  }, async (scan) => {
    const scanned = scan.files.map((f) => f.relPath).filter((rel) => declarations.includes(rel)).sort();
    assert.deepEqual(scanned, declarations);
    const relevant = new Set(['ts/unused-file', 'code/high-complexity', 'ts/no-explicit-any']);
    const hits = scan.findings
      .filter((f) => relevant.has(f.ruleId) && declarations.includes(f.file))
      .map((f) => `${f.ruleId}:${f.file}`)
      .sort();
    assert.deepEqual(hits, []);
  });
});

test('an unused export in a .mts file is reported', async () => {
  await withProject({
    'src/main.mts': "import { used } from './lib.mjs';\nconsole.log(used);\n",
    'src/lib.mts': 'export const used = 1;\nexport const orphan = 2;\n',
  }, async (scan) => {
    const hits = scan.findings
      .filter((f) => f.ruleId === 'ts/unused-export' && f.file === 'src/lib.mts')
      .map((f) => f.message)
      .sort();
    assert.deepEqual(hits, ['Exported symbol `orphan` has zero references; safe to delete.']);
  });
});

test('app-router framework exports are exempt in .mts and .cts route files', async () => {
  await withProject({
    'package.json': '{"name":"x","version":"1.0.0"}\n',
    'features/a/route.mts': 'export const dynamic = "force-dynamic";\nexport const unusedThing = 1;\n',
    'features/b/route.cts': 'export const revalidate = 0;\n',
  }, (scan) => {
    const messages = scan.findings
      .filter((f) => f.ruleId === 'ts/unused-export')
      .map((f) => `${f.file} ${f.message}`);
    assert.equal(messages.some((m) => /dynamic|revalidate/.test(m)), false, messages.join('\n'));
    assert.equal(messages.some((m) => m.includes('unusedThing')), true, messages.join('\n'));
  });
});
