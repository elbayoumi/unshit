# Known gaps in the frozen rule suite

This file documents every case that is excluded from the frozen suite's pass
gate. Exclusions are **explicit and machine-readable** in
[`known-gaps.json`](./known-gaps.json); the runner rejects stale entries that
no longer correspond to a current miss or false positive. Only the six rules
added in round 9 may be listed, so the original unused-code gates are
unchanged.

For each gap: the case, the expected/actual finding key (`ruleId`, `file`,
`symbol`), why the detector misses or over-reports, and the owner/status. A gap
is a report for the detector owner, never a label edit: frozen fixtures and
their `expected.json` stay intact. When a detector is fixed, remove the gap
entry in the same commit and confirm the suite still prints `RESULT: PASS`.

Eval cases are informational (not gated), so their misses are documented here
but are not listed in `known-gaps.json`.

## Current gaps

### `arch/import-cycle`

- **Gated miss — `holdout/cy-lazy-three`**, key `arch/import-cycle | src/a.ts | src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts`. `src/a.ts` lazily imports `src/b.ts` with `import('./b')`; `b -> c -> a` are static imports. `collectTsJsEdges` (`src/core/import-graph/ts.ts`) does not emit an edge for dynamic `import()`, so Tarjan SCC never sees the closing edge. Excluded explicitly in `known-gaps.json`. Owner: detector worker (round 9); not changed here.
- **Informational eval miss — `eval/cy-dynamic`**, key `arch/import-cycle | src/a.ts | src/a.ts -> src/b.ts -> src/a.ts`. Same missing dynamic-`import()` edge in a two-module lazy cycle.
- **Informational eval miss — `eval/cy-self-import`**, key `arch/import-cycle | src/cache.ts | src/cache.ts -> src/cache.ts`. A module importing its own runtime export is a one-node cycle; the graph collapses or skips self edges, so no finding is emitted.
