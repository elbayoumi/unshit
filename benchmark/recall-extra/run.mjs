#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCorpusToTmp, scanJson, wilson95, listSourceFiles } from '../recall/lib.mjs';
import {
  RULE_IDS,
  injectAllPositives,
  injectAllNegatives,
  evaluateRecall,
  evaluateFalsePositives,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');

function readOpt(argv, name, fallback) {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  const val = argv[idx + 1];
  argv.splice(idx, 2);
  return val ?? fallback;
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
    const cur = acc.get(r.ruleId) ?? { ruleId: r.ruleId, injected: 0, found: 0, misses: [], hits: [] };
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
  const p = join(corpusDir, name);
  if (!existsSync(p)) {
    console.error(`skip missing corpus project: ${p}`);
    continue;
  }
  projects.push({ name, path: p });
}
if (projects.length === 0) {
  console.error(`no corpus projects found in ${corpusDir}`);
  process.exit(2);
}

const report = {
  generatedAt: new Date().toISOString(),
  corpusDir,
  seeds,
  perRule,
  negPerRule,
  projects: [],
  notes: [],
};

for (const proj of projects) {
  const reactTsx = hasReactTsxProject(proj.path);
  const includeReactGodFile = reactTsx;
  if (!includeReactGodFile) {
    report.notes.push(`${proj.name}: react/god-file marked not measurable (no .tsx/.jsx files in corpus).`);
  }
  const projReport = {
    name: proj.name,
    path: proj.path,
    reactTsx,
    seeds: [],
  };

  for (const seed of seeds) {
    console.error(`\n== ${proj.name} seed=${seed} ==`);
    const { base: basePos, work: workPos } = copyCorpusToTmp(proj.path);
    const beforePos = scanJson(BIN, workPos, REPO_ROOT);
    const posCounts = {
      noDoubleCast: perRule, redundantCatch: perRule, highComplexity: perRule, godFile: perRule,
      importCycle: perRule, unusedTypeExport: perRule, unlistedDependency: perRule,
    };
    const posInj = injectAllPositives(workPos, seed, posCounts, { includeReactGodFile, complexityMax: 25 });
    const afterPos = scanJson(BIN, workPos, REPO_ROOT);
    const recallRows = evaluateRecall(posInj, afterPos);

    const { base: baseNeg, work: workNeg } = copyCorpusToTmp(proj.path);
    const beforeNeg = scanJson(BIN, workNeg, REPO_ROOT);
    const negCounts = {
      noDoubleCast: negPerRule, redundantCatch: negPerRule, highComplexity: negPerRule, godFile: negPerRule,
      importCycle: negPerRule, unusedTypeExport: negPerRule, unlistedDependency: negPerRule,
    };
    const negInj = injectAllNegatives(workNeg, seed, negCounts, { includeReactGodFile, complexityMax: 25 });
    const afterNeg = scanJson(BIN, workNeg, REPO_ROOT);
    const fpRows = evaluateFalsePositives(negInj, afterNeg);

    const seedReport = {
      seed,
      positives: {
        beforeCount: beforePos.length,
        afterCount: afterPos.length,
        injectedCount: posInj.length,
        rules: recallRows.map((r) => ({
          ruleId: r.ruleId, injected: r.injected, found: r.found, recall: r.recall, wilson95: r.wilson95,
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

// Aggregate
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

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
console.error(`wrote ${outJson}`);

// Markdown
const lines = [];
lines.push('# Recall-extra benchmark (mutation injection)');
lines.push('');
lines.push(`Generated: ${report.generatedAt}`);
lines.push('');
lines.push('## Method');
lines.push('');
lines.push(`- Corpus projects: ${report.projects.map((p) => `\`${p.name}\``).join(', ')} (copied to temp dirs; corpora never modified).`);
lines.push(`- Seeds: ${report.seeds.join(', ')} (dev/holdout as requested). ${perRule} positive injections per rule per project per seed; ${negPerRule} hard-negative near-misses per rule per project per seed.`);
lines.push('- For each project+seed, two fresh copies were scanned: one with positive injections (recall) and one with hard negatives (FP sanity). Scans used `node bin/unshit.js scan <dir> --format json --no-cache`.');
lines.push('- Recall = matched injected defects / injected defects. FP rate = matched hard negatives / hard negatives. Wilson 95% confidence intervals reported.');
lines.push('- Matchers are rule-specific and location/marker-based; see `benchmark/recall-extra/lib.mjs`.');
lines.push('- No detectors were tuned to this benchmark. Misses and FPs are reported as measured.');
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

for (const p of report.projectAggregates) {
  tableRecall(`Recall — ${p.name}`, p.recall);
  tableFp(`False-positive sanity — ${p.name}`, p.falsePositives);
}

lines.push('## Misses (pooled)');
lines.push('');
const misses = report.pooled.recall.flatMap((r) => r.misses.map((m) => ({ ruleId: r.ruleId, ...m })));
if (misses.length === 0) {
  lines.push('No misses.');
} else {
  lines.push('| Rule | Project/seed context | File | Line | Marker | Reason |');
  lines.push('|---|---|---|---:|---|---|');
  // misses in pooled rows lost project/seed context; reconstruct from project aggregates? keep simple.
  for (const r of report.pooled.recall) {
    for (const m of r.misses) {
      const inj = m.injection ?? m;
      lines.push(`| ${r.ruleId} | pooled | \`${inj.file}\` | ${inj.line ?? ''} | \`${inj.marker ?? ''}\` | ${m.reason ?? ''} |`);
    }
  }
}
lines.push('');

lines.push('## False positives (pooled)');
lines.push('');
const fps = report.pooled.falsePositives.flatMap((r) => r.fps.map((fp) => ({ ruleId: r.ruleId, ...fp })));
if (fps.length === 0) {
  lines.push('No false positives on hard negatives.');
} else {
  lines.push('| Rule | File | Line | Marker | Finding |');
  lines.push('|---|---|---:|---|---|');
  for (const fp of fps) {
    const inj = fp.injection ?? fp;
    const f = fp.finding ?? {};
    lines.push(`| ${fp.ruleId} | \`${inj.file}\` | ${inj.line ?? ''} | \`${inj.marker ?? ''}\` | ${String(f.message ?? '').replace(/\|/g, '\\|')} |`);
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
lines.push('- `react/god-file` is only measurable on corpora containing TSX/JSX; corpora without React files are reported as not measurable for that rule.');
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
}, null, 2));
