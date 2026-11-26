# Fix soundness (round 11)

Generated: 2026-11-26T13:17:48.239Z

Method: for each corpus project, copy to a fresh `/tmp` dir (corpus read-only), run `node bin/unshit.js fix <copy> --apply --no-cache`, then compare TypeScript program diagnostics before/after using this repo's `typescript` package over the project's `tsconfig.json`. "New compile errors" are diagnostics present after but not before (keyed by file+code+message). Idempotency = second `fix --apply` makes no changes and applies 0 patches/deletions. Re-scan = fixed findings do not reappear.

## Summary

| Project | tsconfig | tsc before | tsc after | new tsc errors | fixed findings | skipped | passes | idempotent | syntax failed | remaining fixable | time ms |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|---:|---:|
| hono | tsconfig.json | 0 | 0 | 0 | 39 | 30 | 2 | yes | 0 | 0 | 4419 |
| execa | tsconfig.json | 16 | 16 | 0 | 5 | 0 | 2 | yes | 0 | 0 | 4451 |
| zod | tsconfig.json | 598 | 374 | 0 | 342 | 94 | 7 | yes | 0 | 0 | 16964 |
| commander.js | tsconfig.json | 47 | 47 | 0 | 0 | 4 | 1 | yes | 0 | 0 | 1454 |
| fastify | none | no tsconfig found | no tsconfig found | 0 | 5 | 20 | 2 | yes | 0 | 0 | 2755 |
| scale-1000 | tsconfig.json | 3363 | 3363 | 0 | 830 | 0 | 2 | yes | 0 | 0 | 4729 |

## hono

Typecheck: 0 -> 0 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 18/0. Wall time: 4419ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 2 | 0 | 0 |  |
| code/high-complexity | 1 | 0 | 0 |  |
| deps/unused-dependency | 2 | 0 | 0 |  |
| ts/no-explicit-any | 5 | 0 | 0 |  |
| ts/unused-export | 14 | 0 | 0 |  |
| ts/unused-file | 2 | 0 | 0 |  |
| ts/unused-type-export | 13 | 0 | 0 |  |

## execa

Typecheck: 16 -> 16 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 1/0. Wall time: 4451ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 1 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |
| ts/no-double-cast | 1 | 0 | 0 |  |
| ts/unused-file | 2 | 0 | 0 |  |

## zod

Typecheck: 598 -> 374 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 7. Remaining fixable not fixed: 0. Syntax checked/failed: 2/0. Wall time: 16964ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 27 | 0 | 0 |  |
| code/high-complexity | 3 | 0 | 0 |  |
| deps/unused-dependency | 11 | 0 | 0 |  |
| react/god-file | 4 | 0 | 0 |  |
| slop/redundant-catch | 23 | 0 | 0 |  |
| ts/no-double-cast | 2 | 0 | 0 |  |
| ts/no-explicit-any | 124 | 0 | 0 |  |
| ts/unused-export | 20 | 0 | 0 |  |
| ts/unused-file | 105 | 0 | 0 |  |
| ts/unused-type-export | 23 | 0 | 0 |  |

## commander.js

Typecheck: 47 -> 47 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 1. Remaining fixable not fixed: 0. Syntax checked/failed: 0/0. Wall time: 1454ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| (none) | 0 | 0 | 0 | no deterministic fixes/skips |

## fastify

Typecheck: no tsconfig found
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 1/0. Wall time: 2755ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| deps/unused-dependency | 4 | 0 | 0 |  |
| slop/magic-timer | 1 | 0 | 0 |  |

## scale-1000

Typecheck: 3363 -> 3363 (0 new, 0 unattributed)
Idempotent: true. Fixed findings reappearing: 0.
Passes: 2. Remaining fixable not fixed: 0. Syntax checked/failed: 468/0. Wall time: 4729ms.

| Rule | fixed | skipped | new compile errors | notes |
|---|---:|---:|---:|---|
| code/duplicate-block | 362 | 0 | 0 |  |
| ts/unused-type-export | 468 | 0 | 0 |  |
