# Precision audit (real-world corpora)

Generated: 2026-11-26T13:58:55.618Z

## Method

- Corpora (public, read-only copies): `hono`, `zod`, `execa`, `fastify`, `commander.js` from `/Volumes/data/projects/unshit-bench/corpus`. Each corpus was copied to a temp dir and scanned with `node bin/unshit.js scan <dir> --format json --no-cache` using default config. The corpora were never modified.
- Sampling: seeded stratified sample, seed `20261128`, up to `15` findings per rule per corpus (all findings if fewer). Stratification key: `(corpus, ruleId)`. Within each stratum findings were shuffled with a deterministic PRNG seeded by `seed ^ hash(corpus\0ruleId)` and the first N selected, then sorted by file/line for stable output.
- Sample size: 395 findings sampled from 2257 total findings across 5 corpora.
- Labeling: every sampled finding was labeled by reading the actual corpus code around the reported location and, for dead-code rules, grepping for cross-file references/imports. Labels: `TP` (true positive), `FP` (false positive), `UNSURE` (could not confirm). A finding is `FP` only when it is wrong per the rule's own documented meaning, not merely inconvenient or noisy.
- Precision: `TP / (TP + FP)`. `UNSURE` is excluded from the denominator but counted and listed. Wilson 95% intervals are computed from summed counts (not by averaging intervals).
- This audit is a real-world precision sample, not a recall measurement. It does not measure how many real defects unshit misses.

## Results

Pooled precision: **394/395 (99.7%)**, Wilson 95% [98.6%, 100.0%]. Counts: TP=394, FP=1, UNSURE=0, sampled=395.

### Per rule

| Rule | TP | FP | Unsure | Denom (TP+FP) | Precision | Wilson 95% |
|---|---:|---:|---:|---:|---:|---:|
| `arch/import-cycle` | 6 | 0 | 0 | 6 | 100.0% | [61.0%, 100.0%] |
| `code/duplicate-block` | 57 | 0 | 0 | 57 | 100.0% | [93.7%, 100.0%] |
| `code/high-complexity` | 44 | 0 | 0 | 44 | 100.0% | [92.0%, 100.0%] |
| `deps/unlisted-dependency` | 1 | 0 | 0 | 1 | 100.0% | [20.7%, 100.0%] |
| `deps/unused-dependency` | 19 | 0 | 0 | 19 | 100.0% | [83.2%, 100.0%] |
| `react/god-file` | 50 | 0 | 0 | 50 | 100.0% | [92.9%, 100.0%] |
| `slop/magic-timer` | 2 | 1 | 0 | 3 | 66.7% | [20.8%, 93.9%] |
| `slop/redundant-catch` | 39 | 0 | 0 | 39 | 100.0% | [91.0%, 100.0%] |
| `ts/no-double-cast` | 31 | 0 | 0 | 31 | 100.0% | [89.0%, 100.0%] |
| `ts/no-explicit-any` | 46 | 0 | 0 | 46 | 100.0% | [92.3%, 100.0%] |
| `ts/unused-export` | 30 | 0 | 0 | 30 | 100.0% | [88.6%, 100.0%] |
| `ts/unused-file` | 39 | 0 | 0 | 39 | 100.0% | [91.0%, 100.0%] |
| `ts/unused-type-export` | 30 | 0 | 0 | 30 | 100.0% | [88.6%, 100.0%] |

### Per corpus (informational)

| Corpus | TP | FP | Unsure | Denom (TP+FP) | Precision | Wilson 95% |
|---|---:|---:|---:|---:|---:|---:|
| `commander.js` | 15 | 0 | 0 | 15 | 100.0% | [79.6%, 100.0%] |
| `execa` | 34 | 1 | 0 | 35 | 97.1% | [85.5%, 99.5%] |
| `fastify` | 71 | 0 | 0 | 71 | 100.0% | [94.9%, 100.0%] |
| `hono` | 125 | 0 | 0 | 125 | 100.0% | [97.0%, 100.0%] |
| `zod` | 149 | 0 | 0 | 149 | 100.0% | [97.5%, 100.0%] |

## False positives

| Rule | Corpus | File:Line | Message | Why FP |
|---|---|---|---|---|
| `slop/magic-timer` | `execa` | `test/io/max-buffer.js:25` | Magic timer delay (5000ms) in setTimeout; extract a named constant with rationale. | Reported in a test file (test/io/max-buffer.js) that the detector intended to skip; isTestFile misses leading test/ paths. |

## Unsure

No UNSURE labels.

## Detector bugs found

The following FP classes were confirmed by reading the detector implementation and the reported code. No detector source was changed in this audit; reproducer snippets are included for triage.

### `slop/magic-timer` — `isTestFile` misses `test/...` paths at repo root

- **Rule meaning**: flag raw numeric delays in `setTimeout`/`setInterval` outside test files. The detector intentionally skips test files via `isTestFile` in `src/detectors/ts-ast.ts`.
- **Observed FP**: `execa` `test/io/max-buffer.js:25` reports a 5000ms `setTimeout` inside a test helper. The file is under `test/` at the corpus root.
- **Root cause**: `isTestFile` uses `/\.(test|spec)\.|__tests__|\/tests?\//i`. The pattern `\/tests?\//` requires a leading `/`, so `test/io/max-buffer.js` (no leading slash) is not classified as a test file.
- **Minimal reproducer**:

```js
// test/io/example.js (path starts at repo root with "test/")
const cleanup = setTimeout(() => {
  subprocess.kill('SIGKILL');
}, 5000);
```

Expected: no `slop/magic-timer` finding because the file is under `test/`. Actual: finding reported because `isTestFile("test/io/example.js")` returns false.

**Status: fixed** after the audit. `isTestFile` now matches `(^|/)tests?/`; `tests/test-path-scope-r13.test.ts` covers this reproducer. The labels above describe the code as audited, before the fix.

## Limitations

- This is a stratified sample, not an exhaustive manual audit. Per-rule Wilson intervals are wide for rules with few sampled findings; pooled precision is more stable but still conditional on these five corpora and default config.
- Labeling was done by code reading and grep-based usage checks. Dynamic references, reflection, external consumers outside the scanned corpus, and build-tool conventions can make dead-code judgments ambiguous; such cases were labeled carefully but are inherently harder to prove.
- `deps/unused-dependency` reports are literal: a package not referenced by name in scripts/configs/code may still be used by tooling that resolves it implicitly (e.g. coverage providers, binary-name CLIs). These were treated as TP only when consistent with the rule's documented meaning; the audit does not claim the dependency is safe to remove without human review.
- Corpora were scanned at their checked-out revisions under `/Volumes/data/projects/unshit-bench/corpus`. Different revisions or configs may produce different findings.
- Only findings emitted by unshit were sampled. The audit measures precision, not recall or real-world defect prevalence.

## Reproduce

```bash
pnpm run build
node benchmark/precision/sample.mjs
# Review/edit benchmark/precision/labels.json if re-auditing
node benchmark/precision/report.mjs
```

