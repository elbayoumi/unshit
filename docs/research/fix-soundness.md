# Fix soundness (round 11)

Generated: 2026-11-26T13:51:59.782Z

Method: for each corpus project, copy to a fresh `/tmp` dir (corpus read-only), run `node bin/unshit.js fix <copy> --apply --no-cache`, then compare TypeScript program diagnostics before/after using this repo's `typescript` package over the project's `tsconfig.json`. "New compile errors" are diagnostics present after but not before (keyed by file+code+message). Idempotency = second `fix --apply` makes no changes and applies 0 patches/deletions. Re-scan = fixed findings do not reappear.

## Summary

| Project | tsconfig | tsc before | tsc after | new tsc errors | fixed findings | skipped | passes | idempotent | syntax failed | remaining fixable | time ms |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|---:|---:|
| hono | tsconfig.json | 0 | 0 | 0 | 39 | 40 | 2 | yes | 0 | 0 | 5325 |
| execa | tsconfig.json | 16 | 16 | 0 | 5 | 13 | 2 | yes | 0 | 0 | 12045 |
| zod | tsconfig.json | 598 | 374 | 0 | 342 | 126 | 7 | yes | 0 | 0 | 82289 |
| commander.js | tsconfig.json | 47 | 47 | 0 | 0 | 4 | 1 | yes | 0 | 0 | 2869 |
| fastify | none | no tsconfig found | no tsconfig found | 0 | 5 | 21 | 2 | yes | 0 | 0 | 4091 |
| scale-1000 | tsconfig.json | 3363 | 3363 | 0 | 830 | 0 | 2 | yes | 0 | 0 | 6002 |

## hono

Typecheck: 0 -> 0 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 18/0. Wall time: 5325ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 2 | 0 | 0 |  |
| code/high-complexity | 1 | 0 | 0 |  |
| deps/unused-dependency | 2 | 1 | 0 | skip: `mitata` still imported (or required) by a scanned file anywhere in the project |
| slop/redundant-catch | 0 | 10 | 0 | skip: catch parameter is missing or destructured |
| ts/no-explicit-any | 5 | 0 | 0 |  |
| ts/unused-export | 14 | 5 | 0 | skip: could break declaration emit: `EventProcessor` is referenced by the exported signature of `EventV2Processor` (kept conservatively); default export: removing only `export` would leave an invalid declaration; could break declaration emit: `EXTERNAL_CLASS_NAMES` is referenced by the exported signature of `CssClassName` (kept conservatively); listed export clause: removing only `export` would delete the re-export |
| ts/unused-file | 2 | 1 | 0 | skip: protected path (config, test, docs or script directory) |
| ts/unused-type-export | 13 | 23 | 0 | skip: could break declaration emit: `CognitoIdentity` is referenced by the exported signature of `LambdaContext` (kept conservatively); could break declaration emit: `ClientContext` is referenced by the exported signature of `LambdaContext` (kept conservatively); could break declaration emit: `ClientContextClient` is referenced by the exported signature of `ClientContext` (kept conservatively); could break declaration emit: `ClientContextEnv` is referenced by the exported signature of `ClientContext` (kept conservatively); could break declaration emit: `APIGatewayProxyEvent` is referenced by the exported signature of `LambdaEvent` (kept conservatively); could break declaration emit: `ALBProxyEvent` is referenced by the exported signature of `LambdaEvent` (kept conservatively); could break declaration emit: `Response` is referenced by the exported signature of `ClientResponse` (kept conservatively); could break declaration emit: `Renderer` is referenced by the exported signature of `PropsForRenderer` (kept conservatively); could break declaration emit: `Layout` is referenced by the exported signature of `Context` (kept conservatively); could break declaration emit: `ReplacementMap` is referenced by the exported signature of `Trie` (kept conservatively) |

## execa

Typecheck: 16 -> 16 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 1/0. Wall time: 12045ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 1 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |
| slop/redundant-catch | 0 | 13 | 0 | skip: catch parameter is missing or destructured; try statement has a finally block |
| ts/no-double-cast | 1 | 0 | 0 |  |
| ts/unused-file | 2 | 0 | 0 |  |

## zod

