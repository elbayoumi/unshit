#!/usr/bin/env node
// Hook latency benchmark (cold cache / --no-cache).
// Measures `unshit hook --stdin` wall-clock latency over N runs on a real repo file.
//
// The hook is invoked as a Write payload for src/core/scanner.ts (same style as
// /tmp/bench-hook.js warm benchmark). Two scenarios, each >=30 runs:
//   - cold-cache: .unshit/cache is deleted before every run, so the hook sees a
//     cache miss and recomputes (then writes cache). This is the "first hook
//     invocation after the cache dir is deleted" case.
//   - no-cache:   --no-cache is passed, so cache reads/writes are disabled.
//
// Usage:
//   pnpm run build
//   node benchmark/hook-latency.mjs [--runs 35] [--file src/core/scanner.ts] [--json]
//
// Output reports p50/p95/min/max in milliseconds. Exit 0 always (measurement only).
// Measured numbers are environment-dependent; record machine/Node in any report.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const runs = Math.max(30, Number(opt('--runs', '35')));
const target = opt('--file', 'src/core/scanner.ts');
const jsonOut = args.includes('--json');
const root = resolve(new URL('..', import.meta.url).pathname);
const bin = resolve(root, 'bin/unshit.js');
const content = readFileSync(resolve(root, target), 'utf8');
const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target, content } });

function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  return {
    runs: s.length,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    min: s[0],
    max: s[s.length - 1],
  };
}

function runOnce(extra) {
  const t = performance.now();
  const r = spawnSync(process.execPath, [bin, 'hook', '--stdin', ...extra], {
    input: payload,
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const ms = performance.now() - t;
  return { ms, status: r.status };
}

function measure(name, { extra = [], clearCache = false }) {
  // warmup: one throwaway run to avoid first-process one-offs dominating
  rmSync(resolve(root, '.unshit/cache'), { recursive: true, force: true });
  runOnce(extra);

  const samples = [];
  for (let i = 0; i < runs; i++) {
    if (clearCache) rmSync(resolve(root, '.unshit/cache'), { recursive: true, force: true });
    samples.push(runOnce(extra));
  }
  const statuses = [...new Set(samples.map((s) => s.status))];
  const ms = samples.map((s) => s.ms);
  return { name, ...stats(ms), statuses };
}

mkdirSync(resolve(root, '.unshit'), { recursive: true });
const cold = measure('cold-cache (cache dir deleted before each run)', { clearCache: true });
const nocache = measure('--no-cache', { extra: ['--no-cache'] });

const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  target,
  runs,
  scenarios: [cold, nocache],
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`hook latency (${target}, ${runs} runs, ${report.node} ${report.platform}/${report.arch})`);
  for (const s of report.scenarios) {
    const fmt = (n) => n.toFixed(1).padStart(7);
    console.log(`  ${s.name}`);
    console.log(`    p50=${fmt(s.p50)}ms  p95=${fmt(s.p95)}ms  min=${fmt(s.min)}ms  max=${fmt(s.max)}ms  exit=${s.statuses.join(',')}`);
  }
}
