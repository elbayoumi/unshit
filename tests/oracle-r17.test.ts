import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('oracle no longer contains mirror attribution logic', () => {
  const model = source('benchmark/oracle/model.mjs');
  const classify = source('benchmark/oracle/classify.mjs');
  const run = source('benchmark/oracle/run.mjs');
  for (const [name, text] of [['model.mjs', model], ['classify.mjs', classify], ['run.mjs', run]] as const) {
    assert.ok(!text.includes('mirrorPathOf'), `${name} still defines mirrorPathOf`);
    assert.ok(!text.includes('mirrorOf'), `${name} still contains mirrorOf`);
  }
  assert.ok(!/\bmirrored?\b/i.test(run), 'run.mjs still describes the removed mirror assumption');
});

test('oracle report labels movement as a comparison with the previous run', () => {
  const run = source('benchmark/oracle/run.mjs');
  assert.ok(!run.includes('UNSAFE ->'), 'run.mjs still prints UNSAFE ->');
  assert.ok(!/this round/i.test(run), 'run.mjs still labels movement as this round');
  assert.match(run, /previousGeneratedAt/);
  assert.match(run, /Previous run generated at/);
  assert.match(run, /UNSURE -> CONFIRMED/);
});

test('generated oracle report keeps hand-written investigation text verbatim', () => {
  const doc = source('docs/research/oracle-audit.md');
  const investigations = source('benchmark/oracle/investigations.md').trim();
  assert.ok(doc.includes(investigations), 'hand-written investigation text was lost or changed by the report generator');
  assert.ok(doc.includes('## Verdict movement vs the previous run'));
  assert.match(doc, /Previous run generated at `\d{4}-\d{2}-\d{2}T/);
  assert.ok(!doc.includes('UNSAFE ->'));
  assert.ok(!doc.includes('Round 16 verdict movement'));
});

test('regenerated results record the previous run and both flip directions', () => {
  const results = JSON.parse(source('benchmark/oracle/results.json'));
  assert.equal(typeof results.movement.previousGeneratedAt, 'string');
  assert.ok(results.movement.previousPooled, 'previous pooled counts are missing');
  assert.ok(Array.isArray(results.movement.moved.CONTRADICTED_TO_UNSURE));
  assert.ok(Array.isArray(results.movement.moved.UNSURE_TO_CONFIRMED));
});
