#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countsFromRules, parseProjects, summarizeRun } from './aggregate.mjs';
import {
  eligibleUnusedExportFiles,
  injectEntryPointExports,
  injectionScope,
  nonTokenizedInjections,
  reasonForOutOfScopeMiss,
} from './entries.mjs';
import {
  copyCorpusToTmp,
  diffNewFindings,
  evaluateRecall,
  findCorpusProject,
  injectAll,
  listSourceFiles,
  mulberry32,
  scanJson,
} from './lib.mjs';
import { renderReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');

const DEV_SEED = 20261126;
const HOLDOUT_SEED = 20261127;
const DEFAULT_PROJECTS = ['hono', 'zod', 'execa', 'fastify'];
const TARGET = 0.9;
const ENTRY_INJECTIONS = 5;

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
function hasFlag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

const corpusDir = resolve(opt('--corpus', process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus'));
const legacyProject = opt('--project', null);
const projects = legacyProject ? [legacyProject] : parseProjects(opt('--projects', DEFAULT_PROJECTS.join(',')));
const seed = Number(opt('--seed', String(DEV_SEED)));
const perRule = Number(opt('--per-rule', '20'));
const minFiles = Number(opt('--min-files', '25'));
const outJson = resolve(opt('--out', join(HERE, 'results.json')));
const outMd = resolve(opt('--md', join(REPO_ROOT, 'docs', 'research', 'recall.md')));
const update = hasFlag('--update');

function pct(x) { return x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`; }
function fmtWilson(w) { return w ? `[${pct(w.low)}, ${pct(w.high)}]` : 'n/a'; }

// Keep the published rule shape flat and backward-compatible with the v1
// report, while adding the out-of-scope marker.
function serializeRules(rules) {
  return rules.map((r) => ({
    ruleId: r.ruleId,
    injected: r.injected,
    found: r.found,
    recall: r.recall,
    wilson95: r.wilson95,
    outOfScope: Boolean(r.outOfScope),
    misses: r.misses.map((m) => ({
      file: m.injection.file,
      line: m.injection.line,
      marker: m.injection.marker,
      kind: m.injection.kind,
      reason: m.reason,
      ...(m.injection.sourceFile ? { sourceFile: m.injection.sourceFile } : {}),
    })),
  }));
}

if (!existsSync(BIN) || !existsSync(join(REPO_ROOT, 'dist', 'src', 'detectors', 'dead-exports', 'analysis.js'))) {
  console.error('missing build output; run pnpm build first');
  process.exit(2);
}
if (!projects.length) {
  console.error('no projects selected');
  process.exit(2);
}

let existing = null;
if (update && existsSync(outJson)) {
  try {
    existing = JSON.parse(readFileSync(outJson, 'utf8'));
  } catch (err) {
    console.error(`cannot read ${outJson}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

const runs = {};
if (existing?.runs && typeof existing.runs === 'object') {
  for (const [key, value] of Object.entries(existing.runs)) {
    if (value && Array.isArray(value.projects)) runs[key] = value;
  }
} else if (existing && Array.isArray(existing.rules)) {
  // Migrate a v1 single-project report instead of discarding it.
  const oldSeed = String(existing.seed ?? DEV_SEED);
  runs[oldSeed] = {
    seed: Number(oldSeed),
    perRule: existing.perRule ?? perRule,
    minFiles,
    corpusDir,
    projects: [{
      name: basename(existing.corpusProject ?? 'hono'),
      path: existing.corpusProject ?? '',
      workDir: existing.workDir ?? '',
      fileCount: 0,
      starConsumedCount: 0,
      beforeCount: existing.beforeCount ?? 0,
      afterCount: existing.afterCount ?? 0,
      newFindingCount: existing.newFindingCount ?? 0,
      injectedCount: existing.injectedCount ?? 0,
      rules: existing.rules,
      injections: existing.injections ?? [],
    }],
    excludedProjects: [],
    summary: summarizeRun([{
      name: basename(existing.corpusProject ?? 'hono'),
      fileCount: 0,
      rules: existing.rules,
    }], Number(oldSeed), TARGET),
  };
}

const projectRuns = [];
const excludedProjects = [];
// commander.js is a public corpus, but far too small for a stable rate. Keep
// that scope limit visible with a measured file count in every report.
if (!projects.includes('commander.js') && existsSync(join(corpusDir, 'commander.js'))) {
  const count = listSourceFiles(join(corpusDir, 'commander.js')).length;
  if (count < minFiles) {
    excludedProjects.push({ name: 'commander.js', reason: 'too small', fileCount: count, default: true });
  }
}
const counts = {
  unusedExport: perRule,
  unusedFile: perRule,
  unusedDependency: perRule,
  noExplicitAny: perRule,
  magicTimer: perRule,
  duplicateBlock: perRule,
};

for (const name of projects) {
  const projectPath = join(corpusDir, name);
  if (!existsSync(projectPath)) {
    console.error(`skip ${name}: missing ${projectPath}`);
    excludedProjects.push({ name, reason: 'not found' });
    continue;
  }
  const resolvedPath = findCorpusProject(corpusDir, name);
  const { base, work } = copyCorpusToTmp(resolvedPath);
  console.error(`corpus: ${resolvedPath}`);
  console.error(`work:   ${work}`);
  try {
    // Scope is computed from unshit's compiled modules before any injection
    // mutates the copied project: scanned files, STAR-consumed entry points,
    // and files the clone detector actually tokenizes.
    const scope = await injectionScope(work, REPO_ROOT);
    const files = listSourceFiles(work).filter((f) => scope.scannedFiles.has(f));
    if (files.length < minFiles) {
      console.error(`skip ${name}: ${files.length} source files < min-files ${minFiles}`);
      excludedProjects.push({ name, reason: 'too small', fileCount: files.length });
      continue;
    }

    const before = scanJson(BIN, work, REPO_ROOT);
    const inScopeFiles = eligibleUnusedExportFiles(files, scope.starConsumed);
    const entryFiles = files.filter((f) => scope.starConsumed.has(f));
    console.error(`entry points skipped: ${entryFiles.length}; eligible files: ${inScopeFiles.length}; clone files: ${scope.cloneFiles.size}`);

    const injections = injectAll(work, seed, counts, {
      files,
      skipFiles: scope.starConsumed,
      cloneFiles: scope.cloneFiles,
    });
    const entryRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    injections.push(...injectEntryPointExports(work, entryFiles, Math.min(ENTRY_INJECTIONS, entryFiles.length), entryRand));
    // Injections the clone tokenizer cannot see are NOT dropped: the injected
    // text is valid TS, so a miss there is a detector bug (the tokenizer stops
    // at template literal types). They are scored as ordinary injections and
    // only annotated, so recall stays honest.
    const untokenized = await nonTokenizedInjections(work, injections, REPO_ROOT);
    const evaluatedInjections = injections;
    console.error(`injected: ${injections.length}; outside clone-tokenizer stream: ${untokenized.length}`);

    const after = scanJson(BIN, work, REPO_ROOT);
    const newFindings = diffNewFindings(before, after);
    console.error(`before/after/new findings: ${before.length}/${after.length}/${newFindings.length}`);

    const rules = evaluateRecall(evaluatedInjections, after);
    const byMarker = new Map(evaluatedInjections.map((i) => [`${i.file}\u0000${i.marker}`, i]));
    for (const row of rules) {
      for (const m of row.misses) {
        const inj = byMarker.get(`${m.injection.file}\u0000${m.injection.marker}`);
        m.reason = untokenized.includes(inj)
          ? 'detector bug: clone tokenizer stops before this line (template literal type earlier in file)'
          : reasonForOutOfScopeMiss(inj ?? m.injection);
      }
    }

    const projectRun = {
      name,
      path: resolvedPath,
      workDir: work,
      fileCount: files.length,
      starConsumedCount: entryFiles.length,
      beforeCount: before.length,
      afterCount: after.length,
      newFindingCount: newFindings.length,
      injectedCount: evaluatedInjections.length,
      tokenizerBlind: untokenized.map((i) => ({
        file: i.file,
        marker: i.marker,
        kind: i.kind,
        note: 'scored normally; clone tokenizer stops before this line (template literal type)',
      })),
      rules: serializeRules(rules),
      injections: evaluatedInjections.map((i) => ({ ...i })),
    };
    projectRuns.push(projectRun);
    const s = countsFromRules(rules, false);
    console.error(`${name}: in-scope ${s.found}/${s.injected} (${pct(s.recall)}) ${fmtWilson(s.wilson95)}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

if (projectRuns.length === 0) {
  console.error('no projects had enough files; refusing to write an empty report');
  process.exit(2);
}

const currentSummary = summarizeRun(projectRuns, seed, TARGET);
runs[String(seed)] = {
  seed,
  perRule,
  minFiles,
  corpusDir,
  projects: projectRuns,
  excludedProjects,
  summary: currentSummary,
};

const seedKeys = Object.keys(runs).sort((a, b) => Number(a) - Number(b));
const primaryKey = runs[String(HOLDOUT_SEED)]
  ? String(HOLDOUT_SEED)
  : (runs[String(DEV_SEED)] ? String(DEV_SEED) : seedKeys[seedKeys.length - 1]);
const primary = runs[primaryKey];
const primaryProject = primary.projects[0] ?? {};
const allPaths = [...new Set(Object.values(runs).flatMap((r) => r.projects.map((p) => p.path)))];

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  // Backward-compatible top-level fields describe the primary (holdout when
  // available) run; detailed per-seed data lives under `runs`.
  corpusProject: primaryProject.path ?? '',
  corpusProjects: allPaths,
  workDir: primaryProject.workDir ?? '',
  seed: Number(primaryKey),
  seeds: { dev: DEV_SEED, holdout: HOLDOUT_SEED },
  perRule,
  minFiles,
  target: TARGET,
  beforeCount: primary.projects.reduce((s, p) => s + p.beforeCount, 0),
  afterCount: primary.projects.reduce((s, p) => s + p.afterCount, 0),
  newFindingCount: primary.projects.reduce((s, p) => s + p.newFindingCount, 0),
  injectedCount: primary.projects.reduce((s, p) => s + p.injectedCount, 0),
  rules: primary.summary.rules,
  injections: primaryProject.injections ?? [],
  runs,
  summary: {
    dev: runs[String(DEV_SEED)]?.summary ?? null,
    holdout: runs[String(HOLDOUT_SEED)]?.summary ?? null,
    target: TARGET,
    met: runs[String(HOLDOUT_SEED)]?.summary?.met ?? currentSummary.met,
  },
  detectorBugs: [
    'Clone tokenizer (`src/detectors/clones-tokenize.ts`) truncates files that contain a template literal type. `TemplateLiteralType` nodes are not in the skip ranges, so the raw `ts.createScanner` mis-scans the `}` that closes `${...}` and swallows the rest of the file. Reproducer: hono `src/jsx/intrinsic-elements.ts` (928 lines) emits no tokens after line 705 (`image/${string}`); hono `src/types.ts` (2783 lines) stops at line 2733 (`${infer R}?`). Effect: `code/duplicate-block` cannot see clones below that line. Other rules are unaffected (an appended `any` and `setTimeout` at lines 926/927 are both reported). Not fixed in this round.',
  ],
};

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
writeFileSync(outMd, renderReport(report));
console.error(`wrote ${outJson} and ${outMd}`);

const stdout = {
  seed,
  projects: projectRuns.map((p) => ({
    name: p.name,
    inScope: countsFromRules(p.rules, false),
    outOfScope: countsFromRules(p.rules, true),
  })),
  pooledInScope: currentSummary.pooled,
  outOfScope: currentSummary.outOfScope,
  target: TARGET,
  met: currentSummary.met,
  dev: report.summary.dev ? { seed: DEV_SEED, pooled: report.summary.dev.pooled, met: report.summary.dev.met } : null,
  holdout: report.summary.holdout ? { seed: HOLDOUT_SEED, pooled: report.summary.holdout.pooled, met: report.summary.holdout.met } : null,
};
console.log(JSON.stringify(stdout, null, 2));
