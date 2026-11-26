// Entry-point handling for the recall benchmark.
//
// The skip decision is NOT re-implemented here. It reuses the same compiled
// modules the CLI uses (dist/src/...): `loadConfig` + `runScan` build the exact
// DetectorContext that `analyze` uses, and `analyze().consumed` tells us which
// files the dead-export detector marks STAR-consumed (entry points and files
// re-exported from them). Injecting a named export into one of those files is
// outside the detector's intended scope, so it must not count against recall.

import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { injectLinePerFile, listSourceFiles } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..');
export const ENTRY_POINT_ROW = 'ts/unused-export [entry-point, out of scope]';

function distUrl(repoRoot, rel) {
  return pathToFileURL(join(repoRoot, 'dist', 'src', rel)).href;
}

async function analysisContext(workDir, repoRoot) {
  const { loadConfig } = await import(distUrl(repoRoot, 'config.js'));
  const { runScan } = await import(distUrl(repoRoot, 'core/scanner.js'));
  const { analyze } = await import(distUrl(repoRoot, 'detectors/dead-exports/analysis.js'));
  const { tokenize, isTsLikeFile } = await import(distUrl(repoRoot, 'detectors/clones-tokenize.js'));
  const config = await loadConfig(workDir);
  const scan = await runScan(workDir, config, [], { noCache: true });
  const ctx = { rootDir: workDir, config, files: scan.files, manifests: scan.manifests };
  const { consumed } = analyze(ctx);
  const starConsumed = new Set();
  for (const [file, names] of consumed) {
    if (names.has('*')) starConsumed.add(file);
  }
  return { config, files: scan.files, starConsumed, tokenize, isTsLikeFile };
}

/**
 * Files whose exports are consumed with STAR by unshit's dead-export analysis.
 * These are entry points / public-API barrels by design.
 */
export async function starConsumedFiles(workDir, repoRoot = DEFAULT_REPO_ROOT) {
  return (await analysisContext(workDir, repoRoot)).starConsumed;
}

/**
 * Injection universe aligned with what unshit actually scans and what each
 * detector actually considers. Using the compiled detector helpers avoids
 * injecting into files that are excluded by config or skipped by a detector.
 */
export async function injectionScope(workDir, repoRoot = DEFAULT_REPO_ROOT) {
  const { config, files, starConsumed, tokenize, isTsLikeFile } = await analysisContext(workDir, repoRoot);
  const scannedFiles = new Set(files.map((f) => f.relPath));
  const cloneFiles = new Set(
    files
      .filter((f) => isTsLikeFile(f) && !/\.(test|spec|d)([-.]|$)/.test(f.relPath))
      .filter((f) => !/(^|\/)(locales?|i18n)\//.test(f.relPath))
      .filter((f) => tokenize(f).length >= config.cloneMinTokens)
      .map((f) => f.relPath),
  );
  return { starConsumed, scannedFiles, cloneFiles };
}

/**
 * Injections whose line is absent from the clone tokenizer's token stream.
 * Diagnostic only: run.mjs still scores them. In round 12 every such case was
 * a valid TS file that the tokenizer truncated at a template literal type
 * (a detector bug), so dropping them would have hidden real misses.
 */
export async function nonTokenizedInjections(workDir, injections, repoRoot = DEFAULT_REPO_ROOT) {
  const { tokenize } = await import(distUrl(repoRoot, 'detectors/clones-tokenize.js'));
  return (() => {
    const cached = new Map();
    const tokenLines = (rel) => {
      if (!cached.has(rel)) {
        const content = readFileSync(join(workDir, rel), 'utf8');
        const tokens = tokenize({ relPath: rel, content, ext: extname(rel) });
        cached.set(rel, new Set(tokens.map((t) => t.line)));
      }
      return cached.get(rel);
    };
    return injections.filter((inj) => {
      if (inj.kind === 'unused-dependency') return false;
      const checks = inj.kind === 'duplicate-block'
        ? [[inj.file, inj.line], [inj.sourceFile, inj.sourceLine]]
        : [[inj.file, inj.line]];
      return checks.some(([file, line]) => !file || !tokenLines(file).has(line));
    });
  })();
}

/** Source files that may receive in-scope unused-export injections. */
export function eligibleUnusedExportFiles(files, starConsumed) {
  return files.filter((f) => !starConsumed.has(f));
}

/** Entry/public-API source files used for the documented out-of-scope row. */
export function entryPointSourceFiles(workDir, starConsumed) {
  return listSourceFiles(workDir).filter((f) => starConsumed.has(f));
}

/**
 * Deliberate out-of-scope injections: unused exports placed in entry-point
 * files. They are measured, but reported in a separate row and excluded from
 * the in-scope recall denominator.
 */
export function injectEntryPointExports(workDir, files, n, rand) {
  return injectLinePerFile(workDir, files, n, rand, /\.(ts|tsx|js|jsx|mjs|cjs)$/, (i, r) => {
    const marker = `__unshitRecallEntryExport_${i}_${Math.floor(r() * 1e6)}`;
    return {
      text: `export function ${marker}(v) { return v + ${i}; }`,
      meta: {
        ruleId: 'ts/unused-export',
        reportRuleId: ENTRY_POINT_ROW,
        marker,
        kind: 'entry-point-unused-export',
        outOfScope: true,
      },
    };
  });
}

export function reasonForOutOfScopeMiss(inj) {
  return inj.outOfScope
    ? 'out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused exports here'
    : 'no matching finding after injection';
}
