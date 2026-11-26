#!/usr/bin/env node
// Reproducible scan wall-time benchmark for unshit.
//
//   node benchmark/scan-speed.mjs <dir>... [--reps 5] [--out report.json]
//
// Each target is copied to a fresh directory under the OS temp dir (never
// written in place). After a warm-up scan, `node bin/unshit.js scan <copy>
// --format json` is timed as a median of N runs, both with `--no-cache` and
// with the content-hash cache enabled (warm cache after the warm-up).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'unshit.js');

function parseArgs(argv) {
  const repsAt = argv.indexOf('--reps');
  const outAt = argv.indexOf('--out');
  const reps = repsAt >= 0 ? Number(argv[repsAt + 1]) : 5;
  const out = outAt >= 0 ? argv[outAt + 1] : undefined;
  const dirs = argv.filter((a, i) =>
    !a.startsWith('--') && (repsAt < 0 || i !== repsAt + 1) && (outAt < 0 || i !== outAt + 1));
  if (!dirs.length || !Number.isInteger(reps) || reps < 1) {
    console.error('usage: node benchmark/scan-speed.mjs <dir>... [--reps N] [--out report.json]');
    process.exit(2);
  }
  return { dirs: dirs.map((d) => resolve(d)), reps, out };
}

function copyFilter(src) {
  return !/(^|\/)(node_modules|\.git|\.unshit|dist)(\/|$)/.test(src);
}

function makeCopy(target) {
  const root = mkdtempSync(join(tmpdir(), 'unshit-scan-speed-'));
  const project = join(root, 'project');
  cpSync(target, project, { recursive: true, filter: copyFilter });
  return { root, project };
}

function scanOnce(project, useCache) {
  const args = [BIN, 'scan', project, '--format', 'json'];
  if (!useCache) args.push('--no-cache');
  const start = process.hrtime.bigint();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measure(project, reps, useCache) {
  scanOnce(project, useCache);
  const samples = [];
  for (let i = 0; i < reps; i += 1) samples.push(scanOnce(project, useCache));
  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

function pad(value, width) {
  return String(value).padEnd(width);
}

const { dirs, reps, out } = parseArgs(process.argv.slice(2));
const rows = [];
for (const target of dirs) {
  const copy = makeCopy(target);
  try {
    const noCache = measure(copy.project, reps, false);
    const cached = measure(copy.project, reps, true);
    rows.push({ target, noCache, cached });
  } finally {
    rmSync(copy.root, { recursive: true, force: true });
  }
}

console.log(`Scan wall time — median of ${reps} runs, warm FS, Node ${process.version}`);
console.log(`${pad('Target', 34)} ${pad('no-cache ms', 14)} ${pad('cached ms', 12)} speedup`);
for (const row of rows) {
  const speedup = row.cached.median > 0 ? row.noCache.median / row.cached.median : 0;
  console.log(`${pad(row.target, 34)} ${pad(row.noCache.median.toFixed(1), 14)} ${pad(row.cached.median.toFixed(1), 12)} ${speedup.toFixed(2)}x`);
}
if (out) writeFileSync(out, JSON.stringify({ node: process.version, reps, rows }, null, 2));
