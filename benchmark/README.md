# Benchmark: unshit vs knip and jscpd

Reproduce:

```bash
mkdir /tmp/bench && cd /tmp/bench && npm init -y && npm i knip jscpd   # knip 6.48.0, jscpd 5.4.3 were used
cd <unshit repo> && pnpm build
node benchmark/run.mjs <corpus-dir>... --tools /tmp/bench --out results.json
```

The script runs each tool on each corpus and compares **unused exports/types** (unshit `ts/unused-export` +
`ts/unused-type-export` vs knip `exports` + `types`) and **duplication** (unshit `code/duplicate-block` vs jscpd at
`--min-tokens 80`, which matches unshit's default `cloneMinTokens`). It also compares **unused files**
(`ts/unused-file` vs knip `files`), **unused and unlisted dependencies** (`deps/unused-dependency` and
`deps/unlisted-dependency` vs knip `dependencies`/`devDependencies`/`unlisted`) and reports unshit's
`code/high-complexity` count (knip has no equivalent).

## Results (2026-11-25, Node 26, macOS, 5 real TS/JS repos, 20–50 files each plus unshit itself)

Unused exports use import-binding analysis (resolved specifiers, default/named, `export *` chains, namespace members,
`import()`/`require`); it replaced an identifier-count heuristic in this release.

| Corpus | unshit exports | knip exports | both | unshit ms |
|---|---|---|---|---|
| unshit (self) | 32 | 20 | 20 | 556 |
| frontend | 1 | 1 | 1 | 232 |
| app-3 | 1 | 1 | 1 | 218 |
| app-4 | 3 | 2 | 2 | 216 |
| backend | 0 | 0 | 0 | 224 |

unshit now finds every export knip finds on all five corpora (nothing is knip-only). Its extra findings are listed
in the table below.

Duplication (unshit vs jscpd): self 4 vs 6, frontend 6 vs 2, app-3 6 vs 2, app-4 2 vs 1, backend 0 vs 0.
unshit also reports same-file repeats (3 of the 6 on each frontend); same-file regions need at least 6 branch tokens so
repeated JSX markup is not flagged. jscpd still finds 2 more clones in unshit itself. The counts are not a one-to-one
match, so check overlap before reading them as recall or precision.

## Files, dependencies, complexity (same 5 corpora)

| Corpus | unused files (unshit / knip / both) | unused deps (unshit / knip / both) | unlisted (unshit / knip) | high-complexity |
|---|---|---|---|---|
| unshit (self) | 0 / 6 / 0 | 0 / 0 / 0 | 0 / 0 | 27 |
| frontend | 0 / 0 / 0 | 16 / 16 / 16 | 1 / 1 | 2 |
| app-3 | 0 / 0 / 0 | 16 / 16 / 16 | 1 / 1 | 2 |
| app-4 | 1 / 1 / 1 | 2 / 4 / 2 | 0 / 0 | 2 |
| backend | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |

Disagreements, hand-checked:

| Finding | Who flagged | Verdict |
|---|---|---|
| app-4 unused file, `@google/genai`, `autoprefixer` | both | Correct. |
| `tsx`, `vite` (app-4) | knip only | Both are CLI tooling; unshit deliberately spares tooling packages (scripts, configs). Judgement call. |
| `react-dom`, `@types/react-dom`, `@frontend/tokens` (frontends) | both (now) | Correct, per workspace package (counts are `package.json#dependency` pairs). Were unshit misses before per-workspace analysis; `@types/x` is flagged only when `x` is declared and unused in the same package. |
| `react` unlisted in `packages/core` (frontends) | both | Correct: a phantom dependency resolved from the monorepo root. |
| `apps/shell/src/main.tsx`, `resources/js/app.js` | unshit (early run) | False positives, fixed: nested `index.html` module scripts and vite/laravel `input` entries are now entry points. Both are covered by tests. |
| `@prisma/client` unlisted in `docs/research/**` | unshit (early run) | False positive, fixed: `docs/` and fixture directories are skipped. |
| 6 unused files in unshit itself (`integrations/`, `benchmark/run.mjs`, research fixtures) | knip only | Intentional: unshit treats `integrations/` as entry and docs/benchmark scripts are run by hand, so these are not dead. |


| Finding | Who flagged | Verdict |
|---|---|---|
| `translations` (i18n.ts) | unshit | Correct: used only inside its own file. |
| `Registration` (types.ts) | unshit | Correct: zero references. knip missed it. |
| `ContactForm` (app-4) | unshit | Correct: never imported. knip missed it. |
| `Tokens` (packages/tokens/index.ts) | unshit | Correct within the repo: never imported. knip treats workspace package entries as public API. |
| `i18n` default export | both (now) | Correct: module is imported only for side effects. Was an unshit miss before binding analysis. |
| `inferShape`, `BASELINE_FILENAME` (unshit self) | both (now) | Correct: only the default / other names were imported. Were unshit misses before. |
| 12 exported types in unshit itself (e.g. `FeedbackEntry`) | unshit only | Exported but used only inside their own file, so unshit suggests dropping `export`. Verified `FeedbackEntry` has no outside importer. knip does not report these in this setup. |

## Caveats, honestly

- Small corpora; do not read a ranking into 5 repos. Hand-checked cases were all resolved in unshit's favour or tied.
  Locally used types are reported (like knip's `types` mode); dropping `export` from one that appears in a public signature can break declaration emit, so review before applying.
- knip understands plugins and framework entry points (tests, configs, Storybook, etc.) far more broadly. unshit
  covers `package.json` entries, root entry files, Next app-router conventions and `integrations/`, nothing more.
- unshit falls back to name matching when a specifier is internal but unresolvable, which can hide a real dead export.
- jscpd is mature and exact; unshit's clone detector is a token-window approximation tuned for fewer false positives.
- knip needs `node_modules` and a resolvable config; unshit needs neither.
- Runtimes are the same order of magnitude (~0.1-0.4 s); the repos are too small to compare scaling.
- unshit's unused-dependency check runs per workspace package but spares tooling packages (`tsx`, `vite`, ...), so knip
  still finds a few more. knip has far more plugins for deciding what a config file uses.
- unshit treats `integrations/` as entry points, which is why it finds none of knip's 6 self-reported unused files.
- unshit also reports ~18 other rule families that neither tool covers; this benchmark does not measure those.
