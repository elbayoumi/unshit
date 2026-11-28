#!/usr/bin/env node
// Independent cross-check of unshit's dead-code findings.
//
//   pnpm run build && node benchmark/oracle/run.mjs
//
// Scans five public corpora from read-only copies, then classifies every
// finding of the four dead-code rules with a text-only oracle that shares no
// code with src/ or dist/ (see ./lib.mjs). Writes results.json and
// docs/research/oracle-audit.md. Any human-written investigation notes are
// read verbatim from ./investigations.md and appended to the report.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, aggregate, buildProject, classifyFinding } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_ENTRY = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const CORPUS_DIR = resolve(process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus');
const CORPORA = ['hono', 'zod', 'execa', 'fastify', 'commander.js'];
const RESULTS_PATH = join(HERE, 'results.json');
const DOC_PATH = join(REPO_ROOT, 'docs', 'research', 'oracle-audit.md');
const INVESTIGATIONS_PATH = join(HERE, 'investigations.md');

function die(message) {
  console.error(`oracle: ${message}`);
  process.exit(2);
}

if (!existsSync(CORPUS_DIR)) die(`missing corpus dir ${CORPUS_DIR}`);
for (const corpus of CORPORA) {
  if (!existsSync(join(CORPUS_DIR, corpus))) die(`missing corpus ${corpus} in ${CORPUS_DIR}`);
}

