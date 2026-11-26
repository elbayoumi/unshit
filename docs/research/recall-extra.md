# Recall-extra benchmark (mutation injection)

Generated: 2026-11-26T13:55:10.759Z

## Method

- Corpus projects: `hono`, `zod`, `execa`, `synthetic-react` (copied to temp dirs; corpora never modified).
- Seeds: 20261126, 20261127. 15 positive injections per rule per project per seed; 10 hard-negative near-misses per rule per project per seed.
- For each project+seed, two fresh copies were scanned: one with positive injections (recall) and one with hard negatives (FP sanity). Scans used `node bin/unshit.js scan <dir> --format json --no-cache`.
- Recall = matched injected defects / injected defects. FP rate = matched hard negatives / hard negatives. Wilson 95% confidence intervals reported.
- Matchers are rule-specific and location/marker-based; see `benchmark/recall-extra/lib.mjs`.
- No detectors were tuned to this benchmark. Misses and FPs are reported as measured.
- Injection targeting reuses `listSourceFiles` from `benchmark/recall/lib.mjs` with an extra filter excluding default-config-excluded dirs (`fixtures`, `__fixtures__`, etc.) to avoid scan-invisible artifacts.
- `ts/unused-type-export` injections skip files unshit marks STAR-consumed (entry/public-API), reusing compiled dead-export analysis from `benchmark/recall/entries.mjs`. Out-of-scope injections into those files are reported separately.

## Notes on measurability

- hono: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- zod: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- execa: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- synthetic-react: synthetic React/TSX corpus (generated, deterministic, seeded) — components are below god-file thresholds; god-file positives/negatives injected on top.

## Pooled recall

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| code/high-complexity | 90 | 89 | 98.9% | [94.0%, 99.8%] | 1 |
| deps/unlisted-dependency | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| react/god-file | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 90 | 88 | 97.8% | [92.3%, 99.4%] | 2 |
| ts/no-double-cast | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| ts/unused-type-export | 64 | 63 | 98.4% | [91.7%, 99.7%] | 1 |
| ts/unused-type-export [entry-point, out of scope] | 30 | 0 | 0.0% | [0.0%, 11.4%] | 30 |

## Pooled false-positive sanity

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| code/high-complexity | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| deps/unlisted-dependency | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| react/god-file | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| ts/no-double-cast | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| ts/unused-type-export | 44 | 0 | 0.0% | [0.0%, 8.0%] |

Out of scope (entry-point injections): 0/30 found.

## Recall — hono

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export [entry-point, out of scope] | 10 | 0 | 0.0% | [0.0%, 27.8%] | 10 |

## False-positive sanity — hono

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 20 | 0 | 0.0% | [0.0%, 16.1%] |

## Recall — zod

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 29 | 96.7% | [83.3%, 99.4%] | 1 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 28 | 93.3% | [78.7%, 98.2%] | 2 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 30 | 29 | 96.7% | [83.3%, 99.4%] | 1 |
| ts/unused-type-export [entry-point, out of scope] | 10 | 0 | 0.0% | [0.0%, 27.8%] | 10 |

## False-positive sanity — zod

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 20 | 0 | 0.0% | [0.0%, 16.1%] |

## Recall — execa

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 4 | 4 | 100.0% | [51.0%, 100.0%] | 0 |
| ts/unused-type-export [entry-point, out of scope] | 10 | 0 | 0.0% | [0.0%, 27.8%] | 10 |

## False-positive sanity — execa

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 4 | 0 | 0.0% | [0.0%, 49.0%] |

## Recall — synthetic-react

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| react/god-file | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |

## False-positive sanity — synthetic-react

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| react/god-file | 20 | 0 | 0.0% | [0.0%, 16.1%] |

## Misses (pooled)

