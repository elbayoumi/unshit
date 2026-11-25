import type { Detector, DetectorContext, Finding } from '../contracts.js';

const CSS_EXTS = new Set(['.css', '.scss']);

function stripCssCommentsPreserveLines(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '));
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

export const cssNoImportantDetector: Detector = {
  id: 'css/no-important',
  category: 'css',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `!important` overrides in stylesheets (ignoring comments).',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!CSS_EXTS.has(file.ext)) continue;
      const strippedLines = stripCssCommentsPreserveLines(file.content).split(/\r?\n/);
      for (let i = 0; i < strippedLines.length; i++) {
        const line = strippedLines[i] ?? '';
        const importantRe = /!\s*important\b/gi;
        for (const match of line.matchAll(importantRe)) {
          const idx = match.index ?? 0;
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'ai',
            confidence: 0.99,
            file: file.relPath,
            span: { line: i + 1, column: idx + 1 },
            message: 'Avoid `!important`; use CSS cascade order or `@layer` instead.',
            evidence: (file.lines[i] ?? line).trim().slice(0, 100),
          });
        }
      }
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
      const clean = stripCssCommentsPreserveLines(file.content);
      const offsets = buildLineOffsets(clean);
      const scopeStack: string[] = [];
      let headerStart = 0;
      let quote: '"' | "'" | null = null;

      for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (quote) {
          if (ch === '\\') {
            i++;
          } else if (ch === quote) {
            quote = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === '{') {
          const header = clean.slice(headerStart, i).trim().replace(/\s+/g, ' ');
          if (header.startsWith('@')) {
            scopeStack.push(header);
          } else {
            const insideKeyframes = scopeStack.some((s) => /^@(-webkit-|-moz-)?keyframes\b/i.test(s));
            if (header && !insideKeyframes) {
              const scopeKey = scopeStack.join(' > ');
              const mapKey = `${scopeKey}::${header}`;
              const list = seen.get(mapKey) ?? [];
              list.push({ file: file.relPath, line: lineAtOffset(offsets, headerStart), selector: header });
              seen.set(mapKey, list);
            }
            scopeStack.push(`RULE:${header}`);
          }
          headerStart = i + 1;
        } else if (ch === '}') {
          scopeStack.pop();
          headerStart = i + 1;
        } else if (ch === ';' && !scopeStack.some((s) => s.startsWith('RULE:'))) {
          headerStart = i + 1;
        }
      }
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
