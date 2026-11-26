# Fix soundness (round 11)

Generated: 2026-11-26T12:45:08.630Z

Method: for each corpus project, copy to a fresh `/tmp` dir (corpus read-only), run `node bin/unshit.js fix <copy> --apply --no-cache`, then compare TypeScript program diagnostics before/after using this repo's `typescript` package over the project's `tsconfig.json`. "New compile errors" are diagnostics present after but not before (keyed by file+code+message). Idempotency = second `fix --apply` makes no changes and applies 0 patches/deletions. Re-scan = fixed findings do not reappear.

## Summary

| Project | tsconfig | tsc before | tsc after | new tsc errors | fixed findings | skipped | idempotent | fixed still present |
|---|---|---:|---:|---:|---:|---:|:---:|---:|
| hono | tsconfig.json | 0 | 0 | 0 | 39 | 30 | yes | 0 |
| execa | tsconfig.json | 16 | 16 | 0 | 5 | 0 | yes | 0 |
| zod | tsconfig.json | 598 | 374 | 0 | 342 | 94 | yes | 0 |
| commander.js | tsconfig.json | 47 | 47 | 0 | 0 | 4 | yes | 0 |

## hono

Typecheck: 0 -> 0 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 2 | 0 | 0 |  |
| code/high-complexity | 1 | 0 | 0 |  |
| deps/unused-dependency | 2 | 1 | 0 | skip: `mitata` still imported (or required) by a scanned file anywhere in the project |
| ts/no-explicit-any | 5 | 0 | 0 |  |
| ts/unused-export | 14 | 5 | 0 | skip: could break declaration emit: `EventProcessor` is referenced by the exported signature of `EventV2Processor` (kept conservatively); default export: removing only `export` would leave an invalid declaration; could break declaration emit: `EXTERNAL_CLASS_NAMES` is referenced by the exported signature of `CssClassName` (kept conservatively); listed export clause: removing only `export` would delete the re-export |
| ts/unused-file | 2 | 1 | 0 | skip: protected path (config, test, docs or script directory) |
| ts/unused-type-export | 13 | 23 | 0 | skip: could break declaration emit: `CognitoIdentity` is referenced by the exported signature of `LambdaContext` (kept conservatively); could break declaration emit: `ClientContext` is referenced by the exported signature of `LambdaContext` (kept conservatively); could break declaration emit: `ClientContextClient` is referenced by the exported signature of `ClientContext` (kept conservatively); could break declaration emit: `ClientContextEnv` is referenced by the exported signature of `ClientContext` (kept conservatively); could break declaration emit: `APIGatewayProxyEvent` is referenced by the exported signature of `LambdaEvent` (kept conservatively); could break declaration emit: `ALBProxyEvent` is referenced by the exported signature of `LambdaEvent` (kept conservatively); could break declaration emit: `Response` is referenced by the exported signature of `ClientResponse` (kept conservatively); could break declaration emit: `Renderer` is referenced by the exported signature of `PropsForRenderer` (kept conservatively); could break declaration emit: `Layout` is referenced by the exported signature of `Context` (kept conservatively); could break declaration emit: `ReplacementMap` is referenced by the exported signature of `Trie` (kept conservatively) |

## execa

Typecheck: 16 -> 16 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 1 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |
| ts/no-double-cast | 1 | 0 | 0 |  |
| ts/unused-file | 2 | 0 | 0 |  |

## zod

Typecheck: 598 -> 374 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 27 | 0 | 0 |  |
| code/high-complexity | 3 | 0 | 0 |  |
| deps/unused-dependency | 11 | 10 | 0 | skip: `lint-staged` still referenced by package.json (scripts or config field); `zod4` still imported (or required) by a scanned file anywhere in the project; `zod3` still imported (or required) by a scanned file anywhere in the project; `execa` still imported (or required) by a scanned file anywhere in the project |
| react/god-file | 4 | 0 | 0 |  |
| slop/magic-timer | 0 | 1 | 0 | skip: delay literal is not a plain decimal number |
| slop/redundant-catch | 23 | 0 | 0 |  |
| ts/no-double-cast | 2 | 0 | 0 |  |
| ts/no-explicit-any | 124 | 0 | 0 |  |
| ts/unused-export | 20 | 49 | 0 | skip: removing export would leave `sink` unused locally (noUnusedLocals); removing export would leave `SINK` unused locally (noUnusedLocals); removing export would leave `shortestPaths` unused locally (noUnusedLocals); removing export would leave `findNodes` unused locally (noUnusedLocals); removing export would leave `is` unused locally (noUnusedLocals); removing export would leave `equals` unused locally (noUnusedLocals); removing export would leave `clone` unused locally (noUnusedLocals); removing export would leave `schema` unused locally (noUnusedLocals); removing export would leave `VALIBOT` unused locally (noUnusedLocals); removing export would leave `filePath` unused locally (noUnusedLocals) |
| ts/unused-file | 105 | 2 | 0 | skip: protected path (config, test, docs or script directory) |
| ts/unused-type-export | 23 | 32 | 0 | skip: could break declaration emit: `Measurement` is referenced by the exported signature of `measureStable` (kept conservatively); could break declaration emit: `Graph` is referenced by the exported signature of `loadGraph` (kept conservatively); could break declaration emit: `DiffRow` is referenced by the exported signature of `diffAllocation` (kept conservatively); could break declaration emit: `Test` is referenced by the exported signature of `Test` (kept conservatively); could break declaration emit: `TestMerge` is referenced by the exported signature of `TestMerge` (kept conservatively); could break declaration emit: `TestUnion` is referenced by the exported signature of `TestUnion` (kept conservatively); could break declaration emit: `TestPartial` is referenced by the exported signature of `TestPartial` (kept conservatively); could break declaration emit: `TestPick` is referenced by the exported signature of `TestPick` (kept conservatively); could break declaration emit: `TestOmit` is referenced by the exported signature of `TestOmit` (kept conservatively); could break declaration emit: `DeepPartial` is referenced by the exported signature of `deepPartial` (kept conservatively) |

## commander.js

Typecheck: 47 -> 47 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| ts/unused-file | 0 | 4 | 0 | skip: protected path (config, test, docs or script directory) |
