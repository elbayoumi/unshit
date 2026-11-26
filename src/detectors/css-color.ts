import { blankRange, findParenEnd } from './css-parse.js';

// CSS color functions whose output is only a hardcoded color when at least one
// COLOR CHANNEL is a literal. `rgb()/rgba()/hsl()/hsla()` built purely from
// `var()`/`env()`/calc-with-var channels reference design tokens, not hardcoded
// colors; a literal alpha component alone never makes a color hardcoded.
const COLOR_FUNCTION_RE = /\b(rgba?|hsla?)\(/gi;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z%]*)$/i;

// Blank rgb()/rgba()/hsl()/hsla() calls in `scannable` when no color channel is
// a literal. `scannable` has comments/strings, custom-property definitions,
// nested blocks, url() and var() masked; `keepVars` has everything masked except
// var(), so channel origins survive. Blanking preserves length, so offsets in
// `scannable`, `keepVars` and `masked` stay aligned.
export function maskColorlessColorCalls(scannable: string, keepVars: string): string {
  const chars = scannable.split('');
  COLOR_FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COLOR_FUNCTION_RE.exec(scannable)) !== null) {
    const name = match[1] ?? '';
    const open = match.index + match[0].length - 1;
    const close = findParenEnd(scannable, open);
    const innerEnd = close < 0 ? scannable.length : close;
    const inner = keepVars.slice(open + 1, innerEnd);
    if (hasLiteralColorChannel(inner, name)) continue;
    blankRange(chars, match.index, close < 0 ? scannable.length : close + 1);
  }
  return chars.join('');
}

function hasLiteralColorChannel(inner: string, name: string): boolean {
  return parseColorChannels(inner, name).some((channel) => !isDerivedChannel(channel));
}

function parseColorChannels(inner: string, name: string): string[] {
  // A top-level `/` separates an optional alpha component; alpha is not a color channel.
  let colorPart = inner;
  const slash = findTopLevelSeparator(inner, '/');
  if (slash >= 0) colorPart = inner.slice(0, slash);

  const commaParts = splitTopLevel(colorPart, ',').filter((part) => part !== '');
  const hasComma = commaParts.length > 1;
  const parts = hasComma ? commaParts : tokenizeWords(colorPart);

  if (hasComma) {
    // Comma syntax `rgb(r, g, b[, a])` / `rgba(r, g, b, a)`: 4th+ part is alpha.
    if (parts.length >= 4) return parts.slice(0, 3);
    // `rgba(var(--c), a)` / `hsla(var(--c), a)`: one var/env value supplies all
    // color channels; a trailing lone number/percentage is alpha only.
    if (
      /^(?:rgba|hsla)$/i.test(name) &&
      parts.length === 2 &&
      isDerivedChannel(parts[0] ?? '') &&
      !isDerivedChannel(parts[1] ?? '') &&
      isLoneNumber(parts[1] ?? '')
    ) {
      return parts.slice(0, 1);
    }
  }
  return parts;
}

// A channel is not literal when it is empty, a whole `var(...)` or `env(...)`
// call, or a whole `calc(...)` expression that references var()/env().
function isDerivedChannel(channel: string): boolean {
  const trimmed = channel.trim();
  if (trimmed === '') return true;
  if (matchWholeCall(trimmed, 'var') !== null) return true;
  if (matchWholeCall(trimmed, 'env') !== null) return true;
  const calcInner = matchWholeCall(trimmed, 'calc');
  if (calcInner !== null && /\b(?:var|env)\s*\(/i.test(calcInner)) return true;
  return false;
}

function matchWholeCall(text: string, name: string): string | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith(`${name}(`)) return null;
  const end = findParenEnd(trimmed, name.length);
  if (end !== trimmed.length - 1) return null;
  return trimmed.slice(name.length + 1, end);
}

function isLoneNumber(text: string): boolean {
  return NUMBER_RE.test(text.trim());
}

function findTopLevelSeparator(text: string, sep: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function tokenizeWords(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (depth === 0 && /\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