| Rule | File | Line | Marker | Reason |
|---|---|---:|---|---|
| code/high-complexity | `packages/integration/fixtures/internal-types/index.ts` | 59 | `__unshitRecallComplex_2_290814` | harness artifact: file is not scanned by default config (excluded dir such as fixtures/) |
| slop/redundant-catch | `packages/integration/fixtures/internal-types/mini.ts` | 35 | `__unshitRecallRedundantCatch_5_458085` | harness artifact: file is not scanned by default config (excluded dir such as fixtures/) |
| slop/redundant-catch | `packages/integration/fixtures/ai-sdk/index.ts` | 19 | `__unshitRecallRedundantCatch_10_926275` | harness artifact: file is not scanned by default config (excluded dir such as fixtures/) |
| ts/unused-type-export | `packages/integration/fixtures/drizzle-zod/index.ts` | 20 | `__unshitRecallUnusedType_12_384540` | harness artifact: file is not scanned by default config (excluded dir such as fixtures/) |
| ts/unused-type-export [entry-point, out of scope] | `src/helper/dev/index.ts` | 80 | `__unshitRecallEntryTypeExport_0_410390` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/middleware/etag/digest.ts` | 96 | `__unshitRecallEntryTypeExport_1_763624` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/middleware/cors/index.ts` | 165 | `__unshitRecallEntryTypeExport_2_46008` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/router.ts` | 105 | `__unshitRecallEntryTypeExport_3_640644` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/router/reg-exp-router/index.ts` | 8 | `__unshitRecallEntryTypeExport_4_240263` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/middleware/method-override/index.ts` | 172 | `__unshitRecallEntryTypeExport_0_104254` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/index.ts` | 54 | `__unshitRecallEntryTypeExport_1_403958` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/adapter/netlify/index.ts` | 12 | `__unshitRecallEntryTypeExport_2_733463` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `src/middleware/compress/index.ts` | 176 | `__unshitRecallEntryTypeExport_3_330459` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `adapters/cloudflare-workers/src/index.ts` | 10 | `__unshitRecallEntryTypeExport_4_448893` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/core/compile.ts` | 2379 | `__unshitRecallEntryTypeExport_0_958891` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v3/helpers/typeAliases.ts` | 3 | `__unshitRecallEntryTypeExport_1_149573` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/mini/index.ts` | 4 | `__unshitRecallEntryTypeExport_2_734550` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/core/memoizer.ts` | 477 | `__unshitRecallEntryTypeExport_3_329697` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/classic/index.ts` | 36 | `__unshitRecallEntryTypeExport_4_401959` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/core/versions.ts` | 6 | `__unshitRecallEntryTypeExport_0_480669` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/classic/iso.ts` | 21 | `__unshitRecallEntryTypeExport_1_320192` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/core/json-schema.ts` | 150 | `__unshitRecallEntryTypeExport_2_756910` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/mini/iso.ts` | 68 | `__unshitRecallEntryTypeExport_3_261973` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `packages/zod/src/v4/mini/index.ts` | 4 | `__unshitRecallEntryTypeExport_4_895513` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/methods/script.test-d.ts` | 66 | `__unshitRecallEntryTypeExport_0_655095` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/return/result-all.test-d.ts` | 202 | `__unshitRecallEntryTypeExport_1_597186` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/stdio/option/generator-string-full.test-d.ts` | 50 | `__unshitRecallEntryTypeExport_2_246525` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/stdio/option/web-transform-invalid.test-d.ts` | 49 | `__unshitRecallEntryTypeExport_3_898611` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/stdio/option/generator-only-preserve.test-d.ts` | 45 | `__unshitRecallEntryTypeExport_4_388073` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/arguments/specific.test-d.ts` | 177 | `__unshitRecallEntryTypeExport_0_905408` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/stdio/option/generator-string.test-d.ts` | 65 | `__unshitRecallEntryTypeExport_1_317613` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/methods/node.test-d.ts` | 66 | `__unshitRecallEntryTypeExport_2_472719` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/stdio/option/array-string.test-d.ts` | 32 | `__unshitRecallEntryTypeExport_3_760476` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |
| ts/unused-type-export [entry-point, out of scope] | `test-d/arguments/encoding-option.test-d.ts` | 50 | `__unshitRecallEntryTypeExport_4_960180` | out of scope: entry-point/public-API file (STAR-consumed); unshit intentionally does not report unused-type-exports here |

## False positives (pooled)

No false positives on hard negatives.

## Detector bugs found

None confirmed by this run. Any misses/FPs above are reported as measured; if a pattern indicates a detector bug, it should be reproduced minimally before changing src.

## Limitations

- Synthetic injections only; they model specific defect shapes, not full real-world variety.
- Recall is measured on injected locations; a detector may report a related but differently-located finding that the matcher does not count.
- `react/god-file` is measured on a deterministic synthetic React/TSX corpus (components below thresholds) because hono/zod/execa contain no TSX/JSX. Labelled synthetic.
- Hard negatives target near-miss shapes and do not prove global FP <= 2%; they are a sanity check.
- Scans run with `--no-cache` on default config. Project-specific config can change thresholds/counts.
- Import-cycle injections create new files and add a reachability import; this is slightly invasive but necessary to keep the shape realistic.
