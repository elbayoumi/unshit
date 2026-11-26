#!/usr/bin/env node
// Polyglot recall / false-positive benchmark for the non-TS rules:
//   rust/no-unwrap, python/no-bare-except, dart/no-dynamic-or-print,
//   css/no-important, css/design-drift, css/duplicate-selector.
//
//   pnpm build && node benchmark/polyglot/run.mjs
//
// For each seed it writes three fresh copies of the deterministic synthetic
// base (Rust, Python, Dart, CSS): the clean base, the base + 15 positives per
// rule, and the base + 10 hard negatives per rule. Each copy is scanned with
// `bin/unshit.js scan <dir> --format json --no-cache`. Findings are matched to
// injections by ruleId + file + exact line.
//
// No detector is tuned to this benchmark. Misses and false positives are
// reported as measured, including two known-miss variants and one known FP.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanJson, wilson95 } from '../recall/lib.mjs';
import { buildMarkdown } from './report.mjs';
import { generateBase, injectPositives, injectNegatives } from './generate.mjs';
import {
  RULES,
  RULE_LABELS,
  countLines,
  evaluateFalsePositives,
  evaluateRecall,
  writeProject,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value ?? fallback;
}

const argv = process.argv.slice(2);
const seeds = readOption(argv, '--seeds', '20261126,20261127')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);
const perRule = Number(readOption(argv, '--per-rule', '15'));
const negPerRule = Number(readOption(argv, '--neg-per-rule', '10'));
const outJson = resolve(readOption(argv, '--out', join(HERE, 'results.json')));
const outMd = resolve(readOption(argv, '--md', join(REPO_ROOT, 'docs', 'research', 'polyglot-recall.md')));

if (!existsSync(BIN)) {
  console.error(`missing ${BIN}; run pnpm build first`);
  process.exit(2);
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const fmtInterval = (interval) => `[${pct(interval.low)}, ${pct(interval.high)}]`;
const isRust = (rel) => rel.endsWith('.rs');
const isPython = (rel) => rel.endsWith('.py');
const isDart = (rel) => rel.endsWith('.dart');
const isCss = (rel) => rel.endsWith('.css') || rel.endsWith('.scss');

function polyglotFindings(findings) {
  return findings.filter((finding) => RULES.includes(finding.ruleId));
}

function groupBaseFindings(findings) {
  const byRule = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const finding of findings) byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  return byRule;
}

function scanDir(dir) {
  return scanJson(BIN, dir, REPO_ROOT);
}

