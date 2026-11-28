import { mulberry32, listSourceFiles, wilson95 } from '../recall/lib.mjs';
export { wilson95 } from '../recall/lib.mjs';
import {
  DEFAULT_REPO_ROOT, scannedSourceFiles,
  injectNoDoubleCast, injectNoDoubleCastNegatives,
  injectRedundantCatch, injectRedundantCatchNegatives,
  injectHighComplexity, injectHighComplexityNegatives,
  injectGodFile, injectGodFileNegatives,
  injectImportCycle, injectImportCycleNegatives,
  injectUnusedTypeExport, injectUnusedTypeExportNegatives,
  injectUnlistedDependency, injectUnlistedDependencyNegatives,
} from './inject.mjs';

export { DEFAULT_REPO_ROOT, scannedSourceFiles } from './inject.mjs';

export {
  injectNoDoubleCast, injectNoDoubleCastNegatives,
  injectRedundantCatch, injectRedundantCatchNegatives,
  injectHighComplexity, injectHighComplexityNegatives,
  injectGodFile, injectGodFileNegatives,
  injectImportCycle, injectImportCycleNegatives,
  injectUnusedTypeExport, injectUnusedTypeExportNegatives,
  injectUnlistedDependency, injectUnlistedDependencyNegatives,
};

export const RULE_IDS = [
  'ts/no-double-cast',
  'slop/redundant-catch',
  'code/high-complexity',
  'react/god-file',
  'arch/import-cycle',
  'ts/unused-type-export',
  'deps/unlisted-dependency',
];

const nearLine = (d) => (f, inj) => f.file === inj.file && Math.abs((f.span?.line ?? -999) - inj.line) <= d;
const sameFile = (f, inj) => f.file === inj.file;
const hasMarker = (f, inj) => f.file === inj.file && (String(f.message).includes(inj.marker) || String(f.evidence).includes(inj.marker));
const cycleMatch = (f, inj) => [inj.marker, inj.file, inj.otherFile].some((v) => String(f.evidence).includes(v));
const MATCHERS = {
  'no-double-cast': nearLine(2), 'no-double-cast-neg': nearLine(2),
  'redundant-catch': nearLine(4), 'redundant-catch-neg': nearLine(4),
  'high-complexity': hasMarker, 'high-complexity-neg': hasMarker,
  'react/god-file': sameFile, 'react/god-file-neg': sameFile,
  'import-cycle': cycleMatch, 'import-cycle-neg': cycleMatch,
  'unused-type-export': hasMarker, 'unused-type-export-neg': hasMarker,
  'unlisted-dependency': hasMarker, 'unlisted-dependency-neg': hasMarker,
};

export function findingMatchesInjection(finding, inj) {
  if (finding.ruleId !== inj.ruleId) return false;
  const m = MATCHERS[inj.kind];
  return m ? m(finding, inj) : false;
}

export function evaluateRecall(injections, afterFindings) {
  const buckets = new Map();
  for (const inj of injections) {
    const ruleId = inj.reportRuleId ?? inj.ruleId;
    const b = buckets.get(ruleId) ?? { ruleId, injected: 0, found: 0, misses: [], hits: [], outOfScope: Boolean(inj.outOfScope) };
    b.injected++;
    const hit = afterFindings.find((f) => findingMatchesInjection(f, inj));
    if (hit) { b.found++; b.hits.push({ injection: inj, finding: pickFinding(hit) }); }
    else b.misses.push({ injection: inj, reason: 'no matching finding after injection' });
    buckets.set(ruleId, b);
  }
  return [...buckets.keys()].sort().map((id) => {
    const b = buckets.get(id);
    return { ...b, recall: b.injected ? b.found / b.injected : null, wilson95: wilson95(b.found, b.injected) };
  });
}

