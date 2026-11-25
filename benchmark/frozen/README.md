# Frozen unused-code suite

A small, hand-labelled benchmark for the five unused-code rules:

| Rule | What a true positive means |
|---|---|
| `ts/unused-export` | an exported runtime value is not referenced outside its own file |
| `ts/unused-type-export` | an exported type/interface is not referenced outside its own file |
| `ts/unused-file` | a source file is imported by no other scanned file and is not an entry point |
| `deps/unused-dependency` | a declared dependency is imported, required or config/script-referenced by nothing |
| `deps/unlisted-dependency` | a bare import names a package missing from the relevant `package.json` |

The suite is **frozen**: the fixtures and their labels are the ground truth. A failing
case is a detector result to report, not a label to edit. See [Frozen policy](#frozen-policy).

## Run

```bash
pnpm build
node benchmark/frozen/run.mjs
```

The runner executes `bin/unshit.js scan <case-dir> --format json` once per case and
compares only the five rules above. Other rules are ignored.

Exit code is `0` when every holdout rule has recall `>= 0.90` **and** the
hard-negative false-positive rate is `<= 0.02`; otherwise it is `1`. A missing
`dist/` (not built) exits `2` with a message.

## Layout

```text
benchmark/frozen/
├── run.mjs
├── README.md
├── eval/              # labelled calibration cases (reported, not gated)
├── holdout/           # labelled cases used for the recall gate
└── hard-negatives/    # cases that must produce zero findings
```

Each case is a directory with a tiny project and an `expected.json`:

```json
{
  "description": "One line describing the scenario.",
  "groundTruth": "Why these findings are the complete, correct answer.",
  "expected": [
    {
      "ruleId": "ts/unused-export",
      "file": "src/used.ts",
      "symbol": "dead",
      "reason": "Why this specific finding is correct."
    }
  ]
}
```

- `file` is relative to the case directory (the scan root).
- `symbol` is the exported name (`default` for a default export), the dependency
  package name for the dependency rules, and `null` for `ts/unused-file`.
- `expected` must list **every** finding of the five rules for that case — no more,
  no less. Hard-negative cases use `"expected": []`.
- `reason` is the ground-truth justification for one finding; `groundTruth` explains
  the case as a whole.
- Cases are plain files. There are no `node_modules`, no installs and no network.

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
- **A hard-negative case is clean only if all five rules report nothing.** A single
  finding makes the whole case a false positive for the FPR calculation.

## Metrics

- **Holdout recall (per rule)** = matched expected findings / expected findings.
  Only the `holdout/` suite is gated.
- **False-positive rate** = hard-negative cases with at least one unexpected finding
  / all hard-negative cases. A case with two false positives still counts once.
- **Eval recall** is printed for calibration but is not gated.

The runner also prints every miss and every false-positive finding, including the
case name and reason, so failures are actionable without re-running scans by hand.

## Current measured baseline

Measured on 2026-11-25 with Node 26.7.0 (macOS) after `pnpm build`:

```text
cases: 60 (eval 16, holdout 22, hard-negatives 22)

HOLDOUT RECALL
ts/unused-export           5/5   100.00%
ts/unused-type-export      4/4   100.00%
ts/unused-file             5/5   100.00%
deps/unused-dependency     7/7   100.00%
deps/unlisted-dependency   6/6   100.00%

HARD-NEGATIVE FPR
cases: 22   cases with >=1 FP: 0   FPR: 0.00%   unexpected findings: 0

EVAL (informational)
recall: 100.00% (21/21)   unexpected findings: 0
```

The suite passes all gates. It originally failed the FPR gate on `hard-negatives/next-app-router` (`ts/unused-file` flagged `app/layout.tsx` and `app/page.tsx`); that was fixed in `src/` by treating the Next.js `app/` router as entry points, and the case now guards against regression.

## Frozen policy

Cases are intentionally small and stable. To keep the benchmark comparable over time:

1. **Do not edit a fixture or its `expected.json` to make a failing detector pass.**
   If a case fails, report it. Fix the detector (with a unit test) separately.
2. **Changing a case requires a written justification** in the commit/PR: what was
   mislabelled, the evidence (file/line behaviour, framework documentation, a
   minimal reproduction), and why the new label is the correct ground truth. Prefer
   adding a new case over weakening an existing one.
3. **Adding cases is welcome.** Keep them self-contained, dependency-free and
   labelled by the rules above. Do not add a case that only restates an existing
   scenario with different names.
4. **Do not change the five tracked rules or the metric definitions** without also
   updating this README and explaining the before/after numbers.
