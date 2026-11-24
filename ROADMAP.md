# `unshit` — Strategic Decision Record & Roadmap (`v0.2` → `v0.4`)

> **Council Verdict (Claude Code + OpenCode `beam-free` + Market Research):** Keep `unshit` a lean, zero-Docker, `<150 KB` MIT CLI. Solve the real polyglot + AI-slop gap in **3 strictly gated releases** (`v0.2` Relapse Prevention → `v0.3` Trustworthy Fixer → `v0.4` Scale-out Swarm & External Language Plugins).

---

## 1. The Market Gap (Why Existing Tools Fail)

Modern AI-assisted repositories are **polyglot monorepos** (TS/React + CSS + Rust sidecars + Python/Dart). Existing tools force a bad trade-off:

| Competitor | Overhead / Paywall | Fragmentation & Blind Spot |
|---|---|---|
| **SonarQube** | Heavy JVM + Elasticsearch + Docker (`>=4 GB` RAM); PR analysis paywalled | No AI-slop heuristics; no automated refactoring |
| **MegaLinter** | `3.2–4.4 GB` Docker image; 15+ separate linter configs | No unified 0–100 score, no diff-delta gate, no layer graph, no fixer |
| **Trunk.io / Qlty** | Cloud paywalls for PR trends & AI autofixes; BUSL-1.1 (Qlty) | Wraps external linters; no polyglot architecture graph or worktree AI fixer |
| **Biome / Knip** | Fast, MIT/ISC | **Web-only** (no Rust/Dart/Python); no cycle/layer graph or AI-gated fixer |
| **dependency-cruiser / import-linter / lakos** | Separate tool & config per language | Severely fragmented; polyglot repos need 3–4 incompatible tools |

**`unshit`'s Unserved Niche:** One zero-infra, `<150 KB` MIT CLI combining **0–100 hygiene scoring + polyglot slop/cycle/layer checks + free PR diff guards + test-gated worktree AI cleanup**.

---

## 2. Explicit Anti-Bloat Exclusions (YAGNI)

To ensure `unshit` never turns into a slow MegaLinter/SonarQube clone:
- **NO bundling WASM grammars (`tree-sitter`) or external compilers** (`rustc`, `ruff`, `dart`, `eslint`) inside core.
- **NO formatting/style wars** (Prettier/Biome/rustfmt own whitespace & quotes).
- **NO SAST/CVE/secret scanning** (Trivy/Gitleaks/Semgrep own security).
- **NO hosted SaaS server, Elasticsearch, background daemon, or Graphviz binary** (output terminal/JSON/SARIF/Mermaid text only).

---

## 3. Phased Execution Plan & Hard Exit Gates

### `v0.2` — Relapse Prevention (Zero New Runtime Deps)
1. **`unshit guard --changed [baseRef]`**
   - Resolves `git diff --name-only <baseRef>...HEAD` + working tree.
   - Runs full cross-file scan (so `ts/unused-export` and `code/duplicate-block` stay accurate), filters findings to changed files, and compares line-shift-resilient fingerprints against `unshit.baseline.json`.
   - Emits PR-ready **Markdown**, **SARIF**, and GitHub `::error` annotations + copy-paste GitHub Action snippet (no hosted PR bot server).
2. **`arch/import-cycle` Detector (Tarjan SCC)**
   - Integrated into the standard `Detector` registry (`category: 'architecture'`).
   - Reuses TS/JS import resolution + lightweight syntactic import edges for Rust (`mod`/`use`), Dart (`import`), Python (`import`/`from`).
3. **Zero-Dep Polyglot Heuristics**
   - Extend `code/duplicate-block`, `god-file` (LOC), and lightweight `slop/*` checks (`unwrap()` abuse in `.rs`, bare `except:` in `.py`, `dynamic` / `print` slop in `.dart`) to run on `FileEntry.lines`/`content` with zero extra dependencies.

**Exit Criteria (`v0.2`):**
- Packed tarball `< 150 KB`, zero new runtime dependencies.
- `--changed` findings on changed files match full-scan findings for those files (tested).
- Warm `--changed` run on a 1,000-file repo `< 2s`.
- `arch/import-cycle` has 0 false positives on 3 real repos.
- `unshit` scores **Grade A (>= 90)** on itself.

---

### `v0.3` — Trustworthy Fixer & Layer Governance
1. **Architecture Layer Rules (`layers` in `unshit.config.json`)**
   - Config schema: `layers: [{ name, include[], allowImportsFrom[] }]` emitting `arch/layer-violation` findings that participate in `pin` / `guard`.
2. **Hardened Single-Worktree `fix --ai`**
   - Runs inside an isolated `git worktree add --detach .unshit/wt/<id>` from pinned `HEAD` (never mutates main checkout directly).
   - Enforces path allowlist (`git diff --name-only`), diff budget, `verifyCommand`, and re-scan verification before fast-forward landing.

**Exit Criteria (`v0.3`):**
- `>= 70%` of AI fixes pass `verifyCommand` on a 30-finding corpus across 3 repos.
- `0` commits that regress `unshit.baseline.json`.
- Fault injection (kill mid-run, failing verify, out-of-allowlist edit) leaves main tree byte-identical.

---

### `v0.4` — Scale-Out (`--swarm`) & External Language Plugins
1. **`unshit fix --apply --ai --swarm`**
   - Partitions findings into **disjoint file sets** across up to `N` (default 3) parallel `git worktree` sandboxes under `.unshit/wt/<run>-<n>`.
   - Serial `git apply --3way` integration into a staging branch; any conflict drops that worker's patch (never auto-resolves conflicts).
   - Compare-and-swap landing (aborts if `HEAD` moved), crash journal at `.unshit/runs/<id>.json`, and `unshit fix --abort` cleanup.
2. **Out-of-Process Language Plugins**
   - External packages (e.g. `@unshit/detector-rust`, `@unshit/detector-python`) invoked via `unshit.config.json` `plugins[]`, emitting normalized `Finding[]` JSON while keeping core `< 150 KB`.

**Exit Criteria (`v0.4`):**
- 8 disjoint findings finish `>= 2x` faster than serial.
- 500 fuzzed runs produce `0` corrupted merges.
- Core tarball remains `< 150 KB`.
