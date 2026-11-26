# Recall-extra benchmark (mutation injection)

Generated: 2026-11-26T13:19:16.948Z

## Method

- Corpus projects: `hono`, `zod`, `execa` (copied to temp dirs; corpora never modified).
- Seeds: 20261126, 20261127 (dev 20261126, holdout 20261127). 15 positive injections per rule per project per seed; 10 hard-negative near-misses per rule per project per seed.
- For each project+seed, two fresh copies were scanned: one with positive injections (recall) and one with hard negatives (FP sanity). Scans used `node bin/unshit.js scan <dir> --format json --no-cache` with default config.
- Recall = matched injected defects / injected defects. FP rate = matched hard negatives / hard negatives. Wilson 95% confidence intervals reported.
- Matchers are rule-specific and location/marker-based; see `benchmark/recall-extra/lib.mjs`.
- No detectors were tuned to this benchmark. Misses and FPs are reported as measured.
- Injection targeting reuses `listSourceFiles` from `benchmark/recall/lib.mjs` with an extra filter excluding default-config-excluded dirs (`fixtures`, `__fixtures__`, etc.) to avoid scan-invisible artifacts.

## Measurability

- hono: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- zod: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- execa: react/god-file marked not measurable (no .tsx/.jsx files in corpus).
- `react/god-file`: not measured on these corpora (no `.tsx`/`.jsx` files). Injector/matcher/tests exist in `benchmark/recall-extra/lib.mjs` and `tests/recall-extra.test.ts`; run on a React/TSX corpus to measure.

## Pooled recall

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| code/high-complexity | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| deps/unlisted-dependency | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| slop/redundant-catch | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| ts/no-double-cast | 90 | 90 | 100.0% | [95.9%, 100.0%] | 0 |
| ts/unused-type-export | 90 | 41 | 45.6% | [35.7%, 55.8%] | 49 |
| react/god-file | N/A | N/A | N/A | N/A | not measurable on selected corpora |

## Pooled false-positive sanity (hard negatives)

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| code/high-complexity | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| deps/unlisted-dependency | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| slop/redundant-catch | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| ts/no-double-cast | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| ts/unused-type-export | 60 | 0 | 0.0% | [0.0%, 6.0%] |
| react/god-file | N/A | N/A | N/A | N/A (not measurable) |

## Recall — hono

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 30 | 18 | 60.0% | [42.3%, 75.4%] | 12 |
| react/god-file | N/A | N/A | N/A | N/A | not measurable on selected corpora |

## False-positive sanity — hono

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| react/god-file | N/A | N/A | N/A | N/A (not measurable) |

## Recall — zod

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 30 | 23 | 76.7% | [59.1%, 88.2%] | 7 |
| react/god-file | N/A | N/A | N/A | N/A | not measurable on selected corpora |

## False-positive sanity — zod

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| react/god-file | N/A | N/A | N/A | N/A (not measurable) |

## Recall — execa

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| arch/import-cycle | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| code/high-complexity | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| deps/unlisted-dependency | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| slop/redundant-catch | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/no-double-cast | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| ts/unused-type-export | 30 | 0 | 0.0% | [0.0%, 11.4%] | 30 |
| react/god-file | N/A | N/A | N/A | N/A | not measurable on selected corpora |

## False-positive sanity — execa

| Rule | Negatives | False Positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| arch/import-cycle | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| code/high-complexity | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| deps/unlisted-dependency | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| slop/redundant-catch | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/no-double-cast | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| ts/unused-type-export | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| react/god-file | N/A | N/A | N/A | N/A (not measurable) |

## Miss analysis

### ts/unused-type-export (49 misses, 41/90)

- **execa 0/30**: all injected files were under `test-d/` (`*.test-d.ts`). `isRootEntry` in `src/detectors/dead-exports/utils.ts` treats `.(test|spec|test-d|d).[cm]?[jt]sx?$` as entry points; dead-exports analysis marks STAR consumed, so unused-type-export is intentionally not reported. Confirmed by spot-check: injecting `export type Foo` into a `.test-d.ts` file yields no findings.
- **hono 12/30, zod 7/30**: sampled misses (`src/types.ts`, `src/adapter/netlify/mod.ts`, `src/jsx/hooks/index.ts` in hono; `packages/zod/src/v4/core/checks.ts`, `packages/zod/src/v4/classic/schemas.ts`, `scripts/check-versions.ts`, `packages/zod/src/v4/classic/errors.ts` in zod) were all STAR-consumed in dead-exports analysis (`consumed.has("*") === true`) while the injected declaration was present. These files are entry points or consumed through star-export/package-export paths by design.
- **Interpretation**: this is a real recall limitation of `ts/unused-type-export` for exports in STAR-consumed files, not a matcher bug. It is consistent with dead-exports design (avoid false positives on entry/public API surfaces). The injection shape is still valid TypeScript; the detector chooses not to report it in these contexts.

### Other rules

- `ts/no-double-cast`, `slop/redundant-catch`, `code/high-complexity`, `arch/import-cycle`, `deps/unlisted-dependency`: 100% recall on measured injections, 0% FP on hard negatives.

## False positives

No false positives on hard negatives (0/60 per measured rule).

## Detector bugs found

No new detector bug was confirmed. The `ts/unused-type-export` misses were traced to STAR-consumed/entry-point handling in dead-exports analysis. This is a design limitation/recall gap; changing it risks false positives on public API surfaces and should be evaluated separately with precision evidence.

## Limitations

- Synthetic injections only; they model specific defect shapes, not full real-world variety.
- Recall is measured by matcher: a differently-located but related finding may not count. Matchers were kept simple and rule-specific.
- `react/god-file` was not measurable on hono/zod/execa (no TSX/JSX). It remains unmeasured here; do not treat as passing or failing.
- Hard negatives target near-miss shapes and are a sanity check, not proof of global FP <= 2%.
- `ts/unused-type-export` injections can land in STAR-consumed files; those misses are reported honestly and indicate a recall limitation in that context.
- Scans run with `--no-cache` and default config. Project-specific config can change thresholds/results.
- Import-cycle injections create two new files and add a reachability import from an existing file; slightly invasive but keeps files live.
