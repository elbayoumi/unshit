# G4 Precision Sample (unused-file / unused-export)

Date: 2026-11-26  
Worktree: `/Volumes/data/projects/unshit-wt/r9-fp`  
Corpus (read-only): `/Volumes/data/projects/unshit-bench/corpus/{hono,execa,zod,commander.js,fastify}` (copied to `/tmp/unshit-g4-corpus/*` for scanning)

## Method

- Built current worktree: `pnpm run build`.
- Scanned each corpus copy with `node <worktree>/bin/unshit.js scan <copy> --format json --no-cache`.
- Sampled 45 `ts/unused-file` and 45 `ts/unused-export` findings from the pre-fix scan (stratified across execa/hono/zod, seed 0).
- Hand-verified each sample by inspecting the file, searching for real references (`import`/`require`/`export ... from`/dynamic import/path refs), and checking package.json exports/bin/scripts, tsconfig/config files, and test-runner conventions.
- Classification:
  - **TP**: finding is correct under the rule's intent (file/export truly unused or non-entry).
  - **FP**: finding is incorrect; file/export is used or is a real entry/public API.
  - **Debatable**: technically matches rule text but would be noisy compared to ecosystem expectations; counted separately.

## Pre-fix scan counts (target rules)

| Repo | ts/unused-file | ts/unused-export | ts/unused-type-export |
|---|---:|---:|---:|
| execa | 283 | 8 | 0 |
| hono | 31 | 45 | 62 |
| zod | 117 | 34 | 34 |
| commander.js | 4 | 0 | 0 |
| fastify | 20 | 0 | 0 |

## Sample verdicts

### `ts/unused-file` (45 sampled)

| Repo | Sampled | TP | FP | Debatable | Main FP causes |
|---|---:|---:|---:|---:|---|
| execa | 15 | 0 | 15 | 0 | Test files run by `node --test` glob, `*.test-d.ts` type tests not recognized as entries |
| hono | 15 | 0 | 15 | 0 | Type-only imports ignored by import graph; package exports map to `dist/` while source is in `src/`; runtime/perf entry files not recognized |
| zod | 15 | 4 | 10 | 1 | Bench/play/treeshake files referenced by scripts or configs not recognized (`nub run`, rollup/tsconfig), type-only import edges; some bench files are genuinely unused |
| **Total** | **45** | **4** | **40** | **1** | |

Representative FP examples:

| Repo | File | Verdict | Evidence / cause |
|---|---|---|---|
| execa | `test/pipe/setup.js` | FP | Has `node:test`, executed by `node --test "test/!(fixtures|helpers)/*.js"`; not imported but is a test entry. |
| execa | `test-d/return/result-main.test-d.ts` | FP | `*.test-d.ts` type-test entry; suffix not recognized by entry pattern. |
| hono | `src/utils/types.ts` | FP | Imported by multiple src files as `import type`; runtime import graph skipped type-only imports. |
| hono | `src/helper/accepts/index.ts` | FP | Root package exports `./accepts` -> `./dist/helper/accepts/index.js`; source is `src/helper/accepts/index.ts`, missing `src/` mapping. |
| hono | `src/adapter/vercel/index.ts` | FP | Public package export target resolved through `dist/` to `src/` source; no `src/` mapping. |
| zod | `play.ts` | FP | Referenced by package script `dev:play` (`nub run dev play.ts`); script-runner detection did not recognize `nub`. |
| zod | `packages/bench/index.ts` | FP | Referenced by package script `bench`; script-runner detection did not recognize `nub`. |
| zod | `mm.mjs` | FP | Referenced by rollup config (`.configs/rollup.config.js`, `packages/treeshake/rollup.config.js`). |
| zod | `packages/bench/compile-vs-arktype.ts` | TP | Bench file not imported/referenced by scripts/configs in scanned evidence. |

### `ts/unused-export` (45 sampled)

| Repo | Sampled | TP | FP | Debatable | Main FP/Noise causes |
|---|---:|---:|---:|---:|---|
| execa | 8 | 8 | 0 | 0 | True dead/over-exported test-helper symbols (no cross-file refs). |
| hono | 22 | 10 | 11 | 1 | Public API exports in package entry files were flagged before `src/` export-target mapping; some over-exported symbols are real but low-signal. |
| zod | 15 | 14 | 0 | 1 | Mostly true local-only/zero-ref exports in bench/test-source files. |
| **Total** | **45** | **32** | **11** | **2** | |

Representative examples:

| Repo | File / symbol | Verdict | Evidence / cause |
|---|---|---|---|
| execa | `test/helpers/fs.js#getWriteStream` | TP | No cross-file references found. |
| hono | `src/adapter/aws-lambda/handler.ts#EventV1Processor` | Debatable | No cross-file imports found; exported but only used locally. Rule text is correct, but signal is low for public-adapter code. |
| hono | package-entry exports in adapter/src files | FP | Files became public entry points via package exports once `dist/`->`src/` mapping was fixed; entry files should not report unused exports. |
| hono | `src/jsx/dom/server.ts` default export | TP | No cross-file imports/references found; file is not a package/public entry. |
| zod | `packages/zod/src/v3/tests/language-server.source.ts#instanceOfTest` | TP | No cross-file references found. |
| zod | `packages/bench/lazy-box.ts#lazyWithScopeProp` | TP | Used only locally, not imported cross-file. |

## Root causes fixed

1. **Type-only imports ignored by unused-file reachability.** `buildImportGraph` intentionally skips type-only imports for runtime graph uses. `ts/unused-file` now also treats files referenced by type-only static `import`/`export ... from` as used.
2. **Package export target mapping missed `src/` sources.** Package exports often point at `dist/*` while scanned source lives in `src/*`. Entry target resolution now also tries `src/<stripped-target>`.
3. **Node test script glob entries not recognized.** `node --test "glob"` script args were not parsed as entry globs; script parsing now recognizes `node --test` glob/file args.
4. **Test convention gaps.** Added `*.test-d.*` and `__tests__/` as test entry conventions.
5. **Mixed value+type-only import skipped by graph edge extraction.** `import Foo, { type Bar } from './m'` no longer gets dropped as all-type-only.

## Post-fix scan counts (same command/corpus copies)

| Repo | ts/unused-file | ts/unused-export | ts/unused-type-export |
|---|---:|---:|---:|
| execa | 2 | 0 | 0 |
| hono | 3 | 18 | 36 |
| zod | 111 | 34 | 34 |
| commander.js | 4 | 0 | 0 |
| fastify | 20 | 0 | 0 |

Notes:
- execa: remaining 2 unused-file findings are `test-d/ipc/graceful.ts` and `test-d/return/result-ipc.ts` (non-`.test-d.ts` files in test-d, no imports/references found; likely TP/dead test helpers).
- hono: remaining 3 unused-file findings are `adapters/cloudflare-workers/test/worker.ts`, `perf-measures/type-check/client.ts`, `runtime-tests/workerd/index.ts` (specialized runtime/perf/test entry files; likely FP/entry-like, not fixed generically here).
- zod: remaining unused-file findings are dominated by bench/treeshake/playground files; some are FPs due unrecognized script runners/config conventions, others are plausible TPs. No per-project hacks added.

## Tests / guards added

- Unit tests: `tests/unused-file-precision-r9.test.ts`, `tests/unused-export-precision-r9.test.ts`.
- Frozen hard-negatives: `type-only-import-keeps-file`, `package-exports-src-mapping`, `node-test-script-glob`, `test-d-entry`, `dunder-tests-entry`.
