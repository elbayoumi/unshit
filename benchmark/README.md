# Benchmarks

Every benchmark that backs a number in `docs/research/`. One section per benchmark:
purpose, exact command, prerequisites, outputs, measured runtime and the research doc it feeds.

## Prerequisites (apply to every benchmark)

- **Node >= 22** (measured with Node `v26.7.0`, `darwin/arm64`, Apple M5 Pro, 15 cores — a
  machine shared with other jobs, so absolute times move between sessions).
- **Install and build first.** Every script shells out to `bin/unshit.js`, which needs `dist/`:

  ```bash
  pnpm install --frozen-lockfile
  pnpm run build          # tsc -p tsconfig.json, ~1.6 s measured
  ```

- **Corpora.** The public corpora live at
  `/Volumes/data/projects/unshit-bench/corpus/{hono,zod,execa,fastify,commander.js}`.
  This repo ships **no download script**: clone the five public repos yourself into that
  layout (or point `UNSHIT_BENCH_CORPUS` / `--corpus` at your own copy). The corpus is
  read-only — every benchmark copies what it needs into a fresh OS temp directory and never
  writes inside the corpus.
- **Competitor tools** (only `benchmark/run.mjs` and `benchmark/g4/run.mjs` need them): a
  directory whose `node_modules/.bin` contains `knip`, `jscpd` (and for g4 also
  `dependency-cruiser`/`depcruise`, `oxlint`, `biome`). The default for g4 is
  `/Volumes/data/projects/unshit-bench/tools`; `run.mjs` takes `--tools <dir>`. Install the
  tools yourself (e.g. `mkdir /tmp/bench && cd /tmp/bench && npm init -y && npm i knip jscpd`),
  the same way you clone the corpora. Tool versions used for the committed g4 numbers are
  recorded in `docs/research/g4-head-to-head.md`.
- **Network**: none is used by any benchmark. `pnpm install`, the corpora and the competitor
  tools are the only things you fetch, and you fetch them yourself.

## Verified in this pass (2026-11-26)

Every command below was executed in this worktree on 2026-11-26 with Node v26.7.0 on
darwin/arm64. The runtime column is the measured wall clock of that exact command.
Where a script's default output path is a git-tracked file, the run used the script's own
`--out`/`--md`/`--raw` flags to write under `/tmp`, or the tracked file was restored
afterwards, so this pass committed no stale benchmark results.

| # | Benchmark | Command | Runtime (measured) | Research doc |
|---|---|---|---|---|
| 1 | Frozen rule suite | `node benchmark/frozen/run.mjs` | 16.7 s | `benchmark/frozen/README.md` |
| 2 | Recall (mutation injection) | `node benchmark/recall/run.mjs` | 10.0 s (dev), 10.9 s (holdout) | `docs/research/recall.md` |
| 3 | Recall-extra (7 rules + hard negatives) | `node benchmark/recall-extra/run.mjs` | 30.2 s | `docs/research/recall-extra.md` |
| 4 | Precision audit | `node benchmark/precision/sample.mjs` then `report.mjs` | 5.2 s + 0.04 s | `docs/research/precision-audit.md` |
| 5 | Fix soundness | `node benchmark/fix-soundness/run.mjs` | 36.3 s | `docs/research/fix-soundness.md` |
| 6 | G4 head-to-head (5 tools) | `node benchmark/g4/run.mjs --out … --raw …` | 30.2 s | `docs/research/g4-head-to-head.md` |
| 7 | unshit vs knip + jscpd | `node benchmark/run.mjs <corpus>… --tools … --out …` | 5.1 s (5 corpora) | this README (retired tables) |
| 8 | Hook latency, warm git repo | `node benchmark/hook-latency/run.mjs` | 1.5 s | `docs/research/hook-latency.md` |
| 9 | Hook latency, cold / `--no-cache` | `node benchmark/hook-latency.mjs` | 4.7 s | `docs/research/hook-latency.md` |
| 10 | Scan scale (200 / 1000 files) | `node benchmark/scale-bench.mjs` | 10.5 s | `docs/research/scan-scale.md` |
| 11 | Scan wall time | `node benchmark/scan-speed.mjs . --reps 5` | 6.2 s | `docs/research/scan-speed.md` |
| 12 | Roadmap v0.2 exit gates | `node benchmark/roadmap-gates.mjs` | 20.2 s | `docs/research/roadmap-gates.md` |
| 13 | Warm `guard --changed` latency | `node benchmark/changed-latency.mjs --out …` | 12.4 s | `docs/research/perf-r14.md` |
| 14 | `--changed` / cache equivalence | `node benchmark/changed-equivalence.mjs --out …` | 20.8 s | `docs/research/perf-r14.md` |
| 15 | Independent dead-code oracle | `node benchmark/oracle/run.mjs` | 27.0 s | `docs/research/oracle-audit.md` |
| 16 | Polyglot recall and FP | `node benchmark/polyglot/run.mjs` | 0.8 s | `docs/research/polyglot-recall.md` |

