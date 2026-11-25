import type { Detector, DetectorContext, Finding } from '../contracts.js';

const CSS_EXTS = new Set(['.css', '.scss']);

function stripCommentsAndStringsPreserveLines(content: string, isScss: boolean): string {
  const out = content.split('');
  const n = content.length;
  let i = 0;

  while (i < n) {
    const c = content[i] ?? '';
    const next = content[i + 1] ?? '';

    if (c === '/' && next === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n) {
        if (content[i] === '*' && content[i + 1] === '/') {
          out[i++] = ' ';
          out[i++] = ' ';
          break;
        }
        if (content[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }

    if (isScss && c === '/' && next === '/') {
      while (i < n && content[i] !== '\n') {
        out[i++] = ' ';
      }
      continue;
    }

    if (c === '"' || c === "'") {
      const q = c;
      out[i++] = ' ';
      while (i < n && content[i] !== '\n') {
        if (content[i] === '\\' && i + 1 < n) {
          out[i++] = ' ';
          if (content[i] !== '\n') out[i] = ' ';
          i++;
          continue;
        }
        if (content[i] === q) {
          out[i++] = ' ';
          break;
        }
        out[i++] = ' ';
      }
      continue;
    }

    i++;
  }

  return out.join('');
}

function buildLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function lineAtOffset(offsets: number[], offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] ?? 0) <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function isExemptImportantContext(scopeStack: string[]): boolean {
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

function walkCssScopes(
  clean: string,
  onOpenRule: (selector: string, scopeStack: string[], selectorStartOffset: number) => void,
  onBlockText?: (text: string, startOffset: number, scopeStack: string[]) => void,
): void {
  const scopeStack: string[] = [];
  let headerStart = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') {
      const rawSlice = clean.slice(headerStart, i);
      const leadingWs = rawSlice.search(/\S/);
      const selectorStart = leadingWs === -1 ? headerStart : headerStart + leadingWs;
      const header = rawSlice.trim().replace(/\s+/g, ' ');
      if (header.startsWith('@')) {
        scopeStack.push(header);
      } else {
        if (header) {
          onOpenRule(header, scopeStack, selectorStart);
        }
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

export const cssNoImportantDetector: Detector = {
  id: 'css/no-important',
  category: 'css',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `!important` overrides in stylesheets (exempting [hidden], .sr-only, print, reduced-motion).',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!CSS_EXTS.has(file.ext)) continue;
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);
      const re = /!\s*important\b/gi;

      walkCssScopes(
        clean,
        () => {},
        (blockText, blockStart, scopeStack) => {
          if (isExemptImportantContext(scopeStack)) return;
          re.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = re.exec(blockText)) !== null) {
            const absOffset = blockStart + match.index;
            const lineNum = lineAtOffset(offsets, absOffset);
            const lineStart = offsets[lineNum - 1] ?? 0;
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.99,
              file: file.relPath,
              span: { line: lineNum, column: absOffset - lineStart + 1 },
              message: 'Avoid `!important`; use CSS cascade order or `@layer` instead.',
              evidence: (file.lines[lineNum - 1] ?? '').trim().slice(0, 100),
            });
          }
        },
      );
    }
    return findings;
  },
};

const CUSTOM_PROPERTY_DEFINITION_RE = /--([A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g;
const HARDCODED_COLOR_RES: RegExp[] = [
  /#[0-9a-f]{3,8}\b/gi,
  /\brgba?\([^)]+\)/gi,
  /\bhsla?\([^)]+\)/gi,
];

function blankRange(chars: string[], start: number, end: number): void {
  for (let i = start; i < end; i++) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

function blankMatches(text: string, re: RegExp): string {
  const chars = text.split('');
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blankRange(chars, match.index, match.index + match[0].length);
  }
  return chars.join('');
}

function maskCustomPropertyValues(text: string): string {
  return blankMatches(text, CUSTOM_PROPERTY_DEFINITION_RE);
}

function maskColorExemptFunctions(text: string): string {
  const chars = text.split('');
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(' || i === 0) continue;
    let nameStart = i - 1;
    while (nameStart >= 0 && /[A-Za-z0-9_-]/.test(text[nameStart] ?? '')) nameStart--;
    const name = text.slice(nameStart + 1, i);
    if (!/^(url|var)$/i.test(name)) continue;

    let depth = 0;
    let end = i;
    for (; end < text.length; end++) {
      const ch = text[end];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (end >= text.length) continue;
    blankRange(chars, nameStart + 1, end + 1);
    i = end;
  }
  return chars.join('');
}

function maskNestedBlocks(text: string): string {
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
      if (depth === 0 && start >= 0) {
        blankRange(chars, start, i + 1);
        start = -1;
      }
    }
  }
  return chars.join('');
}

