// Entry point for the polyglot recall benchmark.
//
//   node benchmark/polyglot/generate.mjs   # (optional) write the dev base
//   pnpm build && node benchmark/polyglot/run.mjs
//
// The base project is synthetic and deterministic: `generateBase(seed)` returns
// the same file map for the same seed, for both the dev (20261126) and holdout
// (20261127) seeds.

import { mulberry32 } from './lib.mjs';
import { rustFiles } from './corpus-rust.mjs';
import { pythonFiles } from './corpus-python.mjs';
import { dartFiles } from './corpus-dart.mjs';
import { cssFiles } from './corpus-css.mjs';
import { injectPositives } from './inject.mjs';
import { injectNegatives } from './negatives.mjs';

export { injectPositives, injectNegatives };
export { writeProject, RULES, RULE_LABELS } from './lib.mjs';

/**
 * Generates the clean synthetic base for a seed.
 * Returns `{ seed, files: Map<relPath, content>, cssSelectors: Map<relPath, selectors> }`.
 */
export function generateBase(seed) {
  const rng = mulberry32(seed >>> 0);
  const files = new Map();
  const cssSelectors = new Map();
  rustFiles(rng, files);
  pythonFiles(rng, files);
  dartFiles(rng, files);
  cssFiles(rng, files, cssSelectors);
  return { seed, files, cssSelectors };
}

// `node benchmark/polyglot/generate.mjs` writes the dev base to a temp dir so
// the corpus can be inspected by hand without running the benchmark.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeProject } = await import('./lib.mjs');
  const base = generateBase(20261126);
  const dir = mkdtempSync(join(tmpdir(), 'unshit-polyglot-base-'));
  await writeProject(dir, base.files);
  console.log(`wrote ${base.files.size} files to ${dir}`);
}
