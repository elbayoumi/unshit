# Recall benchmark (mutation injection, multi-corpus)

Generated: 2026-11-26T13:47:48.633Z

## Method

- Seeds: dev `20261126`, holdout `20261127`. The holdout seed was run once, after the code was frozen; the dev seed was used for iteration.
- Corpora selected with `--projects` (default `hono,zod,execa,fastify`): `/Volumes/data/projects/unshit-bench/corpus/hono`, `/Volumes/data/projects/unshit-bench/corpus/zod`, `/Volumes/data/projects/unshit-bench/corpus/execa`, `/Volumes/data/projects/unshit-bench/corpus/fastify`. Each project is copied to a temp dir; the corpus is never modified. Projects with fewer than `--min-files` (25) eligible source files are skipped and listed below.
- Per project and seed: scan before injection, inject 20 defects for each of six rules, scan again, and count a hit when a finding matches the injected marker/location.
- Recall = found / injected. Per-project, per-rule and pooled Wilson 95% intervals are computed from the summed counts (never by averaging intervals).
- `ts/unused-export` injections skip every file unshit marks STAR-consumed. The skip set comes from the built dist modules used by the CLI (`loadConfig` + `runScan` -> `DetectorContext` -> `analyze().consumed`), not from a re-implemented heuristic.
- A separate out-of-scope row (`ts/unused-export [entry-point, out of scope]`) injects a small number of unused exports deliberately into STAR-consumed files. It is reported but excluded from the in-scope recall denominator, so the scope limit stays visible.
- Injections are restricted to files unshit actually scans, and duplicate blocks only into files the compiled clone tokenizer accepts. Injections whose line is absent from the clone-tokenizer token stream are still scored (never dropped) and listed under "Injections outside the clone-tokenizer stream".
- No detectors were tuned to this benchmark. Misses are reported as measured.

## Results

### dev seed `20261126`

Executed projects: `hono`, `zod`, `execa`, `fastify`.
Excluded (too small): `commander.js` (9 files).

Per-project in-scope recall:

| Project | Source files | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|---:|
| `hono` | 224 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `zod` | 249 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `execa` | 240 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `fastify` | 34 | 87 | 87 | 100.0% | [95.8%, 100.0%] | 0 |

Pooled in scope: **447/447 (100.0%)**, Wilson 95% [99.1%, 100.0%].
Out of scope (entry-point injections): 0/20 found (detector correctly ignores these by design).
Charter target `>= 90.0%` on dev: **MET**.
Injections outside the clone-tokenizer stream (scored, not dropped): 0.

Pooled by rule:

| Rule | Scope | Injected | Found | Recall | Wilson 95% | Misses |
|---|---|---:|---:|---:|---:|---:|
| code/duplicate-block | in scope | 76 | 76 | 100.0% | [95.2%, 100.0%] | 0 |
| deps/unused-dependency | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| slop/magic-timer | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| ts/no-explicit-any | in scope | 60 | 60 | 100.0% | [94.0%, 100.0%] | 0 |
| ts/unused-export | in scope | 71 | 71 | 100.0% | [94.9%, 100.0%] | 0 |
| ts/unused-export [entry-point, out of scope] | out of scope | 20 | 0 | 0.0% | [0.0%, 16.1%] | 20 |
| ts/unused-file | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |

### holdout seed `20261127`

Executed projects: `hono`, `zod`, `execa`, `fastify`.
Excluded (too small): `commander.js` (9 files).

Per-project in-scope recall:

| Project | Source files | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|---:|
| `hono` | 224 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `zod` | 249 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `execa` | 240 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `fastify` | 34 | 87 | 87 | 100.0% | [95.8%, 100.0%] | 0 |

Pooled in scope: **447/447 (100.0%)**, Wilson 95% [99.1%, 100.0%].
Out of scope (entry-point injections): 0/20 found (detector correctly ignores these by design).
Charter target `>= 90.0%` on holdout: **MET**.
Injections outside the clone-tokenizer stream (scored, not dropped): 0.

Pooled by rule:

| Rule | Scope | Injected | Found | Recall | Wilson 95% | Misses |
|---|---|---:|---:|---:|---:|---:|
| code/duplicate-block | in scope | 76 | 76 | 100.0% | [95.2%, 100.0%] | 0 |
| deps/unused-dependency | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| slop/magic-timer | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| ts/no-explicit-any | in scope | 60 | 60 | 100.0% | [94.0%, 100.0%] | 0 |
| ts/unused-export | in scope | 71 | 71 | 100.0% | [94.9%, 100.0%] | 0 |
| ts/unused-export [entry-point, out of scope] | out of scope | 20 | 0 | 0.0% | [0.0%, 16.1%] | 20 |
| ts/unused-file | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |

## Misses

No in-scope misses.

### Out of scope, by design

| Seed | Project | Injected | Found | Interpretation |
|---|---|---:|---:|---|
| 20261126 | `hono` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261126 | `zod` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261126 | `execa` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261126 | `fastify` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261127 | `hono` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261127 | `zod` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261127 | `execa` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |
| 20261127 | `fastify` | 5 | 0 | Entry-point/public-API file; unshit intentionally does not report unused exports here |

## Injections outside the clone-tokenizer stream

None.

## Detector bugs found

None found in this round.

## Analysis

- Dev pooled recall: 447/447 (100.0%), Wilson 95% [99.1%, 100.0%].
- Holdout pooled recall: 447/447 (100.0%), Wilson 95% [99.1%, 100.0%]. Charter target is >= 90.0%.
- The earlier single-project round measured 111/120 (92.5%) on hono, but 9 of those misses were unused exports injected into entry-point files. That was an injector flaw: the detector deliberately treats STAR-consumed files as public API. Those injections are now excluded from in-scope recall and reported separately.
- Injections are restricted to files unshit scans and, for duplicate blocks, to files the clone tokenizer accepts. Injections the tokenizer cannot see are kept in the denominator, so clone-tokenizer truncation shows up as duplicate-block misses rather than being hidden.
- Per-rule Wilson intervals (roughly 70–80 trials per rule) are wide; the pooled interval is narrower but still conditional on these four corpora, these seeds, and these simple injection shapes. These numbers are a smoke test of the mutation pipeline, not a precise estimate of real-world prevalence.
- Precision, real-world defect prevalence, and the `ts/unused-type-export` rule are outside this benchmark.

## Notes

- Injection shapes are simple and deterministic; they are not a complete model of real defects.
- Results depend on the corpus revisions, seeds, `perRule`, and unshit defaults in the committed dist.
- Full per-injection data, including out-of-scope markers, is in `benchmark/recall/results.json`.

## Round 13: template literal type fix, side effects

A truncation check over all 1076 `.ts` files in hono, zod, execa and fastify, comparing the last tokenized line to the last code line, now finds 0 gaps.
Before and after the fix, `code/duplicate-block` findings on the unmodified corpora: hono 23→23, zod 45→61, execa 11→11, fastify 15→15, commander.js 1→1. The 16 new zod findings come from parts of `v4/classic/schemas.ts` and `v4/mini/schemas.ts` that the tokenizer could not see before. They are not checked one by one for FP.
