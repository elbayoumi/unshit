#!/usr/bin/env node
// Scale benchmark: deterministic 200/1000-file TS projects in a fresh /tmp dir.
//   node benchmark/scale-bench.mjs [--reps 5] [--seed 20261126] [--out report.json]
// Reports median wall time of `node bin/unshit.js scan <dir> --no-cache` and
// a cache-enabled second run. Prints RESULT: PASS only when both budgets hold.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProject } from './scale-project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'unshit.js');
const SIZES = [200, 1000];
const BUDGET_MS = { 200: 1500, 1000: 3000 };
const DEFAULT_SEED = 20261126;
const DEFAULT_REPS = 5;

function parseArgs(argv) {
  let reps = DEFAULT_REPS;
  let seed = DEFAULT_SEED;
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reps') reps = Number(argv[++i]);
    else if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg === '--out') out = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(reps) || reps < 1) throw new Error('--reps must be a positive integer');
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  return { reps, seed, out };
}

function machine() {
  const processors = cpus();
  return {
    node: process.version,
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu: processors[0]?.model ?? 'unknown',
    cores: processors.length,
    totalMemoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)),
    date: new Date().toISOString(),
  };
}

function makeProject(count, seed) {
  const root = mkdtempSync(join(tmpdir(), `unshit-scale-${count}-`));
  const project = join(root, 'project');
  const files = generateProject(project, count, seed);
  return { root, project, files };
}

function timeScan(project, useCache) {
  const flags = useCache ? [] : ['--no-cache'];
  const argv = [BIN, 'scan', project, '--format', 'json', ...flags];
  const started = performance.now();
  execFileSync(process.execPath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
  return performance.now() - started;
}

function middle(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const at = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[at] : (ordered[at - 1] + ordered[at]) / 2;
}

function measure(project, reps, useCache) {
  timeScan(project, useCache);
  const values = Array.from({ length: reps }, () => timeScan(project, useCache));
  const stats = { samples: values, median: middle(values) };
  stats.min = Math.min(...values);
  stats.max = Math.max(...values);
  return stats;
}

function findingsDigest(project) {
  // stdout is redirected to a file, not a pipe: bin/unshit.js calls
  // process.exit(), which truncates large piped writes at 64 KiB.
  const output = join(project, '..', 'findings.json');
  const fd = openSync(output, 'w');
  try {
    execFileSync(process.execPath, [BIN, 'scan', project, '--no-cache', '--format', 'json'], {
      stdio: ['ignore', fd, 'pipe'],
    });
  } finally {
    closeSync(fd);
  }
  const findings = JSON.parse(readFileSync(output, 'utf8')).findings;
  return createHash('sha256').update(JSON.stringify(findings)).digest('hex');
}

function rowFor(count, seed, reps) {
  const project = makeProject(count, seed);
  try {
    return {
      count,
      files: project.files,
      noCache: measure(project.project, reps, false),
      cached: measure(project.project, reps, true),
      findingsSha256: findingsDigest(project.project),
    };
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function printTable(info, reps, rows) {
  console.log(`Scale scan — median of ${reps} runs, warm FS, ${info.node} ${info.platform}/${info.arch}, ${info.cpu}, ${info.cores} cores`);
  console.log(`${pad('files', 8)} ${pad('no-cache ms', 14)} ${pad('cached ms', 12)} ${pad('budget ms', 11)} ${pad('verdict', 9)} findings sha256`);
  for (const row of rows) {
    const budget = BUDGET_MS[row.count];
    const verdict = row.noCache.median < budget ? 'PASS' : 'MISS';
    console.log(`${pad(row.count, 8)} ${pad(row.noCache.median.toFixed(1), 14)} ${pad(row.cached.median.toFixed(1), 12)} ${pad(budget, 11)} ${pad(verdict, 9)} ${row.findingsSha256}`);
  }
}

function main() {
  const { reps, seed, out } = parseArgs(process.argv.slice(2));
  const info = machine();
  const rows = SIZES.map((count) => rowFor(count, seed, reps));
  printTable(info, reps, rows);
  const passed = rows.every((row) => row.noCache.median < BUDGET_MS[row.count]);
  console.log(`RESULT: ${passed ? 'PASS' : 'FAIL'}`);
  if (out) writeFileSync(out, JSON.stringify({ machine: info, reps, seed, budgetsMs: BUDGET_MS, rows }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
