import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCHMARK_DIR = join(ROOT, 'benchmark');
const RESEARCH_DIR = join(ROOT, 'docs', 'research');

const benchmarkReadme = readFileSync(join(BENCHMARK_DIR, 'README.md'), 'utf8');
const researchIndex = readFileSync(join(RESEARCH_DIR, 'README.md'), 'utf8');

const benchmarkEntries = readdirSync(BENCHMARK_DIR, { withFileTypes: true });
const scripts = benchmarkEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => entry.name)
  .sort();
const folders = benchmarkEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Paths owned by other work streams: excluded from the index and from this check. */
const EXCLUDED_DOCS = ['README.md', 'PROTOCOL_LANDSCAPE_STUDY.md'];

const indexedDocs = new Set(
  [...researchIndex.matchAll(/docs\/research\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]),
);

test('every benchmark/*.mjs script is mentioned in benchmark/README.md', () => {
  assert.ok(scripts.length >= 6, 'expected the top-level benchmark scripts to be discoverable');
  const missing = scripts.filter((name) => !benchmarkReadme.includes(name));
  assert.deepEqual(missing, [], `benchmark/README.md does not mention: ${missing.join(', ')}`);
});

test('every benchmark/ subfolder is mentioned in benchmark/README.md', () => {
  assert.ok(folders.length >= 7, 'expected benchmark subfolders to be discoverable');
  const missing = folders.filter((name) => !benchmarkReadme.includes(`benchmark/${name}/`));
  assert.deepEqual(missing, [], `benchmark/README.md does not mention: ${missing.join(', ')}`);
});

test('every path indexed in docs/research/README.md exists', () => {
  assert.ok(indexedDocs.size >= 13, 'expected the research index to list the reports');
  const missing = [...indexedDocs]
    .filter((name) => !EXCLUDED_DOCS.includes(name))
    .filter((name) => !existsSync(join(RESEARCH_DIR, name)))
    .sort();
  assert.deepEqual(missing, [], `docs/research/README.md indexes missing docs: ${missing.join(', ')}`);
});

test('every top-level docs/research/*.md report is indexed', () => {
  const onDisk = readdirSync(RESEARCH_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .filter((name) => !EXCLUDED_DOCS.includes(name))
    .sort();
  assert.ok(onDisk.length >= 13, 'expected research reports to be discoverable');
  const unlisted = onDisk.filter((name) => !indexedDocs.has(name)).sort();
  assert.deepEqual(unlisted, [], `docs/research/README.md does not index: ${unlisted.join(', ')}`);
});