console.error('oracle: building unshit...');
execFileSync('pnpm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
if (!existsSync(BIN)) die(`missing CLI entry ${BIN}`);
if (!existsSync(DIST_ENTRY)) die(`missing ${DIST_ENTRY}`);

function symbolOf(finding) {
  const match = /`([^`]+)`/.exec(finding.message ?? '');
  if (match) return match[1];
  const ev = (finding.evidence ?? '').trim();
  const named = /export\s+(?:\.\.\.\s*)?([A-Za-z_$][\w$]*)$/.exec(ev);
  return named ? named[1] : null;
}

function scan(binPath, projectDir, cwd) {
  const stdout = execFileSync(process.execPath, [binPath, 'scan', projectDir, '--format', 'json', '--no-cache'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout);
  if (!parsed || !Array.isArray(parsed.findings)) throw new Error('scan output missing findings array');
  return parsed;
}

const verdicts = [];
const scanStats = [];
const projectCache = new Map();

const previousResults = existsSync(RESULTS_PATH) ? safeReadJson(RESULTS_PATH) : null;

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

for (const corpus of CORPORA) {
  const source = join(CORPUS_DIR, corpus);
  const base = mkdtempSync(join(tmpdir(), `unshit-oracle-${corpus}-`));
  const work = join(base, basename(source));
  try {
    cpSync(source, work, { recursive: true });
    rmSync(join(work, '.git'), { recursive: true, force: true });
    console.error(`oracle: scanning ${corpus}...`);
    const output = scan(BIN, work, REPO_ROOT);
    const findings = output.findings.filter((f) => RULES.includes(f.ruleId));
    const byRule = {};
    for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    scanStats.push({ corpus, score: output.score, totalFindings: output.findings.length, trackedFindings: findings.length, byRule });

    // Classify against the untouched source copy (the scan copy is equivalent,
    // and we must not let the scan mutate the corpus either way).
    let project = projectCache.get(corpus);
    if (!project) {
      project = buildProject(source);
      projectCache.set(corpus, project);
    }
    for (const f of findings) {
      const normalized = {
        corpus,
        ruleId: f.ruleId,
        file: f.file,
        line: f.span?.line ?? 1,
        message: f.message ?? '',
        evidence: f.evidence ?? '',
        symbol: symbolOf(f),
      };
      const result = classifyFinding(project, normalized);
      verdicts.push({ ...normalized, verdict: result.verdict, reason: result.reason, evidence: result.evidence });
    }
    console.error(`oracle: ${corpus}: ${findings.length} tracked findings`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function movementFrom(before, after) {
  const key = (v) => `${v.corpus}\u0000${v.ruleId}\u0000${v.file}\u0000${v.line ?? 0}\u0000${v.symbol ?? ''}`;
  const beforeMap = new Map((before ?? []).map((v) => [key(v), v]));
  const flips = [];
  for (const v of after) {
    const prev = beforeMap.get(key(v));
    if (!prev) continue;
    if (prev.verdict !== v.verdict) flips.push({ ...v, from: prev.verdict, to: v.verdict });
  }
  const moved = {
    UNSURE_TO_CONFIRMED: flips.filter((f) => f.from === 'UNSURE' && f.to === 'CONFIRMED'),
    UNSURE_TO_CONTRADICTED: flips.filter((f) => f.from === 'UNSURE' && f.to === 'CONTRADICTED'),
    CONFIRMED_TO_UNSURE: flips.filter((f) => f.from === 'CONFIRMED' && f.to === 'UNSURE'),
  };
  return { moved, flips };
}

const byRuleMap = groupBy(verdicts, (r) => r.ruleId);
const byCorpusMap = groupBy(verdicts, (r) => r.corpus);
const byBothMap = groupBy(verdicts, (r) => `${r.corpus}\0${r.ruleId}`);

const rowFor = (name, rows) => ({ name, ...aggregate(rows) });
const perRule = [...byRuleMap.entries()].map(([ruleId, rows]) => rowFor(ruleId, rows)).sort((a, b) => a.name.localeCompare(b.name));
const perCorpus = [...byCorpusMap.entries()].map(([corpus, rows]) => rowFor(corpus, rows)).sort((a, b) => a.name.localeCompare(b.name));
const perCorpusRule = [...byBothMap.entries()].map(([key, rows]) => {
  const [corpus, ruleId] = key.split('\0');
  return { corpus, ruleId, ...aggregate(rows) };
}).sort((a, b) => a.corpus.localeCompare(b.corpus) || a.ruleId.localeCompare(b.ruleId));
const pooled = aggregate(verdicts);

const movement = movementFrom(previousResults?.verdicts ?? [], verdicts);
const movedCount = movement.moved.UNSURE_TO_CONFIRMED.length + movement.moved.UNSURE_TO_CONTRADICTED.length + movement.moved.CONFIRMED_TO_UNSURE.length;

const contradictions = verdicts
  .filter((v) => v.verdict === 'CONTRADICTED')
  .sort((a, b) => a.corpus.localeCompare(b.corpus) || a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file) || a.line - b.line);

const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpora: CORPORA,
  corpusDir: CORPUS_DIR,
  rules: RULES,
  method: {
    independence: 'lib.mjs imports nothing from src/ or dist/; verdicts come from a fresh walk plus regex text search',
    scanCommand: 'node bin/unshit.js scan <tmp-copy> --format json --no-cache',
    unsurePolicy: 'lower = all UNSURE are false positives; upper = all UNSURE are true positives',
  },
  scanStats,
  pooled,
  movement,
  perRule,
  perCorpus,
  perCorpusRule,
  contradictions,
  verdicts,
};

mkdirSync(dirname(RESULTS_PATH), { recursive: true });
writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

function pct(x) {
  return x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function statsTable(rows, label) {
  const lines = [
    `| ${label} | Confirmed | Contradicted | Unsure | Total | Precision (lower) | Precision (upper) | Wilson 95% |`,
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    lines.push(`| \`${r.name}\` | ${r.confirmed} | ${r.contradicted} | ${r.unsure} | ${r.total} | ${pct(r.precisionLower)} | ${pct(r.precisionUpper)} | [${pct(r.wilson95.lowerBoundLow)}, ${pct(r.wilson95.upperBoundHigh)}] |`);
  }
  return lines;
}

