#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCorpusToTmp, scanJson, wilson95, listSourceFiles } from '../recall/lib.mjs';
import { injectAllPositives, injectAllNegatives, evaluateRecall, evaluateFalsePositives } from './lib.mjs';
import { injectionScope, injectEntryPointTypeExports, reasonForOutOfScopeMiss } from './entries.mjs';
import { generateProject as generateSyntheticReactProject } from './synthetic-react.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');

function readOpt(argv, name, fallback) {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const removed = argv.splice(idx, 2);
  const val = removed[1];
  return val === undefined ? fallback : val;
}

const argv = process.argv.slice(2);
const corpusDir = resolve(readOpt(argv, '--corpus', process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus'));
const projectNames = readOpt(argv, '--projects', 'hono,zod,execa').split(',').map((s) => s.trim()).filter(Boolean);
const seeds = readOpt(argv, '--seeds', '20261126,20261127').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
const perRule = Number(readOpt(argv, '--per-rule', '15'));
const negPerRule = Number(readOpt(argv, '--neg-per-rule', '10'));
const outJson = resolve(readOpt(argv, '--out', join(HERE, 'results.json')));
const outMd = resolve(readOpt(argv, '--md', join(REPO_ROOT, 'docs', 'research', 'recall-extra.md')));

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmtWilson = (w) => `[${pct(w.low)}, ${pct(w.high)}]`;

if (!existsSync(BIN)) {
  console.error(`missing ${BIN}; run pnpm build`);
  process.exit(2);
}

function hasReactTsxProject(projectPath) {
  const files = listSourceFiles(projectPath);
  return files.some((f) => /\.(tsx|jsx)$/.test(f));
}

function mergeRecallRows(rows) {
  const acc = new Map();
  for (const r of rows) {
    const cur = acc.get(r.ruleId) ?? { ruleId: r.ruleId, injected: 0, found: 0, misses: [], hits: [], outOfScope: Boolean(r.outOfScope) };
    cur.injected += r.injected;
    cur.found += r.found;
    if (r.misses?.length) cur.misses.push(...r.misses);
    if (r.hits?.length) cur.hits.push(...r.hits);
    acc.set(r.ruleId, cur);
  }
  return [...acc.values()]
    .map((r) => ({ ...r, recall: r.injected ? r.found / r.injected : null, wilson95: wilson95(r.found, r.injected) }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function mergeFpRows(rows) {
  const byRule = new Map();
  for (const r of rows) {
    const cur = byRule.get(r.ruleId) ?? { ruleId: r.ruleId, negatives: 0, falsePositives: 0, fps: [] };
    cur.negatives += r.negatives;
    cur.falsePositives += r.falsePositives;
    cur.fps.push(...(r.fps ?? []));
    byRule.set(r.ruleId, cur);
  }
  return [...byRule.values()].map((r) => {
    const w = wilson95(r.falsePositives, r.negatives);
    return { ...r, fpRate: r.negatives ? r.falsePositives / r.negatives : null, wilson95: w };
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

const projects = [];
for (const name of projectNames) {
  projects.push({ name });
}
if (projects.length === 0) {
  console.error('no projects');
  process.exit(2);
}

const ENTRY_INJECTIONS = 5;

const report = {
  generatedAt: new Date().toISOString(),
  corpusDir,
  seeds,
  perRule,
  negPerRule,
  projects: [],
  notes: [],
};

function isSynthetic(name) { return /^synthetic/i.test(name); }

for (const proj of projects) {
  const name = proj.name;
  const synthetic = isSynthetic(name);
  let projectPath;
  if (synthetic) {
    const base = mkdtempSync(join(tmpdir(), 'unshit-recall-extra-synthetic-'));
    projectPath = join(base, name);
    generateSyntheticReactProject(projectPath, 40, 20261126);
    report.notes.push(`${name}: synthetic React/TSX corpus (generated, deterministic, seeded) — components are below god-file thresholds; god-file positives/negatives injected on top.`);
  } else {
    projectPath = join(corpusDir, name);
    if (!existsSync(projectPath)) {
      console.error(`skip missing corpus project: ${projectPath}`);
      continue;
    }
  }

  const reactTsx = hasReactTsxProject(projectPath);
  const includeReactGodFile = reactTsx;
  if (!includeReactGodFile && !synthetic) {
    report.notes.push(`${name}: react/god-file marked not measurable (no .tsx/.jsx files in corpus).`);
  }
  const projReport = {
    name,
    path: projectPath,
    synthetic,
    reactTsx,
    seeds: [],
  };

  for (const seed of seeds) {
    console.error(`\n== ${name} seed=${seed} ==`);
    const { base: basePos, work: workPos } = copyCorpusToTmp(projectPath);
    const beforePos = scanJson(BIN, workPos, REPO_ROOT);

    let scope = null;
    try { scope = await injectionScope(workPos, REPO_ROOT); } catch (e) { scope = null; }
    const files = scope ? listSourceFiles(workPos).filter((f) => scope.scannedFiles.has(f)) : listSourceFiles(workPos);

    const posCounts = synthetic
      ? { noDoubleCast: 0, redundantCatch: 0, highComplexity: 0, godFile: perRule, importCycle: 0, unusedTypeExport: 0, unlistedDependency: 0 }
      : { noDoubleCast: perRule, redundantCatch: perRule, highComplexity: perRule, godFile: perRule, importCycle: perRule, unusedTypeExport: perRule, unlistedDependency: perRule };

    const posOpts = { includeReactGodFile, complexityMax: 25, skipFiles: scope ? scope.starConsumed : null, cloneFiles: scope ? scope.cloneFiles : null, scannedFiles: scope ? scope.scannedFiles : null };
    const posInj = await injectAllPositives(workPos, seed, posCounts, posOpts);

    if (!synthetic && scope) {
      const entryFiles = files.filter((f) => scope.starConsumed.has(f));
      const entryRand = (seed ^ 0x9e3779b9) >>> 0;
      const { mulberry32 } = await import('../recall/lib.mjs');
      const r = mulberry32(entryRand);
      const entryInj = injectEntryPointTypeExports(workPos, entryFiles, Math.min(ENTRY_INJECTIONS, entryFiles.length), r);
      posInj.push(...entryInj);
    }

    const byMarker = new Map(posInj.map((i) => [`${i.file}\u0000${i.marker}`, i]));
    const afterPos = scanJson(BIN, workPos, REPO_ROOT);
    const recallRows = evaluateRecall(posInj, afterPos);
    for (const row of recallRows) {
      for (const m of row.misses) {
        const inj = byMarker.get(`${m.injection.file}\u0000${m.injection.marker}`);
        const mi = inj ?? m.injection;
        m.reason = scope && !scope.scannedFiles.has(mi.file)
          ? 'harness artifact: file is not scanned by default config (excluded dir such as fixtures/)'
          : reasonForOutOfScopeMiss(mi);
      }
    }

    const { base: baseNeg, work: workNeg } = copyCorpusToTmp(projectPath);
    const beforeNeg = scanJson(BIN, workNeg, REPO_ROOT);
    const negCounts = synthetic
      ? { noDoubleCast: 0, redundantCatch: 0, highComplexity: 0, godFile: negPerRule, importCycle: 0, unusedTypeExport: 0, unlistedDependency: 0 }
      : { noDoubleCast: negPerRule, redundantCatch: negPerRule, highComplexity: negPerRule, godFile: negPerRule, importCycle: negPerRule, unusedTypeExport: negPerRule, unlistedDependency: negPerRule };
    const negOpts = { includeReactGodFile, complexityMax: 25, skipFiles: null, cloneFiles: null };
    let negScope = null;
    try { negScope = await injectionScope(workNeg, REPO_ROOT); } catch (e) { negScope = null; }
    negOpts.skipFiles = negScope ? negScope.starConsumed : null;
    negOpts.cloneFiles = negScope ? negScope.cloneFiles : null;
    negOpts.scannedFiles = negScope ? negScope.scannedFiles : null;
    const negInj = await injectAllNegatives(workNeg, seed, negCounts, negOpts);
    const afterNeg = scanJson(BIN, workNeg, REPO_ROOT);
    const fpRows = evaluateFalsePositives(negInj, afterNeg);

    const seedReport = {
      seed,
      positives: {
        beforeCount: beforePos.length,
        afterCount: afterPos.length,
        injectedCount: posInj.length,
        rules: recallRows.map((r) => ({
          ruleId: r.ruleId, injected: r.injected, found: r.found, recall: r.recall, wilson95: r.wilson95, outOfScope: Boolean(r.outOfScope),
          misses: r.misses.map((m) => ({ file: m.injection.file, line: m.injection.line, marker: m.injection.marker, kind: m.injection.kind, reason: m.reason })),
        })),
      },
      negatives: {
        beforeCount: beforeNeg.length,
        afterCount: afterNeg.length,
        injectedCount: negInj.length,
        rules: fpRows.map((r) => ({
          ruleId: r.ruleId, negatives: r.negatives, falsePositives: r.falsePositives, fpRate: r.fpRate, wilson95: r.wilson95,
          fps: r.fps.map((fp) => ({ file: fp.injection.file, line: fp.injection.line, marker: fp.injection.marker, kind: fp.injection.kind, finding: fp.finding })),
        })),
      },
    };
    projReport.seeds.push(seedReport);
    console.error(`  injected positives=${posInj.length} negatives=${negInj.length}`);
  }
  report.projects.push(projReport);
}

function aggregateProject(proj) {
  const recallRows = mergeRecallRows(proj.seeds.flatMap((s) => s.positives.rules.map((r) => ({ ...r }))));
  const fpRows = mergeFpRows(proj.seeds.flatMap((s) => s.negatives.rules.map((r) => ({ ...r }))));
  return { recallRows, fpRows };
}

const projectAggs = report.projects.map((p) => ({ name: p.name, ...aggregateProject(p) }));
const pooledRecall = mergeRecallRows(projectAggs.flatMap((p) => p.recallRows));
const pooledFp = mergeFpRows(projectAggs.flatMap((p) => p.fpRows));
report.projectAggregates = projectAggs.map((p) => ({
  name: p.name,
  recall: p.recallRows,
  falsePositives: p.fpRows,
}));
report.pooled = { recall: pooledRecall, falsePositives: pooledFp };

const oosInjected = pooledRecall.filter((r) => r.outOfScope).reduce((s, r) => s + r.injected, 0);
const oosFound = pooledRecall.filter((r) => r.outOfScope).reduce((s, r) => s + r.found, 0);
report.outOfScope = { injected: oosInjected, found: oosFound, recall: oosInjected ? oosFound / oosInjected : null, wilson95: wilson95(oosFound, oosInjected) };
report.pooled.outOfScope = report.outOfScope;

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
console.error(`wrote ${outJson}`);

const lines = [];
lines.push('# Recall-extra benchmark (mutation injection)');
lines.push('');
lines.push(`Generated: ${report.generatedAt}`);
lines.push('');
lines.push('## Method');
lines.push('');
lines.push(`- Corpus projects: ${report.projects.map((p) => `\`${p.name}\``).join(', ')} (copied to temp dirs; corpora never modified).`);
lines.push(`- Seeds: ${report.seeds.join(', ')}. ${perRule} positive injections per rule per project per seed; ${negPerRule} hard-negative near-misses per rule per project per seed.`);
lines.push('- For each project+seed, two fresh copies were scanned: one with positive injections (recall) and one with hard negatives (FP sanity). Scans used `node bin/unshit.js scan <dir> --format json --no-cache`.');
lines.push('- Recall = matched injected defects / injected defects. FP rate = matched hard negatives / hard negatives. Wilson 95% confidence intervals reported.');
lines.push('- Matchers are rule-specific and location/marker-based; see `benchmark/recall-extra/lib.mjs`.');
lines.push('- No detectors were tuned to this benchmark. Misses and FPs are reported as measured.');
lines.push('- Injection targeting chooses candidate files ONLY from the files the default scan actually scans: the ts-like/non-test base listing is intersected with the scanned set from a real clean scan of the copy through the built unshit (`scan.files`, no cache; `scannedSourceFiles` in `benchmark/recall-extra/inject.mjs`). A caller-supplied scanned set (e.g. `injectionScope().scannedFiles`) can only narrow that pool. No hard-coded project paths.');
lines.push('- `ts/unused-type-export` injections skip files unshit marks STAR-consumed (entry/public-API), reusing compiled dead-export analysis from `benchmark/recall/entries.mjs`. Out-of-scope injections into those files are reported separately.');
lines.push('');
if (report.notes.length) {
  lines.push('## Notes on measurability');
  lines.push('');
  for (const n of report.notes) lines.push(`- ${n}`);
  lines.push('');
}

function tableRecall(title, rows) {
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('| Rule | Injected | Found | Recall | Wilson 95% | Misses |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    lines.push(`| ${r.ruleId} | ${r.injected} | ${r.found} | ${pct(r.recall)} | ${fmtWilson(r.wilson95)} | ${r.misses.length} |`);
  }
  lines.push('');
}

function tableFp(title, rows) {
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('| Rule | Negatives | False Positives | FP rate | Wilson 95% |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const r of rows) {
    lines.push(`| ${r.ruleId} | ${r.negatives} | ${r.falsePositives} | ${pct(r.fpRate)} | ${fmtWilson(r.wilson95)} |`);
  }
  lines.push('');
}

tableRecall('Pooled recall', report.pooled.recall);
tableFp('Pooled false-positive sanity', report.pooled.falsePositives);
lines.push(`Out of scope (entry-point injections): ${report.outOfScope.found}/${report.outOfScope.injected} found.`);
lines.push('');

for (const p of report.projectAggregates) {
  tableRecall(`Recall — ${p.name}`, p.recall);
  tableFp(`False-positive sanity — ${p.name}`, p.falsePositives);
}

lines.push('## Misses (pooled)', '');
const pooledMisses = report.pooled.recall.flatMap((r) => r.misses.map((m) => ({ ruleId: r.ruleId, inj: m.injection ?? m, reason: m.reason ?? '' })));
if (pooledMisses.length === 0) {
  lines.push('No misses.');
} else {
  lines.push('| Rule | File | Line | Marker | Reason |', '|---|---|---:|---|---|');
  for (const { ruleId, inj, reason } of pooledMisses) {
    lines.push(`| ${ruleId} | \`${inj.file}\` | ${inj.line ?? ''} | \`${inj.marker ?? ''}\` | ${reason} |`);
  }
}
lines.push('');

lines.push('## False positives (pooled)', '');
const pooledFps = report.pooled.falsePositives.flatMap((r) => r.fps.map((fp) => ({ ruleId: r.ruleId, inj: fp.injection ?? fp, finding: fp.finding ?? {} })));
if (pooledFps.length === 0) {
  lines.push('No false positives on hard negatives.');
} else {
  lines.push('| Rule | File | Line | Marker | Finding |', '|---|---|---:|---|---|');
  for (const { ruleId, inj, finding } of pooledFps) {
    const msg = String(finding.message ?? '').replace(/\|/g, '\\|');
    lines.push(`| ${ruleId} | \`${inj.file}\` | ${inj.line ?? ''} | \`${inj.marker ?? ''}\` | ${msg} |`);
  }
}
lines.push('');

lines.push('## Detector bugs found');
lines.push('');
lines.push('None confirmed by this run. Any misses/FPs above are reported as measured; if a pattern indicates a detector bug, it should be reproduced minimally before changing src.');
lines.push('');

lines.push('## Limitations');
lines.push('');
lines.push('- Synthetic injections only; they model specific defect shapes, not full real-world variety.');
lines.push('- Recall is measured on injected locations; a detector may report a related but differently-located finding that the matcher does not count.');
lines.push('- `react/god-file` is measured on a deterministic synthetic React/TSX corpus (components below thresholds) because hono/zod/execa contain no TSX/JSX. Labelled synthetic.');
lines.push('- Hard negatives target near-miss shapes and do not prove global FP <= 2%; they are a sanity check.');
lines.push('- Scans run with `--no-cache` on default config. Project-specific config can change thresholds/counts.');
lines.push('- Import-cycle injections create new files and add a reachability import; this is slightly invasive but necessary to keep the shape realistic.');
lines.push('');

mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, lines.join('\n'));
console.error(`wrote ${outMd}`);

console.log(JSON.stringify({
  seeds: report.seeds,
  projects: report.projects.map((p) => p.name),
  pooledRecall: report.pooled.recall.map((r) => ({ ruleId: r.ruleId, injected: r.injected, found: r.found, recall: r.recall, wilson95: r.wilson95, misses: r.misses.length })),
  pooledFp: report.pooled.falsePositives.map((r) => ({ ruleId: r.ruleId, negatives: r.negatives, falsePositives: r.falsePositives, fpRate: r.fpRate, wilson95: r.wilson95 })),
  outOfScope: report.outOfScope,
}, null, 2));
