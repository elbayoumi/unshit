# `unshit` — Architecture & Council Decision Record

> **Council Verdict:** Combine deterministic multi-domain static analysis (`knip` graph + `jscpd` clones + `oxc`/`biome` AST & fix applicability + `deslop` AI-slop heuristics) with a sandboxed, worktree-isolated AI fixer (`opencode` / `claude`) gated by baseline verification.

---

## 1. Lessons Synthesized from Top 5 OSS Tools

| Tool | License | What We Adopt | What It Lacks (Solved by `unshit`) |
|---|---|---|---|
| **knip** | ISC | Entry-point reachability, unused exports/deps graph | No CSS, clones, AI slop, or God-file splitting |
| **jscpd** | MIT | Token-window clone detection across files | Read-only; no auto-fix or AST refactoring |
| **biome** | MIT / Apache-2.0 | Safe vs. Unsafe fix `Applicability`, crisp diagnostics | No AI-slop heuristics or multi-pass AI orchestration |
| **oxc** | MIT | Fast AST visitor filtering, modular rule registry | JS/TS only; no CSS `!important` or God-file decomposition |
| **deslop** | MIT | 14 AI-slop heuristics, bottom-up edits + test-gate rollback | Regex/diff-only; no full AST/graph or worktree isolation |

---

## 2. Core Pipeline & Safety Invariants

```text
discover -> scan (read-only) -> pin (baseline) -> fix (deterministic -> AI worktree) -> verify -> commit | rollback
```

1. **Read-Only Discovery (`unshit scan`):** Capability-based `DetectorContext` exposes source, TS AST, CSS tokens, and config — **never** filesystem writes, network, or subprocesses.
2. **Pin Before Change (`unshit pin`):** Captures `unshit.baseline.json` (file hashes, baseline check status, 0–100 health score) before any mutation.
3. **Dry-Run Default (`unshit fix`):** Outputs unified patches and plan by default; `--apply` is required to mutate.
4. **Deterministic First, AI Last:** Mechanical fixes run via deterministic AST/text patches first. Complex refactors (`--ai` via `opencode` or `claude`) run in an isolated `git worktree` with path allowlists, diff budgets, and automatic rollback if `typecheck`/`test`/`build` regresses.
5. **Relapse Prevention (`unshit guard`):** Compares current scan against `unshit.baseline.json` for CI/pre-commit gates, supporting `// unshit-ignore: <ruleId> — <reason>`.

---

## 3. Built-in Detector Suite (v0.1)

| Rule ID | Tier | Category | What It Catches | Fixability |
|---|---|---|---|---|
| `css/no-important` | structural | css | `!important` abuse in stylesheets | unsafe / ai |
| `css/duplicate-selector` | structural | css | Repeated selector blocks across CSS files | ai |
| `ts/no-explicit-any` | structural | types | `: any`, `as any`, `catch (e: any)` | safe / ai |
| `ts/no-double-cast` | structural | types | `as unknown as` type-system bypasses | ai |
| `i18n/no-inline-ternary` | structural | i18n | Inline `isAr ? '...' : '...'` or locale/dir ternaries | ai |
| `react/god-file` | heuristic | architecture | Files >350 LOC or >15 React hooks | ai |
| `slop/magic-timer` | structural | slop | Raw `setTimeout(..., N)` without named constant | safe / ai |
| `slop/redundant-catch` | structural | slop | `try { ... } catch (e) { throw e; }` or empty catch | safe |
| `code/duplicate-block` | structural | duplication | Copy-pasted token blocks across files (`jscpd`-style) | ai |
| `ts/unused-export` | structural | dead-code | Exported symbols with zero cross-file references | safe |

---

## 4. Directory Layout

```text
unshit/
├── bin/unshit.js              # Executable CLI entrypoint
├── src/
│   ├── contracts.ts           # Detector, Finding, Patch, Score, Result<T,E>
│   ├── config.ts              # unshit.config.json / defaults / allowlists
│   ├── walker.ts              # Fast git-aware file discovery
│   ├── detectors/
│   │   ├── index.ts           # Registry of built-in detectors
│   │   ├── ts-ast.ts          # TS AST detectors (any, double-cast, timers, catch, i18n)
│   │   ├── css.ts             # CSS detectors (!important, duplicate selectors)
│   │   ├── god-file.ts        # LOC + React hook density detector
│   │   ├── clones.ts          # Token-window duplicate block detector
│   │   └── dead-exports.ts    # Cross-file export reachability detector
│   ├── core/
│   │   ├── scanner.ts         # Deterministic scan + finding deduplication/sorting
│   │   ├── scorer.ts          # 0-100 explainable health score
│   │   ├── pinner.ts          # unshit.baseline.json capture & diff
│   │   ├── fixer.ts           # Deterministic patcher + OpenCode/Claude worktree runner
│   │   └── reporters.ts       # Human terminal, JSON, SARIF, Markdown
│   ├── mcp/server.ts          # Read-only MCP server (unshit_scan, unshit_score, unshit_guard)
│   └── cli.ts                 # Command router: scan | pin | fix | guard | score | mcp
└── tests/
    └── detectors.test.ts      # Node test runner suite
```
