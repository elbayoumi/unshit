# Polyglot rule recall and false positives (Rust, Python, Dart, CSS)

Generated: 2026-11-26T21:11:43.676Z

## Method

- Rules measured: `rust/no-unwrap`, `python/no-bare-except`, `dart/no-dynamic-or-print`, `css/no-important`, `css/design-drift`, `css/duplicate-selector`.
- Seeds: 20261126 (dev), 20261127 (holdout). The generator is deterministic per seed (`benchmark/polyglot/generate.mjs`).
- Base corpus: 131 files per seed across four synthetic projects — Rust (683 lines), Python (486), Dart (501), CSS/SCSS (399). The code is idiomatic and intentionally clean for the tracked rules (no injected defect).
- Positives: 15 true-positive injections per rule per seed, placed only in files the detector is meant to scan.
- Hard negatives: 10 near misses per rule per seed, each one a construct the rule must not flag according to its description/exemptions.
- Three fresh copies per seed (base, positives, negatives) are written to temp dirs and scanned with `node bin/unshit.js scan <dir> --format json --no-cache`. The corpus is never modified.
- Matching is strict: same `ruleId`, same file, same 1-based line as the injection. Recall = matched positives / injected positives; FP rate = matched hard negatives / hard negatives. Wilson 95% intervals are reported per seed and pooled.
- No detector was tuned to this benchmark. The injectors that exposed the three detector bugs below are kept unchanged after the fixes, so they now guard against regressions.

## Clean-base findings

Findings on the generated base (no injection), per rule:

| Seed | `rust/no-unwrap` | `python/no-bare-except` | `dart/no-dynamic-or-print` | `css/no-important` | `css/design-drift` | `css/duplicate-selector` | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| 20261126 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20261127 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

No findings on the clean base in any seed: the generated idiomatic code does not trigger these rules.

## Recall

### Seed 20261126

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| css/design-drift | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| css/duplicate-selector | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| css/no-important | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| dart/no-dynamic-or-print | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| python/no-bare-except | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| rust/no-unwrap | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |

### Seed 20261127

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| css/design-drift | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| css/duplicate-selector | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| css/no-important | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| dart/no-dynamic-or-print | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| python/no-bare-except | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |
| rust/no-unwrap | 15 | 15 | 100.0% | [79.6%, 100.0%] | 0 |

### Pooled

| Rule | Injected | Found | Recall | Wilson 95% | Misses |
|---|---:|---:|---:|---:|---:|
| css/design-drift | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| css/duplicate-selector | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| css/no-important | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| dart/no-dynamic-or-print | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| python/no-bare-except | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |
| rust/no-unwrap | 30 | 30 | 100.0% | [88.6%, 100.0%] | 0 |

## False-positive rate on hard negatives

### Seed 20261126

| Rule | Negatives | False positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| css/design-drift | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| css/duplicate-selector | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| css/no-important | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| dart/no-dynamic-or-print | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| python/no-bare-except | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| rust/no-unwrap | 10 | 0 | 0.0% | [0.0%, 27.8%] |

### Seed 20261127

| Rule | Negatives | False positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| css/design-drift | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| css/duplicate-selector | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| css/no-important | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| dart/no-dynamic-or-print | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| python/no-bare-except | 10 | 0 | 0.0% | [0.0%, 27.8%] |
| rust/no-unwrap | 10 | 0 | 0.0% | [0.0%, 27.8%] |

### Pooled

| Rule | Negatives | False positives | FP rate | Wilson 95% |
|---|---:|---:|---:|---:|
| css/design-drift | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| css/duplicate-selector | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| css/no-important | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| dart/no-dynamic-or-print | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| python/no-bare-except | 20 | 0 | 0.0% | [0.0%, 16.1%] |
| rust/no-unwrap | 20 | 0 | 0.0% | [0.0%, 16.1%] |

## Misses (pooled)

No misses.

## False positives (pooled)

No false positives on the hard negatives.

## Detector bugs found

These were real false negatives/positives reproduced by the injectors when the benchmark was introduced. All three are fixed (see `CHANGELOG.md`, Unreleased); the reproducers below are kept as history and the matching injections stay in the benchmark.

### 1. Rust: whitespace before the argument list is not matched (`rust/no-unwrap`)

`src/detectors/polyglot.ts` searches for the literal string `.unwrap()`, so valid Rust with a space is missed.

Minimal reproducer:

```rust
fn main() {
    let values = std::collections::HashMap::from([("k", "v")]);
    let value = values.get("k").unwrap ();
    let _ = value;
}
```

Observed before the fix: 0 findings. Expected by the rule description: 1 finding.

Status: fixed — the detector now matches `.unwrap` followed by optional whitespace and `()`.

### 2. CSS: `rgb()`/`hsl()` channel functions with custom-property channels are false positives (`css/design-drift`)

`maskColorExemptFunctions` blanks `var(...)`, but the remaining text still matches `\brgba?\([^)]+\)`, so a token-only color is reported as hardcoded.

Minimal reproducer:

```css
:root { --color-rgb: 47 111 237; }
.button { color: rgb(var(--color-rgb) / 0.5); }
```

Observed before the fix: one `css/design-drift` finding on the declaration line with message ``Hardcoded color `rgb(                 / 0.5)`.`` (the `var()` is masked in the message). There is no hardcoded channel in the declaration.

Status: fixed — `rgb()`/`hsl()` calls are only reported when at least one color channel is a literal; a literal alpha alone does not count.

### 3. CSS: nested `&:hover` is not expanded when comparing selectors (`css/duplicate-selector`)

The rule compares raw header text plus the at-rule scope stack, so a nested rule and its expanded top-level equivalent are treated as different selectors.

Minimal reproducer:

```scss
.card {
  &:hover { color: inherit; }
}
.card:hover { color: inherit; }
```

Observed before the fix: 0 findings. Both selectors target the same element state.

Status: fixed — nested selectors are expanded through every ancestor rule (`&` substitution, descendant otherwise) before comparison; BEM suffixes, interpolation and placeholders keep their full scope.

## Limitations

- **Synthetic only.** The corpus is generated from templates; it exercises the rule shapes and scope boundaries, not the full variety of real projects. Numbers here are not a claim about recall/FP on real Rust/Python/Dart/CSS codebases.
- Base projects are intentionally clean, so the clean-base row measures absence of findings on idiomatic generated code, not the natural FP rate of the rules in the wild.
- Hard negatives are hand-designed near misses; they cannot enumerate every way a real project can trip a rule.
- Only the six rules in `src/detectors/polyglot.ts` and `src/detectors/css.ts` are measured; other detectors may also fire on the generated projects but are ignored here.
- Line-exact matching is deliberately strict. A finding on a nearby line would count as a miss; no tolerance is applied.
- No real polyglot corpus was available offline and nothing was downloaded, by design.

