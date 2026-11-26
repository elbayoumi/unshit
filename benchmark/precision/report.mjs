#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePrecision, wilson95 } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SAMPLE_PATH = join(HERE, 'sample.json');
const LABELS_PATH = join(HERE, 'labels.json');
const RESULTS_PATH = join(HERE, 'results.json');
const DOC_PATH = join(REPO_ROOT, 'docs', 'research', 'precision-audit.md');

function pct(x) {
  return x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}
function fmtWilson(w) {
  if (!w) return 'n/a';
  return `[${pct(w.low)}, ${pct(w.high)}]`;
}

function die(msg) { console.error(`precision-report: ${msg}`); process.exit(2); }
if (!existsSync(SAMPLE_PATH)) die(`missing ${SAMPLE_PATH}`);
if (!existsSync(LABELS_PATH)) die(`missing ${LABELS_PATH}`);

const sampleData = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
const labelsMap = JSON.parse(readFileSync(LABELS_PATH, 'utf8'));
const sample = sampleData.sample;

const labeled = [];
const missing = [];
for (const s of sample) {
  const id = s.id;
  const l = labelsMap[id];
  if (!l) { missing.push(id); continue; }
  if (!['TP', 'FP', 'UNSURE'].includes(l.label)) die(`bad label ${l.label} for ${id}`);
  labeled.push({ ...s, label: l.label, reason: l.reason });
}
if (missing.length) die(`missing labels for ${missing.length} sampled findings: ${missing.slice(0,5).join(', ')}`);

const stats = computePrecision(labeled, { excludeUnsureFromDenominator: true });

// By-corpus breakdown (informational)
const byCorpus = {};
for (const item of labeled) {
  const c = byCorpus[item.corpus] ?? { corpus: item.corpus, tp: 0, fp: 0, unsure: 0, total: 0 };
  c.total += 1;
  if (item.label === 'TP') c.tp += 1;
  else if (item.label === 'FP') c.fp += 1;
  else c.unsure += 1;
  byCorpus[item.corpus] = c;
}
const corpusRows = Object.values(byCorpus).map((c) => {
  const denom = c.tp + c.fp;
  return { ...c, denominator: denom, precision: denom > 0 ? c.tp / denom : null, wilson95: wilson95(c.tp, denom) };
}).sort((a, b) => a.corpus.localeCompare(b.corpus));

const fpItems = labeled.filter((x) => x.label === 'FP').sort((a,b)=>a.ruleId.localeCompare(b.ruleId)||a.corpus.localeCompare(b.corpus)||a.file.localeCompare(b.file)||a.line-b.line);
const unsureItems = labeled.filter((x) => x.label === 'UNSURE').sort((a,b)=>a.ruleId.localeCompare(b.ruleId)||a.corpus.localeCompare(b.corpus)||a.file.localeCompare(b.file)||a.line-b.line);

const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  seed: sampleData.seed,
  perRulePerCorpus: sampleData.perRulePerCorpus,
  corpora: sampleData.corpora,
  corpusDir: sampleData.corpusDir,
  totalFindings: sampleData.totalFindings,
  sampledCount: sample.length,
  labeledCount: labeled.length,
  counts: { tp: stats.pooled.tp, fp: stats.pooled.fp, unsure: stats.pooled.unsure },
  pooled: stats.pooled,
  byRule: stats.rules,
  byCorpus: corpusRows,
  falsePositives: fpItems.map((f) => ({ id: f.id, corpus: f.corpus, ruleId: f.ruleId, file: f.file, line: f.line, message: f.message, evidence: f.evidence, reason: f.reason })),
  unsure: unsureItems.map((f) => ({ id: f.id, corpus: f.corpus, ruleId: f.ruleId, file: f.file, line: f.line, message: f.message, evidence: f.evidence, reason: f.reason })),
};

mkdirSync(dirname(RESULTS_PATH), { recursive: true });
writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

