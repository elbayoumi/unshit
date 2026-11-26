function canExpandNestedSelector(header: string): boolean {
  // Skip if contains SCSS interpolation/extend/placeholder
  if (header.includes('#{')) return false;
  if (header.includes('@extend')) return false;
  if (header.includes('%placeholder')) return false; // defensive

  // Check every '&' is in an allowed expansion position
  for (let i = 0; i < header.length; i++) {
    if (header[i] !== '&') continue;
    const next = header[i + 1];
    // allowed if end of string
    if (next === undefined) continue; // & at end is odd, but allow? probably not common
    // allowed chars after &: : . [ # whitespace > + ~
    if (
      next === ':' ||
      next === '.' ||
      next === '[' ||
      next === '#' ||
      next === '>' ||
      next === '+' ||
      next === '~' ||
      /\s/.test(next)
    ) {
      continue;
    }
    // otherwise (e.g. _ for BEM &__title, - for &-x, letter etc.) => not allowed
    return false;
  }
  return true;
}

function normalizeCombinatorWhitespace(s: string): string {
  // normalize spaces around combinators > + ~
  let out = s.replace(/\s*([>+~])\s*/g, ' $1 ');
  // collapse multiple spaces
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function splitSelectorList(s: string): string[] {
  // simple split by commas not inside parens/brackets (basic)
  const parts: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    if (ch === ',' && depthParen === 0 && depthBracket === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts.length > 0 ? parts : [s.trim()];
}

function replaceAmpersand(childSel: string, parentSel: string): string {
  // replace & in childSel with parentSel
  let out = '';
  for (let i = 0; i < childSel.length; i++) {
    if (childSel[i] === '&') {
      out += parentSel;
    } else {
      out += childSel[i];
    }
  }
  return out;
}

function expandNestedSelector(parentHeader: string, childHeader: string): string[] {
  if (!canExpandNestedSelector(childHeader)) {
    return [childHeader]; // fall back to raw
  }
  const parents = splitSelectorList(parentHeader).map((p) => p.trim()).filter(Boolean);
  const children = splitSelectorList(childHeader).map((c) => c.trim()).filter(Boolean);
  const results: string[] = [];
  for (const p of parents) {
    for (const c of children) {
      if (c.includes('&')) {
        // replace & with parent
        results.push(normalizeCombinatorWhitespace(replaceAmpersand(c, p)));
      } else {
        // no &: becomes parent descendant
        results.push(normalizeCombinatorWhitespace(`${p} ${c}`));
      }
    }
  }
  // dedupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out.length > 0 ? out : [childHeader];
}

/**
 * Expand a nested selector through every ancestor rule (outermost first).
 * Returns null when any level cannot be expanded safely (BEM suffixes, SCSS
 * interpolation, placeholders); callers then keep the raw header together with
 * the full ancestor chain so unrelated nested rules never collide.
 */
export function expandSelectorChain(ancestors: string[], header: string): string[] | null {
  const levels = [...ancestors, header];
  let current = splitSelectorList(levels[0] ?? '').map((p) => p.trim()).filter(Boolean);
  if (current.length === 0 || levels[0]!.includes('#{') || /(^|[\s,])%/.test(levels[0]!)) return null;
  for (const level of levels.slice(1)) {
    if (!canExpandNestedSelector(level) || /(^|[\s,])%/.test(level)) return null;
    const next: string[] = [];
    for (const parent of current) next.push(...expandNestedSelector(parent, level));
    current = [...new Set(next)];
  }
  return current;
}
