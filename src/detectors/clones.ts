import { createHash } from 'node:crypto';
import type { Detector, DetectorContext, Finding } from '../contracts.js';

interface TokenUnit {
  norm: string;
  line: number;
}

const TOKEN_RE = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}()[\].,:;+-/*=<>!&|?]+/g;
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'switch', 'case', 'break', 'import', 'export', 'from', 'type', 'interface',
  'async', 'await', 'try', 'catch', 'throw', 'new', 'true', 'false', 'null',
]);

function tokenize(content: string): TokenUnit[] {
  const units: TokenUnit[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    if (lineText.trimStart().startsWith('import ')) continue;
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(lineText)) !== null) {
      const raw = m[0];
      let norm = raw;
      if (raw.startsWith('"') || raw.startsWith("'")) norm = '$STR';
      else if (/^\d/.test(raw)) norm = '$NUM';
      else if (/^[A-Za-z_$]/.test(raw) && !KEYWORDS.has(raw)) norm = '$ID';
      units.push({ norm, line: i + 1 });
    }
  }
  return units;
}

/**
 * jscpd-inspired rolling token-window clone detector.
 */
export const duplicateBlockDetector: Detector = {
  id: 'code/duplicate-block',
  category: 'duplication',
  tier: 'structural',
  severity: 'info',
  description: 'Detects copy-pasted structural token blocks across source files.',
  detect(ctx: DetectorContext): Finding[] {
    const windowSize = ctx.config.cloneMinTokens;
    const buckets = new Map<string, { file: string; startLine: number; endLine: number }[]>();

    for (const file of ctx.files) {
      if (!file.sourceFile || /\.(test|spec|d)\./.test(file.relPath)) continue;
      const tokens = tokenize(file.content);
      if (tokens.length < windowSize) continue;

      const step = Math.max(10, Math.floor(windowSize / 3));
      for (let i = 0; i <= tokens.length - windowSize; i += step) {
        const slice = tokens.slice(i, i + windowSize);
        const sig = slice.map((t) => t.norm).join(' ');
        const hash = createHash('sha1').update(sig).digest('hex').slice(0, 12);
        const startLine = slice[0]!.line;
        const endLine = slice[slice.length - 1]!.line;
        const list = buckets.get(hash) ?? [];
        list.push({ file: file.relPath, startLine, endLine });
        buckets.set(hash, list);
      }
    }

    const findings: Finding[] = [];
    const reported = new Set<string>();
    for (const occurrences of buckets.values()) {
      const distinctFiles = new Set(occurrences.map((o) => o.file));
      if (distinctFiles.size < 2) continue;
      const first = occurrences[0]!;
      for (let i = 1; i < occurrences.length; i++) {
        const dup = occurrences[i]!;
        if (dup.file === first.file) continue;
        const key = `${dup.file}:${Math.floor(dup.startLine / 10)}`;
        if (reported.has(key)) continue;
        reported.add(key);
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.82,
          file: dup.file,
          span: { line: dup.startLine, column: 1, endLine: dup.endLine },
          message: `Duplicate logic block (~${windowSize} tokens) matches ${first.file}:${first.startLine}-${first.endLine}.`,
          evidence: `${dup.file}:${dup.startLine}-${dup.endLine} <-> ${first.file}:${first.startLine}-${first.endLine}`,
        });
      }
    }
    return findings;
  },
};