function ruleTable(rows) {
  const lines = [
    '| Rule | TP | FP | Unsure | Denom (TP+FP) | Precision | Wilson 95% |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    lines.push(`| \`${r.ruleId}\` | ${r.tp} | ${r.fp} | ${r.unsure} | ${r.denominator} | ${pct(r.precision)} | ${fmtWilson(r.wilson95)} |`);
  }
  return lines;
}

function corpusTable(rows) {
  const lines = [
    '| Corpus | TP | FP | Unsure | Denom (TP+FP) | Precision | Wilson 95% |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    lines.push(`| \`${r.corpus}\` | ${r.tp} | ${r.fp} | ${r.unsure} | ${r.denominator} | ${pct(r.precision)} | ${fmtWilson(r.wilson95)} |`);
  }
  return lines;
}

const doc = [];
doc.push('# Precision audit (real-world corpora)');
doc.push('');
doc.push(`Generated: ${results.generatedAt}`);
doc.push('');
doc.push('## Method');
doc.push('');
doc.push(`- Corpora (public, read-only copies): ${results.corpora.map((c) => `\`${c}\``).join(', ')} from \`${results.corpusDir}\`. Each corpus was copied to a temp dir and scanned with \`node bin/unshit.js scan <dir> --format json --no-cache\` using default config. The corpora were never modified.`);
doc.push(`- Sampling: seeded stratified sample, seed \`${results.seed}\`, up to \`${results.perRulePerCorpus}\` findings per rule per corpus (all findings if fewer). Stratification key: \`(corpus, ruleId)\`. Within each stratum findings were shuffled with a deterministic PRNG seeded by \`seed ^ hash(corpus\\0ruleId)\` and the first N selected, then sorted by file/line for stable output.`);
doc.push(`- Sample size: ${results.sampledCount} findings sampled from ${results.totalFindings} total findings across ${results.corpora.length} corpora.`);
doc.push('- Labeling: every sampled finding was labeled by reading the actual corpus code around the reported location and, for dead-code rules, grepping for cross-file references/imports. Labels: `TP` (true positive), `FP` (false positive), `UNSURE` (could not confirm). A finding is `FP` only when it is wrong per the rule\'s own documented meaning, not merely inconvenient or noisy.');
doc.push('- Precision: `TP / (TP + FP)`. `UNSURE` is excluded from the denominator but counted and listed. Wilson 95% intervals are computed from summed counts (not by averaging intervals).');
doc.push('- This audit is a real-world precision sample, not a recall measurement. It does not measure how many real defects unshit misses.');
doc.push('');
doc.push('## Results');
doc.push('');
doc.push(`Pooled precision: **${stats.pooled.tp}/${stats.pooled.denominator} (${pct(stats.pooled.precision)})**, Wilson 95% ${fmtWilson(stats.pooled.wilson95)}. Counts: TP=${stats.pooled.tp}, FP=${stats.pooled.fp}, UNSURE=${stats.pooled.unsure}, sampled=${results.sampledCount}.`);
doc.push('');
doc.push('### Per rule');
doc.push('');
doc.push(...ruleTable(stats.rules));
doc.push('');
doc.push('### Per corpus (informational)');
doc.push('');
doc.push(...corpusTable(corpusRows));
doc.push('');
doc.push('## False positives');
doc.push('');
if (fpItems.length === 0) {
  doc.push('No false positives found in this sample.');
} else {
  doc.push('| Rule | Corpus | File:Line | Message | Why FP |');
  doc.push('|---|---|---|---|---|');
  for (const f of fpItems) {
    const msg = f.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const why = f.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    doc.push(`| \`${f.ruleId}\` | \`${f.corpus}\` | \`${f.file}:${f.line}\` | ${msg} | ${why} |`);
  }
}
doc.push('');
doc.push('## Unsure');
doc.push('');
if (unsureItems.length === 0) {
  doc.push('No UNSURE labels.');
} else {
  doc.push('| Rule | Corpus | File:Line | Message | Why unsure |');
  doc.push('|---|---|---|---|---|');
  for (const f of unsureItems) {
    const msg = f.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const why = f.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    doc.push(`| \`${f.ruleId}\` | \`${f.corpus}\` | \`${f.file}:${f.line}\` | ${msg} | ${why} |`);
  }
}
doc.push('');
doc.push('## Detector bugs found');
doc.push('');
doc.push('The following FP classes were confirmed by reading the detector implementation and the reported code. No detector source was changed in this audit; reproducer snippets are included for triage.');
doc.push('');
doc.push('### `slop/magic-timer` — `isTestFile` misses `test/...` paths at repo root');
doc.push('');
doc.push('- **Rule meaning**: flag raw numeric delays in `setTimeout`/`setInterval` outside test files. The detector intentionally skips test files via `isTestFile` in `src/detectors/ts-ast.ts`.');
doc.push('- **Observed FP**: `execa` `test/io/max-buffer.js:25` reports a 5000ms `setTimeout` inside a test helper. The file is under `test/` at the corpus root.');
doc.push('- **Root cause**: `isTestFile` uses `/\\.(test|spec)\\.|__tests__|\\/tests?\\//i`. The pattern `\\/tests?\\//` requires a leading `/`, so `test/io/max-buffer.js` (no leading slash) is not classified as a test file.');
doc.push('- **Minimal reproducer**:');
doc.push('');
doc.push('```js');
doc.push('// test/io/example.js (path starts at repo root with "test/")');
doc.push('const cleanup = setTimeout(() => {');
doc.push("  subprocess.kill('SIGKILL');");
doc.push('}, 5000);');
doc.push('```');
doc.push('');
doc.push('Expected: no `slop/magic-timer` finding because the file is under `test/`. Actual: finding reported because `isTestFile("test/io/example.js")` returns false.');
doc.push('');
doc.push('## Limitations');
doc.push('');
doc.push('- This is a stratified sample, not an exhaustive manual audit. Per-rule Wilson intervals are wide for rules with few sampled findings; pooled precision is more stable but still conditional on these five corpora and default config.');
doc.push('- Labeling was done by code reading and grep-based usage checks. Dynamic references, reflection, external consumers outside the scanned corpus, and build-tool conventions can make dead-code judgments ambiguous; such cases were labeled carefully but are inherently harder to prove.');
doc.push('- `deps/unused-dependency` reports are literal: a package not referenced by name in scripts/configs/code may still be used by tooling that resolves it implicitly (e.g. coverage providers, binary-name CLIs). These were treated as TP only when consistent with the rule\'s documented meaning; the audit does not claim the dependency is safe to remove without human review.');
doc.push('- Corpora were scanned at their checked-out revisions under `/Volumes/data/projects/unshit-bench/corpus`. Different revisions or configs may produce different findings.');
doc.push('- Only findings emitted by unshit were sampled. The audit measures precision, not recall or real-world defect prevalence.');
doc.push('');
doc.push('## Reproduce');
doc.push('');
doc.push('```bash');
doc.push('pnpm run build');
doc.push('node benchmark/precision/sample.mjs');
doc.push('# Review/edit benchmark/precision/labels.json if re-auditing');
doc.push('node benchmark/precision/report.mjs');
doc.push('```');
doc.push('');

mkdirSync(dirname(DOC_PATH), { recursive: true });
writeFileSync(DOC_PATH, doc.join('\n') + '\n');

console.error(`wrote ${RESULTS_PATH}`);
console.error(`wrote ${DOC_PATH}`);
console.log(JSON.stringify({ pooled: results.pooled, byRule: results.byRule.map((r) => ({ ruleId: r.ruleId, tp: r.tp, fp: r.fp, unsure: r.unsure, precision: r.precision })) }, null, 2));
