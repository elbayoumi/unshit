#!/usr/bin/env node
// Warm guard --changed latency benchmark (gate b).
//   pnpm run build && node benchmark/changed-latency.mjs [--runs 9] [--seed 20261129] [--out benchmark/changed-latency-results.json]
//
// Generates a 1000-file TS project in a temp dir, git-inits it, warms the cache
// with one full scan, makes one seeded edit, then times `guard --changed --base HEAD`
// over >= 9 runs. Also reports an untouched second batch (no further edit) to
// separate steady-state cache-hit cost. Never modifies the corpus or the repo.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const DEFAULT_RUNS = 9;
const DEFAULT_SEED = 20261129;
const FILE_COUNT = 1000;

function die(msg) {
  console.error(`changed-latency: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  let runs = DEFAULT_RUNS;
  let seed = DEFAULT_SEED;
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runs') runs = Number(argv[++i]);
    else if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg === '--out') out = argv[++i];
    else die(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(runs) || runs < 9) die('--runs must be an integer >= 9');
  if (!Number.isInteger(seed)) die('--seed must be an integer');
  return { runs, seed, out };
}

function ensureBuilt() {
  if (!existsSync(BIN)) die(`missing ${BIN}`);
  if (!existsSync(DIST_CLI)) die(`missing ${DIST_CLI}; run \`pnpm run build\``);
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

function runCli(args, cwd = REPO_ROOT) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(sorted) {
  return percentile(sorted, 50);
}

function summarize(timesMs) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  return {
    runs: timesMs.length,
    minMs: sorted[0],
    medianMs: median(sorted),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
    timesMs,
  };
}

function timeGuardChanged(work, runs) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    const r = runCli(['guard', work, '--changed', '--base', 'HEAD'], REPO_ROOT);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (r.code !== 0 && r.code !== 1) {
      throw new Error(`guard --changed failed with code ${r.code}: ${(r.stderr || r.stdout).slice(0, 500)}`);
    }
    samples.push({ ms, code: r.code });
  }
  return summarize(samples.map((s) => s.ms));
}

async function main() {
  ensureBuilt();
  const { runs, seed, out } = parseArgs(process.argv.slice(2));
  const { generateProject } = await import(pathToFileURL(join(REPO_ROOT, 'benchmark/scale-project.mjs')).href);

  const base = mkdtempSync(join(tmpdir(), 'unshit-changed-latency-'));
  const work = join(base, 'project');
  try {
    const written = generateProject(work, FILE_COUNT, seed);
    gitInit(work);

    const warmScanStart = process.hrtime.bigint();
    const warmScan = runCli(['scan', work, '--format', 'json'], REPO_ROOT);
    const warmScanMs = Number(process.hrtime.bigint() - warmScanStart) / 1e6;
    if (warmScan.code !== 0) throw new Error(`warm scan failed: ${(warmScan.stderr || warmScan.stdout).slice(0, 500)}`);

    // Seeded edit: append an export to a deterministic file.
    const editedFile = 'src/features/feature00/module0000.ts';
    const targetFile = join(work, editedFile);
    const prev = readFileSync(targetFile, 'utf8');
    writeFileSync(targetFile, prev + '\nexport const changedLatencyProbe = 1;\n', 'utf8');

    const afterEdit = timeGuardChanged(work, runs);

    // Untouched second batch: no further edit, same changed set vs HEAD.
    const untouched = timeGuardChanged(work, runs);

    const report = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      seed,
      filesGenerated: written,
      editedFile,
      warmScanMs,
      afterEdit,
      untouched,
      target: { medianMs: 2000, p95Ms: 2500 },
      pass: afterEdit.medianMs < 2000 && afterEdit.p95Ms < 2500,
    };

    console.log(`changed-latency: files=${written} warmScan=${warmScanMs.toFixed(1)}ms`);
    console.log(`  after-edit:   min=${afterEdit.minMs.toFixed(1)} median=${afterEdit.medianMs.toFixed(1)} p95=${afterEdit.p95Ms.toFixed(1)} max=${afterEdit.maxMs.toFixed(1)} ms (${runs} runs)`);
    console.log(`  untouched:    min=${untouched.minMs.toFixed(1)} median=${untouched.medianMs.toFixed(1)} p95=${untouched.p95Ms.toFixed(1)} max=${untouched.maxMs.toFixed(1)} ms (${runs} runs)`);
    console.log(`  target: median < 2000ms, p95 < 2500ms -> ${report.pass ? 'PASS' : 'MISS'}`);

    if (out) {
      const outPath = resolve(out);
      writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
      console.log(`wrote ${outPath}`);
    }
    return report;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
