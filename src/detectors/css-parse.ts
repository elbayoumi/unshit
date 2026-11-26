export const CSS_EXTS = new Set(['.css', '.scss']);

function blankChar(ch: string): string {
  return ch === '\n' ? '\n' : ' ';
}

function skipBlockComment(content: string, out: string[], i: number): number {
  out[i] = ' '; out[i + 1] = ' ';
  let j = i + 2;
  while (j < content.length) {
    if (content[j] === '*' && content[j + 1] === '/') {
      out[j] = ' '; out[j + 1] = ' ';
      return j + 2;
    }
    if (content[j] !== '\n') out[j] = ' ';
    j++;
  }
  return j;
}

function skipLineComment(content: string, out: string[], i: number): number {
  let j = i;
  while (j < content.length && content[j] !== '\n') { out[j] = ' '; j++; }
  return j;
}

function skipQuotedString(content: string, out: string[], i: number): number {
  const q = content[i]!;
  out[i] = ' ';
  let j = i + 1;
  while (j < content.length && content[j] !== '\n') {
    if (content[j] === '\\' && j + 1 < content.length) {
      out[j] = ' ';
      if (content[j + 1] !== '\n') out[j + 1] = ' ';
      j += 2;
      continue;
    }
    if (content[j] === q) { out[j] = ' '; return j + 1; }
    out[j] = ' ';
    j++;
  }
  return j;
}

export function stripCommentsAndStringsPreserveLines(content: string, isScss: boolean): string {
  const out = content.split('');
  let i = 0;
  while (i < content.length) {
    const c = content[i] ?? '';
    const next = content[i + 1] ?? '';
    if (c === '/' && next === '*') { i = skipBlockComment(content, out, i); continue; }
    if (isScss && c === '/' && next === '/') { i = skipLineComment(content, out, i); continue; }
    if (c === '"' || c === "'") { i = skipQuotedString(content, out, i); continue; }
    i++;
  }
  return out.join('');
}

export function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

export function lineAtOffset(offsets: number[], offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] ?? 0) <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

export function isExemptImportantContext(scopeStack: string[]): boolean {
  for (const entry of scopeStack) {
    if (/^@media\s+print\b/i.test(entry)) return true;
    if (/^@media\b[^]*prefers-reduced-motion\s*:\s*reduce/i.test(entry)) return true;
    if (entry.startsWith('RULE:')) {
      const sel = entry.slice(5);
      if (/\[hidden\]|\.sr-only\b|\.visually-hidden\b/i.test(sel)) return true;
    }
  }
  return false;
}

function extractHeader(clean: string, headerStart: number, i: number, scopeStack: string[]): { header: string; selectorStart: number } {
  let rawSlice = clean.slice(headerStart, i);
  if (scopeStack.some((s) => s.startsWith('RULE:'))) {
    const lastSemi = rawSlice.lastIndexOf(';');
    if (lastSemi >= 0) {
      const afterSemi = rawSlice.slice(lastSemi + 1);
      const leadingWs = afterSemi.search(/\S/);
      const header = afterSemi.trim().replace(/\s+/g, ' ');
      const selectorStart = leadingWs === -1 ? headerStart : headerStart + (lastSemi + 1) + leadingWs;
      return { header, selectorStart };
    }
  }
  const leadingWs = rawSlice.search(/\S/);
  const header = rawSlice.trim().replace(/\s+/g, ' ');
  const selectorStart = leadingWs === -1 ? headerStart : headerStart + leadingWs;
  return { header, selectorStart };
}

export function walkCssScopes(
  clean: string,
  onOpenRule: (selector: string, scopeStack: string[], selectorStartOffset: number) => void,
  onBlockText?: (text: string, startOffset: number, scopeStack: string[]) => void,
): void {
  const scopeStack: string[] = [];
  let headerStart = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') {
      const { header, selectorStart } = extractHeader(clean, headerStart, i, scopeStack);
      if (header.startsWith('@')) {
        scopeStack.push(header);
      } else {
        if (header) onOpenRule(header, scopeStack, selectorStart);
        scopeStack.push(`RULE:${header}`);
      }
      headerStart = i + 1;
    } else if (ch === '}') {
      onBlockText?.(clean.slice(headerStart, i), headerStart, scopeStack);
      scopeStack.pop();
      headerStart = i + 1;
    } else if (ch === ';' && !scopeStack.some((s) => s.startsWith('RULE:'))) {
      headerStart = i + 1;
    }
  }
}

export const CUSTOM_PROPERTY_DEFINITION_RE = /--([A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g;
export const HARDCODED_COLOR_RES: RegExp[] = [
  /#[0-9a-f]{3,8}\b/gi,
  /\brgba?\([^)]+\)/gi,
  /\bhsla?\([^)]+\)/gi,
];


export function blankRange(chars: string[], start: number, end: number): void {
  for (let i = start; i < end; i++) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

function blankMatches(text: string, re: RegExp): string {
  const chars = text.split('');
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) blankRange(chars, match.index, match.index + match[0].length);
  return chars.join('');
}

export function maskCustomPropertyValues(text: string): string {
  return blankMatches(text, CUSTOM_PROPERTY_DEFINITION_RE);
}

function readFunctionName(text: string, parenIndex: number): string {
  let nameStart = parenIndex - 1;
  while (nameStart >= 0 && /[A-Za-z0-9_-]/.test(text[nameStart] ?? '')) nameStart--;
  return text.slice(nameStart + 1, parenIndex);
}

export function findParenEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function maskColorExemptFunctions(text: string): string {
  return blankFunctionCalls(text, (name) => /^(url|var)$/i.test(name));
}

export function maskUrlFunctions(text: string): string {
  return blankFunctionCalls(text, (name) => /^url$/i.test(name));
}

function blankFunctionCalls(text: string, shouldBlank: (name: string) => boolean): string {
  const chars = text.split('');
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(' || i === 0) continue;
    const name = readFunctionName(text, i);
    if (!shouldBlank(name)) continue;
    const end = findParenEnd(text, i);
    if (end < 0) continue;
    blankRange(chars, i - name.length, end + 1);
    i = end;
  }
  return chars.join('');
}

export function maskNestedBlocks(text: string): string {
  const chars = text.split('');
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) { blankRange(chars, start, i + 1); start = -1; }
    }
  }
  return chars.join('');
}

export function normalizeColor(value: string): string {
  let normalized = value.replace(/!important\b/gi, '').trim().toLowerCase().replace(/\s+/g, '');
  const shorthand = /^#([0-9a-f]{3,4})$/.exec(normalized);
  if (shorthand?.[1]) normalized = `#${[...shorthand[1]].map((digit) => digit + digit).join('')}`;
  return normalized;
}
