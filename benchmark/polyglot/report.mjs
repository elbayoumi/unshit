// Markdown rendering for the polyglot recall benchmark.
// Kept separate from run.mjs so each benchmark module stays below the
// repository's god-file threshold.

import { RULES } from './lib.mjs';

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const fmtInterval = (interval) => `[${pct(interval.low)}, ${pct(interval.high)}]`;

export function buildMarkdown(report) {
  const md = [];
  md.push('# Polyglot rule recall and false positives (Rust, Python, Dart, CSS)');
  md.push('');
  md.push(`Generated: ${report.generatedAt}`);
  md.push('');
  md.push('## Method');
  md.push('');
  md.push('- Rules measured: ' + RULES.map((rule) => `\`${rule}\``).join(', ') + '.');
  md.push(`- Seeds: ${report.seedList.join(' (dev), ')} (holdout). The generator is deterministic per seed (\`benchmark/polyglot/generate.mjs\`).`);
  md.push(`- Base corpus: ${report.base.perSeed[0]?.files ?? 0} files per seed across four synthetic projects — Rust (${report.base.perSeed[0]?.lines.rust ?? 0} lines), Python (${report.base.perSeed[0]?.lines.python ?? 0}), Dart (${report.base.perSeed[0]?.lines.dart ?? 0}), CSS/SCSS (${report.base.perSeed[0]?.lines.css ?? 0}). The code is idiomatic and intentionally clean for the tracked rules (no injected defect).`);
  md.push(`- Positives: ${report.perRule} true-positive injections per rule per seed, placed only in files the detector is meant to scan.`);
  md.push(`- Hard negatives: ${report.negPerRule} near misses per rule per seed, each one a construct the rule must not flag according to its description/exemptions.`);
  md.push('- Three fresh copies per seed (base, positives, negatives) are written to temp dirs and scanned with `node bin/unshit.js scan <dir> --format json --no-cache`. The corpus is never modified.');
  md.push('- Matching is strict: same `ruleId`, same file, same 1-based line as the injection. Recall = matched positives / injected positives; FP rate = matched hard negatives / hard negatives. Wilson 95% intervals are reported per seed and pooled.');
  md.push('- No detector was tuned to this benchmark. Known misses and the known false positive are kept in the injectors and reported below.');
  md.push('');
  md.push('## Clean-base findings');
  md.push('');
  md.push('Findings on the generated base (no injection), per rule:');
  md.push('');
  md.push('| Seed | ' + RULES.map((rule) => `\`${rule}\``).join(' | ') + ' | Total |');
  md.push('|---|' + RULES.map(() => '---:').join('|') + '|---:|');
  for (const row of report.base.perSeed) {
    md.push(`| ${row.seed} | ` + RULES.map((rule) => row.findingsByRule[rule] ?? 0).join(' | ') + ` | ${row.findings.length} |`);
  }
  md.push('');
  if (report.base.totalFindings === 0) {
    md.push('No findings on the clean base in any seed: the generated idiomatic code does not trigger these rules.');
  } else {
    md.push('| Seed | Rule | File | Line | Message |');
    md.push('|---|---|---|---:|---|');
    for (const finding of report.base.pooledFindings) {
      md.push(`| ${report.base.perSeed.find((row) => row.findings.includes(finding))?.seed ?? ''} | ${finding.ruleId} | \`${finding.file}\` | ${finding.line ?? ''} | ${String(finding.message).replace(/\|/g, '\\|')} |`);
    }
  }
  md.push('');

  function recallTable(title, rows) {
    md.push(`### ${title}`);
    md.push('');
    md.push('| Rule | Injected | Found | Recall | Wilson 95% | Misses |');
    md.push('|---|---:|---:|---:|---:|---:|');
    for (const row of rows) {
      md.push(`| ${row.ruleId} | ${row.injected} | ${row.found} | ${pct(row.recall)} | ${fmtInterval(row.wilson95)} | ${row.misses.length} |`);
    }
    md.push('');
  }

  function fpTable(title, rows) {
    md.push(`### ${title}`);
    md.push('');
    md.push('| Rule | Negatives | False positives | FP rate | Wilson 95% |');
    md.push('|---|---:|---:|---:|---:|');
    for (const row of rows) {
      md.push(`| ${row.ruleId} | ${row.negatives} | ${row.falsePositives} | ${pct(row.fpRate)} | ${fmtInterval(row.wilson95)} |`);
    }
    md.push('');
  }

  md.push('## Recall');
  md.push('');
  for (const seedRow of report.seeds) recallTable(`Seed ${seedRow.seed}`, seedRow.positives.rules);
  recallTable('Pooled', report.pooled.recall);

  md.push('## False-positive rate on hard negatives');
  md.push('');
  for (const seedRow of report.seeds) fpTable(`Seed ${seedRow.seed}`, seedRow.negatives.rules);
  fpTable('Pooled', report.pooled.falsePositives);

  md.push('## Misses (pooled)');
  md.push('');
  const misses = report.pooled.recall.flatMap((row) => row.misses.map((miss) => ({ ruleId: row.ruleId, ...miss })));
  if (misses.length === 0) {
    md.push('No misses.');
  } else {
    md.push('| Rule | Seed | File | Line | Variant | Reason |');
    md.push('|---|---:|---|---:|---|---|');
    for (const miss of misses) {
      const seed = report.seeds.find((row) => row.positives.rules.some((rule) => rule.misses.some((entry) => entry.file === miss.file && entry.line === miss.line && entry.variant === miss.variant)))?.seed ?? '';
      md.push(`| ${miss.ruleId} | ${seed} | \`${miss.file}\` | ${miss.line} | \`${miss.variant}\` | ${String(miss.reason).replace(/\|/g, '\\|')} |`);
    }
  }
  md.push('');

  md.push('## False positives (pooled)');
  md.push('');
  const falsePositives = report.pooled.falsePositives.flatMap((row) => row.fps.map((fp) => ({ ruleId: row.ruleId, ...fp })));
  if (falsePositives.length === 0) {
    md.push('No false positives on the hard negatives.');
  } else {
    md.push('| Rule | File | Line | Variant | Finding |');
    md.push('|---|---|---:|---|---|');
    for (const fp of falsePositives) {
      md.push(`| ${fp.ruleId} | \`${fp.file}\` | ${fp.line} | \`${fp.variant}\` | ${String(fp.finding.message).replace(/\|/g, '\\|')} |`);
    }
  }
  md.push('');

  md.push('## Detector bugs found');
  md.push('');
  md.push('These are real false negatives/positives reproduced by the injectors. Detector sources were **not** changed in this track.');
  md.push('');
  md.push('### 1. Rust: whitespace before the argument list is not matched (`rust/no-unwrap`)');
  md.push('');
  md.push('`src/detectors/polyglot.ts` searches for the literal string `.unwrap()`, so valid Rust with a space is missed.');
  md.push('');
  md.push('Minimal reproducer:');
  md.push('');
  md.push('```rust');
  md.push('fn main() {');
  md.push('    let values = std::collections::HashMap::from([("k", "v")]);');
  md.push('    let value = values.get("k").unwrap ();');
  md.push('    let _ = value;');
  md.push('}');
  md.push('```');
  md.push('');
  md.push('Observed: 0 findings. Expected by the rule description: 1 finding.');
  md.push('');
  md.push('### 2. CSS: `rgb()`/`hsl()` channel functions with custom-property channels are false positives (`css/design-drift`)');
  md.push('');
  md.push('`maskColorExemptFunctions` blanks `var(...)`, but the remaining text still matches `\\brgba?\\([^)]+\\)`, so a token-only color is reported as hardcoded.');
  md.push('');
  md.push('Minimal reproducer:');
  md.push('');
  md.push('```css');
  md.push(':root { --color-rgb: 47 111 237; }');
  md.push('.button { color: rgb(var(--color-rgb) / 0.5); }');
  md.push('```');
  md.push('');
  md.push('Observed: one `css/design-drift` finding on the declaration line with message ``Hardcoded color `rgb(                 / 0.5)`.`` (the `var()` is masked in the message). There is no hardcoded channel in the declaration.');
  md.push('');
  md.push('### 3. CSS: nested `&:hover` is not expanded when comparing selectors (`css/duplicate-selector`)');
  md.push('');
  md.push('The rule compares raw header text plus the at-rule scope stack, so a nested rule and its expanded top-level equivalent are treated as different selectors.');
  md.push('');
  md.push('Minimal reproducer:');
  md.push('');
  md.push('```scss');
  md.push('.card {');
  md.push('  &:hover { color: inherit; }');
  md.push('}');
  md.push('.card:hover { color: inherit; }');
  md.push('```');
  md.push('');
  md.push('Observed: 0 findings. Both selectors target the same element state.');
  md.push('');

  md.push('## Limitations');
  md.push('');
  md.push('- **Synthetic only.** The corpus is generated from templates; it exercises the rule shapes and scope boundaries, not the full variety of real projects. Numbers here are not a claim about recall/FP on real Rust/Python/Dart/CSS codebases.');
  md.push('- Base projects are intentionally clean, so the clean-base row measures absence of findings on idiomatic generated code, not the natural FP rate of the rules in the wild.');
  md.push('- Hard negatives are hand-designed near misses; they cannot enumerate every way a real project can trip a rule.');
  md.push('- Only the six rules in `src/detectors/polyglot.ts` and `src/detectors/css.ts` are measured; other detectors may also fire on the generated projects but are ignored here.');
  md.push('- Line-exact matching is deliberately strict. A finding on a nearby line would count as a miss; no tolerance is applied.');
  md.push('- No real polyglot corpus was available offline and nothing was downloaded, by design.');
  md.push('');

  return `${md.join('\n')}\n`;
}