Commands with a documented default output that was **not** re-run verbatim in this pass
because it overwrites a tracked result file: the g4 and recall defaults (run instead with
their `--out`/`--md`/`--raw` flags) — everything else in this table ran exactly as written.

---

## 1. Frozen rule suite — `benchmark/frozen/`

**Purpose.** The gate: a hand-labelled suite of 188 cases (64 eval, 46 holdout,
78 hard-negatives) covering eleven rules, used to decide whether a build ships. Labels are
ground truth; a failing case is reported, never relabelled to pass.

**Command.**

```bash
pnpm run build && node benchmark/frozen/run.mjs
```

**Prerequisites.** Built `dist/` only. No corpus, no network, no competitor tools. The
runner exits `2` if `dist/` is missing, `1` if a gate fails, `0` otherwise.

**Outputs.** stdout only: per-case PASS/FAIL lines, per-rule holdout recall, hard-negative
FPR, eval recall, `RESULT: PASS`. No file is written; gate exclusions live in the tracked
`benchmark/frozen/known-gaps.json` / `KNOWN-GAPS.md`.

**Runtime.** 16.7 s measured in this pass (188 cases, `RESULT: PASS`).

**Research doc.** `benchmark/frozen/README.md` — case format, labelling rules, frozen
policy and the measured baseline.

## 2. Recall via mutation injection — `benchmark/recall/`

**Purpose.** Injects real defects into corpus copies and measures how many unshit finds:
six rules × 20 injections per project per seed, with Wilson 95% intervals.

**Command.**

```bash
pnpm run build
node benchmark/recall/run.mjs                              # dev seed 20261126
node benchmark/recall/run.mjs --seed 20261127             # holdout seed, run once on frozen code
```

Flags: `--corpus <dir>` (default `UNSHIT_BENCH_CORPUS` or
`/Volumes/data/projects/unshit-bench/corpus`), `--projects` (default
`hono,zod,execa,fastify`), `--per-rule 20`, `--min-files 25`, `--out`, `--md`, `--update`.

**Prerequisites.** Built `dist/`, the five public corpora. Projects with fewer than 25
eligible source files are skipped (`commander.js`). Corpus copies go to temp dirs.

**Outputs.** `benchmark/recall/results.json` and `docs/research/recall.md` by default;
pass `--out <file> --md <file>` to write elsewhere (that is how this pass ran it, under `/tmp`).

**Runtime.** 10.0 s (dev seed) and 10.9 s (holdout seed), measured in this pass with
output redirected to `/tmp`.

**Research doc.** `docs/research/recall.md` — pooled in-scope recall **447/447 (100.0%)**
on both seeds, charter target `>= 90.0%` met, plus the deliberately out-of-scope
entry-point injections (0/20 found, by design).

## 3. Recall-extra (seven rules, positives and hard negatives) — `benchmark/recall-extra/`

**Purpose.** Extends the injection method to the rules the first recall pass does not cover
(`arch/import-cycle`, `code/high-complexity`, `deps/unlisted-dependency`, `react/god-file`,
`slop/redundant-catch`, `ts/no-double-cast`, `ts/unused-type-export`) and pairs every
positive injection with a hard negative that must *not* be reported.

