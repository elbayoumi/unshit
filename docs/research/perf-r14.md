# r14 perf: warm `guard --changed` latency

## Goal

Reduce warm `unshit guard <dir> --changed --base HEAD` latency on a 1000-file synthetic TS project (gate b in `docs/research/roadmap-gates.md`). Target: median < 2s, p95 < 2.5s.

## Environment

- Node: v26.7.0
- OS: darwin arm64
- Date: 2026-11-26
- Command: `node benchmark/changed-latency.mjs --runs 9 --seed 20261129 --out benchmark/changed-latency-results.json`
- Project: 1000-file deterministic TS project from `benchmark/scale-project.mjs`, seed 20261129, git-initialized, one warm full scan, one seeded edit to `src/features/feature00/module0000.ts`, then >= 9 timed `guard --changed --base HEAD` runs. A second untouched batch (no further edit) separates steady-state cache-hit cost.

## Before / After (this machine)

| Case | Min | Median | P95 | Max |
|---|---:|---:|---:|---:|
| Before per-file index (HEAD baseline, after-edit) | 611.9 ms | 620.0 ms | 661.1 ms | 674.1 ms |
| Before per-file index (HEAD baseline, untouched) | 609.9 ms | 626.5 ms | 689.9 ms | 700.0 ms |
| After this fix (after-edit) | 577.1 ms | 586.2 ms | 600.6 ms | 608.3 ms |
| After this fix (untouched) | 577.9 ms | 583.1 ms | 605.2 ms | 615.0 ms |

Target: median < 2000 ms, p95 < 2500 ms. **PASS**.

The historical roadmap-gates measurement on a different machine recorded median 2777.5 ms / p95 6933.1 ms (2026-11-26, r13-roadmap worktree). On this machine the baseline was already under target; the per-file cache index gives a small warm-run improvement while keeping correctness.

## Correctness bug fix

An earlier iteration added a cross-file findings cache keyed by scanned file hashes and manifest paths. That cache was incorrect: cross-file detectors also read manifest contents, tsconfig files, CI workflows, config files, `.husky`, and plugin code, so edits to those inputs could return stale cross-file findings. The cross-file findings cache has been removed. Cross-file detectors run on every scan; the per-file `_index.json` cache remains.

## Profile summary (before change)

CPU profile: `node --cpu-prof --cpu-prof-dir=/tmp <bin> guard <1000-file-project> --changed --base HEAD` (single warm run after one seeded edit, 513 samples).

Top self-time hotspots:

| Self % | Samples | Location |
|---:|---:|---|
| 16.4% | 84 | `dist/src/detectors/clones.js:addTokenWindows` |
| 9.4% | 48 | idle |
| 6.6% | 34 | stat (native) |
| 4.5% | 23 | GC |
| 3.5% | 18 | TS parse |
| 2.7% | 14 | `dist/src/detectors/clones.js:analyzeBucket` |
| 1.8% | 9 | readFileUtf8 (native) |
| 1.8% | 9 | `dist/src/detectors/clones-tokenize.js:visit` |

Clone detection and TypeScript parsing/walker I/O dominate. Clones and walker are in forbidden files for this track; optimizations were limited to allowed cache/scanner paths.

## Changes

- `src/core/cache.ts`: keeps a best-effort `_index.json` manifest for the per-file finding cache. Warm scans load one index file instead of reading one JSON file per content hash; per-hash files are still written for compatibility. `flush()` persists the index. Corrupt, old-version, or other-config indexes are ignored.
- `src/core/scanner.ts`: collects per-file findings through the per-file cache and always runs cross-file detectors on the full workspace. Cross-file findings are not cached because their inputs include manifest contents, tsconfig, CI/config files, hooks, and plugin detector code.

## Correctness proof

`benchmark/changed-equivalence.mjs` compares, for each of the 5 public corpora (hono, zod, execa, fastify, commander.js) and unshit itself:

- (a) full scan findings JSON before vs after this change (sorted, timings stripped)
- (b) guard --changed blocking findings vs full-scan blocking findings restricted to changed files, after 3 seeded edits

Output: `benchmark/changed-equivalence-results.json`. Result: `{"beforeAfterAllEqual":true,"changedGuardAllEqual":true,"allEqual":true}`.

## What remains

- Clone detection (`src/detectors/clones.ts`, `src/detectors/clones-tokenize.ts`) is the top hotspot but forbidden in this track. A content-fingerprint cache or cheaper tokenization would need to live in those files.
- Workspace walking and TS parsing (`src/walker.ts`) are forbidden in this track. An mtime/size fast path that avoids re-reading unchanged file contents would require walker changes or a parallel walker path.
- A safe cross-file cache would need to key every input cross-file detectors read (manifest contents, tsconfig, CI/config files, hooks, plugin code). Until then, cross-file detectors run on every scan.
