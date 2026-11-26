# Round 10 — full-scan wall time

## Goal and charter

Charter target: full scan < 3 s for 1000 files and < 1.5 s for 200 files. This round measures the five available targets (four corpus copies plus this repo); it does **not** synthesise 200- or 1000-file corpora, so the charter thresholds themselves remain unverified here. The largest measured target is this repo at 125 files.

## Method

- `benchmark/scan-speed.mjs <dir>... [--reps N] [--out report.json]` copies each target to a fresh temp dir (skipping `node_modules`, `.git`, `.unshit`, `dist` — all excluded or hidden from scans anyway), warms the filesystem with one scan, then times `node bin/unshit.js scan <copy> --format json` as a median of N runs, both with `--no-cache` and with the content-hash cache warmed.
- Reproducible table: `pnpm build && node benchmark/scan-speed.mjs <corpus>... . --reps 5`.
- Because fresh copies add variance (an entire process start is ~120–140 ms), the before/after table below is a **controlled interleaved A/B**: both binaries live under `/tmp` (one pristine pre-change build, one post-change build), scan the *same* five fixed copies, and alternate `base, new, base, new, …` for 9 timed runs per mode after one warm-up. Medians are reported; `--no-cache` and cached modes are measured independently.

## Before / after (median of 9 interleaved runs, warm FS, Node v26.7.0, darwin/arm64)

| Target | no-cache before (ms) | no-cache after (ms) | Δ | cached before (ms) | cached after (ms) | Δ |
|---|---:|---:|---:|---:|---:|---:|
| auctions-platform-backend | 144.7 | 121.8 | −15.8% | 142.4 | 118.9 | −16.5% |
| auctions-platform-frontend | 195.4 | 187.0 | −4.3% | 177.5 | 173.4 | −2.3% |
| bidshop-frontend | 216.5 | 211.6 | −2.3% | 195.0 | 196.3 | +0.7% |
| rveta-site | 214.5 | 205.6 | −4.2% | 197.3 | 181.4 | −8.1% |
| this repo (125 files) | 477.7 | 436.5 | −8.6% | 375.8 | 351.9 | −6.4% |

Cached scans improve less because per-file cacheable detectors are skipped entirely; the remaining cross-file work (deps, unused-file, entry points) is what the shared memoization speeds up. Small corpora are dominated by process startup, so percentage gains there are noisy; the repo is the most reliable signal.

## `benchmark/scan-speed.mjs` output (median of 5, fresh copies)

Baseline build:

```text
Scan wall time — median of 5 runs, warm FS, Node v26.7.0
Target                             no-cache ms    cached ms    speedup
/Volumes/data/projects/auctions-platform-backend 146.4          145.6        1.01x
/Volumes/data/projects/auctions-platform-frontend 194.7          176.9        1.10x
/Volumes/data/projects/bidshop-frontend          195.9          180.7        1.08x
/Volumes/data/projects/rveta-site                202.9          181.9        1.12x
/private/tmp/unshit-r10/copies/unshit-self       403.1          367.2        1.10x
```

Optimized build, same invocation:

```text
Scan wall time — median of 5 runs, warm FS, Node v26.7.0
Target                             no-cache ms    cached ms    speedup
/Volumes/data/projects/auctions-platform-backend 123.2          122.0        1.01x
/Volumes/data/projects/auctions-platform-frontend 190.0          173.8        1.09x
/Volumes/data/projects/bidshop-frontend          217.7          214.4        1.02x
/Volumes/data/projects/rveta-site                237.1          222.9        1.06x
/Volumes/data/projects/unshit-wt/r10-perf        408.6          391.1        1.04x
```

These two runs disagree on the small corpora (fresh-copy noise); the interleaved A/B above is the measurement to trust.

## CPU profile (`node --cpu-prof`, this repo, `--no-cache`)

Before (649 samples): `typescript.js` 39.1% (mostly `walker.ts` AST creation — not editable this round), `clones.js` 13.4% with `addTokenWindows` alone at 12.0% (**forbidden file**), `ts-ast.js` 9.6% (five separate walks), `deps-shared.js` 3.4%, `unused-file.js` 3.2%, `import-graph/ts.js` 3.1%, `clones-tokenize.js` 2.8% (**forbidden**), native `readdir` 4.6%.

After (516 samples): `addTokenWindows` 11.6% remains #1; `deps-shared.js` 4.8%; `import-graph/ts.js` 4.5%; `ts-ast.js` 2.5% (down from 9.6%); native `readdir` 1.7% (down from 4.6%). On the slowest corpus (rveta-site) `ts-ast.js` walks occupied ~35% before.

### Hotspots fixed (editable files)

1. **`src/detectors/ts-ast.ts`** — five detectors each walked every AST. They now dispatch from one memoized walk per `SourceFile` into per-rule buckets; each detector still returns its own rule's findings, so detector IDs and registry are unchanged.
2. **`src/detectors/deps-shared.ts`** — `collectModuleSpecs` was recomputed for `allUsed`, per-workspace usage and unlisted imports. It is now memoized per `SourceFile`/`FileEntry`; dynamic `import()` specifiers are tagged so consumers can filter without another walk.
3. **`src/detectors/unused-file.ts`** — `dynamicImportTargets` did its own recursive AST walk; it now filters the already-memoized spec list. Bonus: `src/detectors/dead-exports/entries.ts` memoizes `entryPointFileSet` per detector context, removing a second recursive directory walk.

### Biggest hotspot is in a forbidden file — proposed patch, not applied

`addTokenWindows` (`src/detectors/clones.ts`) builds a window signature with `tokens.slice(i, end).map(t => t.norm).join(' ')`, i.e. O(windowSize) string work and allocations per position. Proposed change:

- Intern each `token.norm` to an integer id and build two polynomial rolling-hash prefix arrays (`h[i+1] = h[i] * B + id + M mod M`, plus powers). A window signature becomes an O(1) `(hash1, hash2)` pair instead of a joined string; bucket keys use the pair.
- Store the token array per file and, in `analyzeBucket`, verify candidate pairs by comparing the actual `norm` sequences before emitting findings, so a hash collision cannot change output.
- Separately, `tokenize` (`src/detectors/clones-tokenize.ts`) builds the blanked source with `text.split('')` / `chars.join('')` and calls `getLineAndCharacterOfPosition` for every token. Replace with a precomputed line-start array plus incremental line index, and blank skip ranges with a single `String.replace` over a regex built from the ranges.

Neither file was edited (both are on the do-not-modify list), so the clone-detector hotspot remains.

## Equivalence evidence

Before and after JSON was captured with `--no-cache` for all five targets. The `findings` arrays are byte-identical (backend 0, frontend 124, bidshop 112, rveta 126, self 0). The self score stays 100 with 0 findings. `pnpm run typecheck` passes, `pnpm test` passes (213 tests, including the new `tests/scan-walk-sharing.test.ts`), and `pnpm build && node benchmark/frozen/run.mjs` prints `RESULT: PASS`.

## Caveats

- Process startup (~120 ms) dominates the small corpora; their deltas are directional, not precise.
- Interleaving reduces but does not eliminate thermal/scheduler noise; the repo delta is the most trustworthy.
- The 200/1000-file charter thresholds were not exercised because only the supplied corpora and this repo were in scope.
- Findings equality was checked on the five available targets, not on arbitrary inputs.