function mergeRows(rows, kind) {
  const acc = new Map();
  for (const row of rows) {
    const current = acc.get(row.ruleId) ?? (kind === 'recall'
      ? { ruleId: row.ruleId, injected: 0, found: 0, misses: [], hits: [] }
      : { ruleId: row.ruleId, negatives: 0, falsePositives: 0, fps: [] });
    if (kind === 'recall') {
      current.injected += row.injected;
      current.found += row.found;
      current.misses.push(...row.misses);
      current.hits.push(...row.hits);
    } else {
      current.negatives += row.negatives;
      current.falsePositives += row.falsePositives;
      current.fps.push(...row.fps);
    }
    acc.set(row.ruleId, current);
  }
  return [...acc.values()]
    .map((row) => (kind === 'recall'
      ? { ...row, recall: row.injected === 0 ? null : row.found / row.injected, wilson95: wilson95(row.found, row.injected) }
      : { ...row, fpRate: row.negatives === 0 ? null : row.falsePositives / row.negatives, wilson95: wilson95(row.falsePositives, row.negatives) }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

const report = {
  generatedAt: new Date().toISOString(),
  generator: 'benchmark/polyglot/generate.mjs',
  seedList: seeds,
  perRule,
  negPerRule,
  rules: RULES.map((ruleId) => ({ ruleId, label: RULE_LABELS[ruleId] })),
  notes: [
    'Synthetic corpus only: no real-world polyglot project was used (none is available offline and nothing was downloaded).',
    'Base projects are generated per seed; positives and negatives are injected into fresh copies of that base.',
    'Recall and FP rows are matched by ruleId + file + exact 1-based line.',
    'Two positive variants are known misses (Rust `.unwrap ()`, SCSS nested `&:hover` expansion) and one design-drift negative is a known false positive (`rgb(var(--x) / 0.5)`); they are kept so the gaps stay visible.',
  ],
  base: { perSeed: [], pooledFindings: [] },
  seeds: [],
  pooled: {},
};

const temporary = [];

for (const seed of seeds) {
  console.error(`\n== polyglot seed=${seed} ==`);
  const base = generateBase(seed);

  const baseDir = mkdtempSync(join(tmpdir(), `unshit-polyglot-base-${seed}-`));
  temporary.push(baseDir);
  await writeProject(baseDir, base.files);
  const baseFindings = polyglotFindings(scanDir(baseDir));

  const lines = {
    rust: countLines(base.files, isRust),
    python: countLines(base.files, isPython),
    dart: countLines(base.files, isDart),
    css: countLines(base.files, isCss),
  };

  const positive = injectPositives(base, seed, { perRule });
  const positiveDir = mkdtempSync(join(tmpdir(), `unshit-polyglot-pos-${seed}-`));
  temporary.push(positiveDir);
  await writeProject(positiveDir, positive.files);
  const positiveFindings = polyglotFindings(scanDir(positiveDir));
  const recallRows = evaluateRecall(positive.injections, positiveFindings, wilson95);

  const negative = injectNegatives(base, seed, { perRule: negPerRule });
  const negativeDir = mkdtempSync(join(tmpdir(), `unshit-polyglot-neg-${seed}-`));
  temporary.push(negativeDir);
  await writeProject(negativeDir, negative.files);
  const negativeFindings = polyglotFindings(scanDir(negativeDir));
  const fpRows = evaluateFalsePositives(negative.injections, negativeFindings, wilson95);

  const baseRow = {
    seed,
    files: base.files.size,
    lines,
    findingsByRule: groupBaseFindings(baseFindings),
    findings: baseFindings.map((finding) => ({
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.span?.line,
      message: finding.message,
    })),
  };
  report.base.perSeed.push(baseRow);

  const seedRow = {
    seed,
    base: {
      findingsByRule: baseRow.findingsByRule,
      total: baseFindings.length,
    },
    positives: {
      injected: positive.injections.length,
      findings: positiveFindings.length,
      rules: recallRows.map((row) => ({
        ruleId: row.ruleId,
        injected: row.injected,
        found: row.found,
        recall: row.recall,
        wilson95: row.wilson95,
        misses: row.misses,
        hits: row.hits,
      })),
    },
    negatives: {
      injected: negative.injections.length,
      findings: negativeFindings.length,
      rules: fpRows.map((row) => ({
        ruleId: row.ruleId,
        negatives: row.negatives,
        falsePositives: row.falsePositives,
        fpRate: row.fpRate,
        wilson95: row.wilson95,
        fps: row.fps,
      })),
    },
  };
  report.seeds.push(seedRow);
  console.error(`  base findings=${baseFindings.length} positives=${positive.injections.length} negatives=${negative.injections.length}`);
  console.error(`  recall=${recallRows.map((row) => `${row.ruleId.split('/')[0]}:${row.found}/${row.injected}`).join(' ')}`);
}

const pooledRecall = mergeRows(report.seeds.flatMap((seed) => seed.positives.rules), 'recall');
const pooledFp = mergeRows(report.seeds.flatMap((seed) => seed.negatives.rules), 'fp');
report.pooled = { recall: pooledRecall, falsePositives: pooledFp };
report.base.pooledFindings = report.base.perSeed.flatMap((row) => row.findings);
report.base.totalFindings = report.base.pooledFindings.length;

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.error(`wrote ${outJson}`);

const markdown = buildMarkdown(report);
mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, markdown, 'utf8');
console.error(`wrote ${outMd}`);

for (const dir of temporary) {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`polyglot benchmark: seeds=${seeds.join(',')} base findings=${report.base.totalFindings}`);
for (const row of pooledRecall) {
  console.log(`  recall ${row.ruleId}: ${row.found}/${row.injected} (${pct(row.recall)}) Wilson ${fmtInterval(row.wilson95)}`);
}
for (const row of pooledFp) {
  console.log(`  fp     ${row.ruleId}: ${row.falsePositives}/${row.negatives} (${pct(row.fpRate)}) Wilson ${fmtInterval(row.wilson95)}`);
}