Typecheck: 598 -> 374 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 7. Remaining fixable not fixed: 0. Syntax checked/failed: 2/0. Wall time: 82289ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 27 | 0 | 0 |  |
| code/high-complexity | 3 | 0 | 0 |  |
| deps/unused-dependency | 11 | 10 | 0 | skip: `lint-staged` still referenced by package.json (scripts or config field); `zod4` still imported (or required) by a scanned file anywhere in the project; `zod3` still imported (or required) by a scanned file anywhere in the project; `execa` still imported (or required) by a scanned file anywhere in the project |
| react/god-file | 4 | 0 | 0 |  |
| slop/magic-timer | 0 | 1 | 0 | skip: delay literal is not a plain decimal number |
| slop/redundant-catch | 23 | 32 | 0 | skip: catch parameter is missing or destructured; catch clause does more than rethrow the caught error |
| ts/no-double-cast | 2 | 0 | 0 |  |
| ts/no-explicit-any | 124 | 0 | 0 |  |
| ts/unused-export | 20 | 49 | 0 | skip: removing export would leave `sink` unused locally (noUnusedLocals); removing export would leave `SINK` unused locally (noUnusedLocals); removing export would leave `shortestPaths` unused locally (noUnusedLocals); removing export would leave `findNodes` unused locally (noUnusedLocals); removing export would leave `is` unused locally (noUnusedLocals); removing export would leave `equals` unused locally (noUnusedLocals); removing export would leave `clone` unused locally (noUnusedLocals); removing export would leave `schema` unused locally (noUnusedLocals); removing export would leave `VALIBOT` unused locally (noUnusedLocals); removing export would leave `filePath` unused locally (noUnusedLocals) |
| ts/unused-file | 105 | 2 | 0 | skip: protected path (config, test, docs or script directory) |
| ts/unused-type-export | 23 | 32 | 0 | skip: could break declaration emit: `Measurement` is referenced by the exported signature of `measureStable` (kept conservatively); could break declaration emit: `Graph` is referenced by the exported signature of `loadGraph` (kept conservatively); could break declaration emit: `DiffRow` is referenced by the exported signature of `diffAllocation` (kept conservatively); could break declaration emit: `Test` is referenced by the exported signature of `Test` (kept conservatively); could break declaration emit: `TestMerge` is referenced by the exported signature of `TestMerge` (kept conservatively); could break declaration emit: `TestUnion` is referenced by the exported signature of `TestUnion` (kept conservatively); could break declaration emit: `TestPartial` is referenced by the exported signature of `TestPartial` (kept conservatively); could break declaration emit: `TestPick` is referenced by the exported signature of `TestPick` (kept conservatively); could break declaration emit: `TestOmit` is referenced by the exported signature of `TestOmit` (kept conservatively); could break declaration emit: `DeepPartial` is referenced by the exported signature of `deepPartial` (kept conservatively) |

## commander.js

Typecheck: 47 -> 47 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 1. Remaining fixable not fixed: 0. Syntax checked/failed: 0/0. Wall time: 2869ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| ts/unused-file | 0 | 4 | 0 | skip: protected path (config, test, docs or script directory) |

## fastify

Typecheck: no tsconfig found
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 1/0. Wall time: 4091ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 4 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |
| slop/redundant-catch | 0 | 1 | 0 | skip: catch parameter is missing or destructured |
| ts/unused-file | 0 | 20 | 0 | skip: protected path (config, test, docs or script directory) |

## scale-1000

Typecheck: 3363 -> 3363 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 468/0. Wall time: 6002ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 362 | 0 | 0 |  |
| ts/unused-type-export | 468 | 0 | 0 |  |

## r13 catchfix addendum (deterministic redundant-catch unwrapping)

Measured with `node benchmark/fix-soundness/run.mjs` on 2026-11-26; that run produced both this table and `benchmark/fix-soundness/results.json`.

- Overall: `RESULT: PASS fixed=1221 newTscErrors=0 syntaxFailed=0 idempotent=true`.
- Deterministic `slop/redundant-catch` patches applied by the new fixer: **0** across hono, execa, zod, commander.js, fastify and scale-1000. A direct pre-fix scan found **0** `slop/redundant-catch` findings with `fixability: "safe"` in each of the five public corpora, so the planner had nothing to apply. The unwrap, block-kept, finally, wrapping, nested, dry-run, idempotency and compile checks are covered by `tests/fix-redundant-catch-r13.test.ts`.
- The benchmark's finding-level `slop/redundant-catch` row reports 23 "fixed" findings in zod and 0 in the other projects. Those finding keys vanished from the rescan while this fixer planned **0** patches, so they are side effects of other fixes in the same run (file deletions / line shifts), not redundant-catch patches applied by this fixer.
- Skips reported for this rule: **56** total (hono 10, execa 13, zod 32, commander.js 0, fastify 1, scale-1000 0). Distinct reasons: `catch parameter is missing or destructured` (4 projects), `try statement has a finally block` (execa), `catch clause does more than rethrow the caught error` (zod).
- New TypeScript compile errors attributed to `slop/redundant-catch`: **0** in every project. Syntax check failures: **0**. A second `fix --apply` was a no-op in every project.
