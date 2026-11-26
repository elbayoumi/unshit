# G4 precision sample (round 9)

Hand-verified precision sample for `deps/unlisted-dependency`, `deps/unused-dependency`,
`code/duplicate-block`, and `arch/import-cycle` on the read-only corpus
(`/Volumes/data/projects/unshit-bench/corpus/{hono,execa,zod,commander.js,fastify}`).
No corpus files were modified. `docs/research/g4-head-to-head.md` numbers are untouched.

## Method

- Ran `node <worktree>/bin/unshit.js scan <project> --format json --no-cache` after `pnpm run build`.
- Classified every `deps/unlisted-dependency` finding (13 total), every `deps/unused-dependency`
  finding (19 after fixes), all `arch/import-cycle` findings (6 before fix, 5 after), and a
  sample of 40 `code/duplicate-block` findings across the five projects.
- TP = genuine issue; FP = false positive.

## Verdict table

### deps/unlisted-dependency (all findings hand-verified)

| Project | Before | After | TP | FP | Notes |
|---|---:|---:|---:|---:|---|
| hono | 9 | 0 | 0 | 9 | `bun:test`, `@std/assert` are runtime builtins, not npm packages |
| zod | 1 | 1 | 1 | 0 | `puppeteer` optional dynamic import; declared? no — genuine unlisted |
| commander.js | 3 | 0 | 0 | 3 | example-only optional deps (`chalk`, `wrap-ansi`, `strip-ansi`) |
| execa | 0 | 0 | 0 | 0 | — |
| fastify | 0 | 0 | 0 | 0 | — |
| **Total** | **13** | **1** | **1** | **12** | |

Root causes: (1) runtime builtins (`bun:`, `deno:`, `jsr:`, `@std/*`) not recognized;
(2) `examples/` treated as package source. Fixed in `src/detectors/deps-shared.ts`
(`isBareSpec`) and `src/detectors/deps.ts` (skip `examples/`, skip `@std/*`).

### deps/unused-dependency (all findings hand-verified)

| Project | Before | After | TP (approx) | FP eliminated | Notes |
|---|---:|---:|---:|---:|---|
| hono | 4 | 3 | 3 | 1 | `bun-types` now found via tsconfig manifest text |
| execa | 1 | 1 | 1 | 0 | `@typescript/native` genuinely unused |
| zod | 15 | 11 | ~7 | 4 | `tslib`, `ts-morph` (comment only) remain? see below |
| commander.js | 0 | 0 | 0 | 0 | — |
| fastify | 6 | 4 | 4 | 2 | `fastify-tsconfig`, `@jsumners/line-reporter` now recognized |
| **Total** | **26** | **19** | — | **7** | |

Root causes: (1) `scriptsReference` used `\b` word boundaries, which fail for scoped
package names (e.g. `@jsumners/line-reporter` preceded by `=`); (2) dependencies
referenced only in nested config/manifest files (tsconfig `extends`) were not counted;
(3) broad file-text references were not consulted. Fixed in `src/detectors/deps-shared.ts`
(`scriptsReference` now uses `includes`) and `src/detectors/deps.ts` (search owned
non-package.json file contents + owned tsconfig manifests).

Remaining unused findings are judged genuine or out-of-scope (e.g. `.mts` not scanned
by the walker; nub-wrapped CLI tools).

### code/duplicate-block (sample of 40)

| Pattern | Verdict | Fix |
|---|---|---|
| `*.test-d.ts` type-test files (execa) | FP | extended test-file skip regex in `src/detectors/clones.ts` |
| zod `packages/zod/src/v4/locales/*.ts` | FP | skip `locales/` directories in `src/detectors/clones.ts` |
| Adapter boilerplate copies (hono) | TP-ish | left as-is; jscpd also reports them |
| Bench harnesses (zod) | TP-ish | left as-is |

Counts: execa 159 → 11, zod 557 → 45. hono 23, fastify 15 unchanged.

### arch/import-cycle (all findings hand-verified)

| Project | Before | After | Verdict |
|---|---:|---:|---|
| hono | 4 | 4 | TP — real value cycles (barrel re-exports) |
| execa | 1 | 1 | TP — `forward → incoming → graceful → forward` |
| zod | 1 | 1 | TP — `core ↔ util` value cycle |
| fastify | 1 | 0 | FP — `.d.ts` declaration files only; removed by skipping `.d.ts` in import graph |
| commander.js | 0 | 0 | — |

Fixed in `src/core/import-graph/graph.ts` (skip `.d.ts` files).

## Hard-negative cases added

- `benchmark/frozen/hard-negatives/unlisted-runtime-builtin/`
- `benchmark/frozen/hard-negatives/unlisted-example/`
- `benchmark/frozen/hard-negatives/unused-tsconfig-extends/`

Unit tests added in `tests/deps.test.ts` and `tests/detectors.test.ts`.

## Verification

- `pnpm run typecheck` passes.
- `pnpm test` passes (195 tests).
- `pnpm run build` passes.
- `node benchmark/frozen/run.mjs` prints `RESULT: PASS` (recall 100%).
- `node bin/unshit.js scan . --format json` reports score 100/100, 0 findings.
