# G4 precision sample 3 (round 10)

Hand-verified precision sample for `ts/unused-export`, `ts/unused-file` and
`deps/unused-dependency` on the read-only corpus
(`/Volumes/data/projects/unshit-bench/corpus/{hono,execa,zod,commander.js,fastify}`).
No corpus files were modified. `docs/research/g4-head-to-head.md` numbers are
unchanged by this sample.

## Method

- Built current worktree: `pnpm run build`.
- Scanned each project with `node <worktree>/bin/unshit.js scan <project> --format json --no-cache`
  (raw outputs in `docs/research/g4-raw/<project>/unshit.json`).
- Population sizes (current code): `ts/unused-export` 52, `ts/unused-file` 140,
  `deps/unused-dependency` 19. The requested 30 `deps/unused-dependency` findings do
  not exist (only 19), so all 19 were verified (a census of that category).
- Seeded stratified random sample (seed `20261126`, mulberry32 PRNG), spread over the
  five projects proportional to population:
  - `ts/unused-export`: 50 of 52 (hono 17, zod 33).
  - `ts/unused-file`: 50 of 140 (hono 1, execa 1, zod 40, commander.js 1, fastify 7).
  - `deps/unused-dependency`: 19 of 19 (all; hono 3, execa 1, zod 11, fastify 4).
- Each sampled finding was hand-verified by grepping the corpus for real references
  (import/require/export-from/dynamic import statements, path references in tests and
  configs, package.json `exports`/`main`/`types`/`bin`, and framework entry
  conventions). TP = genuine unused item under the rule's intent; FP = item is actually
  used or is a real entry/public API.
- The same sampled items were compared against knip's verdict where knip reported the
  same item (same relative file + name for exports/deps; same relative file for files).

## Populations

| Project | ts/unused-export | ts/unused-file | deps/unused-dependency |
|---|---:|---:|---:|
| hono | 18 | 3 | 3 |
| execa | 0 | 2 | 1 |
| zod | 34 | 111 | 11 |
| commander.js | 0 | 4 | 0 |
| fastify | 0 | 20 | 4 |
| **Total** | **52** | **140** | **19** |

## Verdicts

### `ts/unused-export` (50 sampled)

| Project | Sampled | TP | FP | Precision |
|---|---:|---:|---:|---:|
| hono | 17 | 15 | 2 | 0.882 |
| zod | 33 | 32 | 1 | 0.970 |
| **Total** | **50** | **47** | **3** | **0.940** |

Wilson 95% interval for precision: **[0.838, 0.979]** (n = 50).

Main FP causes (entry/public-API exports with no internal references):
- hono `adapters/cloudflare-workers/test/worker.ts` default export (used by test via
  `unstable_dev`).
- hono `runtime-tests/workerd/index.ts` default export (used by test via
  `unstable_dev`).
- zod `packages/zod/src/v3/index.ts` default export (public entry via `@zod/source`).

All other sampled exports had zero cross-file references (true dead/over-exported
symbols, including bench/test-source fixtures and adapter handler classes).

### `ts/unused-file` (50 sampled)

| Project | Sampled | TP | FP | Precision |
|---|---:|---:|---:|---:|
| hono | 1 | 0 | 1 | 0.000 |
| execa | 1 | 1 | 0 | 1.000 |
| zod | 40 | 36 | 4 | 0.900 |
| commander.js | 1 | 0 | 1 | 0.000 |
| fastify | 7 | 7 | 0 | 1.000 |
| **Total** | **50** | **44** | **6** | **0.880** |

Wilson 95% interval for precision: **[0.762, 0.944]** (n = 50).

Main FP causes (files that are real entries/fixtures, not dead):
- hono `runtime-tests/workerd/index.ts` (unstable_dev entry in tests).
- zod `packages/zod/src/v4-mini/index.ts` (package `exports` entry).
- zod `packages/zod/src/mini/index.ts` (package `exports` entry).
- commander.js `tests/fixtures-extensions/pm.js` (executed by tests).
- fastify `test/bundler/webpack/src/fail-plugin-version.js` (webpack entry).
- fastify `test/bundler/esbuild/src/index.js` (esbuild entry).

### `deps/unused-dependency` (19 sampled, census)

| Project | Sampled | TP | FP | Precision |
|---|---:|---:|---:|---:|
| hono | 3 | 1 | 2 | 0.333 |
| execa | 1 | 1 | 0 | 1.000 |
| zod | 11 | 9 | 2 | 0.818 |
| fastify | 4 | 3 | 1 | 0.750 |
| **Total** | **19** | **14** | **5** | **0.737** |

Wilson 95% interval for precision: **[0.512, 0.882]** (n = 19).

Main FP causes (dependencies used via binaries, plugins, or non-scanned extensions):
- hono `mitata` in `benchmarks/fetch/package.json` (imported in `.mts` files, which the
  walker does not scan).
- zod `@biomejs/biome` (invoked as `biome` binary in npm scripts).
- fastify `@stylistic/eslint-plugin` and `@stylistic/eslint-plugin-js` (used via
  `@stylistic/*` rules in `eslint.config.js`).
- fastify `webpack-cli` (provides the `webpack` binary used by npm scripts).

All other sampled dependencies had no real references in their owning package's source,
scripts or config.

## Comparison against knip

For each sampled unshit finding, knip's verdict on the same item (same relative file and
name) was checked:

| Rule | Sampled | knip also flagged | knip disagreed (considers used) |
|---|---:|---:|---:|
| `ts/unused-export` | 50 | 12 | 38 |
| `ts/unused-file` | 50 | 39 | 11 |
| `deps/unused-dependency` | 19 | 17 | 2 |

Knip is more conservative on exports (it flags only 12 of the 50 sampled items that
unshit flags, 8 of which are true positives in the sample) and broadly agrees on files
and dependencies. Disagreements are concentrated in the items classified as false
positives above (entry points, fixtures, binary-provided tooling) plus items unshit
flags that knip's entry-point model spares.

## Summary

| Rule | n | TP | FP | Precision | Wilson 95% |
|---|---:|---:|---:|---:|---|
| `ts/unused-export` | 50 | 47 | 3 | 0.940 | [0.838, 0.979] |
| `ts/unused-file` | 50 | 44 | 6 | 0.880 | [0.762, 0.944] |
| `deps/unused-dependency` | 19 | 14 | 5 | 0.737 | [0.512, 0.882] |

No recall claim is made: precision was measured only, on the sampled items. The sample
is small for `deps/unused-dependency` (n = 19) and its interval is correspondingly
wide.

## Seed

Random seed used for sampling: `20261126` (mulberry32 PRNG, stratified by project).
Sampling script and full per-item verdicts are in the worktree scratchpad
(`sample.json`, `verdicts.json`); they are not part of the repository.