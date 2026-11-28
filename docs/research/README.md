# Research reports index

Every report in `docs/research/`, with a one-line summary and the headline number **as
printed in that document**. Numbers were not re-measured here; each one comes from the doc
itself, which carries the machine, date and method behind it.

Excluded from this index (they belong to other work streams): `docs/research/reviews/`,
`docs/research/studies/` and `docs/research/PROTOCOL_LANDSCAPE_STUDY.md`.
`docs/research/g4-raw/` is not a report — it is the gzipped raw tool output backing
[g4-head-to-head](#reports).

`tests/benchmark-readme-r14.test.ts` keeps this index honest: every path listed here must
exist, and every top-level `docs/research/*.md` must be listed here.

## Reports

| Doc | What it is | Headline number (from the doc) | Produced by |
|---|---|---|---|
| [docs/research/recall.md](./recall.md) | Mutation-injection recall for six rules on four corpus repos, dev and holdout seeds, with Wilson intervals. | Pooled in-scope recall **447/447 (100.0%)** on both seeds; charter target `>= 90.0%` **MET**. | `node benchmark/recall/run.mjs` (`--seed 20261127` for holdout) |
| [docs/research/recall-extra.md](./recall-extra.md) | Extends injection recall to seven more rules and pairs every positive with a hard negative that must stay quiet. | Pooled recall **97.8–100.0%** per rule (4 of 7 rules at 100.0%); **0 false positives** in every hard-negative row; out-of-scope entry-point injections 0/30 found. | `node benchmark/recall-extra/run.mjs` |
| [docs/research/precision-audit.md](./precision-audit.md) | Seeded stratified hand-label sample of real findings across the five corpora; pooled and per-rule precision. | **394/395 (99.7%)**, Wilson 95% [98.6%, 100.0%] — the one FP is `slop/magic-timer` in a test file (since fixed). | `node benchmark/precision/sample.mjs` + `report.mjs` |
| [docs/research/fix-soundness.md](./fix-soundness.md) | Applies `fix --apply` to temp copies of every corpus project plus a generated 1000-file project and diffs tsc diagnostics before/after. | `RESULT: PASS fixed=1221 newTscErrors=0 syntaxFailed=0 idempotent=true`. | `node benchmark/fix-soundness/run.mjs` |
| [docs/research/g4-head-to-head.md](./g4-head-to-head.md) | unshit vs knip, jscpd, dependency-cruiser, oxlint and biome on the five corpus repos — 3 runs each, median wall time, raw counts side by side, no precision/recall claim. | Median-of-3 wall time **238–803 ms** for unshit across the five repos (e.g. hono: 642 unshit findings, 273 knip items, 699 jscpd clones). | `node benchmark/g4/run.mjs` |
| [docs/research/g4-precision-sample.md](./g4-precision-sample.md) | Round-9 hand audit of `ts/unused-file` / `ts/unused-export` **before** the entry-point fixes: FP causes classified one by one. | `ts/unused-file`: **4 TP of 45** sampled (40 FP, 1 debatable) — the pre-fix baseline the fixes were written against. | Manual hand-verification (no script) |
| [docs/research/g4-precision-sample-2.md](./g4-precision-sample-2.md) | Round-9 hand audit of `deps/unlisted-dependency`, `deps/unused-dependency`, `code/duplicate-block` and `arch/import-cycle`, with root causes and fixes. | `deps/unlisted-dependency` went **13 findings → 1** (12 of 13 were FPs, all fixed: `bun:`/`@std/*` builtins, `examples/` skipping). | Manual hand-verification (no script) |
| [docs/research/g4-precision-sample-3.md](./g4-precision-sample-3.md) | Round-10 seeded hand audit of `ts/unused-export`, `ts/unused-file`, `deps/unused-dependency`, compared against knip's verdict on the same items. | `ts/unused-export` precision **47/50 = 94.0%**, Wilson [83.8%, 97.9%] (`ts/unused-file` 44/50, deps 14/19). | Manual hand-verification (no script) |
| [docs/research/hook-latency.md](./hook-latency.md) | `unshit hook --stdin` latency before/after making the complexity detector build its `ts.SyntaxKind` set lazily instead of at module load. | Warm-repo p50 **49.5 ms → 30.5 ms** (p95 59.6 → 35.8 ms), interleaved A/B, ~40% faster. | `node benchmark/hook-latency/run.mjs` and `node benchmark/hook-latency.mjs` |
| [docs/research/import-cycle-dynamic.md](./import-cycle-dynamic.md) | Round-10 investigation: do dynamic `import()` edges and self-imports create cycle findings or corpus noise? | Corpus cycle count unchanged **6 → 6** after adding 24 dynamic `import()` call sites / 29 resolved edges; `scan .` stayed at score 100 / 0 findings. | Manual investigation (no script; method in the doc) |
| [docs/research/roadmap-gates.md](./roadmap-gates.md) | The three roadmap v0.2 exit gates: `--changed` parity, warm `--changed` latency, import-cycle FP audit. | 2 of 3 gates **PASS** (a: 5/5 corpora equal; c: 6 cycles → 6 TP, 0 FP). Gate (b) **MISS**: warm `guard --changed` median **2777.5 ms** vs the < 2000 ms target. | `node benchmark/roadmap-gates.mjs` |
| [docs/research/oracle-audit.md](./oracle-audit.md) | Independent text-only oracle classifies every dead-code finding on the five corpora as confirmed, contradicted or undecided. | Pooled 205 confirmed, 2 contradicted, 60 undecided of 267 (after the round-14 deps and unused-file fixes; first run: 6 contradicted of 276); precision bounds **76.8%–99.3%**, confirmed-only 99.0%. | `node benchmark/oracle/run.mjs` |
| [docs/research/perf-r14.md](./perf-r14.md) | Warm `guard --changed` latency on a 1000-file project before/after the per-file cache index, with an equivalence proof. | Median **620 → 586 ms** after an edit; gate (b) target met on this machine; findings identical with and without cache. | `node benchmark/changed-latency.mjs` + `node benchmark/changed-equivalence.mjs` |
| [docs/research/polyglot-recall.md](./polyglot-recall.md) | Seeded synthetic recall/FP benchmark for the Rust, Python, Dart and CSS rules. | Pooled recall **100%** (30/30) for all six rules, hard-negative FP **0/20** for all six, after the three detector bugs it found were fixed. | `node benchmark/polyglot/run.mjs` |
| [docs/research/scan-scale.md](./scan-scale.md) | Charter scale check on deterministic synthetic projects of exactly 200 and 1000 files, cold and cached. | no-cache medians **221.4 ms (200 files)** and **629.8 ms (1000 files)** vs 1500/3000 ms budgets → `RESULT: PASS`. | `node benchmark/scale-bench.mjs` |
| [docs/research/scan-speed.md](./scan-speed.md) | Round-10 full-scan wall time on real targets, controlled interleaved A/B of two builds. | This repo (125 files): **477.7 → 436.5 ms** no-cache, **−8.6%** (cached 375.8 → 351.9 ms). | `node benchmark/scan-speed.mjs` (plus a manual interleaved A/B) |

## Known limits (collected from the reports)

- **Small corpora, no rankings.** Five public repos with ~2257 total findings; counts are
  not a leaderboard, and raw counts are not precision or recall
  ([precision-audit](./precision-audit.md), [g4-head-to-head](./g4-head-to-head.md)).
- **Competitor runs are conditional on their environment.** The corpus ships without
  `node_modules`, so knip printed config-load errors and its counts are degraded; biome
  failed on one project whose `biome.jsonc` targets an older schema (count 0, error
  recorded); dependency-cruiser needed a symlinked TypeScript to parse the corpus
  ([g4-head-to-head](./g4-head-to-head.md)).
- **Precision ≠ recall.** The precision audit samples what was reported; it says nothing
  about missed defects ([precision-audit](./precision-audit.md)).
- **Injection scope excludes entry/public-API files.** STAR-consumed files are skipped by
  design: the out-of-scope injections are 0/20 found ([recall](./recall.md)) and 0/30 found
  ([recall-extra](./recall-extra.md)) — a documented scope limit, not a miss.
- **Some rules are not measurable on every corpus.** `react/god-file` has no `.tsx/.jsx`
  targets in hono, zod or execa, so a generated `synthetic-react` project stands in
  ([recall-extra](./recall-extra.md)).
- **The round-9/10 g4 samples are pre-fix audits.** Their false-positive counts describe
  the code as audited; several were fixed afterwards
  ([g4-precision-sample](./g4-precision-sample.md),
  [g4-precision-sample-2](./g4-precision-sample-2.md)).
- **Absolute latencies are load-dependent.** Hook p95 ranged from 35 ms to 179 ms across
  sessions on a shared machine (load average up to ~40) — the ratio held, the absolutes did
  not ([hook-latency](./hook-latency.md)). The same caveat applies to
  [roadmap-gates](./roadmap-gates.md) gate (b).
- **One roadmap gate is unmet:** warm `guard --changed` on a 1000-file repo measured
  median 2777.5 ms against a < 2000 ms target ([roadmap-gates](./roadmap-gates.md));
  a later run on a less loaded machine measured 620 ms before any change ([perf-r14](./perf-r14.md)),
  so the miss is load-dependent.
- **Synthetic scale numbers are generator-specific.** `scale-project.mjs` output is
  deliberately varied to avoid pathological clone blow-ups, and process startup dominates
  the smaller case; real heavily-duplicated repos may be slower
  ([scan-scale](./scan-scale.md)).
- **Fix soundness on plain JS uses syntactic diagnostics only.** `fastify` has no
  `tsconfig`, so it falls back to a synthesized TS program over `.js`/`.cjs`/`.mjs`
  (`allowJs`, `checkJs: false`, `getSyntacticDiagnostics` only); `scale-1000` is
  synthetic ([fix-soundness](./fix-soundness.md)).
- **The frozen suite gates only holdout and hard negatives;** `eval/` recall is printed for
  calibration and is not a gate, and gate exclusions must stay explicit in
  `benchmark/frozen/known-gaps.json` (`benchmark/frozen/README.md`).
