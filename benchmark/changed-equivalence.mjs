#!/usr/bin/env node
// Correctness proof for r14 perf changes.
//
// For each of the 5 public corpora and unshit itself:
//   (a) full scan findings JSON before vs after this change (sorted, timings stripped)
//   (b) guard --changed findings vs full-scan findings restricted to changed files,
//       after 3 seeded edits
// All comparisons must be byte-identical after normalization.
//
//   pnpm run build && node benchmark/changed-equivalence.mjs [--out benchmark/changed-equivalence-results.json]
//
// Never modifies the corpus. Uses /tmp worktrees and cleans them up.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const CORPUS_ROOT = '/Volumes/data/projects/unshit-bench/corpus';
const CORPORA = ['hono', 'zod', 'execa', 'fastify', 'commander.js'];
const SEED = 20261129;

function die(msg) { console.error(`changed-equivalence: ${msg}`); process.exit(2); }
function ensureBuilt() {
  if (!existsSync(BIN) || !existsSync(DIST_CLI)) die('missing build; run `pnpm run build`');
}
function parseArgs(argv) {
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') out = argv[++i];
    else die(`unknown argument: ${arg}`);
  }
  return { out };
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function pickDeterministic(items, n, seed) {
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
function findingSortKey(f) {
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
  return { equal: missing.length === 0 && extra.length === 0 && a.length === b.length, actualCount: a.length, expectedCount: b.length, missing, extra };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitInit(work) {
  git(['init', '-q'], work);
  git(['config', 'user.email', 'test@test'], work);
  git(['config', 'user.name', 'test'], work);
  git(['add', '-A'], work);
  git(['commit', '-qm', 'init', '--no-gpg-sign'], work);
}
function runCliWithBin(bin, args, cwd = REPO_ROOT) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}
function scanJsonWithBin(bin, projectDir, extraArgs = []) {
  const r = runCliWithBin(bin, ['scan', projectDir, '--format', 'json', '--no-cache', ...extraArgs], REPO_ROOT);
  if (r.code !== 0) throw new Error(`scan failed (${r.code}): ${(r.stderr || r.stdout).slice(0, 500)}`);
  const parsed = JSON.parse(r.stdout);
  if (!parsed || !Array.isArray(parsed.findings)) throw new Error(`scan output missing findings for ${projectDir}`);
  return parsed;
}

const copyFilter = (src) => !/(^|\/)(node_modules|\.git|\.unshit|dist)(\/|$)/.test(src);
function copyCorpus(name) {
  const src = join(CORPUS_ROOT, name);
  if (!existsSync(src)) die(`missing corpus ${src}`);
  const base = mkdtempSync(join(tmpdir(), `unshit-eq-${name}-`));
  const work = join(base, name);
  cpSync(src, work, { recursive: true, filter: copyFilter });
  return { base, work };
}
function copyUnshitHead() {
  const base = mkdtempSync(join(tmpdir(), 'unshit-eq-self-'));
  const work = join(base, 'unshit');
  mkdirSync(work, { recursive: true });
  execFileSync('bash', ['-lc', 'git archive HEAD | tar -x -C "$1"', 'bash', work], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  return { base, work };
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
    writeFileSync(abs, prev + (prev.endsWith('\n') ? '' : '\n') + `\n/* changed-equivalence-seed-${seed}-${i} */\n`, 'utf8');
    return { file: rel, kind: 'append-comment-marker' };
  });
  return { edits, picked };
}

function buildBaselineWorktree() {
  const base = mkdtempSync(join(tmpdir(), 'unshit-eq-baseline-'));
  const work = join(base, 'repo');
  git(['worktree', 'add', '--detach', work, 'HEAD'], REPO_ROOT);
  try {
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(work, 'node_modules'));
    execFileSync('pnpm', ['run', 'build'], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    try { git(['worktree', 'remove', '--force', work], REPO_ROOT); } catch { /* best-effort cleanup */ }
    rmSync(base, { recursive: true, force: true });
    throw err;
  }
  return { base, work, bin: join(work, 'bin', 'unshit.js') };
}

function removeBaselineWorktree(baseline) {
  try { git(['worktree', 'remove', '--force', baseline.work], REPO_ROOT); } catch { /* best-effort cleanup */ }
  rmSync(baseline.base, { recursive: true, force: true });
}

