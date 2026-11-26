# Frozen rule suite

A hand-labelled benchmark covering all eleven gated rules: the original five
unused-code rules and the six rules added in round 9:

| Rule | What a true positive means |
|---|---|
| `ts/unused-export` | an exported runtime value is not referenced outside its own file |
| `ts/unused-type-export` | an exported type/interface is not referenced outside its own file |
| `ts/unused-file` | a source file is imported by no other scanned file and is not an entry point |
| `deps/unused-dependency` | a declared dependency is imported, required or config/script-referenced by nothing |
| `deps/unlisted-dependency` | a bare import names a package missing from the relevant `package.json` |
| `code/high-complexity` | a function/method/arrow's cognitive complexity is above the project's `complexityMax` |
| `arch/import-cycle` | the import graph has a strongly connected component (a real circular dependency) |
| `code/duplicate-block` | a token window of at least `cloneMinTokens` with enough logic tokens repeats across (or within) files |
| `react/god-file` | a module exceeds `godFileMaxLines` or `godFileMaxHooks` (with the polyglot line allowance) |
| `slop/redundant-catch` | a catch block is empty with no comment, or only rethrows its own binding |
| `ts/no-explicit-any` | a TypeScript source contains an explicit `any` keyword outside tests/declarations |

The suite is **frozen**: the fixtures and their labels are the ground truth. A
failing case is a detector result to report, not a label to edit. See
[Frozen policy](#frozen-policy). Round 9 added 120 cases (20 per new rule)
without changing any existing case or weakening the original runner.

## Run

```bash
pnpm build
node benchmark/frozen/run.mjs
```

The runner executes `bin/unshit.js scan <case-dir> --format json` once per case
and compares only the eleven rules above. Other rules are ignored unless a case
explicitly opts into them with its `rules` field.

Exit code is `0` when every holdout rule has recall `>= 0.90` **and** both the
case-level and every per-rule hard-negative false-positive rate are `<= 0.02`;
otherwise it is `1`. A missing `dist/` (not built) exits `2` with a message.
Stale or malformed known-gap entries also exit `2`.

## Layout

```text
benchmark/frozen/
├── run.mjs
├── README.md
├── known-gaps.json     # explicit, machine-readable gate exclusions
├── KNOWN-GAPS.md       # human-readable justification for each exclusion
├── eval/               # labelled calibration cases (reported, not gated)
├── holdout/            # labelled cases used for the recall gate
└── hard-negatives/     # cases that must produce zero findings for their scoped rules
```

Each case is a directory with a tiny project and an `expected.json`:

```json
{
  "description": "One line describing the scenario.",
  "groundTruth": "Why these findings are the complete, correct answer.",
  "rules": ["code/high-complexity"],
  "expected": [
    {
      "ruleId": "code/high-complexity",
      "file": "src/pricing.ts",
      "symbol": "priceOrder",
      "reason": "Why this specific finding is correct."
    }
  ]
}
```

- `file` is relative to the case directory (the scan root).
- `expected` must list **every** finding of the rules in scope for that case —
  no more, no less. Hard-negative cases use `"expected": []`.
- `reason` is the ground-truth justification for one finding; `groundTruth`
  explains the case as a whole.
- `rules` is optional. Without it, a case tracks all eleven rules (this is how
  the original 60 cases work). Round-9 cases declare one rule, so a near-miss
  is only a false positive for the rule it is designed to test.
- Cases are plain files. There are no installs and no network. Round-9 cases
  use small per-case `unshit.config.json` thresholds (`complexityMax`,
  `cloneMinTokens`, `godFileMaxLines`, `godFileMaxHooks`) so the code samples
  stay short and realistic.

### Label format (`symbol`)

A finding matches only when `ruleId`, `file` and `symbol` all match exactly.

| Rule | `symbol` |
|---|---|
| `ts/unused-export`, `ts/unused-type-export` | exported name (`default` for default exports) |
| `ts/unused-file`, `react/god-file` | `null` (file-level) |
| `deps/unused-dependency` | dependency package name |
| `deps/unlisted-dependency` | bare package name from the import |
| `code/high-complexity` | function name from the finding message |
| `arch/import-cycle` | exact cycle path from the evidence, e.g. `src/a.ts -> src/b.ts -> src/a.ts` |
| `code/duplicate-block` | `source file -> reported file`, parsed from the evidence (the reported file is the one in `file`) |
| `slop/redundant-catch`, `ts/no-explicit-any` | `line:column` of the finding span, so two occurrences in one file stay distinct |

## Labelling rules

A finding matches only when `ruleId`, `file` and `symbol` all match exactly. In
particular:

- **Exports are dead only when no other file consumes them.** A symbol used inside
  its own file is still reported (the export keyword is unnecessary), matching the
  detector's "used only locally" behaviour. A module that is imported only for its
  side effects does not consume its exports.
- **Type imports count for exports but not for file reachability.** A file imported
  only via `import type` is still reported by `ts/unused-file` in the current
  detector, so type-export fixtures also have a runtime import to isolate the
  intended rule. This is a fixture technique, not a claim that type-only imports
  should leave a file dead.
- **Entry points are not dead files.** `package.json` `exports`/`main`/`bin`/
  `scripts` targets, HTML module-script targets, config setup files, framework
  routes, root entry names (`src/index.ts`, …), tests/specs/stories and
  `integrations/` are entry points. Hard-negative cases cover these conventions.
- **Dependencies are used by imports, `require()`, dynamic `import()`, CSS
  `@plugin`/`@import`, package scripts, and root config file names/contents.**
  Common tooling prefixes (`typescript`, `vitest`, `tsx`, `eslint*`, …) and
  `@types/node` are deliberately spared; `@types/x` is reported only when `x` is
  declared and unused in the same package.
- **Bare imports are unlisted only when the package is undeclared** in the root or
  nearest workspace `package.json`. Relative imports, `node:`/Node builtins,
  tsconfig path aliases, the project's own name and workspace package names are
  not unlisted.
- **Complexity is scored per function**, with +1 per control construct, +1 per
  nesting level and +1 per logical-operator sequence. A file with many simple
  functions is clean; tests and `.d.ts` files are exempt.
- **An import cycle needs real graph edges.** Type-only imports, one-way re-export
  chains and strings/comments that mention `a -> b -> a` are not cycles.
- **Clones need logic, not just similar text.** Identifiers, literals and strings
  are normalized, but comments and import lists are stripped and a window needs
  at least three logic tokens. Test/spec files are exempt.
- **God-file is per file, not cumulative.** The polyglot line limit is 2x the TS
  limit; tests, generated files and Python migrations are exempt.
- **A catch with a comment or any handling is not redundant.** Rewrapping the
  error, returning a fallback or rethrowing a different identifier are all
  legitimate near-misses.
- **Explicit `any` means the AST keyword**, including casts, generics and catch
  bindings. Comments, strings, identifiers containing "any", tests and `.d.ts`
  files are clean.
- **A hard-negative case is clean only if the scoped rule reports nothing.** A
  single finding makes the whole case a false positive for that rule's FPR.

## Metrics

- **Holdout recall (per rule)** = matched expected findings / expected findings.
  Only the `holdout/` suite is gated.
- **False-positive rate** = hard-negative cases with at least one unexpected
  finding / all hard-negative cases (a case with two false positives still
  counts once). A per-rule table additionally gates FPR with only the cases that
  declare that rule in scope (legacy cases have all rules in scope).
- **Eval recall** is printed for calibration but is not gated.
- The runner prints every miss and every false-positive finding, including the
  case name and reason, so failures are actionable without re-running scans by
  hand.

### Known gaps

A detected failure that is not a detector edit in this worktree is recorded in
[`KNOWN-GAPS.md`](./KNOWN-GAPS.md) and, when it affects a gate, as an explicit
entry in [`known-gaps.json`](./known-gaps.json). Only the six round-9 rules may
be listed, so the original unused-code gates cannot be weakened through this
list. Each entry names the suite, case, `ruleId`, `file`, `symbol` and reason;
the runner **rejects entries that no longer match a current miss or false
positive** and prints every active exclusion. Eval-only misses are documented
in `KNOWN-GAPS.md` but are not gate exclusions, since eval is not gated.

## Current measured baseline

Measured on 2026-11-26 with Node v26.7.0 (macOS) after `pnpm build`:

```text
cases: 180 (eval 64, holdout 46, hard-negatives 70)

HOLDOUT RECALL (gate: per-rule recall >= 90.00%)
rule                       expected  matched  recall  missing
ts/unused-export           5         5        100.00%  0
ts/unused-type-export      4         4        100.00%  0
ts/unused-file             5         5        100.00%  0
deps/unused-dependency     7         7        100.00%  0
deps/unlisted-dependency   6         6        100.00%  0
code/high-complexity       4         4        100.00%  0
arch/import-cycle          3         3        100.00%  0   (1 documented gap excluded)
code/duplicate-block       4         4        100.00%  0
react/god-file             5         5        100.00%  0
slop/redundant-catch       4         4        100.00%  0
ts/no-explicit-any         4         4        100.00%  0

HARD-NEGATIVE FPR
cases: 70   cases with >=1 FP: 0   FPR: 0.00%   unexpected findings: 0
per-rule FPR: 0.00% for all eleven rules

EVAL (informational)  recall: 97.40% (75/77)   unexpected findings: 0
  misses: eval/cy-dynamic, eval/cy-self-import (dynamic-import / self-import cycles)

KNOWN GAPS: 1 gated exclusion (holdout/cy-lazy-three) + 2 eval-only misses
```

The suite prints `RESULT: PASS`. The original suite (60 cases) still passes all
gates unchanged; it originally failed the FPR gate on
`hard-negatives/next-app-router` (`ts/unused-file` flagged `app/layout.tsx` and
`app/page.tsx`), which was fixed in `src/` by treating the Next.js `app/` router
as entry points, and that case now guards against regression.

## Frozen policy

Cases are intentionally small and stable. To keep the benchmark comparable over time:

1. **Do not edit a fixture or its `expected.json` to make a failing detector pass.**
   If a case fails, report it in `KNOWN-GAPS.md`. Fix the detector (with a unit
   test) separately; another worker owns detector edits in round 9.
2. **Changing a case requires a written justification** in the commit/PR: what was
   mislabelled, the evidence (file/line behaviour, framework documentation, a
   minimal reproduction), and why the new label is the correct ground truth. Prefer
   adding a new case over weakening an existing one.
3. **Adding cases is welcome.** Keep them self-contained, dependency-free and
   labelled by the rules above. Do not add a case that only restates an existing
   scenario with different names.
4. **Do not change the tracked rules, gate thresholds or metric definitions**
   without also updating this README and explaining the before/after numbers.
   Gate exclusions must be explicit entries in `known-gaps.json` with a written
   reason in `KNOWN-GAPS.md`; never silently skip a failing case.
