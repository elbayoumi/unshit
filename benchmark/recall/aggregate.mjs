// Pure aggregation helpers for multi-project recall. Kept dependency-free and
// synchronous so tests can exercise them with tiny synthetic fixtures.

import { wilson95 } from './lib.mjs';

export function parseProjects(raw) {
  const out = [];
  for (const part of String(raw).split(',')) {
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export function countsFromRules(rules, outOfScope) {
  let injected = 0;
  let found = 0;
  for (const r of rules) {
    if (Boolean(r.outOfScope) !== outOfScope) continue;
    injected += r.injected;
    found += r.found;
  }
  return {
    injected,
    found,
    recall: injected > 0 ? found / injected : null,
    wilson95: wilson95(found, injected),
  };
}

/** Pool rows by rule across projects; never average Wilson intervals. */
export function poolRules(projectRuns) {
  const byRule = new Map();
  for (const run of projectRuns) {
    for (const r of run.rules) {
      const row = byRule.get(r.ruleId) ?? {
        ruleId: r.ruleId,
        outOfScope: Boolean(r.outOfScope),
        injected: 0,
        found: 0,
        misses: [],
        projects: [],
      };
      row.injected += r.injected;
      row.found += r.found;
      row.projects.push({ project: run.name, injected: r.injected, found: r.found });
      for (const m of r.misses) row.misses.push({ project: run.name, ...m });
      byRule.set(r.ruleId, row);
    }
  }
  return [...byRule.values()]
    .map((r) => ({
      ...r,
      recall: r.injected > 0 ? r.found / r.injected : null,
      wilson95: wilson95(r.found, r.injected),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function summarizeRun(projectRuns, seed, target = 0.9) {
  const allRules = projectRuns.flatMap((r) => r.rules);
  const projects = projectRuns.map((r) => {
    const inScope = countsFromRules(r.rules, false);
    return {
      name: r.name,
      fileCount: r.fileCount,
      injected: inScope.injected,
      found: inScope.found,
      recall: inScope.recall,
      wilson95: inScope.wilson95,
      misses: r.rules.reduce((sum, rule) => sum + (rule.outOfScope ? 0 : rule.misses.length), 0),
      outOfScope: countsFromRules(r.rules, true),
    };
  });
  const pooled = countsFromRules(allRules, false);
  const outOfScope = countsFromRules(allRules, true);
  const tokenizerBlind = projectRuns.reduce((sum, r) => sum + (r.tokenizerBlind?.length ?? 0), 0);
  return {
    seed,
    projects,
    tokenizerBlind,
    pooled,
    outOfScope,
    rules: poolRules(projectRuns),
    target,
    met: pooled.recall !== null && pooled.recall >= target,
  };
}

export function countMisses(rules, outOfScope) {
  let total = 0;
  for (const r of rules) {
    if (Boolean(r.outOfScope) !== outOfScope) continue;
    total += r.misses.length;
  }
  return total;
}
