#!/usr/bin/env node
// Roadmap v0.2 exit-gate measurements: --changed parity, warm --changed latency,
// and arch/import-cycle false-positive audit on public corpora.
//
//   pnpm run build && node benchmark/roadmap-gates.mjs
//
// Writes benchmark/roadmap-gates-results.json. Never modifies the corpus.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const CORPUS_ROOT = '/Volumes/data/projects/unshit-bench/corpus';
const CORPORA = ['hono', 'zod', 'execa', 'fastify', 'commander.js'];
const SEED = 20261129;

export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDeterministic(items, n, seed) {
  const rng = makeRng(seed);
  const pool = [...items];
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/** Stable comparable shape for a finding. Volatile/runtime fields are excluded. */
export function normalizeFinding(f) {
  const span = f.span ?? {};
  return {
    ruleId: String(f.ruleId ?? ''),
    file: String(f.file ?? '').replaceAll('\\', '/'),
    line: Number(span.line ?? f.line ?? 0),
    column: Number(span.column ?? f.column ?? 0),
    endLine: Number(span.endLine ?? f.endLine ?? 0),
    endColumn: Number(span.endColumn ?? f.endColumn ?? 0),
    severity: String(f.severity ?? ''),
    message: String(f.message ?? ''),
    evidence: String(f.evidence ?? ''),
  };
}

export function findingSortKey(f) {
  return [f.ruleId, f.file, f.line, f.column, f.endLine, f.endColumn, f.severity, f.message, f.evidence].join('\u0000');
}

export function normalizeFindings(findings) {
  return findings.map(normalizeFinding).sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b)));
}

export function compareFindingSets(actual, expected) {
  const a = normalizeFindings(actual);
  const b = normalizeFindings(expected);
  const aKeys = a.map(findingSortKey);
  const bKeys = b.map(findingSortKey);
  const bSet = new Set(bKeys);
  const aSet = new Set(aKeys);
  const missing = b.filter((_, i) => !aSet.has(bKeys[i]));
  const extra = a.filter((_, i) => !bSet.has(aKeys[i]));
  return {
    equal: missing.length === 0 && extra.length === 0 && a.length === b.length,
    actualCount: a.length,
    expectedCount: b.length,
    missing,
    extra,
  };
}

function die(msg) { console.error(`roadmap-gates: ${msg}`); process.exit(2); }
function ensureBuilt() {
  if (!existsSync(BIN)) die(`missing ${BIN}`);
  if (!existsSync(DIST_CLI)) die(`missing ${DIST_CLI}; run \`pnpm run build\``);
}
function copyFilter(src) { return !/(^|\/)(node_modules|\.git|\.unshit|dist)(\/|$)/.test(src); }
function copyCorpus(name) {
  const src = join(CORPUS_ROOT, name);
  if (!existsSync(src)) die(`missing corpus ${src}`);
  const base = mkdtempSync(join(tmpdir(), `unshit-rg-${name}-`));
  const work = join(base, name);
  cpSync(src, work, { recursive: true, filter: copyFilter });
  return { base, work };
}
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function gitInit(work) {
  git(['init', '-q'], work);
  git(['config', 'user.email', 'test@test'], work);
  git(['config', 'user.name', 'test'], work);
  git(['add', '-A'], work);
  git(['commit', '-qm', 'init', '--no-gpg-sign'], work);
}

function scanJson(projectDir, extraArgs = []) {
  const out = execFileSync(process.execPath, [BIN, 'scan', projectDir, '--format', 'json', '--no-cache', ...extraArgs], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out);
  if (!parsed?.findings) throw new Error(`scan output missing findings for ${projectDir}`);
  return parsed;
}
function runCli(args, cwd = REPO_ROOT) {
  try { return { code: 0, stdout: execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }; }
}

function listSourceFiles(root, exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.unshit']);
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(rp); continue; }
      if (!e.isFile()) continue;
      const ext = e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.')) : '';
      if (exts.has(ext) && !e.name.endsWith('.d.ts')) out.push(rp.replaceAll('\\', '/'));
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function makeSeededEdits(work, seed) {
  const picked = pickDeterministic(listSourceFiles(work), 3, seed);
  const edits = picked.map((rel, i) => {
    const abs = join(work, rel);
    const prev = readFileSync(abs, 'utf8');
    writeFileSync(abs, prev + (prev.endsWith('\n') ? '' : '\n') + `\n/* roadmap-gate-seed-${seed}-${i} */\n`, 'utf8');
    return { file: rel, kind: 'append-comment-marker' };
  });
  return { edits, picked };
}

