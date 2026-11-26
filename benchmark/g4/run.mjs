#!/usr/bin/env node
// Head-to-head benchmark: unshit vs knip, jscpd, dependency-cruiser, oxlint, biome.
// Usage:
//   node benchmark/g4/run.mjs [project ...] [--tools <dir>] [--corpus <dir>] [--out file] [--raw dir]
// Defaults target the five approved corpus projects and the approved tools directory.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { countUnshit, countKnip, countJscpd, countDepcruise, countOxlint, countBiome } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const args = process.argv.slice(2);
function opt(name) {
  const i = args.indexOf(name);
  if (i >= 0) {
    const v = args.splice(i, 2)[1];
    return v;
  }
  return undefined;
}
const toolsDir = resolve(opt('--tools') ?? process.env.UNSHIT_BENCH_TOOLS ?? '/Volumes/data/projects/unshit-bench/tools');
const corpusDir = resolve(opt('--corpus') ?? process.env.UNSHIT_BENCH_CORPUS ?? '/Volumes/data/projects/unshit-bench/corpus');
const outFile = resolve(opt('--out') ?? join(HERE, 'results.json'));
const rawRoot = resolve(opt('--raw') ?? join(REPO_ROOT, 'docs', 'research', 'g4-raw'));
const projects = args.length ? args.map((a) => resolve(a)) : ['hono', 'execa', 'zod', 'commander.js', 'fastify'].map((n) => join(corpusDir, n));

const TOOLS_BIN = join(toolsDir, 'node_modules', '.bin');
const UNSHIT_BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DEPCRUISE_CONFIG = join(toolsDir, 'node_modules', 'dependency-cruiser', 'configs', 'recommended.cjs');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function runOnce(cmd, cmdArgs, cwd, stdoutPath, stderrPath) {
  const fd = openSync(stdoutPath, 'w');
  const t0 = performance.now();
  let status = 0;
  let stderr = '';
  try {
    execFileSync(cmd, cmdArgs, { cwd, stdio: ['ignore', fd, 'pipe'] });
  } catch (error) {
    status = typeof error.status === 'number' ? error.status : 1;
    stderr = error.stderr ? error.stderr.toString() : '';
  }
  const ms = performance.now() - t0;
  closeSync(fd);
  if (stderrPath) writeFileSync(stderrPath, stderr);
  const stdout = readFileSync(stdoutPath, 'utf8');
  return { ms, status, stdout, stderr };
}

function runRepeated(runFn, times = 3) {
  const runs = [];
  let last = null;
  for (let i = 0; i < times; i++) {
    last = runFn();
    runs.push(last.ms);
  }
  return { last, runs };
}