const doc = [];
doc.push('# Independent oracle audit of dead-code findings');
doc.push('');
doc.push(`Generated: ${results.generatedAt}`);
doc.push('');
doc.push('## Method');
doc.push('');
doc.push(`- Corpora: ${CORPORA.map((c) => `\`${c}\``).join(', ')} from \`${CORPUS_DIR}\`. Each corpus was copied to a fresh temp directory; the copy was scanned with \`node bin/unshit.js scan <copy> --format json --no-cache\` and then deleted. The corpora were never modified.`);
doc.push('- The oracle (`benchmark/oracle/lib.mjs`) is independent: it imports nothing from `src/` or `dist/` and reuses no unshit walker, resolver or detector. It walks the corpus afresh and classifies findings from regex/text evidence only.');
doc.push('- Rules cross-checked: `ts/unused-export`, `ts/unused-type-export`, `ts/unused-file`, `deps/unused-dependency`. Findings outside these rules are not classified.');
doc.push('- Mechanical guards: comment-only text is stripped before regex matching, so commented-out imports are not treated as usage; path mentions require a token boundary, so `play` does not match `playground.ts`; dependency usage is limited to the package scope of the manifest that declares it (root manifests cover the whole corpus).');
doc.push('- Export verdicts: CONFIRMED when the symbol appears nowhere outside its declaration and re-export chain; CONTRADICTED when a resolved import/require/namespace usage of that symbol from the file is found (evidence is `file:line` plus the matching line); UNSURE when the name occurs but cannot be attributed (name collisions, docs, public entry points).');
doc.push('- File verdicts: CONFIRMED when no import/require/dynamic import/reference and no path mention is found; CONTRADICTED for a resolved import or a literal path in a script/config/code file; UNSURE for unresolved textual mentions.');
doc.push('- Dependency verdicts: CONFIRMED when the package name appears nowhere outside its `package.json` declaration; CONTRADICTED for a matching import specifier, a script/config key in that manifest, a config file named after the package, or a config/type reference in scope; UNSURE for comment/doc/lockfile mentions.');
doc.push('- Precision with UNSURE counted both ways: lower bound `C / (C + D + U)` (all unsure are wrong), upper bound `(C + U) / (C + D + U)` (all unsure are right), where C/D/U are confirmed/contradicted/unsure. Wilson 95% reported as `[wilson(C).low, wilson(C+U).high]`. Confirmed-only precision (`C / (C+D)`) is in `results.json`.');
doc.push('- Wilson intervals are computed from summed counts, not by averaging intervals. This is a precision cross-check of emitted findings, not a recall measurement.');
doc.push('- Round 16 evidence sources: (1) import specifiers are resolved through mirrored adapter directories, so an import that lands in `adapters/<name>/src/*` is attributed to the same module as its twin `src/adapter/<name>/*`; (2) package.json `exports`/`main`/`bin` targets are mapped back to source files before public-entry checks run; (3) documentation and lockfile mentions no longer count as usage occurrences during export/type-export matching.');
doc.push('');
doc.push('## Results');
doc.push('');
doc.push(`Pooled: C=${pooled.confirmed}, D=${pooled.contradicted}, U=${pooled.unsure}, N=${pooled.total}. Precision lower **${pct(pooled.precisionLower)}**, upper **${pct(pooled.precisionUpper)}**, Wilson 95% [${pct(pooled.wilson95.lowerBoundLow)}, ${pct(pooled.wilson95.upperBoundHigh)}]. Confirmed-only precision ${pct(pooled.precisionConfirmedOnly)}.`);
doc.push('');
doc.push('## Round 16 verdict movement (new evidence sources)');
doc.push('');
const before = previousResults?.pooled ?? null;
if (before) {
  doc.push(`Before this round: C=${before.confirmed}, D=${before.contradicted}, U=${before.unsure}, N=${before.total}.`);
  doc.push('');
}
doc.push(`After this round: C=${pooled.confirmed}, D=${pooled.contradicted}, U=${pooled.unsure}, N=${pooled.total}.`);
doc.push('');
doc.push(`UNSAFE -> CONFIRMED: ${movement.moved.UNSURE_TO_CONFIRMED.length}. UNSAFE -> CONTRADICTED: ${movement.moved.UNSURE_TO_CONTRADICTED.length}. CONFIRMED -> UNSURE (newly uncertain, reported honestly): ${movement.moved.CONFIRMED_TO_UNSURE.length}.`);
doc.push('');
doc.push('### Verdict flips by rule');
doc.push('');
if (movedCount === 0) {
  doc.push('No verdicts moved during this round.');
} else {
  const byRule = new Map();
  for (const f of movement.flips) {
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
    byRule.get(f.ruleId).push(f);
  }
  for (const [ruleId, flips] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    doc.push(`- \`${ruleId}\`: ${flips.length} verdict flip(s) -> ${flips.map((f) => `${f.from}->${f.to} (${f.corpus} ${f.file}:${f.line} \`${f.symbol ?? ''}\`)`).join('; ')}.`);
  }
}
doc.push('');
doc.push('### Per rule');
doc.push('');
doc.push(...statsTable(perRule, 'Rule'));
doc.push('');
doc.push('### Per corpus');
doc.push('');
doc.push(...statsTable(perCorpus, 'Corpus'));
doc.push('');
doc.push('### Per rule and corpus');
doc.push('');
doc.push('| Corpus | Rule | Confirmed | Contradicted | Unsure | Total | Precision (lower) | Precision (upper) | Wilson 95% |');
doc.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of perCorpusRule) {
  doc.push(`| \`${r.corpus}\` | \`${r.ruleId}\` | ${r.confirmed} | ${r.contradicted} | ${r.unsure} | ${r.total} | ${pct(r.precisionLower)} | ${pct(r.precisionUpper)} | [${pct(r.wilson95.lowerBoundLow)}, ${pct(r.wilson95.upperBoundHigh)}] |`);
}
doc.push('');
doc.push('## Contradicted findings (all)');
doc.push('');
if (contradictions.length === 0) {
  doc.push('No contradictions found.');
} else {
  doc.push(`Total: ${contradictions.length}.`);
  doc.push('');
  for (const c of contradictions) {
    doc.push(`### \`${c.ruleId}\` — ${c.corpus} — \`${c.file}:${c.line}\`${c.symbol ? ` — \`${c.symbol}\`` : ''}`);
    doc.push('');
    doc.push(`- Finding: ${c.message}`);
    doc.push(`- Oracle reason: ${c.reason}`);
    for (const e of c.evidence) doc.push(`- Evidence: \`${e.file}:${e.line}\` — ${e.text.replace(/\|/g, '\\|')}`);
    doc.push('');
  }
}

mkdirSync(dirname(DOC_PATH), { recursive: true });
doc.push('## Contradiction investigation, detector bugs and limitations');
doc.push('');
if (existsSync(INVESTIGATIONS_PATH)) {
  doc.push(readFileSync(INVESTIGATIONS_PATH, 'utf8').trim());
} else {
  doc.push('Investigation notes are pending; see `benchmark/oracle/investigations.md`.');
}
doc.push('');
doc.push('## Reproduce');
doc.push('');
doc.push('```bash');
doc.push('node benchmark/oracle/run.mjs');
doc.push('```');
doc.push('');
writeFileSync(DOC_PATH, doc.join('\n') + '\n');

console.error(`oracle: wrote ${RESULTS_PATH}`);
console.error(`oracle: wrote ${DOC_PATH}`);
console.log(JSON.stringify({ generatedAt: results.generatedAt, pooled, perRule: perRule.map((r) => ({ ruleId: r.name, confirmed: r.confirmed, contradicted: r.contradicted, unsure: r.unsure })), contradictions: contradictions.length }, null, 2));
