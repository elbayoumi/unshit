# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/elbayoumi/unshit/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/elbayoumi/unshit/compare/v0.4.1...v0.5.1
[0.4.1]: https://github.com/elbayoumi/unshit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/elbayoumi/unshit/releases/tag/v0.4.0
