// Hard-negative injectors: 10 near misses per tracked rule and seed. A hard
// negative is a construct the rule must NOT flag according to its own
// description and exemptions (test paths, allowed unwrap receivers, specific
// exception handlers, exempt `!important` scopes, token-only colors, and
// selectors that only look duplicated).
//
// One design-drift negative (`rgb(var(--rgb) / 0.5)`) is expected to be a
// false positive; it is forced into every seed so the documented bug is
// measured instead of hidden.

import { mulberry32, shuffle } from './lib.mjs';
import { RUST_NEG } from './negatives-rust.mjs';
import { PYTHON_NEG } from './negatives-python.mjs';
import { DART_NEG } from './negatives-dart.mjs';
import { CSS_IMPORTANT_NEG } from './negatives-css-important.mjs';
import { CSS_COLOR_NEG } from './negatives-css-color.mjs';
import { CSS_DUP_NEG } from './negatives-css-dup.mjs';

function pickVariants(pool, count, rng, forced = []) {
  const rest = pool.filter((entry) => !forced.includes(entry));
  return [...forced, ...shuffle(rng, rest).slice(0, count - forced.length)];
}

/**
 * Applies all hard-negative injections to a copy of the generated base.
 */
export function injectNegatives(base, seed, options = {}) {
  const perRule = options.perRule ?? 10;
  const files = new Map(base.files);
  const injections = [];
  const rng = mulberry32((seed ^ 0x85ebca6b) >>> 0);

  const rust = pickVariants(RUST_NEG, perRule, rng);
  const python = pickVariants(PYTHON_NEG, perRule, rng);
  const dart = pickVariants(DART_NEG, perRule, rng);
  const important = pickVariants(CSS_IMPORTANT_NEG, perRule, rng);
  const forcedFp = CSS_COLOR_NEG.filter((entry) => entry.expectedFalsePositive);
  const colors = pickVariants(CSS_COLOR_NEG, perRule, rng, forcedFp);
  const duplicates = pickVariants(CSS_DUP_NEG, perRule, rng);

  const groups = [
    ['rust', rust],
    ['python', python],
    ['dart', dart],
    ['important', important],
    ['colors', colors],
    ['duplicates', duplicates],
  ];
  for (const [prefix, entries] of groups) {
    entries.forEach((entry, index) => {
      const before = injections.length;
      entry.run(files, injections, `${prefix}_${index}`);
      // Mark the variant on every record the entry produced.
      for (let i = before; i < injections.length; i++) injections[i].variant = entry.variant;
    });
  }
  return { files, injections };
}
