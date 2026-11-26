# Roadmap v0.2 Gate Measurements

Measured 2026-11-26 on the `r13-roadmap` worktree. Every number below comes from `benchmark/roadmap-gates.mjs` and the committed `benchmark/roadmap-gates-results.json`.

## Method

- **Corpora (read-only, copied to temp dirs):** `/Volumes/data/projects/unshit-bench/corpus/{hono,zod,execa,fastify,commander.js}`. The corpus was never modified; each measurement copied a corpus to a temp directory and removed it afterwards.
- **CLI:** `node bin/unshit.js ...` from this worktree after `pnpm run build`.
- **Seed:** `20261129` for deterministic file selection / edits / 1000-file project generation.
- **Gate (a) --changed parity:** For each corpus copy, initialized a git repo, made 3 seeded append-comment edits to existing source files, then ran a full `unshit scan --format json --no-cache` and compared findings restricted to changed files (sorted, normalized by ruleId/file/span/severity/message/evidence). The real CLI flag is `guard --changed` (there is no `scan --changed` flag); `guard --changed` runs a full scan and filters findings to changed files (`src/cli.ts`, `src/cli/guard.ts`, `src/core/pinner.ts`). The benchmark also captured `unshit guard <dir> --changed --no-cache --base HEAD` CLI output.
- **Gate (b) warm --changed latency:** Generated a 1000-file TS project with `benchmark/scale-project.mjs` (read-only import), git-initialized it, warmed the cache with one full `scan --format json`, appended one export to `src/features/feature00/module0000.ts`, then timed `guard --changed --base HEAD` (cache enabled) over 7 runs. Reported median and p95.
- **Gate (c) import-cycle FP audit:** Ran `unshit scan --format json --no-cache` on a temp copy of each corpus, extracted every `arch/import-cycle` finding, and verified each cycle by reading source import statements along the reported evidence path. Verdicts: TP = real runtime or type/module cycle per detector semantics (detector graph excludes pure type-only TS imports; reported edges are module dependencies), FP = not a real cycle per those semantics. Any text-search uncertainty was manually inspected; two initial "unknown" hits were resolved by reading source and are recorded as TP with manual evidence.

## Results

| Gate | Result | Measured |
|---|---|---|
| (a) `--changed` findings on changed files match full scan for those files | **PASS** | 5/5 corpora equal; changed-file finding deltas 0/1/0/0/0 |
| (b) Warm `--changed` run on a 1000-file repo < 2s | **MISS** | median 2777.5ms, p95 6933.1ms, min 1006.2ms, max 6933.1ms (7 runs) |
| (c) `arch/import-cycle` has 0 false positives on 5 real repos | **PASS (0 FP, 2 manually verified)** | 6 cycles total: 6 TP, 0 FP, 0 unknown |

## Gate (a) Details

| Corpus | Seeded edits | Changed files | Full scan findings | Findings on changed files | Equal | guard --changed CLI |
|---|---:|---:|---:|---:|---:|---|
| hono | 3 | 3 | 642 | 0 | yes | exit 0 |
| zod | 3 | 3 | 1477 | 1 | yes | exit 1 (1 warn on changed file) |
| execa | 3 | 3 | 35 | 0 | yes | exit 0 |
| fastify | 3 | 3 | 88 | 0 | yes | exit 0 |
| commander.js | 3 | 3 | 15 | 0 | yes | exit 0 |

The comparison is exact after normalization (ruleId, file, span, severity, message, evidence; sorted). No missing/extra findings.

## Gate (b) Details

- Generated files: 1000 (benchmark/scale-project.mjs, seed 20261129).
- Warm cache: one full `scan --format json` (cache enabled) before edit.
- Edit: appended `export const roadmapGateLatency = 1;` to `src/features/feature00/module0000.ts`.
- Command timed: `node bin/unshit.js guard <tmp> --changed --base HEAD` (cache enabled), 7 runs.
- Times (ms): 1006.2, 1780.4, 1821.3, 2777.5, 3551.4, 6532.0, 6933.1.
- Median: 2777.5ms. P95: 6933.1ms. **Target < 2000ms not met.**

## Gate (c) Import-Cycle Audit

Every reported cycle is listed below. Evidence paths are from the detector; edge checks read source import statements.

| Corpus | Verdict | Evidence | Reason |
|---|---|---|---|
| hono | TP | `src/helper/streaming/index.ts -> src/helper/streaming/text.ts -> src/helper/streaming/index.ts` | runtime/value import edges found in source (text.ts imports from "./") |
| hono | TP | `src/jsx/base.ts -> src/jsx/context.ts -> src/jsx/base.ts` | runtime/value import edges found in source |
| hono | TP | `src/jsx/components.ts -> src/jsx/streaming.ts -> src/jsx/components.ts` | runtime/value import edges found in source |
| hono | TP | `src/jsx/dom/render.ts -> src/jsx/hooks/index.ts -> src/jsx/dom/render.ts` | runtime/value import edges found in source (render.ts imports STASH_EFFECT from "../hooks"; type-only import also present) |
| zod | TP | `packages/zod/src/v4/core/core.ts -> packages/zod/src/v4/core/util.ts -> packages/zod/src/v4/core/core.ts` | runtime/value import edges found in source |
| execa | TP | `lib/ipc/forward.js -> lib/ipc/incoming.js -> lib/ipc/graceful.js -> lib/ipc/forward.js` | runtime/value import edges found in source |
| fastify | — | (no cycles reported) | 0 findings |
| commander.js | — | (no cycles reported) | 0 findings |

Total: 6 cycles, 6 TP, 0 FP, 0 unknown.

## Detector bugs found

- **Gate (a):** No mismatch found.
- **Gate (b):** No detector bug; this is a performance miss against the <2s target.
- **Gate (c):** No false positives found. Two cycles required manual source inspection because the initial text-search heuristic missed `./` and directory-index imports; the benchmark verifier was improved and the results JSON was corrected with manual evidence. No `src/` changes were made.

## Artifacts

- `benchmark/roadmap-gates.mjs` - benchmark script.
- `benchmark/roadmap-gates-results.json` - machine-readable results.
- `tests/roadmap-gates-r13.test.ts` - normalization/comparison helper fixtures.
