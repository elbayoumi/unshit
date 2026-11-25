import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { DetectorContext, FileEntry } from '../src/contracts.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import { tarjanSCC } from '../src/detectors/arch.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function getScriptKind(ext: string): ts.ScriptKind {
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function makeFile(rootDir: string, relPath: string, content: string): FileEntry {
  const ext = extname(relPath).toLowerCase();
  return {
    absPath: join(rootDir, relPath),
    relPath,
    ext,
    content,
    lines: content.split(/\r?\n/),
    ...(TS_EXTS.has(ext)
      ? { sourceFile: ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, getScriptKind(ext)) }
      : {}),
  };
}

function ctxFrom(files: Record<string, string>, manifests: string[] = []): DetectorContext {
  const rootDir = join(tmpdir(), `unshit-lang-graph-${Math.random().toString(36).slice(2)}`);
  return {
    rootDir,
    config: { ...DEFAULT_CONFIG },
    files: Object.entries(files).map(([relPath, content]) => makeFile(rootDir, relPath, content)),
    manifests,
  };
}

test('vue <script setup> and plain <script> blocks create TS/JS edges and resolve component targets', () => {
  const ctx = ctxFrom({
    'src/app.ts': [
      "import Foo from './Foo.vue';",
      "export { Widget } from './Widget.svelte';",
      "import Missing from './Missing.vue';",
    ].join('\n') + '\n',
    'src/entry.js': [
      "const Foo = require('./Foo.vue');",
      "import Widget from './Widget.svelte';",
    ].join('\n') + '\n',
    'src/Foo.vue': [
      '<script setup lang="ts">',
      "import { helper } from './helper';",
      'export { helper };',
      "const legacy = require('./legacy');",
      '</script>',
      '<template><Widget /></template>',
      '<script>',
      "import Widget from './Widget.svelte';",
      'export default { legacy };',
      '</script>',
    ].join('\n') + '\n',
    'src/Widget.svelte': [
      '<script lang="ts">',
      'import { helper } from "./helper";',
      'export const widget = helper;',
      '</script>',
    ].join('\n') + '\n',
    'src/helper.ts': 'export const helper = 1;\n',
    'src/legacy.js': 'module.exports = {};\n',
  });

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/app.ts'), ['src/Foo.vue', 'src/Widget.svelte']);
  assert.deepEqual(graph.outgoingOf('src/entry.js'), ['src/Foo.vue', 'src/Widget.svelte']);
  assert.deepEqual(graph.outgoingOf('src/Foo.vue'), [
    'src/Widget.svelte',
    'src/helper.ts',
    'src/legacy.js',
  ]);
  assert.deepEqual(graph.outgoingOf('src/Widget.svelte'), ['src/helper.ts']);

  const firstScriptEdge = graph.edges.find((edge) =>
    edge.from === 'src/Foo.vue' && edge.to === 'src/helper.ts');
  assert.equal(firstScriptEdge?.line, 2);
  assert.equal(firstScriptEdge?.spec, './helper');
  const secondScriptEdge = graph.edges.find((edge) =>
    edge.from === 'src/Foo.vue' && edge.to === 'src/Widget.svelte');
  assert.equal(secondScriptEdge?.line, 8);

  // An unscanned component is an asset, not an unresolved internal import.
  assert.ok(!graph.edges.some((edge) => edge.spec === './Missing.vue'));
});

test('svelte <script lang="ts"> parses static imports/re-exports/require and ignores type-only imports', () => {
  const ctx = ctxFrom({
    'src/Panel.svelte': [
      '<div>before</div>',
      '<script lang="ts">',
      "import type { Shape } from './types';",
      "import { model } from './model';",
      "import Foo from './Foo.vue';",
      "export { view } from './view';",
      'const cache = require("./cache");',
      '</script>',
    ].join('\n') + '\n',
    'src/Foo.vue': '<template><div /></template>\n<script setup>export const foo = 1;\n</script>\n',
    'src/types.ts': 'export type Shape = { id: string };\n',
    'src/model.ts': 'export const model = 1;\n',
    'src/view.ts': 'export const view = 2;\n',
    'src/cache.js': 'module.exports = {};\n',
  });

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/Panel.svelte'), [
    'src/Foo.vue',
    'src/cache.js',
    'src/model.ts',
    'src/view.ts',
  ]);
  const reexportEdge = graph.edges.find((edge) =>
    edge.from === 'src/Panel.svelte' && edge.to === 'src/view.ts');
  assert.equal(reexportEdge?.line, 6);
  assert.equal(graph.stats.internalSpecs, 4);
  assert.equal(graph.stats.resolved, 4);
});

