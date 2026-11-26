import assert from 'node:assert/strict';
import test from 'node:test';

async function loadLib(): Promise<any> {
  return import(new URL('../../benchmark/precision/lib.mjs', import.meta.url).href);
}

function mkFinding(corpus: string, ruleId: string, file: string, line: number, message = 'msg', evidence = 'ev') {
  return { corpus, ruleId, file, line, message, evidence };
}

test('sampleStratified is deterministic for the same seed and findings', async () => {
  const { sampleStratified } = await loadLib();
  const findings = [
    mkFinding('hono', 'ts/no-explicit-any', 'a.ts', 1),
    mkFinding('hono', 'ts/no-explicit-any', 'b.ts', 2),
    mkFinding('hono', 'ts/no-explicit-any', 'c.ts', 3),
    mkFinding('hono', 'ts/unused-file', 'd.ts', 1),
    mkFinding('zod', 'ts/no-explicit-any', 'e.ts', 10),
    mkFinding('zod', 'ts/no-explicit-any', 'f.ts', 11),
  ];
  const a = sampleStratified(findings, { seed: 20261128, perRulePerCorpus: 2, corpora: ['hono', 'zod'] });
  const b = sampleStratified(findings, { seed: 20261128, perRulePerCorpus: 2, corpora: ['hono', 'zod'] });
  assert.deepEqual(a, b);
  const c = sampleStratified(findings, { seed: 999, perRulePerCorpus: 2, corpora: ['hono', 'zod'] });
  // different seed may produce different selection/order; at least it's deterministic itself
  assert.deepEqual(c, sampleStratified(findings, { seed: 999, perRulePerCorpus: 2, corpora: ['hono', 'zod'] }));
});

test('sampleStratified caps per rule per corpus and keeps all when fewer', async () => {
  const { sampleStratified } = await loadLib();
  const findings: any[] = [];
  for (let i = 0; i < 20; i++) findings.push(mkFinding('hono', 'ts/no-explicit-any', `f${i}.ts`, i + 1));
  for (let i = 0; i < 3; i++) findings.push(mkFinding('hono', 'ts/unused-file', `u${i}.ts`, 1));
  for (let i = 0; i < 10; i++) findings.push(mkFinding('zod', 'ts/no-explicit-any', `z${i}.ts`, i + 1));
  const sampled = sampleStratified(findings, { seed: 20261128, perRulePerCorpus: 5, corpora: ['hono', 'zod'] });
  const counts = new Map<string, number>();
  for (const s of sampled) {
    const k = `${s.corpus}\u0000${s.ruleId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.get('hono\u0000ts/no-explicit-any'), 5);
  assert.equal(counts.get('hono\u0000ts/unused-file'), 3); // fewer than cap
  assert.equal(counts.get('zod\u0000ts/no-explicit-any'), 5);
  assert.equal(sampled.length, 13);
});

test('sampleStratified dedupes identical finding locations', async () => {
  const { sampleStratified } = await loadLib();
  const findings = [
    mkFinding('hono', 'ts/no-explicit-any', 'a.ts', 1),
    mkFinding('hono', 'ts/no-explicit-any', 'a.ts', 1),
    mkFinding('hono', 'ts/no-explicit-any', 'b.ts', 2),
  ];
  const sampled = sampleStratified(findings, { seed: 1, perRulePerCorpus: 15, corpora: ['hono'] });
  assert.equal(sampled.length, 2);
  const ids = sampled.map((s: any) => `${s.ruleId}|${s.file}|${s.line}`);
  assert.deepEqual(ids, [...new Set(ids)]);
});

test('computePrecision excludes UNSURE from denominator but counts it', async () => {
  const { computePrecision } = await loadLib();
  const labels = [
    { ruleId: 'r/a', label: 'TP' },
    { ruleId: 'r/a', label: 'FP' },
    { ruleId: 'r/a', label: 'UNSURE' },
    { ruleId: 'r/b', label: 'TP' },
    { ruleId: 'r/b', label: 'TP' },
  ];
  const stats = computePrecision(labels, { excludeUnsureFromDenominator: true });
  const ra = stats.rules.find((r: any) => r.ruleId === 'r/a');
  const rb = stats.rules.find((r: any) => r.ruleId === 'r/b');
  assert.equal(ra.tp, 1);
  assert.equal(ra.fp, 1);
  assert.equal(ra.unsure, 1);
  assert.equal(ra.denominator, 2);
  assert.equal(ra.precision, 0.5);
  assert.equal(rb.denominator, 2);
  assert.equal(rb.precision, 1);
  assert.equal(stats.pooled.tp, 3);
  assert.equal(stats.pooled.fp, 1);
  assert.equal(stats.pooled.unsure, 1);
  assert.equal(stats.pooled.denominator, 4);
  assert.equal(stats.pooled.precision, 0.75);
  assert.equal(stats.pooled.total, 5);
});

test('wilson95 returns sane bounds', async () => {
  const { wilson95 } = await loadLib();
  const zero = wilson95(0, 10);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0 && zero.high < 0.4);
  const full = wilson95(10, 10);
  assert.ok(full.high > 0.999999);
  assert.ok(full.low > 0.65);
  const mid = wilson95(5, 10);
  assert.ok(mid.low < 0.5 && mid.high > 0.5);
  const empty = wilson95(0, 0);
  assert.deepEqual(empty, { low: 0, high: 0, center: 0 });
});

test('stableFindingId is ruleId|file|line', async () => {
  const { stableFindingId } = await loadLib();
  assert.equal(stableFindingId({ ruleId: 'ts/unused-file', file: 'src/a.ts', line: 7 }), 'ts/unused-file|src/a.ts|7');
});
