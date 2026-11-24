# `unshit`

> Open-source codebase detox CLI: deterministic dead-code, clone, CSS, i18n, and AI-slop scanner + gated AI fixer (`opencode` / `claude`).

Inspired by **knip** (reachability), **jscpd** (token-window clones), **biome** & **oxc** (AST diagnostics & fix applicability), and **deslop** (AI-slop heuristics) — unified under one contract with `pin` / `guard` regression gates and an MCP server.

---

## Install & Quick Start

```bash
npx unshit scan .
npx unshit score .
```

Or install globally / locally:

```bash
npm install -D unshit
```

### Commands

| Command | Purpose |
|---|---|
| `unshit scan [path]` | Read-only AST/CSS/clone/slop scan (`--format human\|json\|sarif\|markdown`, `--fail-on error\|warn\|info`) |
| `unshit score [path]` | Compute deterministic 0–100 health score (`Grade A–F`) |
| `unshit pin [path]` | Capture `unshit.baseline.json` characterization snapshot |
| `unshit guard [path]` | Fail CI/pre-commit on new unwaived findings or score regressions vs. baseline |
| `unshit fix [path]` | Dry-run by default; pass `--apply` for deterministic safe fixes (`+ --ai` for OpenCode/Claude with rollback) |
| `unshit mcp` | Start stdio MCP server (`unshit_scan`, `unshit_score`, `unshit_guard`) |

---

## Built-in Rules

| Rule ID | Tier | Severity | Description |
|---|---|---|---|
| `css/no-important` | structural | warn | Flags `!important` overrides (ignoring comments) |
| `css/duplicate-selector` | structural | info | Flags repeated selectors in the same `@media` / scope (skips `@keyframes`) |
| `ts/no-explicit-any` | structural | warn | Flags explicit `any` annotations and casts |
| `ts/no-double-cast` | structural | warn | Flags `as unknown as T` type-system bypasses |
| `i18n/no-inline-ternary` | structural | error | Flags inline `isAr` / `language === 'ar'` ternaries outside dictionaries |
| `react/god-file` | heuristic | warn | Flags modules exceeding `godFileMaxLines` (350) or `godFileMaxHooks` (15) |
| `slop/magic-timer` | structural | info | Flags raw numeric `setTimeout` / `setInterval` delays |
| `slop/redundant-catch` | structural | warn | Flags empty `catch {}` or `catch (e) { throw e; }` |
| `code/duplicate-block` | structural | info | Detects copy-pasted token blocks across files |
| `ts/unused-export` | structural | info | Flags exported symbols with zero cross-file references |

---

## Inline Waivers & Configuration

Suppress a specific line with a documented reason:

```ts
// unshit-ignore: ts/no-double-cast — legacy IPC bridge payload
const data = raw as unknown as BridgePayload;
```

Optional `unshit.config.json` in your project root:

```json
{
  "disabledRules": ["slop/magic-timer"],
  "godFileMaxLines": 400,
  "godFileMaxHooks": 15,
  "aiRunner": "opencode",
  "aiModel": "opencode/big-pickle",
  "verifyCommand": "npm run typecheck && npm test"
}
```

---

## Crewloom & AI Agent Integration

- **Crewloom Skill:** `.agent/skills/crewloom-unshit/SKILL.md`
- **MCP Server (Claude Code / Cursor / Antigravity):**
  ```json
  {
    "mcpServers": {
      "unshit": {
        "command": "npx",
        "args": ["-y", "unshit", "mcp"]
      }
    }
  }
  ```
- **CI / Pre-commit Guard:**
  ```bash
  npx unshit pin .
  npx unshit guard .
  ```