test('rust mod declarations resolve file and directory modules relative to the owning module', () => {
  const ctx = ctxFrom({
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/main.rs': [
      'mod alpha;',
      'pub mod beta;',
      'mod inline { pub fn nop() {} }',
      'mod missing;',
    ].join('\n') + '\n',
    'src/alpha.rs': 'mod inner;\n',
    'src/alpha/inner.rs': 'pub fn inner() {}\n',
    'src/beta/mod.rs': 'pub fn beta() {}\n',
  }, ['Cargo.toml']);

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/main.rs'), ['src/alpha.rs', 'src/beta/mod.rs']);
  assert.deepEqual(graph.outgoingOf('src/alpha.rs'), ['src/alpha/inner.rs']);
  assert.equal(graph.edges.find((edge) =>
    edge.from === 'src/main.rs' && edge.to === 'src/beta/mod.rs')?.line, 2);
  assert.ok(!graph.edges.some((edge) => edge.to === 'src/inline.rs'));
});

test('rust use crate:: and grouped uses resolve crate-root modules and ignore external crates', () => {
  const ctx = ctxFrom({
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/lib.rs': [
      'use crate::api::util;',
      'use crate::{config, domain::model};',
      'use crate::api::util as renamed;',
      'use serde::Deserialize;',
    ].join('\n') + '\n',
    'src/api.rs': 'pub mod util;\n',
    'src/api/util.rs': 'pub fn util() {}\n',
    'src/config.rs': 'pub fn config() {}\n',
    'src/domain/model.rs': 'pub struct Model;\n',
  }, ['Cargo.toml']);

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/lib.rs'), [
    'src/api/util.rs',
    'src/config.rs',
    'src/domain/model.rs',
  ]);
  assert.deepEqual(graph.outgoingOf('src/api.rs'), ['src/api/util.rs']);
  const groupedEdge = graph.edges.find((edge) =>
    edge.from === 'src/lib.rs' && edge.to === 'src/domain/model.rs');
  assert.equal(groupedEdge?.line, 2);
  assert.equal(groupedEdge?.spec, 'crate::{config, domain::model}');
  assert.equal(graph.stats.internalSpecs, 5);
  assert.equal(graph.stats.resolved, 5);
});

test('rust super:: and self:: uses resolve from parent and current module directories', () => {
  const ctx = ctxFrom({
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/lib.rs': 'mod a;\nmod b;\n',
    'src/shared.rs': 'pub fn shared() {}\n',
    'src/a/mod.rs': 'use super::shared;\nuse self::local;\nmod local;\n',
    'src/a/local.rs': 'pub fn local() {}\n',
    'src/b.rs': 'use super::shared;\nuse self::child;\nmod child;\n',
    'src/b/child.rs': 'pub fn child() {}\n',
  }, ['Cargo.toml']);

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/lib.rs'), ['src/a/mod.rs', 'src/b.rs']);
  assert.deepEqual(graph.outgoingOf('src/a/mod.rs'), ['src/a/local.rs', 'src/shared.rs']);
  assert.deepEqual(graph.outgoingOf('src/b.rs'), ['src/b/child.rs', 'src/shared.rs']);
});

test('rust import graph exposes cycles for cycle detection', () => {
  const ctx = ctxFrom({
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/lib.rs': 'mod a;\nmod b;\n',
    'src/a.rs': 'use crate::b;\n',
    'src/b.rs': 'use crate::a;\n',
  }, ['Cargo.toml']);

  const graph = buildImportGraph(ctx);
  assert.deepEqual(graph.outgoingOf('src/a.rs'), ['src/b.rs']);
  assert.deepEqual(graph.outgoingOf('src/b.rs'), ['src/a.rs']);
  const sccs = tarjanSCC(
    graph.nodes,
    new Map<string, string[]>(graph.nodes.map((node) => [node, graph.outgoingOf(node)])),
  );
  assert.ok(sccs.some((scc) =>
    scc.length === 2 && scc.includes('src/a.rs') && scc.includes('src/b.rs')));
  assert.ok(graph.edges.some((edge) =>
    edge.from === 'src/a.rs' && edge.to === 'src/b.rs' && edge.line === 1 && edge.spec === 'crate::b'));
});