async function main() {
  ensureBuilt();
  const { out } = parseArgs(process.argv.slice(2));

  const baseline = buildBaselineWorktree();
  const results = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    seed: SEED,
    corpora: [...CORPORA, 'unshit-self'],
    beforeAfter: [],
    changedGuard: [],
    summary: {},
  };

  try {
    // (a) Before vs after on identical inputs
    for (const name of CORPORA) {
      const { base, work } = copyCorpus(name);
      try {
        const before = scanJsonWithBin(baseline.bin, work);
        const after = scanJsonWithBin(BIN, work);
        const cmp = compareFindingSets(after.findings, before.findings);
        results.beforeAfter.push({
          target: name,
          beforeCount: before.findings.length,
          afterCount: after.findings.length,
          equal: cmp.equal,
          missing: cmp.missing,
          extra: cmp.extra,
        });
        console.log(`[a] ${name}: before=${before.findings.length} after=${after.findings.length} equal=${cmp.equal}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
    {
      const { base, work } = copyUnshitHead();
      try {
        const before = scanJsonWithBin(baseline.bin, work);
        const after = scanJsonWithBin(BIN, work);
        const cmp = compareFindingSets(after.findings, before.findings);
        results.beforeAfter.push({
          target: 'unshit-self',
          beforeCount: before.findings.length,
          afterCount: after.findings.length,
          equal: cmp.equal,
          missing: cmp.missing,
          extra: cmp.extra,
        });
        console.log(`[a] unshit-self: before=${before.findings.length} after=${after.findings.length} equal=${cmp.equal}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }

    // (b) guard --changed findings vs full-scan findings restricted to changed files
    const { getChangedFiles } = await import(`file://${join(REPO_ROOT, 'dist/src/core/changed-files.js')}`);
    const { evaluateGuard } = await import(`file://${join(REPO_ROOT, 'dist/src/core/pinner.js')}`);
    const { runScan } = await import(`file://${join(REPO_ROOT, 'dist/src/core/scanner.js')}`);
    const { loadConfig } = await import(`file://${join(REPO_ROOT, 'dist/src/config.js')}`);

    async function checkChangedGuard(targetName, work, edits) {
      const changedFiles = await getChangedFiles(work, 'HEAD');
      const config = await loadConfig(work);
      const full = await runScan(work, config, [], { noCache: true });
      const fullChanged = full.findings.filter((f) => changedFiles.has(f.file));
      // Guard --changed with no baseline reports blocking findings in changed scope.
      const guardEval = evaluateGuard(full, null, changedFiles, undefined);
      const expectedBlocking = fullChanged.filter((f) => f.severity === 'error' || f.severity === 'warn');
      const cmpBlocking = compareFindingSets(guardEval.newFindings, expectedBlocking);
      const guardCli = runCliWithBin(BIN, ['guard', work, '--changed', '--no-cache', '--base', 'HEAD'], REPO_ROOT);
      const equal = cmpBlocking.equal;
      results.changedGuard.push({
        target: targetName,
        edits,
        changedFileCount: changedFiles.size,
        fullScanFindingCount: full.findings.length,
        changedFindingCount: fullChanged.length,
        blockingChangedFindingCount: expectedBlocking.length,
        guardReportedCount: guardEval.newFindings.length,
        equal,
        missing: cmpBlocking.missing,
        extra: cmpBlocking.extra,
        guardCli: { code: guardCli.code },
      });
      console.log(`[b] ${targetName}: changed=${changedFiles.size} changedFindings=${fullChanged.length} blocking=${expectedBlocking.length} guardReported=${guardEval.newFindings.length} equal=${equal} guardExit=${guardCli.code}`);
    }

    for (const name of CORPORA) {
      const { base, work } = copyCorpus(name);
      try {
        gitInit(work);
        const { edits } = makeSeededEdits(work, SEED);
        await checkChangedGuard(name, work, edits);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
    {
      const { base, work } = copyUnshitHead();
      try {
        gitInit(work);
        const { edits } = makeSeededEdits(work, SEED);
        await checkChangedGuard('unshit-self', work, edits);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  } finally {
    removeBaselineWorktree(baseline);
  }

  results.summary = {
    beforeAfterAllEqual: results.beforeAfter.every((r) => r.equal),
    changedGuardAllEqual: results.changedGuard.every((r) => r.equal),
    allEqual: results.beforeAfter.every((r) => r.equal) && results.changedGuard.every((r) => r.equal),
  };

  const outPath = out ? resolve(out) : join(REPO_ROOT, 'benchmark/changed-equivalence-results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
  console.log(`summary: ${JSON.stringify(results.summary)}`);
  if (!results.summary.allEqual) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
