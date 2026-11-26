#!/usr/bin/env node
// Hook latency benchmark. Builds nothing; uses the already-built dist/.
// Measures `unshit hook --stdin` wall-clock latency over 40 runs (after 5
// warmups) on a temp git repo carrying a small staged change.
//
// Usage: pnpm build && node benchmark/hook-latency/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname);
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const OUT = join(REPO_ROOT, 'benchmark', 'hook-latency', 'results.json');

const WARMUPS = 5;
const RUNS = 40;
const REL = 'src/index.ts';

function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

// Set up a temp git repo with a small staged change.
const tmp = mkdtempSync(join(tmpdir(), 'unshit-hook-latency-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: tmp });
  execFileSync('git', ['config', 'user.email', 'bench@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'bench'], { cwd: tmp });
  mkdirSync(join(tmp, 'src'), { recursive: true });
  const before = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
  writeFileSync(join(tmp, REL), before);
  execFileSync('git', ['add', '-A'], { cwd: tmp });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: tmp });
  const after = `export function add(a: number, b: number): number {\n  const result: any = a + b;\n  return result;\n}\n`;
  writeFileSync(join(tmp, REL), after);
  execFileSync('git', ['add', REL], { cwd: tmp });

  const payload = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: REL, content: after },
    cwd: tmp,
  });

  function runOnce() {
    const t = performance.now();
    const r = spawnSync(process.execPath, [BIN, 'hook', '--stdin'], {
      input: payload,
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { ms: performance.now() - t, status: r.status };
  }

  // warmups
  for (let i = 0; i < WARMUPS; i++) runOnce();

  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(runOnce());

  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p50 = quantile(ms, 0.5);
  const p95 = quantile(ms, 0.95);
  const min = ms[0];
  const statuses = [...new Set(samples.map((s) => s.status))];

  const report = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runs: RUNS,
    warmups: WARMUPS,
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(ms[ms.length - 1].toFixed(2)),
    statuses,
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(`hook latency (${RUNS} runs after ${WARMUPS} warmups, ${process.version} ${process.platform}/${process.arch})`);
  console.log(`  p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  min=${min.toFixed(1)}ms  (statuses ${statuses.join(',')})`);
  console.log(`  wrote ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
