import { mulberry32, listSourceFiles, wilson95 } from '../recall/lib.mjs';
export { wilson95 } from '../recall/lib.mjs';
import {
  injectNoDoubleCast, injectNoDoubleCastNegatives,
  injectRedundantCatch, injectRedundantCatchNegatives,
  injectHighComplexity, injectHighComplexityNegatives,
  injectGodFile, injectGodFileNegatives,
  injectImportCycle, injectImportCycleNegatives,
  injectUnusedTypeExport, injectUnusedTypeExportNegatives,
  injectUnlistedDependency, injectUnlistedDependencyNegatives,
} from './inject.mjs';

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
    if (!buckets.has(inj.ruleId)) buckets.set(inj.ruleId, { ruleId: inj.ruleId, injected: 0, found: 0, misses: [], hits: [] });
    const b = buckets.get(inj.ruleId);
    b.injected++;
    const hit = afterFindings.find((f) => findingMatchesInjection(f, inj));
    if (hit) { b.found++; b.hits.push({ injection: inj, finding: pickFinding(hit) }); }
    else b.misses.push({ injection: inj, reason: 'no matching finding after injection' });
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

export function injectAllPositives(work, seed, counts, opts = {}) {
  const rand = mulberry32(seed);
  const files = listSourceFiles(work);
  const threshold = opts.complexityMax ?? 25;
  const plan = [
    ['noDoubleCast', injectNoDoubleCast],
    ['redundantCatch', injectRedundantCatch],
    ['highComplexity', (w, f, n, r) => injectHighComplexity(w, f, n, r, threshold)],
    ['godFile', injectGodFile, opts.includeReactGodFile !== false],
    ['importCycle', injectImportCycle],
    ['unusedTypeExport', injectUnusedTypeExport],
    ['unlistedDependency', injectUnlistedDependency],
  ];
  const out = [];
  for (const [key, fn, enabled = true] of plan) {
    if (!enabled) continue;
    out.push(...fn(work, files, counts[key] ?? 15, rand));
  }
  return out;
}

export function injectAllNegatives(work, seed, counts, opts = {}) {
  const rand = mulberry32(seed + 17);
  const files = listSourceFiles(work);
  const threshold = opts.complexityMax ?? 25;
  const plan = [
    ['noDoubleCast', injectNoDoubleCastNegatives],
    ['redundantCatch', injectRedundantCatchNegatives],
    ['highComplexity', (w, f, n, r) => injectHighComplexityNegatives(w, f, n, r, threshold)],
    ['godFile', injectGodFileNegatives, opts.includeReactGodFile !== false],
    ['importCycle', injectImportCycleNegatives],
    ['unusedTypeExport', injectUnusedTypeExportNegatives],
    ['unlistedDependency', injectUnlistedDependencyNegatives],
  ];
  const out = [];
  for (const [key, fn, enabled = true] of plan) {
    if (!enabled) continue;
    out.push(...fn(work, files, counts[key] ?? 10, rand));
  }
  return out;
}

