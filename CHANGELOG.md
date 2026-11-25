# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `ts/unused-file` no longer flags files wired in by nested `index.html` module scripts (including root-relative `src`) or vite/laravel-style `input:` config entries; `deps/unlisted-dependency` skips `docs/` and fixture directories. `benchmark/run.mjs` now also compares unused files, dependencies and unlisted imports against knip and reports `code/high-complexity` counts; results in `benchmark/README.md`.
- `deps/unused-dependency` now analyses every workspace `package.json` separately (a dependency is used only if a file owned by that package, its scripts or its config references it); findings point at the workspace's own `package.json`. The root package still counts usage anywhere in the repo, since it may serve hoisted dependencies. `@types/x` is flagged when `x` is declared in the same package and unused (never `@types/node`). `benchmark/run.mjs` now compares unused dependencies per `package.json#name`.
- `deps/unused-dependency` (dead-code, warn): flags packages in root `package.json` `dependencies`/`devDependencies` that nothing imports/requires and no script or root config-file name references, sparing common tooling (`typescript`, `vitest`, `jest`, `tsx`, `ts-node`, `prettier`, `eslint*`, …). Finding is on the `package.json` line of the dep key.
- `deps/unlisted-dependency` (dead-code, warn): flags bare import specifiers (non-relative, non-`node:` builtin, non-tsconfig alias) whose package name is not declared in root `package.json` `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; silent when no `package.json` exists at the scan root.
- `ts/unused-file`: new structural dead-code detector (severity `warn`, confidence ~0.8) flagging source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs`) that no other scanned file imports (static, dynamic, `require`, export-from or side-effect imports) and that are not entry points (package.json targets, root/framework routing files, config files, test/spec/storybook files).
- `code/high-complexity`: new structural detector flagging functions, methods and arrows whose cognitive complexity exceeds `complexityMax` (SonarSource-style: +1 per control construct, +1 per nesting level, +1 per logical-operator sequence; recursion ignored; skips `.d.ts` and test files). The `complexityMax` config key (default 25) is added to `DEFAULT_CONFIG` and the `UnshitConfig` contract, and documented in README.
- `code/duplicate-block` now also reports a logic block repeated within a single file (confidence 0.7, only regions of at least 1.5x `cloneMinTokens` with at least 6 branch tokens, so repeated JSX markup is ignored; one finding per repeated region).
- `benchmark/run.mjs` and `benchmark/README.md`: reproducible comparison of unused-export and duplicate-block findings against knip and jscpd, with hand-checked disagreements.


- `unshit note <rule> "text" --kind false-positive|improvement|scope-gap` and `unshit notes`: record local feedback in `.unshit/feedback.jsonl` (git-ignored) and print it as a markdown backlog grouped by rule, so false positives and gaps found while using the tool feed the next fix.

### Fixed

- `ts/unused-export` / `ts/unused-type-export` no longer flag symbols reachable from `package.json` `exports`/`main`/`types`, files under `integrations/`, Next app-router convention exports (`metadata`, `dynamic`, `GET`, ...), `*Props` types, or types used only inside their own module.
- `react/god-file` skips Python `test_*.py`, `tests/`, `migrations/` and generated `.g.dart` / `_pb2.py` files, and applies a 2x line limit to Rust/Dart/Python.
- `arch/import-cycle`: Python `from . import sibling` no longer adds a package `__init__` edge that produced false cycles.
- `css/duplicate-selector` only compares within one file and ignores `:root`/`:host`/`html`/`body`/`*`.
- Default excludes add `.dart_tool`, and `static/lib` / `static/vendor` directories are skipped at any depth; generated `.g.dart`, `.freezed.dart` and `_pb2.py` files are skipped. `cloneMinTokens` default raised from 45 to 80 to cut `code/duplicate-block` noise.

### Changed
- `code/duplicate-block`: duplicate-window signatures now start at every token position (was every third), so identical regions at different offsets in two files are no longer missed. On the auctions and bidshop frontends this goes from 0 to 3 cross-file clones, against 2 from jscpd. The logic-density floor stays at 3 to avoid JSX boilerplate noise.
- `ts/unused-type-export` now also reports types that are exported but only used inside their own file (suggesting to drop `export`), matching knip. `*Props` types stay skipped.
- `ts/unused-export` and `ts/unused-type-export` now use import-binding analysis instead of identifier-name counting: specifiers are resolved with the tsconfig-aware resolver, default and named imports are distinguished, `export *`/`export {…} from` chains, namespace member access, `import()`/`require` and `import.meta.glob` are followed, and side-effect imports consume nothing. Unused default exports are reported. Unresolvable internal specifiers fall back to name matching.
- `ts/unused-export` / `ts/unused-type-export` now also treat more files as entry points, matching knip: HTML files with `<script type="module" src>` (their targets, read from disk), `package.json` `scripts` that run files (`node x.js`, `tsx x.ts`, `ts-node`, `vite-node`) and `bin` maps in root and workspace manifests, `*.stories.*`/`__mocks__`/`e2e`/`cypress`/`playwright` files, and framework routing dirs (Next `pages/`, Nuxt `pages/`/`layouts/`/`middleware/`/`plugins/`/`server/`, SvelteKit `src/routes/+*`, Remix `app/routes/`, Astro `pages/`).