function normalizeColor(value: string): string {
  let normalized = value.replace(/!important\b/gi, '').trim().toLowerCase().replace(/\s+/g, '');
  const shorthand = /^#([0-9a-f]{3,4})$/.exec(normalized);
  if (shorthand?.[1]) {
    normalized = `#${[...shorthand[1]].map((digit) => digit + digit).join('')}`;
  }
  return normalized;
}

export const cssDesignDriftDetector: Detector = {
  id: 'css/design-drift',
  category: 'css',
  tier: 'structural',
  severity: 'info',
  description: 'Flags hardcoded colors in declarations when design tokens exist (skipping :root, token definitions, url(), and var() fallbacks).',
  detect(ctx: DetectorContext): Finding[] {
    const cssFiles = ctx.files.filter((file) => CSS_EXTS.has(file.ext));
    const tokenByColor = new Map<string, string>();
    let definitionCount = 0;

    for (const file of cssFiles) {
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const re = new RegExp(CUSTOM_PROPERTY_DEFINITION_RE);
      let match: RegExpExecArray | null;
      while ((match = re.exec(clean)) !== null) {
        definitionCount++;
        const normalized = normalizeColor(match[2] ?? '');
        if (normalized && !tokenByColor.has(normalized)) {
          tokenByColor.set(normalized, `--${match[1]}`);
        }
      }
    }
    if (definitionCount === 0) return [];

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const file of cssFiles) {
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);

      walkCssScopes(
        clean,
        () => {},
        (blockText, blockStart, scopeStack) => {
          if (scopeStack.some((entry) => entry.startsWith('RULE:') && /:root\b/i.test(entry.slice(5)))) return;

          const scannable = maskColorExemptFunctions(maskCustomPropertyValues(maskNestedBlocks(blockText)));
          for (const re of HARDCODED_COLOR_RES) {
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(scannable)) !== null) {
              const absOffset = blockStart + match.index;
              const key = `${file.relPath}:${absOffset}`;
              if (seen.has(key)) continue;
              seen.add(key);

              const color = match[0];
              const token = tokenByColor.get(normalizeColor(color));
              const hint = token ? ` (use var(${token}))` : '';
              const lineNum = lineAtOffset(offsets, absOffset);
              const lineStart = offsets[lineNum - 1] ?? 0;
              findings.push({
                ruleId: this.id,
                category: this.category,
                tier: this.tier,
                severity: this.severity,
                fixability: 'ai',
                confidence: 0.9,
                file: file.relPath,
                span: { line: lineNum, column: absOffset - lineStart + 1 },
                message: `Hardcoded color \`${color}\`${hint}.`,
                evidence: (file.lines[lineNum - 1] ?? '').trim().slice(0, 100),
              });
            }
          }
        },
      );
    }
    return findings;
  },
};

export const cssDuplicateSelectorDetector: Detector = {
  id: 'css/duplicate-selector',
  category: 'css',
  tier: 'structural',
  severity: 'info',
  description: 'Flags CSS selectors defined multiple times in the same at-rule scope (skipping @keyframes).',
  detect(ctx: DetectorContext): Finding[] {
    const seen = new Map<string, { file: string; line: number; selector: string }[]>();

    for (const file of ctx.files) {
      if (!CSS_EXTS.has(file.ext)) continue;
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);

      walkCssScopes(clean, (header, scopeStack, selectorStart) => {
        const insideKeyframes = scopeStack.some((s) => /^@(-webkit-|-moz-)?keyframes\b/i.test(s));
        if (insideKeyframes) return;
        const scopeKey = scopeStack.join(' > ');
        const mapKey = `${scopeKey}::${header}`;
        const list = seen.get(mapKey) ?? [];
        list.push({ file: file.relPath, line: lineAtOffset(offsets, selectorStart), selector: header });
        seen.set(mapKey, list);
      });
    }

    const findings: Finding[] = [];
    for (const occurrences of seen.values()) {
      if (occurrences.length < 2) continue;
      const first = occurrences[0]!;
      for (let i = 1; i < occurrences.length; i++) {
        const dup = occurrences[i]!;
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.88,
          file: dup.file,
          span: { line: dup.line, column: 1 },
          message: `Duplicate CSS selector \`${dup.selector}\` (also defined at ${first.file}:${first.line}).`,
          evidence: dup.selector,
        });
      }
    }
    return findings;
  },
};