**Command.**

```bash
pnpm run build && node benchmark/recall-extra/run.mjs
```

Flags: `--corpus`, `--projects` (default `hono,zod,execa`, plus a generated
`synthetic-react` project), `--seeds` (default `20261126,20261127`), `--per-rule 15`,
`--neg-per-rule 10`, `--out`, `--md`.

**Prerequisites.** Built `dist/`, corpora. The synthetic React corpus is generated
deterministically by `benchmark/recall-extra/synthetic-react.mjs`.

**Outputs.** `benchmark/recall-extra/results.json` and `docs/research/recall-extra.md`
by default; this pass ran it with `--out /tmp/… --md /tmp/…`.

**Runtime.** 30.2 s measured in this pass (both seeds, defaults).

**Research doc.** `docs/research/recall-extra.md` — pooled recall 97.8–100.0% per rule
(4 of 7 rules at 100.0%), **0 false positives in every hard-negative row**, out-of-scope
entry-point injections 0/30 found.

## 4. Precision audit — `benchmark/precision/`

**Purpose.** Real-world precision: sample findings from corpus scans, hand-label them,
compute pooled and per-rule precision with Wilson intervals.

**Command** (two steps, in order).

```bash
pnpm run build
node benchmark/precision/sample.mjs     # stratified sample -> benchmark/precision/sample.json
node benchmark/precision/report.mjs     # sample + labels -> results.json + docs/research/precision-audit.md
```

**Prerequisites.** Built `dist/`, the five corpora. `labels.json` is hand-produced ground
truth (seed `20261128`, up to 15 findings per rule per corpus).

**Outputs.** `benchmark/precision/sample.json`, `benchmark/precision/results.json`,
`docs/research/precision-audit.md`.

**Runtime.** `sample.mjs` 5.2 s, `report.mjs` 0.04 s, measured in this pass.

**Gotchas (measured in this pass).**

- `report.mjs` runs only against the **committed** `sample.json`. Re-running `sample.mjs`
  regenerates the sample from the current detector output (this pass produced 380 findings
  vs. the committed 395, because the detectors changed since labelling) and `report.mjs`
  then aborts with `missing labels for N sampled findings` until the new sample is
  hand-labelled. Treat `sample.mjs` as a label-refreshing step, not a routine re-run.
- `report.mjs` rewrites `docs/research/precision-audit.md` from scratch; paragraphs added
  by hand after generation (e.g. the "Status: fixed" note) are lost. Its numbers are
  otherwise byte-stable: this pass regenerated the same 394/395 result, differing only in
  the `Generated:` timestamp.

**Research doc.** `docs/research/precision-audit.md` — pooled precision **394/395 (99.7%)**,
Wilson 95% [98.6%, 100.0%].

## 5. Fix soundness — `benchmark/fix-soundness/`

**Purpose.** Proves `fix --apply` is safe on real code: copy each corpus project to temp,
run two fix passes, diff TypeScript program diagnostics before/after, and verify idempotency
and syntax validity of every patch.

**Command.**

```bash
pnpm run build && node benchmark/fix-soundness/run.mjs
# subset: FS_PROJECTS=hono,zod node benchmark/fix-soundness/run.mjs
```

**Prerequisites.** Built `dist/`, the five corpora, this repo's `typescript` package (the
only dependency). Runs on six workdirs: the five corpora plus a generated `scale-1000`
project.

**Outputs.** `benchmark/fix-soundness/results.json`, `docs/research/fix-soundness.md`, and
a stdout line `RESULT: PASS|WARN fixed=… newTscErrors=… syntaxFailed=… idempotent=…`.

**Runtime.** 36.3 s measured in this pass, ending `RESULT: PASS fixed=1220 newTscErrors=0
syntaxFailed=0 idempotent=true` (tracked outputs were restored afterwards).

**Research doc.** `docs/research/fix-soundness.md` — headline from that doc:
`RESULT: PASS fixed=1221 newTscErrors=0 syntaxFailed=0 idempotent=true`, with the
per-project tables (fastify has no `tsconfig`, so it gets no typecheck there).

