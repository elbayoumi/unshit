# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `unshit fix` now offers a deterministic safe fix for `slop/magic-timer`: dry runs print a unified diff and never write, while `--apply` replaces plain decimal timer delays with module-level constants named from the enclosing function/variable and timer kind (e.g. `RETRY_DELAY_MS`, `POLL_INTERVAL_MS`), inserted after imports and directive prologues. Literals that are not plain decimal numbers, names that already exist in the file, and names claimed by another timer in the same file are skipped with a reason; fixes are idempotent. `css/no-important` remains unsafe (removing `!important` can change the cascade) and `ts/no-double-cast` remains AI-only.
- `benchmark/frozen/`: extended the frozen, hand-labelled suite from five unused-code rules to all eleven gated rules with 120 new cases (8 eval, 8 hard-negative and 4 holdout per rule for `code/high-complexity`, `arch/import-cycle`, `code/duplicate-block`, `react/god-file`, `slop/redundant-catch` and `ts/no-explicit-any`). `run.mjs` now gates per-rule holdout recall (>= 0.90) and per-rule hard-negative FPR (<= 0.02) in addition to the unchanged original gates, and excludes failures only through explicit entries in the new `known-gaps.json` (reasons in `KNOWN-GAPS.md`; stale entries are rejected). Current measurement: 180 cases, 100% gated recall, 0% hard-negative FPR, `RESULT: PASS`; one holdout dynamic-import-cycle miss and two eval-only cycle misses are documented as detector gaps without changing any detector or existing fixture.
- `benchmark/g4/run.mjs` and `docs/research/g4-head-to-head.md`: reproducible head-to-head comparison of unshit against knip, jscpd, dependency-cruiser, oxlint and biome on five real repositories (hono, execa, zod, commander.js, fastify), with median wall-clock times, exit codes, raw finding counts, overlapping-category side-by-side counts, raw outputs under `docs/research/g4-raw/`, and SHA-256 hashes.
- `unshit fix` now offers a deterministic safe fix for `deps/unused-dependency`: dry runs print a unified diff and never write, while `--apply` removes only the flagged key from its owning (root or workspace) `package.json`, preserving indentation and trailing newline. Every name is re-checked against current imports (`import`/`require`/dynamic/CSS), scripts, config fields/tool configs and CI workflows before removal; names still referenced anywhere, invalid manifests and edits that would change anything else are skipped with a reason. Fixes are idempotent.
- `unshit fix` now offers a deterministic safe fix for `ts/unused-file`: dry runs print a `DELETE` plan and diff without touching disk, while `--apply` deletes only files the detector flagged that are still unreferenced by any import form (static, re-export, `require`, dynamic `import()`), never entry points/config/test files and never files with a dirty git working tree or changed since the scan. A file edited by another deterministic fix in the same run is left for the next pass; re-running after a deletion is a no-op.
- Content-hash incremental cache for scan and hook: per-file results from per-file (non-cross-file) detectors are stored in `.unshit/cache/` (git-ignored), keyed by file content hash + unshit version + config hash. Cross-file detectors (import graph, dead code, duplicates, deps, design-drift) always run on full context so their results stay correct. `--no-cache` disables cache reads/writes. Cache never changes findings (covered by tests for identical cached/uncached results and per-file invalidation).
- `benchmark/frozen/`: a frozen, hand-labelled precision/recall suite for `ts/unused-export`, `ts/unused-type-export`, `ts/unused-file`, `deps/unused-dependency` and `deps/unlisted-dependency`. It contains eval/holdout/hard-negative fixture projects (60 cases) and `run.mjs`, which gates holdout recall at 0.90 per rule and hard-negative false-positive rate at 0.02. Current measurement: 100% holdout recall, 0% hard-negative FPR (the suite originally exposed a Next app-router false positive, now fixed). The directory is excluded from default scans.
- `unshit fix` now offers deterministic fixes for `ts/unused-export` and `ts/unused-type-export`: dry runs print a unified diff and never write, while `--apply` removes only the `export` modifier via TypeScript AST positions (the declaration is kept). Exports that could affect declaration emit (a type used in an exported signature of the same file), listed/default/ambient exports and declaration files are left untouched conservatively and reported with a reason. Fixes are idempotent; no files or dependencies are deleted.
- `ts/unused-file` no longer flags files wired in by nested `index.html` module scripts (including root-relative `src`) or vite/laravel-style `input:` config entries; `deps/unlisted-dependency` skips `docs/` and fixture directories. `benchmark/run.mjs` now also compares unused files, dependencies and unlisted imports against knip and reports `code/high-complexity` counts; results in `benchmark/README.md`.
- Framework entry-point awareness closed the remaining knip plugin gap (conservatively): Next.js `app/` router directories and `middleware` files are now entry points, Jest/Vitest `moduleNameMapper` patterns keep mapped files alive, and GitHub workflow `run:` script references (e.g. `node scripts/build.ts`) keep referenced files alive. `deps/unused-dependency` now spares packages referenced from CI workflow files, next to the existing script/config/tooling spares.
- `deps/unused-dependency` now analyses every workspace `package.json` separately (a dependency is used only if a file owned by that package, its scripts or its config references it); findings point at the workspace's own `package.json`. The root package still counts usage anywhere in the repo, since it may serve hoisted dependencies. `@types/x` is flagged when `x` is declared in the same package and unused (never `@types/node`). `benchmark/run.mjs` now compares unused dependencies per `package.json#name`.
- `deps/unused-dependency` (dead-code, warn): flags packages in root `package.json` `dependencies`/`devDependencies` that nothing imports/requires and no script or root config-file name references, sparing common tooling (`typescript`, `vitest`, `jest`, `tsx`, `ts-node`, `prettier`, `eslint*`, …). Finding is on the `package.json` line of the dep key.
- `deps/unlisted-dependency` (dead-code, warn): flags bare import specifiers (non-relative, non-`node:` builtin, non-tsconfig alias) whose package name is not declared in root `package.json` `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; silent when no `package.json` exists at the scan root.
- `ts/unused-file`: new structural dead-code detector (severity `warn`, confidence ~0.8) flagging source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs`) that no other scanned file imports (static, dynamic, `require`, export-from or side-effect imports) and that are not entry points (package.json targets, root/framework routing files, config files, test/spec/storybook files).
- `code/high-complexity`: new structural detector flagging functions, methods and arrows whose cognitive complexity exceeds `complexityMax` (SonarSource-style: +1 per control construct, +1 per nesting level, +1 per logical-operator sequence; recursion ignored; skips `.d.ts` and test files). The `complexityMax` config key (default 25) is added to `DEFAULT_CONFIG` and the `UnshitConfig` contract, and documented in README.
- `code/duplicate-block` now also reports a logic block repeated within a single file (confidence 0.7, only regions of at least 1.5x `cloneMinTokens` with at least 6 branch tokens, so repeated JSX markup is ignored; one finding per repeated region).
- `benchmark/run.mjs` and `benchmark/README.md`: reproducible comparison of unused-export and duplicate-block findings against knip and jscpd, with hand-checked disagreements.