function gitSha(projectPath) {
  try {
    return execFileSync('git', ['-C', projectPath, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

mkdirSync(rawRoot, { recursive: true });

const results = [];
for (const projectPath of projects) {
  const projectName = basename(projectPath);
  const projectRawDir = join(rawRoot, projectName.replace(/[^a-z0-9._-]/gi, '_'));
  mkdirSync(projectRawDir, { recursive: true });
  const sha = gitSha(projectPath);
  console.error(`\n=== ${projectName} (${sha}) ===`);

  const entry = {
    project: projectName,
    path: projectPath,
    sha,
    tools: {},
    overlap: {},
  };

  // unshit
  {
    const rawPath = join(projectRawDir, 'unshit.json');
    const stderrPath = join(projectRawDir, 'unshit.stderr.txt');
    const runner = () => runOnce('node', [UNSHIT_BIN, 'scan', projectPath, '--format', 'json'], projectPath, rawPath, stderrPath);
    const { last, runs } = runRepeated(runner, 3);
    const json = safeJsonParse(last.stdout);
    const findings = (json && Array.isArray(json.findings)) ? json.findings : [];
    const counts = countUnshit(findings);
    entry.tools.unshit = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'unshit.json',
      ...counts,
    };
    console.error(`unshit: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, findings ${counts.total}`);
  }

  // knip
  {
    const rawPath = join(projectRawDir, 'knip.json');
    const stderrPath = join(projectRawDir, 'knip.stderr.txt');
    const runner = () => runOnce(join(TOOLS_BIN, 'knip'), ['--reporter', 'json', '--no-progress'], projectPath, rawPath, stderrPath);
    const { last, runs } = runRepeated(runner, 3);
    const json = safeJsonParse(last.stdout);
    const counts = countKnip(json);
    entry.tools.knip = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'knip.json',
      ...counts,
    };
    if (last.stderr.trim()) entry.tools.knip.stderrPreview = last.stderr.trim().slice(0, 500);
    console.error(`knip: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, findings ${counts.total}`);
  }

  // jscpd
  {
    const reportDir = join(projectRawDir, 'jscpd');
    mkdirSync(reportDir, { recursive: true });
    const rawPath = join(projectRawDir, 'jscpd.stdout.txt');
    const stderrPath = join(projectRawDir, 'jscpd.stderr.txt');
    const reportPath = join(reportDir, 'jscpd-report.json');
    const runner = () => {
      // clean report file from a previous run
      if (existsSync(reportPath)) rmSync(reportPath, { force: true });
      return runOnce(join(TOOLS_BIN, 'jscpd'), ['.', '--reporters', 'json', '--output', reportDir, '--silent', '--min-tokens', '80', '--format', 'typescript,tsx,javascript,jsx,css,scss,rust,python,dart'], projectPath, rawPath, stderrPath);
    };
    const { last, runs } = runRepeated(runner, 3);
    let json = null;
    if (existsSync(reportPath)) {
      const reportText = readFileSync(reportPath, 'utf8');
      json = JSON.parse(reportText);
    }
    const counts = countJscpd(json);
    // copy report to a stable raw file name
    const stableReport = join(projectRawDir, 'jscpd-report.json');
    if (existsSync(reportPath)) copyFileSync(reportPath, stableReport);
    entry.tools.jscpd = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'jscpd-report.json',
      stdoutFile: 'jscpd.stdout.txt',
      ...counts,
    };
    console.error(`jscpd: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, clones ${counts.clones}`);
  }

  // dependency-cruiser
  {
    const rawPath = join(projectRawDir, 'depcruise.json');
    const stderrPath = join(projectRawDir, 'depcruise.stderr.txt');
    const runner = () => runOnce(join(TOOLS_BIN, 'depcruise'), ['.', '-c', DEPCRUISE_CONFIG, '--output-type', 'json'], projectPath, rawPath, stderrPath);
    const { last, runs } = runRepeated(runner, 3);
    const json = safeJsonParse(last.stdout);
    const counts = countDepcruise(json);
    entry.tools.depcruise = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'depcruise.json',
      ...counts,
    };
    console.error(`depcruise: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, violations ${counts.total} (cycles ${counts.importCycles}, orphans ${counts.orphans})`);
  }

  // oxlint
  {
    const rawPath = join(projectRawDir, 'oxlint.json');
    const stderrPath = join(projectRawDir, 'oxlint.stderr.txt');
    const runner = () => runOnce(join(TOOLS_BIN, 'oxlint'), ['--format', 'json', '.'], projectPath, rawPath, stderrPath);
    const { last, runs } = runRepeated(runner, 3);
    const json = safeJsonParse(last.stdout);
    const counts = countOxlint(json);
    entry.tools.oxlint = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'oxlint.json',
      ...counts,
    };
    console.error(`oxlint: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, diagnostics ${counts.total}`);
  }

  // biome
  {
    const rawPath = join(projectRawDir, 'biome.json');
    const stderrPath = join(projectRawDir, 'biome.stderr.txt');
    const runner = () => runOnce(join(TOOLS_BIN, 'biome'), ['lint', '.', '--reporter=json'], projectPath, rawPath, stderrPath);
    const { last, runs } = runRepeated(runner, 3);
    const json = safeJsonParse(last.stdout);
    const counts = countBiome(json);
    entry.tools.biome = {
      ms: median(runs),
      runs,
      exitCode: last.status,
      rawFile: 'biome.json',
      ...counts,
    };
    console.error(`biome: ${runs.map((x) => x.toFixed(0)).join('/')} ms (median ${median(runs).toFixed(0)}), exit ${last.status}, diagnostics ${counts.total}`);
  }

  // overlap summary
  const u = entry.tools.unshit;
  const k = entry.tools.knip;
  entry.overlap = {
    unusedExports: { unshit: u.unusedExports, knip: k.unusedExports },
    unusedFiles: { unshit: u.unusedFiles, knip: k.unusedFiles },
    unusedDependencies: { unshit: u.unusedDependencies, knip: k.unusedDependencies },
    unlistedDependencies: { unshit: u.unlistedDependencies, knip: k.unlisted },
    duplicateCode: { unshit: u.duplicateBlocks, jscpd: entry.tools.jscpd.clones },
    importCycles: { unshit: u.importCycles, depcruise: entry.tools.depcruise.importCycles },
  };

  results.push(entry);
}

writeFileSync(outFile, JSON.stringify(results, null, 2));
console.error(`\nWrote ${outFile}`);
console.log(JSON.stringify(results.map((r) => ({
  project: r.project,
  sha: r.sha,
  unshit: { ms: Math.round(r.tools.unshit.ms), findings: r.tools.unshit.total },
  knip: { ms: Math.round(r.tools.knip.ms), findings: r.tools.knip.total },
  jscpd: { ms: Math.round(r.tools.jscpd.ms), clones: r.tools.jscpd.clones },
  depcruise: { ms: Math.round(r.tools.depcruise.ms), violations: r.tools.depcruise.total, cycles: r.tools.depcruise.importCycles },
  oxlint: { ms: Math.round(r.tools.oxlint.ms), diagnostics: r.tools.oxlint.total },
  biome: { ms: Math.round(r.tools.biome.ms), diagnostics: r.tools.biome.total },
  overlap: r.overlap,
})), null, 2));
