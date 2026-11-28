# Fix soundness (round 11)

Generated: 2026-11-28T02:02:31.457Z

Method: for each corpus project, copy to a fresh `/tmp` dir (corpus read-only), run `node bin/unshit.js fix <copy> --apply --no-cache`, then compare diagnostics before/after using this repo's `typescript` package. Projects with a tsconfig use `ts.createProgram` over the tsconfig and compare pre-emit diagnostics (`ts.getPreEmitDiagnostics` + config errors). Projects with no tsconfig use a synthesized TypeScript program over `.js/.cjs/.mjs` files with `allowJs: true`, `checkJs: false`, `noEmit: true`, and compare SYNTACTIC diagnostics only (`program.getSyntacticDiagnostics` per source file); this catches parse/syntax regressions introduced by fixes, not type errors. "New errors" are diagnostics present after but not before (keyed by file+code+message, not by position, so shifted lines do not count). Idempotency = second `fix --apply` makes no changes and applies 0 patches/deletions. Re-scan = fixed findings do not reappear.

## Summary

| Project | typecheck | before | after | new errors | fixed findings | skipped | passes | idempotent | syntax failed | remaining fixable | time ms |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|---:|---:|
| hono | tsconfig.json | 0 | 0 | 0 | 39 | 40 | 2 | yes | 0 | 0 | 4790 |
| execa | tsconfig.json | 16 | 16 | 0 | 4 | 11 | 2 | yes | 0 | 0 | 4343 |
| zod | tsconfig.json | 598 | 402 | 0 | 330 | 120 | 7 | yes | 0 | 0 | 19382 |
| commander.js | tsconfig.json | 47 | 47 | 0 | 0 | 4 | 1 | yes | 0 | 0 | 1563 |
| fastify | none (syntactic JS fallback) | 0 | 0 | 0 | 5 | 18 | 2 | yes | 0 | 0 | 3327 |
| scale-1000 | tsconfig.json | 3363 | 3363 | 0 | 830 | 0 | 2 | yes | 0 | 0 | 5089 |

## hono

TypeScript program diagnostics (tsconfig): 0 -> 0 (0 new, 0 unattributed, 0 files before / 0 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 18/0. Wall time: 4790ms.

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

TypeScript program diagnostics (tsconfig): 16 -> 16 (0 new, 0 unattributed, 1 files before / 1 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 0/0. Wall time: 4343ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 1 | 0 | 0 |  |
| slop/redundant-catch | 0 | 11 | 0 | skip: catch parameter is missing or destructured; try statement has a finally block |
| ts/no-double-cast | 1 | 0 | 0 |  |
| ts/unused-file | 2 | 0 | 0 |  |

## zod

TypeScript program diagnostics (tsconfig): 598 -> 402 (0 new, 0 unattributed, 472 files before / 359 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 7. Remaining fixable not fixed: 0. Syntax checked/failed: 2/0. Wall time: 19382ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 27 | 0 | 0 |  |
| code/high-complexity | 1 | 0 | 0 |  |
| deps/unused-dependency | 10 | 5 | 0 | skip: `zod4` still imported (or required) by a scanned file anywhere in the project; `zod3` still imported (or required) by a scanned file anywhere in the project |
| react/god-file | 3 | 0 | 0 |  |
| slop/magic-timer | 0 | 1 | 0 | skip: delay literal is not a plain decimal number |
| slop/redundant-catch | 23 | 32 | 0 | skip: catch parameter is missing or destructured; catch clause does more than rethrow the caught error |
| ts/no-double-cast | 2 | 0 | 0 |  |
| ts/no-explicit-any | 122 | 0 | 0 |  |
| ts/unused-export | 19 | 49 | 0 | skip: removing export would leave `sink` unused locally (noUnusedLocals); removing export would leave `SINK` unused locally (noUnusedLocals); removing export would leave `shortestPaths` unused locally (noUnusedLocals); removing export would leave `findNodes` unused locally (noUnusedLocals); removing export would leave `is` unused locally (noUnusedLocals); removing export would leave `equals` unused locally (noUnusedLocals); removing export would leave `clone` unused locally (noUnusedLocals); removing export would leave `schema` unused locally (noUnusedLocals); removing export would leave `VALIBOT` unused locally (noUnusedLocals); removing export would leave `filePath` unused locally (noUnusedLocals) |
| ts/unused-file | 100 | 1 | 0 | skip: protected path (config, test, docs or script directory) |
| ts/unused-type-export | 23 | 32 | 0 | skip: could break declaration emit: `Measurement` is referenced by the exported signature of `measureStable` (kept conservatively); could break declaration emit: `Graph` is referenced by the exported signature of `loadGraph` (kept conservatively); could break declaration emit: `DiffRow` is referenced by the exported signature of `diffAllocation` (kept conservatively); could break declaration emit: `Test` is referenced by the exported signature of `Test` (kept conservatively); could break declaration emit: `TestMerge` is referenced by the exported signature of `TestMerge` (kept conservatively); could break declaration emit: `TestUnion` is referenced by the exported signature of `TestUnion` (kept conservatively); could break declaration emit: `TestPartial` is referenced by the exported signature of `TestPartial` (kept conservatively); could break declaration emit: `TestPick` is referenced by the exported signature of `TestPick` (kept conservatively); could break declaration emit: `TestOmit` is referenced by the exported signature of `TestOmit` (kept conservatively); could break declaration emit: `DeepPartial` is referenced by the exported signature of `deepPartial` (kept conservatively) |

## commander.js

TypeScript program diagnostics (tsconfig): 47 -> 47 (0 new, 0 unattributed, 12 files before / 12 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 1. Remaining fixable not fixed: 0. Syntax checked/failed: 0/0. Wall time: 1563ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| ts/unused-file | 0 | 4 | 0 | skip: protected path (config, test, docs or script directory) |

## fastify

Syntactic JS fallback (no tsconfig, .js/.cjs/.mjs, allowJs, checkJs false, noEmit, program.getSyntacticDiagnostics only): 0 -> 0 (0 new, 0 unattributed, 271 files before / 271 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 1/0. Wall time: 3327ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 4 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |
| ts/unused-file | 0 | 18 | 0 | skip: protected path (config, test, docs or script directory) |

## scale-1000

TypeScript program diagnostics (tsconfig): 3363 -> 3363 (0 new, 0 unattributed, 1000 files before / 1000 files after)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 468/0. Wall time: 5089ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 362 | 0 | 0 |  |
| ts/unused-type-export | 468 | 0 | 0 |  |