export function evaluateFalsePositives(negatives, afterFindings) {
  const byRule = new Map();
  for (const inj of negatives) {
    const row = byRule.get(inj.ruleId) ?? { ruleId: inj.ruleId, negatives: 0, falsePositives: 0, fps: [] };
    row.negatives += 1;
    const match = afterFindings.find((f) => findingMatchesInjection(f, inj));
    if (match) {
      row.falsePositives += 1;
      row.fps.push({ injection: inj, finding: pickFinding(match) });
    }
    byRule.set(inj.ruleId, row);
  }
  return [...byRule.values()].map((r) => {
    const fpRate = r.negatives ? r.falsePositives / r.negatives : null;
    const w = wilson95(r.falsePositives, r.negatives);
    return { ...r, fpRate, wilson95: w };
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function pickFinding(f) {
  return { ruleId: f.ruleId, file: f.file, line: f.span?.line, message: f.message, evidence: f.evidence };
}

/**
 * Candidate files for injection, ONLY from files the default scan actually
 * scans. Ground truth is a real clean scan of `work` through the built unshit
 * (`scannedSourceFiles`); `opts.scannedFiles` (e.g. `injectionScope().scannedFiles`)
 * may only narrow that set. The base ts-like/non-test/non-config listing is
 * intersected with the scanned set so nothing outside it can be chosen.
 */
async function injectableFiles(work, opts = {}) {
  // Ground truth: a real clean scan of `work` through the built unshit.
  const realScanned = new Set(await scannedSourceFiles(work, opts.repoRoot ?? DEFAULT_REPO_ROOT));
  // A caller-supplied scanned set (e.g. injectionScope().scannedFiles) can only
  // narrow the pool, never widen it past what the default scan actually scans.
  let scanned = realScanned;
  if (opts.scannedFiles instanceof Set) scanned = new Set([...opts.scannedFiles].filter((f) => realScanned.has(f)));
  else if (Array.isArray(opts.scannedFiles)) scanned = new Set(opts.scannedFiles.filter((f) => realScanned.has(f)));
  return listSourceFiles(work).filter((f) => scanned.has(f) && realScanned.has(f));
}

export { injectableFiles };

function runInjectionPlan(work, files, counts, rand, plan, defaultN) {
  const out = [];
  for (const [key, fn, enabled = true] of plan) {
    if (!enabled) continue;
    out.push(...fn(work, files, counts[key] ?? defaultN, rand));
  }
  return out;
}

function complexityThreshold(opts) { return opts.complexityMax ?? 25; }

function highComplexityInjector(fn, threshold) { return (w, f, n, r) => fn(w, f, n, r, threshold); }

function unusedTypeInjector(fn, skipFiles) { return (w, f, n, r) => fn(w, f, n, r, { skipFiles }); }

export async function injectAllPositives(work, seed, counts, opts = {}) {
  const rand = mulberry32(seed);
  const files = await injectableFiles(work, opts);
  const threshold = complexityThreshold(opts);
  const react = opts.includeReactGodFile !== false;
  const plan = [
    ['noDoubleCast', injectNoDoubleCast],
    ['redundantCatch', injectRedundantCatch],
    ['highComplexity', highComplexityInjector(injectHighComplexity, threshold)],
    ['godFile', injectGodFile, react],
    ['importCycle', injectImportCycle],
    ['unusedTypeExport', unusedTypeInjector(injectUnusedTypeExport, opts.skipFiles)],
    ['unlistedDependency', injectUnlistedDependency],
  ];
  return runInjectionPlan(work, files, counts, rand, plan, 15);
}

export async function injectAllNegatives(work, seed, counts, opts = {}) {
  const rand = mulberry32(seed + 17);
  const files = await injectableFiles(work, opts);
  const threshold = complexityThreshold(opts);
  const react = opts.includeReactGodFile !== false;
  const plan = [
    ['noDoubleCast', injectNoDoubleCastNegatives],
    ['redundantCatch', injectRedundantCatchNegatives],
    ['highComplexity', highComplexityInjector(injectHighComplexityNegatives, threshold)],
    ['godFile', injectGodFileNegatives, react],
    ['importCycle', injectImportCycleNegatives],
    ['unusedTypeExport', unusedTypeInjector(injectUnusedTypeExportNegatives, opts.skipFiles)],
    ['unlistedDependency', injectUnlistedDependencyNegatives],
  ];
  return runInjectionPlan(work, files, counts, rand, plan, 10);
}

