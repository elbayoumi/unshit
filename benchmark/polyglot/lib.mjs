// Shared helpers for the polyglot (Rust/Python/Dart/CSS) recall benchmark.
//
// Everything here is pure and deterministic so tests can import it directly.
// Wilson intervals and the RNG are reused from benchmark/recall/lib.mjs so the
// statistics stay identical to the other recall tracks.

export { mulberry32, wilson95 } from '../recall/lib.mjs';

export const RULES = [
  'rust/no-unwrap',
  'python/no-bare-except',
  'dart/no-dynamic-or-print',
  'css/no-important',
  'css/design-drift',
  'css/duplicate-selector',
];

export const RULE_LABELS = {
  'rust/no-unwrap': 'Rust `.unwrap()`',
  'python/no-bare-except': 'Python bare `except:`',
  'dart/no-dynamic-or-print': 'Dart `dynamic` / `print()`',
  'css/no-important': 'CSS `!important`',
  'css/design-drift': 'CSS hardcoded colors',
  'css/duplicate-selector': 'CSS duplicate selectors',
};

export function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

export function shuffle(rng, values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function nextInt(rng, max) {
  return Math.floor(rng() * max);
}

/**
 * Mirror of `isTestPath` in src/detectors/polyglot.ts. Positive injections are
 * only placed in files the detector is supposed to scan; hard negatives may
 * deliberately land inside test paths.
 */
export function isDetectorTestPath(relPath) {
  if (/(^|\/)build\.rs$/i.test(relPath)) return true;
  if (/(^|\/)(examples|benches|bin|tool)(\/|$)/i.test(relPath)) return true;
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.|_test\.(rs|dart|py)$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/i.test(relPath);
}

/**
 * Appends `lines` to a file and returns the 1-based line number of the first
 * appended line. Line numbers are computed as the file is mutated, so several
 * injections into the same file stay accurate.
 */
export function appendLines(files, rel, lines) {
  let prev = files.get(rel) ?? '';
  if (prev && !prev.endsWith('\n')) prev += '\n';
  const start = prev === '' ? 1 : prev.split('\n').length;
  files.set(rel, prev + lines.join('\n') + '\n');
  return start;
}

export function pushInjection(files, injections, rel, lines, offset, meta) {
  const start = appendLines(files, rel, lines);
  injections.push({ ...meta, file: rel, line: start + offset });
}

/** A one-rule CSS block as lines, used by both injectors. */
export function ruleBlock(selector, decls) {
  return [`${selector} {`, ...decls.map((decl) => `  ${decl}`), '}'];
}

/** Line-exact matcher: an injection is found only by a finding of its own rule on its own line. */
export function findingMatchesInjection(finding, injection) {
  if (finding.ruleId !== injection.ruleId) return false;
  if (finding.file !== injection.file) return false;
  return (finding.span?.line ?? -1) === injection.line;
}

export function evaluateRecall(injections, findings, wilson) {
  const rows = new Map();
  for (const injection of injections) {
    const row = rows.get(injection.ruleId) ?? {
      ruleId: injection.ruleId,
      injected: 0,
      found: 0,
      misses: [],
      hits: [],
    };
    row.injected += 1;
    const match = findings.find((finding) => findingMatchesInjection(finding, injection));
    if (match) {
      row.found += 1;
      row.hits.push({
        file: injection.file,
        line: injection.line,
        variant: injection.variant,
        findingLine: match.span?.line,
      });
    } else {
      row.misses.push({
        file: injection.file,
        line: injection.line,
        variant: injection.variant,
        marker: injection.marker,
        reason: injection.missReason ?? 'no finding on the injected line',
      });
    }
    rows.set(injection.ruleId, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      recall: row.injected === 0 ? null : row.found / row.injected,
      wilson95: wilson(row.found, row.injected),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function evaluateFalsePositives(negatives, findings, wilson) {
  const rows = new Map();
  for (const injection of negatives) {
    const row = rows.get(injection.ruleId) ?? {
      ruleId: injection.ruleId,
      negatives: 0,
      falsePositives: 0,
      fps: [],
    };
    row.negatives += 1;
    const match = findings.find((finding) => findingMatchesInjection(finding, injection));
    if (match) {
      row.falsePositives += 1;
      row.fps.push({
        file: injection.file,
        line: injection.line,
        variant: injection.variant,
        marker: injection.marker,
        finding: {
          ruleId: match.ruleId,
          file: match.file,
          line: match.span?.line,
          message: match.message,
        },
      });
    }
    rows.set(injection.ruleId, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      fpRate: row.negatives === 0 ? null : row.falsePositives / row.negatives,
      wilson95: wilson(row.falsePositives, row.negatives),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function countLines(files, predicate) {
  let lines = 0;
  for (const [rel, content] of files) {
    if (predicate(rel)) lines += content.split('\n').length;
  }
  return lines;
}

export function writeProject(dir, files) {
  // Imported lazily so the generator stays usable from pure unit tests without
  // touching the filesystem until the runner asks for a project on disk.
  return import('node:fs').then(({ mkdirSync, writeFileSync }) => {
    for (const [rel, content] of files) {
      const abs = `${dir}/${rel}`;
      const slash = abs.lastIndexOf('/');
      if (slash > 0) mkdirSync(abs.slice(0, slash), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
  });
}
