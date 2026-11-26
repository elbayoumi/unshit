// Entry-point handling for the recall-extra benchmark.
//
// Reuses the same compiled dead-export analysis as benchmark/recall/entries.mjs.
// The skip decision is NOT re-implemented here.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listSourceFiles } from '../recall/lib.mjs';
import { injectEntryPointTypeExports as injectEntryPointTypeExportsImpl } from './inject.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..');
export const ENTRY_POINT_ROW = 'ts/unused-export [entry-point, out of scope]';
export const ENTRY_TYPE_EXPORT_ROW = 'ts/unused-type-export [entry-point, out of scope]';

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

export async function starConsumedFiles(workDir, repoRoot = DEFAULT_REPO_ROOT) {
  return (await analysisContext(workDir, repoRoot)).starConsumed;
}

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

export function eligibleUnusedExportFiles(files, starConsumed) {
  return files.filter((f) => !starConsumed.has(f));
}

export function entryPointSourceFiles(workDir, starConsumed) {
  return listSourceFiles(workDir).filter((f) => starConsumed.has(f));
}

export function injectEntryPointTypeExports(work, files, n, rand) {
  return injectEntryPointTypeExportsImpl(work, files, n, rand);
}

export function reasonForOutOfScopeMiss(inj) {
  return inj.outOfScope
    ? 'out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here'
    : 'no matching finding after injection';
}