- `fix --ai` now takes the same swarm lock as `fix --swarm`, so two concurrent single-file AI runs cannot land simultaneously; the HEAD compare-and-swap landing is covered by an automated race test.
- `unshit note <rule> "text" --kind false-positive|improvement|scope-gap` and `unshit notes`: record local feedback in `.unshit/feedback.jsonl` (git-ignored) and print it as a markdown backlog grouped by rule, so false positives and gaps found while using the tool feed the next fix.
- `unshit mcp`: new read-only MCP tool `unshit_check_patch` — input is a unified diff or `{ path, content }`; the server runs the real scanner/detectors on the in-memory proposed content and reports only the findings the patch would introduce (fingerprint diff against current file content) with severity and a pass/fail verdict; nothing is written to disk. MCP-protocol tests cover clean patches, introducing patches and malformed input.
- `fix --ai` now uses the same isolated git-worktree pipeline as `fix --swarm`: each AI edit runs in a temporary detached worktree, must pass the configured verify command there, and is only landed into the working tree through an allowlist-checked, compare-and-swap patch — a failed AI run, a diff outside the target file, or a failed verify leaves the tree untouched. Dry runs still invoke no AI; without a git repo the AI phase is skipped with a clear message.
- `unshit mcp`: two new read-only tools — `unshit_explain_architecture` returns the layer map (config layers/structure, project shape and structure verdict) and, for an optional file, its layer, allowed imports, importers and architecture findings; `unshit_fix_preview` returns the unified diffs of deterministic safe fixes for a file (optionally filtered by `ruleId`) using the existing dry-run fixer, without writing any file. MCP-protocol tests cover tools/list exposure, normal results, unknown paths and byte-identical files after a preview.
- `unshit context [path] [--write]`: new read-only command that prints a deterministic, dependency-free "project rules" markdown block for `AGENTS.md`/`CLAUDE.md`. The block lists the detected archetype, layout, source roots and packages (reusing the project-shape/project-archetype/project-manifests infra), the verify commands from `package.json` `scripts` (`typecheck`/`test`/`lint`/`build`), configured architecture layers and structure rules, and the active unshit rules with their numeric thresholds from config. `--write` inserts or replaces the block between `<!-- unshit:context:start -->` and `<!-- unshit:context:end -->` in `AGENTS.md` (creating the file when missing, leaving other content byte-identical); re-running is idempotent. README documents the command.
- `unshit pr [path] [--base <ref>] [--format human|markdown|json]`: new read-only PR review. It diffs the current branch against the base ref (default: `git merge-base origin/main HEAD`, falling back to `main`, `master`, `HEAD~1`) using the same changed-line ranges as `guard --changed --lines` and reports only findings introduced on changed lines, grouped by file with rule, severity, line and message. When the deterministic fixer (`runFix` dry run, `src/core/fixer.ts` + fixers) has a safe fix for a finding, a ready unified-diff suggestion is attached (```suggestion blocks for clean single-hunks, ```diff otherwise). Output ends with a summary verdict (pass/warn/fail) plus a score delta vs base when cheaply available. Exit code 1 when new error-severity findings exist, else 0; non-git directories print a clear message.
- `benchmark/hook-latency.mjs`: measures `unshit hook --stdin` cold-cache (cache dir deleted before each run) and `--no-cache` wall-clock latency over >=30 runs. On this repo (Node v26.7.0, darwin/arm64, 35 runs, `src/core/scanner.ts` Write payload): cold-cache p50 50.4ms / p95 54.3ms / min 49.3ms / max 60.2ms; `--no-cache` p50 55.2ms / p95 59.8ms / min 53.2ms / max 61.7ms (all exit 0).
- `benchmark/scan-speed.mjs` and `docs/research/scan-speed.md`: reproducible full-scan wall-time benchmark (median of 5, warm FS, `--no-cache` and cache-enabled) on copies of the corpus projects and this repo. The five TypeScript AST detectors now share a single memoized walk per source file instead of five (`ts-ast.ts`); findings are byte-identical on every corpus copy and on the repo itself.
- Scan-speed follow-up: module-specifier collection (`deps-shared.ts`), dynamic-import targets (`unused-file.ts`) and entry-point discovery (`dead-exports/entries.ts`) are now memoized per file/context, so repeated cross-file passes reuse one walk instead of re-parsing the same ASTs and re-walking directories. A new `tests/scan-walk-sharing.test.ts` guards call-pattern parity and memoization; all findings remain unchanged.

