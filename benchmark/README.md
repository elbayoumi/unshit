# Benchmark: unshit vs knip and jscpd

Reproduce:

```bash
mkdir /tmp/bench && cd /tmp/bench && npm init -y && npm i knip jscpd   # knip 6.48.0, jscpd 5.4.3 were used
cd <unshit repo> && pnpm build
node benchmark/run.mjs <corpus-dir>... --tools /tmp/bench --out results.json
```

The script runs each tool on each corpus and compares **unused exports/types** (unshit `ts/unused-export` +
`ts/unused-type-export` vs knip `exports` + `types`) and **duplication** (unshit `code/duplicate-block` vs jscpd at
`--min-tokens 80`, which matches unshit's default `cloneMinTokens`).

## Results (2026-11-25, Node 26, macOS, 5 real TS/JS repos, 20–50 files each plus unshit itself)

Unused exports use import-binding analysis (resolved specifiers, default/named, `export *` chains, namespace members,
`import()`/`require`); it replaced an identifier-count heuristic in this release.

| Corpus | unshit exports | knip exports | both | unshit ms |
|---|---|---|---|---|
| unshit (self) | 32 | 20 | 20 | 556 |
| auctions-platform-frontend | 1 | 1 | 1 | 232 |
| bidshop-frontend | 1 | 1 | 1 | 218 |
| rveta-site | 3 | 2 | 2 | 216 |
| auctions-platform-backend | 0 | 0 | 0 | 224 |

unshit now finds every export knip finds on all five corpora (nothing is knip-only). Its extra findings are listed
in the table below.

Duplication (unshit vs jscpd): self 2 vs 6, auctions-frontend 3 vs 2, bidshop 3 vs 2, rveta 1 vs 1, backend 0 vs 0.
unshit now matches or exceeds jscpd on the frontends, but jscpd still finds 4 more clones in unshit itself; the counts are
not a one-to-one match, so check overlap before reading them as recall.

## Hand-checked disagreements

| Finding | Who flagged | Verdict |
|---|---|---|
| `translations` (i18n.ts) | unshit | Correct: used only inside its own file. |
| `AuctionRegistration` (types.ts) | unshit | Correct: zero references. knip missed it. |
| `ContactForm` (rveta) | unshit | Correct: never imported. knip missed it. |
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
- unshit also reports ~18 other rule families that neither tool covers; this benchmark does not measure those.