## 6. G4 head-to-head — `benchmark/g4/`

**Purpose.** Run unshit and five competitor tools (knip, jscpd, dependency-cruiser, oxlint,
biome) on the same five corpus repos, 3 runs each, median wall time and raw counts side by
side. Counts only — no precision/recall claim.

**Command.**

```bash
pnpm run build
node benchmark/g4/run.mjs --out /tmp/g4-results.json --raw /tmp/g4-raw
# defaults (writes benchmark/g4/results.json and docs/research/g4-raw/) — NOT re-run in this pass:
# node benchmark/g4/run.mjs
```

Flags: `--tools <dir>` (default `/Volumes/data/projects/unshit-bench/tools`, override with
`UNSHIT_BENCH_TOOLS`), `--corpus <dir>` (default `UNSHIT_BENCH_CORPUS`), `--out`, `--raw`,
or project names as positional args.

**Prerequisites.** Built `dist/`, corpora, and a tools dir with all five competitor binaries
on `node_modules/.bin`.

**Outputs.** JSON to `--out` and gzipped raw tool output to `--raw`; the committed defaults
are `benchmark/g4/results.json` and `docs/research/g4-raw/<project>/`.

**Runtime.** 30.2 s measured in this pass with `--out`/`--raw` under `/tmp`.

**Research doc.** `docs/research/g4-head-to-head.md` (counts, wall times, SHAs, honest
limitations) plus the hand-verified samples `docs/research/g4-precision-sample.md`,
`g4-precision-sample-2.md`, `g4-precision-sample-3.md`.

## 7. unshit vs knip + jscpd — `benchmark/run.mjs`

**Purpose.** The original two-tool comparison: unused exports/types/files/dependencies vs
knip, duplicate blocks vs jscpd at `--min-tokens 80`, plus unshit's own `code/high-complexity`
count. Overlaps (`both` / `only unshit` / `only knip`) are reported per corpus.

**Command.**

```bash
pnpm run build
node benchmark/run.mjs /Volumes/data/projects/unshit-bench/corpus/hono \
  /Volumes/data/projects/unshit-bench/corpus/zod /Volumes/data/projects/unshit-bench/corpus/execa \
  /Volumes/data/projects/unshit-bench/corpus/fastify /Volumes/data/projects/unshit-bench/corpus/commander.js \
  --tools /Volumes/data/projects/unshit-bench/tools --out /tmp/run-results.json
```

**Prerequisites.** Built `dist/`, corpora, and `knip` + `jscpd` under `--tools` (default
`BENCH_TOOLS` or `.`). Missing competitor binaries are skipped silently; a corpus without
`node_modules` produces a `knipError` instead of counts.

**Outputs.** A JSON summary on stdout; `--out <file>` writes the full per-corpus record.
Nothing is written unless `--out` is given.

**Runtime.** 5.1 s for all five corpora measured in this pass (about 1.0 s per corpus).

**Research doc.** This README. The result tables that used to live here were measured on
non-public corpora and were retired in this round; the committed, public-corpus
cross-tool numbers are in `docs/research/g4-head-to-head.md` (run 6), which supersedes
this script for reporting.

## 8. Hook latency, warm git repo — `benchmark/hook-latency/`

**Purpose.** The scenario the AI hook actually sees: a temp git repo with a staged change,
5 warmups, then 40 timed `unshit hook --stdin` Write payloads.

**Command.**

```bash
pnpm run build && node benchmark/hook-latency/run.mjs
```

**Prerequisites.** Built `dist/`. Creates and removes its own temp git repo.

**Outputs.** `benchmark/hook-latency/results.json` (p50/p95/min/max), tracked by git — this
pass ran it and then restored the file so the committed numbers stay the ones quoted in the
research doc.

**Runtime.** 1.5 s measured in this pass (`p50=29.3ms p95=34.5ms`).

**Research doc.** `docs/research/hook-latency.md`.

## 9. Hook latency, cold cache / `--no-cache` — `benchmark/hook-latency.mjs`