### Fixed

- `ts/unused-export` / `ts/unused-type-export` no longer flag symbols reachable from `package.json` `exports`/`main`/`types`, files under `integrations/`, Next app-router convention exports (`metadata`, `dynamic`, `GET`, ...), `*Props` types, or types used only inside their own module.
- `react/god-file` skips Python `test_*.py`, `tests/`, `migrations/` and generated `.g.dart` / `_pb2.py` files, and applies a 2x line limit to Rust/Dart/Python.
- `arch/import-cycle`: Python `from . import sibling` no longer adds a package `__init__` edge that produced false cycles.
- `css/duplicate-selector` only compares within one file and ignores `:root`/`:host`/`html`/`body`/`*`.
- `deps/unlisted-dependency`: recognizes runtime builtins (`bun:`, `deno:`, `jsr:`, `@std/*`) and skips `examples/`; `deps/unused-dependency`: scoped package names in scripts are now matched, and dependencies referenced by owned config/manifest files (e.g. tsconfig `extends`) count as used. `code/duplicate-block`: skips `.test-d.ts` and `locales/` directories. `arch/import-cycle`: ignores `.d.ts` declaration files. Added hard-negative cases and unit tests.
- Default excludes add `.dart_tool`, and `static/lib` / `static/vendor` directories are skipped at any depth; generated `.g.dart`, `.freezed.dart` and `_pb2.py` files are skipped. `cloneMinTokens` default raised from 45 to 80 to cut `code/duplicate-block` noise.
- Default excludes now also skip `benchmark/frozen`, `docs/`, `research/`, `fixtures/` and `__fixtures__/` at any depth, so docs/research benchmark fixtures produce no findings.

