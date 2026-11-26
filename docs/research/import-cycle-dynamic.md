# Import cycles: dynamic `import()` and self imports (round 10)

## Question

`arch/import-cycle` missed three labelled fixtures:

- `holdout/cy-lazy-three` (gated): `a` lazily imports `b` via `import('./b')`,
  while `b -> c -> a` are static; Tarjan SCC never saw the closing `a -> b` edge.
- `eval/cy-dynamic`: the same gap in a two-module lazy cycle.
- `eval/cy-self-import`: `src/cache.ts` imports its own runtime export; the
  import graph deliberately dropped edges where `target === from`.

Decision: fix both gaps. This document records the evidence used to decide that
lazy edges are real dependency edges and do not create corpus noise.

## Method

The read-only corpus at `/Volumes/data/projects/unshit-bench/corpus/` was copied
to `/tmp/unshit-r10-corpus` before scanning; nothing was written inside it.
Each of the five projects was scanned twice with the same `bin/unshit.js scan
<project> --format json`: once with the round-9 graph (static imports,
`export … from`, `require()` only) and once after adding string-literal dynamic
`import()` edges. Findings were compared by `ruleId`, `file` and `evidence`.
Dynamic call sites and resolved dynamic edges were counted independently with
the TypeScript AST and the built `buildImportGraph()` output.

## Measurements

| corpus project | `arch/import-cycle` before | after | all findings before / after | literal `import()` calls | resolved internal dynamic edges |
|---|---:|---:|---:|---:|---:|
| commander.js | 0 | 0 | 15 / 15 | 0 | 0 |
| execa | 1 | 1 | 35 / 35 | 1 | 2 |
| fastify | 0 | 0 | 88 / 88 | 7 | 5 |
| hono | 4 | 4 | 642 / 642 | 6 | 15 |
| zod | 1 | 1 | 1482 / 1482 | 10 | 7 |
| **total** | **6** | **6** | **2262 / 2262** | **24** | **29** |

Every `arch/import-cycle` evidence string was byte-identical before and after:
no lazy cycle and no self-loop finding appeared on any corpus project, so the
corpus cycle count did not blow up (6 -> 6). No finding of any other rule
changed either. `unshit scan . --format json` on this repository stayed at
score 100 / 0 findings before and after.

The 24 literal dynamic calls are real (e.g. execa's `import('./escape.js')`,
fastify's ESM test imports, hono's lazy component/hook imports, zod's test
`import('../../index.js')`); 29 graph edges resolve to scanned files. None of
them closes an SCC that the static graph had not already closed, which is why
the reported cycles are unchanged. The lazy edges that *do* close cycles are
the frozen fixtures, which were hand-checked: `eval/cy-dynamic` (`a` lazily
imports `b`, `b` imports `a`) and `holdout/cy-lazy-three` (`a` lazily imports
`b`, `b -> c -> a`) are genuine dependency cycles, not strings or comments.
`eval/cy-self-import` is a genuine self dependency in the module graph.

## Implementation and trade-offs

- `collectTsJsEdges` (`src/core/import-graph/ts.ts`) now emits a specifier for a
  string-literal `import()` call as well as `require()`. Only literal specifiers
  are used; computed/template specifiers stay unresolved, consistent with the
  other graph parsers. Type queries (`type T = import('./x').Foo`) are
  `ImportTypeNode`, not calls, so they remain excluded.
- Self edges are recorded in `graph.selfLoops` but kept out of `graph.edges`,
  `graph.incoming` and `graph.outgoing`. This preserves reachability semantics:
  `ts/unused-file` must still flag a self-importing orphan, and
  `ts/unused-export` must not treat a self import as an outside consumer.
- `arch/import-cycle` emits one low-confidence (`0.6`, severity `warn`) finding
  for each self loop not already inside a multi-node SCC, so a file that both
  self-imports and participates in a larger cycle is reported once. Lazy cycles
  are reported like static cycles: the corpus check found no lazy-cycle noise,
  and a separate message would only duplicate the same evidence.
- A lazy edge is a dependency edge, not evidence of an initialization-time
  cycle (the target can load after the importer is ready). It is still a real
  circular dependency for bundlers, `dependency-cruiser`-style tooling and
  refactoring, so it belongs in the graph.

## Result

Frozen suite after removing the three gap entries: 188 cases, all holdout rules
100% recall (`arch/import-cycle` 4/4), hard-negative FPR 0%, eval recall
100% (77/77), zero known gaps, `RESULT: PASS`. Added unit tests:
`tests/import-cycle-r10.test.ts`.