**Purpose.** The other end of the cache curve: 35 runs per scenario where `.unshit/cache` is
deleted before every run (cold-cache), and 35 runs with `--no-cache`.

**Command.**

```bash
pnpm run build
node benchmark/hook-latency.mjs [--runs 35] [--file src/core/scanner.ts] [--json]
```

**Prerequisites.** Built `dist/`. Exits 0 always (measurement only).

**Outputs.** stdout only (p50/p95/min/max per scenario), or JSON with `--json`. No file.

**Runtime.** 4.7 s measured in this pass (35 + 35 runs).

**Research doc.** `docs/research/hook-latency.md` (method and the lazy-TypeScript
before/after comparison; note the doc quotes run 8's warm-repo numbers, while this script
measures the cold-cache variants).

## 10. Scan scale — `benchmark/scale-bench.mjs` + `benchmark/scale-project.mjs`

**Purpose.** Charter budgets at real scale: generate deterministic synthetic projects of
exactly 200 and 1000 TypeScript files, then time a full scan against the 1500 ms / 3000 ms
budgets (cold and cached).

**Command.**

```bash
pnpm run build && node benchmark/scale-bench.mjs [--reps 5] [--seed 20261126] [--out report.json]
```

**Prerequisites.** Built `dist/` only — no corpus needed. Generated projects are written
under the OS temp dir, never inside the repo.

**Outputs.** stdout table with per-size medians, findings SHA-256 and `RESULT: PASS` when
both budgets hold; `--out <file>` adds the full sample record (this pass:
`/tmp/r14-scale.json`).

**Runtime.** 10.5 s measured in this pass. Result: `200 files 219.0 ms / 1000 files 593.9 ms`
(no-cache medians, budgets 1500/3000 ms) → `RESULT: PASS`; the findings digests matched the
ones recorded in `docs/research/scan-scale.md`.

**`benchmark/scale-project.mjs`** is the generator library used by this benchmark (and by
`roadmap-gates.mjs` and `fix-soundness/run.mjs`); it has no CLI of its own — call
`generateProject(dir, count, seed)` from another script, or import it as
`tests/scan-scale.test.ts` does.

**Research doc.** `docs/research/scan-scale.md`.

## 11. Scan wall time — `benchmark/scan-speed.mjs`

**Purpose.** Median full-scan wall time for arbitrary real targets, with and without the
content-hash cache, on fresh copies.

**Command.**

```bash
pnpm run build && node benchmark/scan-speed.mjs <dir>... [--reps 5] [--out report.json]
# measured this pass:
node benchmark/scan-speed.mjs . --reps 5 --out /tmp/r14-scan-speed.json
```

**Prerequisites.** Built `dist/`, and directories to copy (each target is copied to a temp
dir; `node_modules`, `.git`, `.unshit` and `dist` are excluded from the copy).

**Outputs.** stdout table (per-target no-cache/cached medians and speedup); `--out <file>`
writes the JSON record.

**Runtime.** 6.2 s for one target (this repo, 5 reps) measured in this pass:
`509.3 ms` no-cache / `439.2 ms` cached.

**Research doc.** `docs/research/scan-speed.md`.

## 12. Roadmap v0.2 exit gates — `benchmark/roadmap-gates.mjs`

**Purpose.** The three roadmap gates: (a) `guard --changed` parity with a full scan on
changed files, (b) warm `guard --changed` latency on a generated 1000-file repo, and
(c) an `arch/import-cycle` false-positive audit over the five corpora.

**Command.**

```bash
pnpm run build && node benchmark/roadmap-gates.mjs
```

**Prerequisites.** Built `dist/`, the five corpora, seed `20261129` (deterministic edits and
project generation). The corpus is copied, never modified.