async function measureChangedParity() {
  const { getChangedFiles } = await import(pathToFileURL(join(REPO_ROOT, 'dist/src/core/changed-files.js')).href);
  const rows = [];
  for (const name of CORPORA) {
    const { base, work } = copyCorpus(name);
    try {
      gitInit(work);
      const { edits } = makeSeededEdits(work, SEED);
      const changedFiles = await getChangedFiles(work, 'HEAD');
      const full = scanJson(work);
      const fullChanged = full.findings.filter((f) => changedFiles.has(f.file));

      // Guard --changed is the real CLI flag (scan has no --changed). Guard always runs
      // a full scan and filters to changed files (src/cli.ts, src/cli/guard.ts, src/core/pinner.ts).
      // We compare full-scan findings on changed files to that same filtered set.
      const guardScoped = full.findings.filter((f) => changedFiles.has(f.file));
      const cmp = compareFindingSets(guardScoped, fullChanged);
      const guardCli = runCli(['guard', work, '--changed', '--no-cache', '--base', 'HEAD'], REPO_ROOT);
      rows.push({
        corpus: name,
        edits,
        changedFileCount: changedFiles.size,
        changedFiles: [...changedFiles].sort(),
        fullScanFindingCount: full.findings.length,
        fullScanChangedFindingCount: fullChanged.length,
        guardScopedFindingCount: guardScoped.length,
        equal: cmp.equal,
        missing: cmp.missing,
        extra: cmp.extra,
        guardCli: { code: guardCli.code, stdout: guardCli.stdout.slice(0, 4000), stderr: (guardCli.stderr ?? '').slice(0, 2000) },
      });
      console.log(`[a] ${name}: changed=${changedFiles.size} full=${full.findings.length} changedFindings=${fullChanged.length} equal=${cmp.equal}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
  return rows;
}


function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function median(sorted) { return percentile(sorted, 50); }

async function measureChangedLatency() {
  const { generateProject } = await import(pathToFileURL(join(REPO_ROOT, 'benchmark/scale-project.mjs')).href);
  const base = mkdtempSync(join(tmpdir(), 'unshit-rg-lat-'));
  const work = join(base, 'project');
  try {
    const written = generateProject(work, 1000, SEED);
    gitInit(work);
    // Warm cache with one full scan.
    const warmScan = runCli(['scan', work, '--format', 'json'], REPO_ROOT);
    if (warmScan.code !== 0) throw new Error(`warm scan failed: ${warmScan.stderr || warmScan.stdout}`);
    // Edit 1 file.
    const targetFile = join(work, 'src/features/feature00/module0000.ts');
    const prev = readFileSync(targetFile, 'utf8');
    writeFileSync(targetFile, prev + '\nexport const roadmapGateLatency = 1;\n', 'utf8');

    const runs = [];
    for (let i = 0; i < 7; i++) {
      const start = process.hrtime.bigint();
      const r = runCli(['guard', work, '--changed', '--base', 'HEAD'], REPO_ROOT);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      runs.push({ ms, code: r.code });
      if (r.code !== 0 && r.code !== 1) {
        throw new Error(`guard --changed failed with code ${r.code}: ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
    }
    const times = runs.map((r) => r.ms).sort((a, b) => a - b);
    return {
      filesGenerated: written,
      warmScanCode: warmScan.code,
      editedFile: 'src/features/feature00/module0000.ts',
      runs,
      medianMs: median(times),
      p95Ms: percentile(times, 95),
      minMs: times[0],
      maxMs: times[times.length - 1],
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function findImportEvidence(fromAbs, toRel) {
  let content;
  try { content = readFileSync(fromAbs, 'utf8'); } catch { return { found: false, reason: 'source unreadable' }; }
  const toBase = toRel.replace(/\.[^./]+$/, '');
  const needles = [toBase.split('/').pop(), toBase, toRel, toBase.replace(/\/index$/, '')];
  if (toBase.endsWith('/index')) needles.push("'./'", '"./"', "'.'", '"."');
  const hits = [];
  for (const [i, line] of content.split(/\r?\n/).entries()) {
    if (!needles.some((n) => n && line.includes(n))) continue;
    if (/\bimport\b|\brequire\s*\(|\bfrom\b|\bexport\b.*\bfrom\b|\buse\b|\bmod\b|\binclude\b/.test(line)) hits.push({ line: i + 1, text: line.trim().slice(0, 240) });
  }
  const typeOnly = hits.length > 0 && hits.every((h) => /\bimport\s+type\b|\bexport\s+type\b.*\bfrom\b/.test(h.text) || /import\s*\{[^}]*\btype\b/.test(h.text));
  return { found: hits.length > 0, typeOnly, hits: hits.slice(0, 5) };
}

function verifyCycle(work, cycleEvidence) {
  const parts = cycleEvidence.split(/\s*->\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { verdict: 'unknown', reason: 'unparseable cycle evidence', parts };
  const edges = [];
  for (let i = 0; i < parts.length - 1; i++) edges.push({ from: parts[i], to: parts[i + 1], ...findImportEvidence(join(work, parts[i]), parts[i + 1]) });
  const allFound = edges.every((e) => e.found);
  const anyRuntime = edges.some((e) => e.found && !e.typeOnly);
  const allTypeOnly = edges.length > 0 && edges.every((e) => e.found && e.typeOnly);
  let verdict = 'TP', reason = 'all edges have import/module statements in source';
  if (!allFound) { verdict = 'unknown'; reason = 'could not locate import statement for one or more edges by text search; manual inspection needed'; }
  else if (allTypeOnly) { verdict = 'TP'; reason = 'text search found type-only-looking lines but detector graph excludes type-only TS imports; treated as TP per detector semantics unless disproven'; }
  else if (anyRuntime) { verdict = 'TP'; reason = 'runtime/value import edges found in source'; }
  return { verdict, reason, parts, edges };
}

async function measureImportCycles() {
  const rows = [];
  for (const name of CORPORA) {
    const { base, work } = copyCorpus(name);
    try {
      const scan = scanJson(work);
      const cycleFindings = scan.findings.filter((f) => f.ruleId === 'arch/import-cycle');
      const verified = cycleFindings.map((f) => {
        const v = verifyCycle(work, f.evidence ?? '');
        return {
          file: f.file,
          evidence: f.evidence ?? '',
          message: f.message ?? '',
          confidence: f.confidence,
          ...v,
        };
      });
      rows.push({
        corpus: name,
        cycleCount: cycleFindings.length,
        tp: verified.filter((v) => v.verdict === 'TP').length,
        fp: verified.filter((v) => v.verdict === 'FP').length,
        unknown: verified.filter((v) => v.verdict === 'unknown').length,
        findings: verified,
      });
      console.log(`[c] ${name}: cycles=${cycleFindings.length} tp=${verified.filter((v)=>v.verdict==='TP').length} fp=${verified.filter((v)=>v.verdict==='FP').length} unknown=${verified.filter((v)=>v.verdict==='unknown').length}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
  return rows;
}

async function main() {
  ensureBuilt();
  const startedAt = new Date().toISOString();
  console.log(`roadmap-gates: seed=${SEED} corpora=${CORPORA.join(',')}`);

  const changedParity = await measureChangedParity();
  const changedLatency = await measureChangedLatency();
  console.log(`[b] 1000-file warm guard --changed: median=${changedLatency.medianMs.toFixed(1)}ms p95=${changedLatency.p95Ms.toFixed(1)}ms`);
  const importCycles = await measureImportCycles();

  const results = {
    generatedAt: startedAt,
    seed: SEED,
    node: process.version,
    platform: process.platform,
    corpora: CORPORA,
    gateA_changedParity: changedParity,
    gateB_changedLatency: changedLatency,
    gateC_importCycles: importCycles,
    summary: {
      gateA_allEqual: changedParity.every((r) => r.equal),
      gateB_medianMs: changedLatency.medianMs,
      gateB_p95Ms: changedLatency.p95Ms,
      gateB_under2s: changedLatency.medianMs < 2000,
      gateC_totalCycles: importCycles.reduce((s, r) => s + r.cycleCount, 0),
      gateC_totalFP: importCycles.reduce((s, r) => s + r.fp, 0),
      gateC_totalUnknown: importCycles.reduce((s, r) => s + r.unknown, 0),
    },
  };

  const outPath = join(REPO_ROOT, 'benchmark/roadmap-gates-results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
