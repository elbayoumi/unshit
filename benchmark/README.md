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
| unshit (self) | 12 | 20 | 12 | 220 |
| auctions-platform-frontend | 3 | 1 | 0 | 193 |
| bidshop-frontend | 2 | 1 | 0 | 190 |
| rveta-site | 2 | 2 | 1 | 196 |
| auctions-platform-backend | 0 | 0 | 0 | 130 |

Duplication: jscpd found 1-2 clones per frontend corpus; unshit found 0 (its default threshold is stricter and it
only compares across files).

## Hand-checked disagreements

| Finding | Who flagged | Verdict |
|---|---|---|
| `translations` (i18n.ts) | unshit | Correct: used only inside its own file. |
| `AuctionRegistration` (types.ts) | unshit | Correct: zero references. knip missed it. |
| `ContactForm` (rveta) | unshit | Correct: never imported. knip missed it. |
| `Tokens` (packages/tokens/index.ts) | unshit | Correct within the repo: never imported. knip treats workspace package entries as public API. |
| `i18n` default export | both (now) | Correct: module is imported only for side effects. Was an unshit miss before binding analysis. |
| `inferShape`, `BASELINE_FILENAME` (unshit self) | both (now) | Correct: only the default / other names were imported. Were unshit misses before. |
| `ActiveTab`, `NotificationPriority`, 8 types in unshit itself | knip | Types exported but used only inside their own file. unshit skips these on purpose (dropping `export` can break declaration emit). Defensible either way; this is the remaining gap. |

## Caveats, honestly

- Small corpora; do not read a ranking into 5 repos. Hand-checked cases were all resolved in unshit's favour or tied,
  except the locally-used-type policy above.
- knip understands plugins and framework entry points (tests, configs, Storybook, etc.) far more broadly. unshit
  covers `package.json` entries, root entry files, Next app-router conventions and `integrations/`, nothing more.
- unshit falls back to name matching when a specifier is internal but unresolvable, which can hide a real dead export.
- jscpd is mature and exact; unshit's clone detector is a token-window approximation tuned for fewer false positives.
- knip needs `node_modules` and a resolvable config; unshit needs neither.
- Runtimes are the same order of magnitude (~0.1-0.4 s); the repos are too small to compare scaling.
- unshit also reports ~18 other rule families that neither tool covers; this benchmark does not measure those.
