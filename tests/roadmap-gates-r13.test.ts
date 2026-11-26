import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Finding = Record<string, unknown>;

async function loadHelpers() {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/tests -> repo root
  const modPath = resolve(here, '../../benchmark/roadmap-gates.mjs');
  return await import(pathToFileURL(modPath).href);
}

test('normalizeFinding produces stable comparable shape', async () => {
  const { normalizeFinding } = await loadHelpers();
  const n = normalizeFinding({
    ruleId: 'ts/unused-export',
    file: 'src\\a.ts',
    span: { line: 3, column: 1, endLine: 3, endColumn: 10 },
    severity: 'warn',
    message: 'm',
    evidence: 'e',
    extra: 'ignored',
  });
  assert.deepEqual(n, {
    ruleId: 'ts/unused-export',
    file: 'src/a.ts',
    line: 3,
    column: 1,
    endLine: 3,
    endColumn: 10,
    severity: 'warn',
    message: 'm',
    evidence: 'e',
  });
});

test('normalizeFindings sorts deterministically', async () => {
  const { normalizeFindings } = await loadHelpers();
  const out = normalizeFindings([
    { ruleId: 'b/rule', file: 'b.ts', span: { line: 2, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
    { ruleId: 'a/rule', file: 'a.ts', span: { line: 1, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
    { ruleId: 'b/rule', file: 'a.ts', span: { line: 5, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
  ]);
  assert.deepEqual(out.map((f: any) => [f.ruleId, f.file, f.line]), [
    ['a/rule', 'a.ts', 1],
    ['b/rule', 'a.ts', 5],
    ['b/rule', 'b.ts', 2],
  ]);
});

test('compareFindingSets reports equal sets regardless of order', async () => {
  const { compareFindingSets } = await loadHelpers();
  const a = [
    { ruleId: 'r1', file: 'a.ts', span: { line: 1, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
    { ruleId: 'r2', file: 'b.ts', span: { line: 2, column: 3 }, severity: 'error', message: 'm2', evidence: 'e2' },
  ];
  const b = [a[1], a[0]];
  const cmp = compareFindingSets(a, b);
  assert.equal(cmp.equal, true);
  assert.equal(cmp.missing.length, 0);
  assert.equal(cmp.extra.length, 0);
});

test('compareFindingSets reports missing and extra findings', async () => {
  const { compareFindingSets } = await loadHelpers();
  const expected = [
    { ruleId: 'r1', file: 'a.ts', span: { line: 1, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
    { ruleId: 'r2', file: 'b.ts', span: { line: 2, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
  ];
  const actual = [
    { ruleId: 'r1', file: 'a.ts', span: { line: 1, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
    { ruleId: 'r3', file: 'c.ts', span: { line: 3, column: 1 }, severity: 'warn', message: 'm', evidence: 'e' },
  ];
  const cmp = compareFindingSets(actual, expected);
  assert.equal(cmp.equal, false);
  assert.equal(cmp.missing.length, 1);
  assert.equal(cmp.extra.length, 1);
  assert.equal(cmp.missing[0].ruleId, 'r2');
  assert.equal(cmp.extra[0].ruleId, 'r3');
});

test('pickDeterministic is stable for same seed', async () => {
  const { pickDeterministic } = await loadHelpers();
  const items = ['a','b','c','d','e','f','g','h','i','j'];
  const a = pickDeterministic(items, 3, 20261129);
  const b = pickDeterministic(items, 3, 20261129);
  const c = pickDeterministic(items, 3, 999);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.notDeepEqual(a, c); // different seed should usually differ
});
