#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyCorpusToTmp,
  diffNewFindings,
  evaluateRecall,
  findCorpusProject,
  injectAll,
  scanJson,
  wilson95,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0) {
    const v = args[i + 1];
    args.splice(i, 2);
    return v ?? fallback;
  }
  return fallback;
}
const corpusDir = resolve(opt('--corpus', process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus'));
const projectName = opt('--project', 'hono');
const seed = Number(opt('--seed', '20261126'));
const perRule = Number(opt('--per-rule', '20'));
const outJson = resolve(opt('--out', join(HERE, 'results.json')));
const outMd = resolve(opt('--md', join(REPO_ROOT, 'docs', 'research', 'recall.md')));

function pct(x) { return `${(x * 100).toFixed(1)}%`; }
function fmtWilson(w) { return `[${pct(w.low)}, ${pct(w.high)}]`; }

if (!existsSync(BIN)) {
  console.error(`missing ${BIN}; run pnpm build`);
  process.exit(2);
}

const projectPath = findCorpusProject(corpusDir, projectName);
const { base, work } = copyCorpusToTmp(projectPath);
console.error(`corpus: ${projectPath}`);
console.error(`work:   ${work}`);

const before = scanJson(BIN, work, REPO_ROOT);
console.error(`before findings: ${before.length}`);

const counts = {
  unusedExport: perRule,
  unusedFile: perRule,
  unusedDependency: perRule,
  noExplicitAny: perRule,
  magicTimer: perRule,
  duplicateBlock: perRule,
};
const injections = injectAll(work, seed, counts);
console.error(`injected: ${injections.length}`);

const after = scanJson(BIN, work, REPO_ROOT);
console.error(`after findings: ${after.length}`);
const newFindings = diffNewFindings(before, after);
console.error(`new findings: ${newFindings.length}`);

const rules = evaluateRecall(injections, newFindings.length > 0 ? after : after);
// Use all after findings for matching; newFindings is informative. But matching against after is safer.
const rulesAfter = evaluateRecall(injections, after);

// Annotate miss reasons where we can determine them (read-only analysis).
try {
  const { analyze } = await import('../../dist/src/detectors/dead-exports/analysis.js');
  const { loadConfig } = await import('../../dist/src/config.js');
  const { runScan: runScanDist } = await import('../../dist/src/core/scanner.js');
  const config = await loadConfig(work);
  const scanRes = await runScanDist(work, config, [], { noCache: true });
  const ctx = { rootDir: work, config, files: scanRes.files, manifests: scanRes.files.filter((f) => f.relPath.endsWith('package.json')).map((f) => f.relPath) };
  const a = analyze(ctx);
  for (const r of rulesAfter) {
    for (const m of r.misses) {
      if (m.injection.kind === 'unused-export') {
        const consumed = a.consumed.get(m.injection.file);
        if (consumed?.has('*')) {
          m.reason = 'entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused';
        }
      } else if (m.injection.kind === 'no-explicit-any' || m.injection.kind === 'magic-timer') {
        if (/(^|\/)(__tests__|tests?|spec)\//i.test(m.injection.file) || /\.(test|spec)\./i.test(m.injection.file)) {
          m.reason = 'test file: ts-ast detectors skip test files by design';
        }
      }
    }
  }
} catch (e) {
  console.error('miss annotation failed:', e instanceof Error ? e.message : String(e));
}

const report = {
  generatedAt: new Date().toISOString(),
  corpusProject: projectPath,
  workDir: work,
  seed,
  perRule,
  beforeCount: before.length,
  afterCount: after.length,
  newFindingCount: newFindings.length,
  injectedCount: injections.length,
  rules: rulesAfter.map((r) => ({
    ruleId: r.ruleId,
    injected: r.injected,
    found: r.found,
    recall: r.recall,
    wilson95: r.wilson95,
    misses: r.misses.map((m) => ({
      file: m.injection.file,
      line: m.injection.line,
      marker: m.injection.marker,
      kind: m.injection.kind,
      reason: m.reason,
      ...(m.injection.sourceFile ? { sourceFile: m.injection.sourceFile } : {}),
    })),
  })),
  injections: injections.map((i) => ({ ...i })),
};

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
console.error(`wrote ${outJson}`);

const lines = [];
lines.push('# Recall benchmark (mutation injection)');
lines.push('');
lines.push(`Generated: ${report.generatedAt}`);
lines.push('');
lines.push('## Method');
lines.push('');
lines.push(`- Corpus project: \`${projectPath}\` (copied to \`${work}\`, corpus never modified).`);
lines.push(`- Seeded PRNG: mulberry32 seed \`${seed}\`, \`${perRule}\` injections per rule.`);
lines.push('- For each rule, inject known defects into the copied project, scan before/after with `node bin/unshit.js scan <dir> --format json --no-cache`, and count an injection as found when a post-scan finding matches the injected rule and location/marker.');
lines.push('- Recall = found / injected. Wilson 95% confidence interval reported per rule.');
lines.push('- No detectors were tuned to this benchmark. Misses are documented; real detector bugs in editable files should be fixed with tests, otherwise documented.');
lines.push('');
lines.push('## Results');
lines.push('');
lines.push('| Rule | Injected | Found | Recall | Wilson 95% | Misses |');
lines.push('|---|---:|---:|---:|---:|---:|');
for (const r of report.rules) {
  lines.push(`| ${r.ruleId} | ${r.injected} | ${r.found} | ${pct(r.recall)} | ${fmtWilson(r.wilson95)} | ${r.misses.length} |`);
}
lines.push('');
const totalInjected = report.rules.reduce((s, r) => s + r.injected, 0);
const totalFound = report.rules.reduce((s, r) => s + r.found, 0);
const totalW = wilson95(totalFound, totalInjected);
lines.push(`Overall: ${totalFound}/${totalInjected} (${pct(totalFound / totalInjected)}) Wilson 95% ${fmtWilson(totalW)}.`);
lines.push('');
lines.push('## Misses');
lines.push('');
const misses = report.rules.flatMap((r) => r.misses.map((m) => ({ ruleId: r.ruleId, ...m })));
if (misses.length === 0) {
  lines.push('No misses.');
} else {
  lines.push('| Rule | File | Line | Marker | Reason |');
  lines.push('|---|---|---:|---|---|');
  for (const m of misses) {
    lines.push(`| ${m.ruleId} | \`${m.file}\` | ${m.line} | \`${m.marker}\` | ${m.reason} |`);
  }
}
lines.push('');
lines.push('## Notes');
lines.push('');
lines.push('- This benchmark measures recall only on synthetic injected defects; it does not measure precision or real-world prevalence.');
lines.push('- Injection shapes are simple and deterministic. They are not a complete model of real defects.');
lines.push('- Results depend on the selected corpus project and unshit config/defaults.');
lines.push('');

mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, lines.join('\n'));
console.error(`wrote ${outMd}`);

console.log(JSON.stringify({ seed, project: projectPath, totalInjected, totalFound, rules: report.rules.map((r) => ({ ruleId: r.ruleId, injected: r.injected, found: r.found, recall: r.recall, wilson95: r.wilson95, misses: r.misses.length })) }, null, 2));
