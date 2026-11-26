# Recall benchmark (mutation injection)

Generated: 2026-11-26T12:37:00.835Z

## Method

- Corpus project: `/Volumes/data/projects/unshit-bench/corpus/hono` (copied to a temp dir; corpus never modified).
- Seeded PRNG: mulberry32 seed `20261126`, `20` injections per rule.
- For each rule, inject known defects into the copied project, scan before/after with `node bin/unshit.js scan <dir> --format json --no-cache`, and count an injection as found when a post-scan finding matches the injected rule and location/marker.
- Recall = found / injected. Wilson 95% confidence interval reported per rule.
- No detectors were tuned to this benchmark. Misses are documented; real detector bugs in editable files should be fixed with tests, otherwise documented.
- Injector avoids test dirs, benchmark/perf-measure/docs dirs, and *.config.* files to reduce injector artifacts. It does not exclude entry-point files.

## Results

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| code/duplicate-block | 20 | 20 | 100.0% | [83.9%, 100.0%] | 0 |
| deps/unused-dependency | 20 | 20 | 100.0% | [83.9%, 100.0%] | 0 |
| slop/magic-timer | 20 | 20 | 100.0% | [83.9%, 100.0%] | 0 |
| ts/no-explicit-any | 20 | 20 | 100.0% | [83.9%, 100.0%] | 0 |
| ts/unused-export | 20 | 11 | 55.0% | [34.2%, 74.2%] | 9 |
| ts/unused-file | 20 | 20 | 100.0% | [83.9%, 100.0%] | 0 |

Overall: 111/120 (92.5%) Wilson 95% [86.4%, 96.0%].

## Misses

| Rule | File | Line | Marker | Reason |
|---|---|---:|---|---|
| ts/unused-export | `src/router.ts` | 104 | `__unshitRecallUnusedExport_5_480024` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/middleware/bearer-auth/index.ts` | 235 | `__unshitRecallUnusedExport_6_9290` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/middleware/timeout/index.ts` | 59 | `__unshitRecallUnusedExport_11_224641` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/http-exception.ts` | 79 | `__unshitRecallUnusedExport_12_808353` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `adapters/service-worker/src/index.ts` | 37 | `__unshitRecallUnusedExport_13_305112` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/middleware/method-override/index.ts` | 172 | `__unshitRecallUnusedExport_16_718645` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/jsx/dom/client.ts` | 90 | `__unshitRecallUnusedExport_17_643118` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/middleware/jsx-renderer/index.ts` | 164 | `__unshitRecallUnusedExport_18_621808` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |
| ts/unused-export | `src/middleware/body-limit/index.ts` | 108 | `__unshitRecallUnusedExport_19_489305` | entry-point file: dead-export analyzer marks STAR consumed by design; export not reported as unused |

## Analysis

- **ts/unused-export (55.0%, 11/20)**: All 9 misses are exports injected into files the dead-export analyzer treats as entry points (`STAR` consumed). By design, unshit does not report unused exports in entry-point/public-API files. This is a scope limitation of the detector model, not a missed detection in the detector's intended scope. The measurement is honest: if you inject an unused export into an entry-point file, unshit will not flag it.
- **deps/unused-dependency, ts/unused-file, ts/no-explicit-any, slop/magic-timer, code/duplicate-block**: 20/20 on this corpus and injection shape.
- After an initial run exposed injector artifacts (test dirs and config/bench dirs), the injector was tightened to avoid those locations; the reported numbers are from the tightened run.

## Notes

- This benchmark measures recall only on synthetic injected defects; it does not measure precision or real-world prevalence.
- Injection shapes are simple and deterministic. They are not a complete model of real defects.
- Results depend on the selected corpus project, seed, and unshit config/defaults.
- The `ts/unused-export` misses are documented as detector-scope behavior. No detector was tuned to this benchmark.
