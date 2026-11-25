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
