import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { DetectorContext, FileEntry, Finding } from '../src/contracts.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import { importCycleDetector } from '../src/detectors/arch.js';
import { unusedFileDetector } from '../src/detectors/unused-file.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function makeFile(rootDir: string, relPath: string, content: string): FileEntry {
  const ext = extname(relPath).toLowerCase();
  return {
    absPath: join(rootDir, relPath),
    relPath,
    ext,
    content,
    lines: content.split(/\r?\n/),
    ...(TS_EXTS.has(ext)
      ? { sourceFile: ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true) }
      : {}),
  };
}

function ctxFrom(files: Record<string, string>): DetectorContext {
  const rootDir = join(tmpdir(), `unshit-cycle-r10-${Math.random().toString(36).slice(2)}`);
  return {
    rootDir,
    config: { ...DEFAULT_CONFIG },
    files: Object.entries(files).map(([relPath, content]) => makeFile(rootDir, relPath, content)),
  };
}

function cycles(ctx: DetectorContext): Finding[] {
  return importCycleDetector.detect(ctx).filter((f) => f.ruleId === 'arch/import-cycle');
}

test('a module importing its own runtime export is a one-node cycle at lower confidence', () => {
  const ctx = ctxFrom({
    'src/cache.ts': "import { VERSION } from './cache';\nexport const VERSION = 1;\n",
    'src/index.ts': "import './cache';\n",
  });

  const findings = cycles(ctx);
  assert.deepEqual(findings.map((f) => f.evidence), ['src/cache.ts -> src/cache.ts']);
  assert.equal(findings[0]?.file, 'src/cache.ts');
  assert.equal(findings[0]?.severity, 'warn');
  assert.ok((findings[0]?.confidence ?? 1) < 1);

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.selfLoops, ['src/cache.ts']);
  assert.ok(!graph.edges.some((edge) => edge.from === edge.to));
  assert.deepEqual(graph.incomingOf('src/cache.ts'), ['src/index.ts']);
});

test('self imports do not keep an otherwise unreferenced file alive', () => {
  const ctx = ctxFrom({
    'src/cache.ts': "import { VERSION } from './cache';\nexport const VERSION = 1;\n",
  });

  const findings = unusedFileDetector.detect(ctx);
  assert.ok(findings.some((finding) => finding.file === 'src/cache.ts'));
});

test('a dynamic import() closes a two-module cycle', () => {
  const ctx = ctxFrom({
    'src/a.ts': "export const a = 1;\nexport const loadB = () => import('./b');\n",
    'src/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
    'src/index.ts': "import './a';\n",
  });

  assert.deepEqual(cycles(ctx).map((f) => f.evidence), ['src/a.ts -> src/b.ts -> src/a.ts']);
  const edge = buildImportGraph(ctx).edges.find((e) => e.from === 'src/a.ts' && e.to === 'src/b.ts');
  assert.equal(edge?.spec, './b');
  assert.equal(edge?.line, 2);
});

test('a lazy edge plus a static chain closes a three-module cycle', () => {
  const ctx = ctxFrom({
    'src/a.ts': "export const a = 1;\nexport const next = () => import('./b');\n",
    'src/b.ts': "import { c } from './c';\nexport const b = c;\n",
    'src/c.ts': "import { a } from './a';\nexport const c = a;\n",
    'src/index.ts': "import './a';\n",
  });

  assert.deepEqual(cycles(ctx).map((f) => f.evidence), [
    'src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts',
  ]);
});

test('a self import inside a larger cycle is not reported twice', () => {
  const ctx = ctxFrom({
    'src/a.ts': [
      "import { b } from './b';",
      "import { a } from './a';",
      'export const a = 1;',
    ].join('\n') + '\n',
    'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
  });

  assert.deepEqual(cycles(ctx).map((f) => f.evidence), ['src/a.ts -> src/b.ts -> src/a.ts']);
});

test('dynamic import() of an external package adds no graph edge or cycle', () => {
  const ctx = ctxFrom({
    'src/a.ts': "export const load = () => import('some-pkg');\n",
    'src/index.ts': "import './a';\n",
  });

  assert.deepEqual(cycles(ctx), []);
  assert.deepEqual(buildImportGraph(ctx).outgoingOf('src/a.ts'), []);
});

test('a dynamic import() of a missing internal target is not an edge', () => {
  const ctx = ctxFrom({
    'src/a.ts': "export const load = () => import('./missing');\n",
    'src/index.ts': "import './a';\n",
  });

  assert.deepEqual(cycles(ctx), []);
  assert.deepEqual(buildImportGraph(ctx).outgoingOf('src/a.ts'), []);
});
