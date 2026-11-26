# Round 11 — scan scale (200 and 1000 files)

## Goal and charter

Round 10 (`docs/research/scan-speed.md`) measured only projects of at most 125 files, so the charter budgets were never exercised: **full scan < 1.5 s for 200 files** and **< 3 s for 1000 files**. This round generates deterministic synthetic TypeScript projects at exactly those sizes and measures the real CLI against both budgets.

## Method

- `benchmark/scale-project.mjs` generates a self-contained project from a Mulberry32 PRNG (default seed `20261126`). It writes `package.json`, `tsconfig.json` and exactly `count` scanned `.ts` files: `src/index.ts`, one `src/features/featureNN/index.ts` barrel per feature and up to 20 modules per feature. Modules import the previous module in their feature and the barrel of the previous feature, and contain interfaces, exported functions, exported classes and eight kinds of randomly composed statements (branches, loops, `try/catch`, `switch`, arithmetic). Each generated project is deterministic byte-for-byte for a given `(count, seed)`.
- `benchmark/scale-bench.mjs` creates a **fresh directory under the OS temp dir** per size (never inside the repo), warms the filesystem with one scan, then times `node bin/unshit.js scan <dir> --no-cache --format json` five times and reports the median. A cache-enabled run (warm cache after its own warm-up) is measured the same way. Wall time is measured around the child process, so it includes ~120 ms of Node/CLI startup.
- A SHA-256 of the `findings` array from an extra `--no-cache` JSON scan is recorded per size. stdout is redirected to a file rather than piped (see caveat below).
- Reproduce: `pnpm build && node benchmark/scale-bench.mjs --reps 5 --seed 20261126 --out /tmp/unshit-scale.json`. The script prints `RESULT: PASS` only when both no-cache medians are under budget.

## Machine

| Item | Value |
|---|---|
| Node | v26.7.0 |
| Platform / release | darwin 25.6.0, arm64 |
| CPU | Apple M5 Pro, 15 cores |
| Memory | 24 GiB |
| Measurement date | 2026-11-26T12:28:33Z |
| Reps / seed | 5 / 20261126 |

## Results (median of 5, warm FS)

| Scanned files | no-cache median (ms) | no-cache min–max (ms) | cached median (ms) | cached min–max (ms) | Budget (ms) | Verdict |
|---:|---:|---:|---:|---:|---:|:---:|
| 200 | **221.4** | 218.3–222.2 | 216.2 | 211.5–227.7 | 1500 | PASS |
| 1000 | **629.8** | 611.2–662.9 | 571.8 | 567.5–577.1 | 3000 | PASS |

Full samples and machine info are in the `--out` JSON. The 200-file project produces 232 info findings (mostly `ts/unused-type-export` and some `code/duplicate-block`), so these are not empty synthetic workloads. Both charter budgets are met with wide headroom (6.8× at 200 files, 4.8× at 1000 files). `RESULT: PASS`.

## Determinism and equivalence

- Two independent benchmark runs produced identical findings digests: `ba8317bd…af91a70ef4c0f8be22c` at 200 files and `7330c3c3…61ed503421f7166c900` at 1000 files. Generator determinism is also covered by `tests/scan-scale.test.ts` (PRNG sequence, byte-identical trees for the same seed, different bytes for a different seed, and a small generated project that scans successfully).
- Because both budgets passed, **no detector or scanner code was changed** and no CPU profile was needed. There is therefore no before/after optimization to prove equivalent; the only code added is the benchmark and its tests. The self-scan of this repo still reports score 100 with **0 findings** (134 scanned files).

## Caveats

- Process startup dominates the smaller case; the 200-file number is not a pure scan cost. The same measurement on a slower machine may differ, but the budgets have large margins here.
- Cached timings are noisier than no-cache timings: an earlier run in this session measured cached medians of 218.3 ms (200 files) and 691.7 ms (1000 files, with one 1020 ms outlier), still under budget. The cached path still runs every cross-file detector, so it is not expected to be dramatically faster.
- Synthetic modules are deliberately varied to avoid pathological clone blow-ups; real repositories with heavily duplicated logic may be slower. These numbers measure this generator's workload, not all 1000-file projects.
- **Discovered issue, not fixed (outside the assigned files):** `bin/unshit.js` ends with `process.exit(code)`. When a large JSON report is written to a **pipe**, Node truncates the pending async stdout write at 64 KiB; parsing `--format json` output of the 1000-file project through `execFileSync` failed at byte 65536. The benchmark works around this by redirecting stdout to a file (writes to files are synchronous). Proposed patch: in `bin/unshit.js`, replace `process.exit(code)` with `process.exitCode = code` (and in the error branch, set `process.exitCode = 2` after logging), so Node drains stdout before exiting. This file was not modified in this round.
