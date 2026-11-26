# Hook latency (round 13)

Target: `unshit hook --stdin` p95 under 50 ms for a single Write payload.

## Method

`node benchmark/hook-latency/run.mjs` builds a temp git repo, then spawns
`bin/unshit.js hook --stdin` with one Write payload: 5 warmups, 40 timed
runs. It writes p50, p95, min and max to `benchmark/hook-latency/results.json`.
Machine: darwin arm64, Node v26.7.0, shared with other jobs (load average
up to ~40 during some runs), so the absolute numbers move between sessions.

## Change

`src/detectors/complexity.ts` built a `Set` of `ts.SyntaxKind` values at
module load. Touching `ts.SyntaxKind` through the lazy proxy loaded the whole
`typescript` package on every hook call, even when no TypeScript parse was
needed. The set is now built on first use.

Scan output is byte-identical: `unshit scan . --no-cache --format json`
gives the same findings before and after.
`tests/complexity-lazy-ts.test.ts` checks that importing the module does not
load `typescript` and that logical operators still add complexity.

## Results (ms, three back-to-back pairs, interleaved)

| Build | p50 | p95 | min |
|---|---|---|---|
| main | 49.5 | 59.6 | 47.3 |
| lazy | 30.5 | 35.8 | 27.7 |
| main | 50.2 | 59.1 | 45.8 |
| lazy | 29.1 | 34.5 | 27.0 |
| main | 48.6 | 52.5 | 45.6 |
| lazy | 29.8 | 38.9 | 27.3 |

An earlier session under heavier load measured main at p95 143–179 and the
lazy build at p95 62–71. The ratio held (about 40% faster), but the absolute
p95 depends on machine load.

## Remaining options (not done)

1. Audit other detector modules for eager `ts.*` access at module scope.
   Add a test that `bin/unshit.js hook` never loads `typescript` when no
   TS parse is needed.
2. Import detectors on demand in `src/core/hook.ts`. That file is being
   edited by another work stream, so it was left alone here.
3. Use a V8 compile cache (`module.enableCompileCache()`) to cut startup.