### Changed
- `unshit hook --stdin`: CLI dispatch is now lazy (hook loads only hook-path modules), hook-eligible detectors load without the full detector registry, `typescript` is loaded on demand via `createRequire` only when a TS/JS parse is needed, and `bin/unshit.js` enables Node's V8 compile cache. Warm-hook p95 for a `src/core/scanner.ts` Write payload dropped from ~125ms to ~50ms (p50 ~44ms, 35 runs, warm cache); bare `node -e 0` floor measured ~12ms on this machine.
- `code/duplicate-block`: duplicate-window signatures now start at every token position (was every third), so identical regions at different offsets in two files are no longer missed. On the auctions and bidshop frontends this goes from 0 to 3 cross-file clones, against 2 from jscpd. The logic-density floor stays at 3 to avoid JSX boilerplate noise.
- `ts/unused-type-export` now also reports types that are exported but only used inside their own file (suggesting to drop `export`), matching knip. `*Props` types stay skipped.
- `ts/unused-export` and `ts/unused-type-export` now use import-binding analysis instead of identifier-name counting: specifiers are resolved with the tsconfig-aware resolver, default and named imports are distinguished, `export *`/`export {…} from` chains, namespace member access, `import()`/`require` and `import.meta.glob` are followed, and side-effect imports consume nothing. Unused default exports are reported. Unresolvable internal specifiers fall back to name matching.
- `ts/unused-export` / `ts/unused-type-export` now also treat more files as entry points, matching knip: HTML files with `<script type="module" src>` (their targets, read from disk), `package.json` `scripts` that run files (`node x.js`, `tsx x.ts`, `ts-node`, `vite-node`) and `bin` maps in root and workspace manifests, `*.stories.*`/`__mocks__`/`e2e`/`cypress`/`playwright` files, and framework routing dirs (Next `pages/`, Nuxt `pages/`/`layouts/`/`middleware/`/`plugins/`/`server/`, SvelteKit `src/routes/+*`, Remix `app/routes/`, Astro `pages/`).

- README, ROADMAP and ARCHITECTURE corrected to match the code: unproven benchmarks are labelled targets, unimplemented items are marked planned, and the rule/layout/command lists are current.
- Dropped the `export` keyword from 32 locally-used or zero-reference symbols in `src/` reported by `ts/unused-export` and `ts/unused-type-export`. Every symbol was checked for outside importers (including default exports) first; runtime behaviour is unchanged.
- `src/cli.ts` is now a thin entry point with explicit dispatch tables; command handlers live in small `src/cli/*.ts` modules loaded by the same lazy `import()` paths as before, so CLI output and hook latency are unchanged and adding a command is a one-line table entry.
- `src/core/import-graph.ts` is now a thin re-export facade over a new `src/core/import-graph/` module directory (constants, types, util, ts, dart, python, rust, graph); behaviour and scan output are unchanged.
- `src/detectors/dead-exports.ts` split into cohesive modules under `src/detectors/dead-exports/` (entries, usage analysis, handlers, reporting) with the two high-complexity functions refactored into helpers; public exports unchanged and behaviour identical.

## [0.7.0] - 2026-11-25

### Added

- `NOTICE` file documenting `Mohamed Ashraf / Crewloom` copyright attribution and trademark notice under the MIT license.
- Import graph parses Vue/Svelte `<script>` blocks (static imports, re-exports, `require()`) and Rust `mod` / `use crate::` / `super::` / `self::` edges, including grouped uses and `.vue`/`.svelte` target resolution.
- `.gitignore` support during file discovery: root and nested scopes with comments, blank lines, anchoring, directory-only rules, `*` / `**` globs, and negation.

### Fixed

- `ts/unused-file` no longer reports files referenced only by type-only static imports/exports, `*.test-d.*` type-test files, `__tests__/` directories, or files matched by `node --test` glob arguments in package scripts. Package export targets resolving through `dist/`/`build/`/`lib/`/`out/` now also map to `src/` source files, so public package entry points are not reported as unused files or unused exports.
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
- Opt-in `unshit scan --deep` mode that uses `ts.createProgram` and the TypeChecker for more precise `ts/unused-export` detection, with soft fallback when tsconfig/program creation fails.

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
