# Recall benchmark (mutation injection, multi-corpus)

Generated: 2026-11-26T13:31:17.477Z

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
| `hono` | 224 | 120 | 118 | 98.3% | [94.1%, 99.5%] | 2 |
| `zod` | 249 | 120 | 119 | 99.2% | [95.4%, 99.9%] | 1 |
| `execa` | 240 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `fastify` | 34 | 87 | 87 | 100.0% | [95.8%, 100.0%] | 0 |

Pooled in scope: **444/447 (99.3%)**, Wilson 95% [98.0%, 99.8%].
Out of scope (entry-point injections): 0/20 found (detector correctly ignores these by design).
Charter target `>= 90.0%` on dev: **MET**.
Injections outside the clone-tokenizer stream (scored, not dropped): 7.

Pooled by rule:

| Rule | Scope | Injected | Found | Recall | Wilson 95% | Misses |
|---|---|---:|---:|---:|---:|---:|
| code/duplicate-block | in scope | 76 | 73 | 96.1% | [89.0%, 98.6%] | 3 |
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
| `zod` | 249 | 120 | 118 | 98.3% | [94.1%, 99.5%] | 2 |
| `execa` | 240 | 120 | 120 | 100.0% | [96.9%, 100.0%] | 0 |
| `fastify` | 34 | 87 | 87 | 100.0% | [95.8%, 100.0%] | 0 |

Pooled in scope: **445/447 (99.6%)**, Wilson 95% [98.4%, 99.9%].
Out of scope (entry-point injections): 0/20 found (detector correctly ignores these by design).
Charter target `>= 90.0%` on holdout: **MET**.
Injections outside the clone-tokenizer stream (scored, not dropped): 2.

Pooled by rule:

| Rule | Scope | Injected | Found | Recall | Wilson 95% | Misses |
|---|---|---:|---:|---:|---:|---:|
| code/duplicate-block | in scope | 76 | 74 | 97.4% | [90.9%, 99.3%] | 2 |
| deps/unused-dependency | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| slop/magic-timer | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |
| ts/no-explicit-any | in scope | 60 | 60 | 100.0% | [94.0%, 100.0%] | 0 |
| ts/unused-export | in scope | 71 | 71 | 100.0% | [94.9%, 100.0%] | 0 |
| ts/unused-export [entry-point, out of scope] | out of scope | 20 | 0 | 0.0% | [0.0%, 16.1%] | 20 |
| ts/unused-file | in scope | 80 | 80 | 100.0% | [95.4%, 100.0%] | 0 |

## Misses

### In scope

| Seed | Project | Rule | File | Line | Marker | Reason |
|---|---|---|---|---:|---|---|
| 20261126 | `hono` | code/duplicate-block | `src/types.ts` | 2783 | `__unshitRecallDup_10` | detector bug: clone tokenizer stops before this line (template literal type earlier in file) |
| 20261126 | `hono` | code/duplicate-block | `src/client/types.ts` | 394 | `__unshitRecallDup_14` | detector bug: clone tokenizer stops before this line (template literal type earlier in file) |
| 20261126 | `zod` | code/duplicate-block | `packages/zod/src/v4/mini/schemas.ts` | 2053 | `__unshitRecallDup_8` | detector bug: clone tokenizer stops before this line (template literal type earlier in file) |
| 20261127 | `zod` | code/duplicate-block | `packages/zod/src/v4/mini/schemas.ts` | 2052 | `__unshitRecallDup_16` | detector bug: clone tokenizer stops before this line (template literal type earlier in file) |
| 20261127 | `zod` | code/duplicate-block | `packages/zod/src/v4/classic/schemas.ts` | 2941 | `__unshitRecallDup_19` | detector bug: clone tokenizer stops before this line (template literal type earlier in file) |

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

These injections are scored like any other. Their line is missing from the clone tokenizer output because the tokenizer stops at a template literal type earlier in the file (see Detector bugs found). Non-clone rules still see them.

| Seed | Project | File | Kind | Marker |
|---|---|---|---|---|
| 20261126 | `hono` | `src/jsx/intrinsic-elements.ts` | no-explicit-any | `__unshitRecallAny_13_975` |
| 20261126 | `hono` | `src/jsx/intrinsic-elements.ts` | magic-timer | `__unshitRecallTimer_1` |
| 20261126 | `hono` | `src/types.ts` | duplicate-block | `__unshitRecallDup_10` |
| 20261126 | `hono` | `src/client/types.ts` | duplicate-block | `__unshitRecallDup_14` |
| 20261126 | `zod` | `packages/zod/src/v4/mini/schemas.ts` | magic-timer | `__unshitRecallTimer_16` |
| 20261126 | `zod` | `packages/zod/src/v4/mini/schemas.ts` | duplicate-block | `__unshitRecallDup_8` |
| 20261126 | `execa` | `test-d/methods/bind-override.test-d.ts` | no-explicit-any | `__unshitRecallAny_7_171222` |
| 20261127 | `zod` | `packages/zod/src/v4/mini/schemas.ts` | duplicate-block | `__unshitRecallDup_16` |
| 20261127 | `zod` | `packages/zod/src/v4/classic/schemas.ts` | duplicate-block | `__unshitRecallDup_19` |

## Detector bugs found

- Clone tokenizer (`src/detectors/clones-tokenize.ts`) truncates files that contain a template literal type. `TemplateLiteralType` nodes are not in the skip ranges, so the raw `ts.createScanner` mis-scans the `}` that closes `${...}` and swallows the rest of the file. Reproducer: hono `src/jsx/intrinsic-elements.ts` (928 lines) emits no tokens after line 705 (`image/${string}`); hono `src/types.ts` (2783 lines) stops at line 2733 (`${infer R}?`). Effect: `code/duplicate-block` cannot see clones below that line. Other rules are unaffected (an appended `any` and `setTimeout` at lines 926/927 are both reported). Not fixed in this round.

## Analysis

- Dev pooled recall: 444/447 (99.3%), Wilson 95% [98.0%, 99.8%].
- Holdout pooled recall: 445/447 (99.6%), Wilson 95% [98.4%, 99.9%]. Charter target is >= 90.0%.
- The earlier single-project round measured 111/120 (92.5%) on hono, but 9 of those misses were unused exports injected into entry-point files. That was an injector flaw: the detector deliberately treats STAR-consumed files as public API. Those injections are now excluded from in-scope recall and reported separately.
- Injections are restricted to files unshit scans and, for duplicate blocks, to files the clone tokenizer accepts. Injections the tokenizer cannot see are kept in the denominator, so clone-tokenizer truncation shows up as duplicate-block misses rather than being hidden.
- Per-rule Wilson intervals (roughly 70–80 trials per rule) are wide; the pooled interval is narrower but still conditional on these four corpora, these seeds, and these simple injection shapes. These numbers are a smoke test of the mutation pipeline, not a precise estimate of real-world prevalence.
- Precision, real-world defect prevalence, and the `ts/unused-type-export` rule are outside this benchmark.

## Notes

- Injection shapes are simple and deterministic; they are not a complete model of real defects.
- Results depend on the corpus revisions, seeds, `perRule`, and unshit defaults in the committed dist.
- Full per-injection data, including out-of-scope markers, is in `benchmark/recall/results.json`.