**Outputs.** `benchmark/roadmap-gates-results.json` (tracked; the committed file is the
measurement quoted in the research doc) plus a per-gate stdout summary. This pass ran the
command exactly and then restored the tracked results file — its gate (b) latency differs
from the committed doc because that number is load-dependent (this pass: median 667.0 ms
warm; the doc's r13 measurement: median 2777.5 ms under heavier load).

**Runtime.** 20.2 s measured in this pass (gates (a) and (c) reproduced: 5/5 corpora equal,
0 false-positive cycles among the 6 reported).

**Research doc.** `docs/research/roadmap-gates.md`.

---

## 13. Warm `guard --changed` latency — `benchmark/changed-latency.mjs`

**Purpose.** Roadmap gate (b): median < 2000 ms, p95 < 2500 ms for warm
`guard --changed --base HEAD` on a generated 1000-file TS project, after one seeded edit and
again untouched.

**Command.** `pnpm run build && node benchmark/changed-latency.mjs [--runs 9] [--seed 20261129] [--out <file>]`

**Prerequisites.** Built `dist/` and `git`. No corpus. Works in an OS temp directory.

**Outputs.** stdout summary; `--out` defaults to the tracked
`benchmark/changed-latency-results.json`.

**Runtime.** 12.4 s measured in this pass (`--out` under `/tmp`, target PASS).

**Research doc.** `docs/research/perf-r14.md`.

## 14. `--changed` and cache equivalence — `benchmark/changed-equivalence.mjs`

**Purpose.** Correctness proof for the per-file cache index: full-scan findings and
`guard --changed` findings must be identical with and without the cache on the five corpora
and on unshit itself, after three seeded edits.

**Command.** `pnpm run build && node benchmark/changed-equivalence.mjs [--out <file>]`

**Prerequisites.** Built `dist/`, `git`, the corpora. Copies everything to temp worktrees.

**Outputs.** stdout summary; `--out` defaults to the tracked
`benchmark/changed-equivalence-results.json`.

**Runtime.** 20.8 s measured in this pass (`allEqual: true`).

**Research doc.** `docs/research/perf-r14.md`.

## 15. Independent dead-code oracle — `benchmark/oracle/`

**Purpose.** Cross-checks every `ts/unused-file`, `ts/unused-export`,
`ts/unused-type-export` and `deps/unused-dependency` finding on the five corpora with a
text-only oracle that shares no code with `src/`, classifying each as confirmed,
contradicted or undecided.

**Command.** `pnpm run build && node benchmark/oracle/run.mjs`

**Prerequisites.** Built `dist/` and the corpora (scanned from read-only copies).

**Outputs.** Tracked `benchmark/oracle/results.json` and `docs/research/oracle-audit.md`
(re-running changes only the `Generated:` timestamp). Hand-written notes are read from
`benchmark/oracle/investigations.md`.

**Runtime.** 27.0 s measured in this pass.

**Research doc.** `docs/research/oracle-audit.md`.

## 16. Polyglot recall and false positives — `benchmark/polyglot/`

**Purpose.** Seeded synthetic Rust, Python, Dart and CSS projects with 15 positives and 10
hard negatives per rule for `rust/no-unwrap`, `python/no-bare-except`,
`dart/no-dynamic-or-print`, `css/no-important`, `css/design-drift` and
`css/duplicate-selector`; matched by rule, file and exact line.

**Command.** `pnpm run build && node benchmark/polyglot/run.mjs`

**Prerequisites.** Built `dist/` only. No corpus, no network.

**Outputs.** Tracked `benchmark/polyglot/results.json` and
`docs/research/polyglot-recall.md` (re-running changes only the `Generated:` timestamp).

**Runtime.** 0.8 s measured in this pass.

**Research doc.** `docs/research/polyglot-recall.md`.

---

## Research docs without a benchmark script

`docs/research/import-cycle-dynamic.md` is a manual investigation (round 10) of dynamic
`import()` and self-import edges: no script produced it, the method is written out in the
doc itself. It is indexed in `docs/research/README.md`.

## Reading rules (honest caveats kept from the reports)

- Corpora are small; do not read a ranking out of five repos, and never out of raw counts
  alone — entry-point models and rule sets differ between tools.
- Recall injections deliberately skip entry/public-API (STAR-consumed) files; the
  out-of-scope rows (0/20, 0/30 found) are a documented scope limit, not missed recall.
- Absolute latencies move with machine load; quote the ratio or re-run, not a stale number.
- No detector is tuned to any of these benchmarks; misses are reported as measured.
