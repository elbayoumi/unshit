# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `unshit note <rule> "text" --kind false-positive|improvement|scope-gap` and `unshit notes`: record local feedback in `.unshit/feedback.jsonl` (git-ignored) and print it as a markdown backlog grouped by rule, so false positives and gaps found while using the tool feed the next fix.

### Fixed

- `ts/unused-export` / `ts/unused-type-export` no longer flag symbols reachable from `package.json` `exports`/`main`/`types`, files under `integrations/`, Next app-router convention exports (`metadata`, `dynamic`, `GET`, ...), `*Props` types, or types used only inside their own module.
- `react/god-file` skips Python `test_*.py`, `tests/`, `migrations/` and generated `.g.dart` / `_pb2.py` files, and applies a 2x line limit to Rust/Dart/Python.
- `arch/import-cycle`: Python `from . import sibling` no longer adds a package `__init__` edge that produced false cycles.
- `css/duplicate-selector` only compares within one file and ignores `:root`/`:host`/`html`/`body`/`*`.
- Default excludes add `.dart_tool`, and `static/lib` / `static/vendor` directories are skipped at any depth; generated `.g.dart`, `.freezed.dart` and `_pb2.py` files are skipped. `cloneMinTokens` default raised from 45 to 80 to cut `code/duplicate-block` noise.

### Changed

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