- README, ROADMAP and ARCHITECTURE corrected to match the code: unproven benchmarks are labelled targets, unimplemented items are marked planned, and the rule/layout/command lists are current.

## [0.7.0] - 2026-11-25

### Added

- `NOTICE` file documenting `Mohamed Ashraf / Crewloom` copyright attribution and trademark notice under the MIT license.
- Import graph parses Vue/Svelte `<script>` blocks (static imports, re-exports, `require()`) and Rust `mod` / `use crate::` / `super::` / `self::` edges, including grouped uses and `.vue`/`.svelte` target resolution.
- `.gitignore` support during file discovery: root and nested scopes with comments, blank lines, anchoring, directory-only rules, `*` / `**` globs, and negation.

### Fixed

- Release workflow strips empty `_authToken` placeholders and requires npm >= 11.5.1 so `npm publish --provenance` works with OIDC Trusted Publishing.

## [0.6.0] - 2026-11-25

### Added

- v0.6.0 Project Structure Health: `unshit structure [path]` reports archetype, layout, import resolution, cycles, boundary leaks, and an explainable verdict.
- Five `structure/*` rules, including error-level `structure/cross-package-import`, plus deep imports, shared-to-feature leaks, feature cycles, and junk drawers.
- TypeScript `paths`/`baseUrl` alias resolution and a Dart `package:` import graph for structure analysis.
- `structure` config (`featureContainers`, `allow`, `tangleMinFiles`) with validation and `structure --fail-on error|warn|info` for CI gating.

### Fixed

- Exclude `vendor`, `storage`, `__pycache__`, `venv`, `.venv`, path-based excludes, `.min.{css,js,mjs,cjs}` / `.bundle.js`, and compiled/sourcemap bundles from scanning.
- Support `jsconfig.json`, Vite root-absolute `/...`, Laravel `@/ -> resources/js` aliases, static `require()`, and exclude non-graphable `.vue`/asset specs from `resolvedRatio`.
- Fix `structure/shared-imports-feature` false positives on Flutter `lib/` and nested folders like `resources/js/Layouts/Components/`, and cache `tsconfig` parsing (`readDirectory: () => []`) + `WeakMap` graph cache.

## [0.5.1] - 2026-11-25

### Added

- CI workflow, tag-driven release workflow, and the `pnpm release` script.
- Changed-line filtering for `guard --changed --lines` via `getChangedLineRanges()`.
- `unshit hotspots [path]` ranking files by git churn and finding density (`--since`, `--top`, `--json`).
- `css/design-drift` rule: flags hardcoded colors when design tokens exist and suggests the matching `var(--token)`.

### Fixed

- SARIF output and the MCP server now report the real package version instead of `0.1.0`.
- Package `repository`, `homepage`, and `bugs` links point to the actual GitHub repository.

## [0.4.1] - 2026-11-25

### Added

- CSS waivers and exemptions.
- Separate reporting for unused type exports.
- Clone detection based on the TypeScript scanner.

### Fixed

- Hardened i18n `en` / `!==` ternary detection and CSS `!important` / string parsing.

## [0.4.0] - 2026-11-25

### Added

- Architecture import graph with cycle and layer rules.
- `unshit init`, the OpenCode plugin, and the `fix --swarm` worktree fixer.
- Polyglot scanners, `guard --changed`, and the live AI hook (developed as 0.2.x, first published here).

### Fixed

- Hardened hook Edit diffing, polyglot masking, and the multiset guard.

## [0.1.3] - 2026-11-25

### Fixed

- Fewer i18n layout false positives; overlapping clone windows are merged.

## [0.1.2] - 2026-11-25

### Fixed

- npm package metadata.

[Unreleased]: https://github.com/elbayoumi/unshit/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/elbayoumi/unshit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/elbayoumi/unshit/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/elbayoumi/unshit/compare/v0.4.1...v0.5.1
[0.4.1]: https://github.com/elbayoumi/unshit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/elbayoumi/unshit/releases/tag/v0.4.0
