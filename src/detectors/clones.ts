import ts from 'typescript';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';

interface TokenUnit {
  norm: string;
  line: number;
  logic: boolean;
}

interface SkipRange {
  start: number;
  end: number;
}

interface CloneWindow {
  file: string;
  startLine: number;
  endLine: number;
  startToken: number;
  endToken: number;
}

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const LOGIC_DENSITY_MIN = 3;

const LOGIC_TOKENS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'try', 'catch', 'finally', 'throw', 'return', 'await', 'yield',
  'break', 'continue', 'typeof', 'instanceof', 'in', 'void', 'delete',
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '?', '!',
]);

function isTsLikeFile(file: FileEntry): boolean {
  return TS_EXTS.has(file.ext.toLowerCase())
    || (!file.ext && /\.[cm]?[jt]sx?$/i.test(file.relPath));
}

function scriptKindFor(file: FileEntry): ts.ScriptKind {
  const ext = (file.ext || file.relPath.match(/\.[cm]?[jt]sx?$/i)?.[0] || '').toLowerCase();
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Ranges that the scanner should not contribute to clone signatures.
 * The scanner already skips trivia (and therefore comments); AST ranges cover
 * template/regex literals, JSX text, and import declarations whose raw text
 * would otherwise pollute token windows or be mis-scanned.
 */
function collectSkipRanges(sourceFile: ts.SourceFile): SkipRange[] {
  const ranges: SkipRange[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node)
      || ts.isImportEqualsDeclaration(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
      || ts.isRegularExpressionLiteral(node)
      || ts.isJsxText(node)
    ) {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Blank skipped ranges (keeping newlines) so the scanner never sees raw
 * template/regex/import text that it cannot reliably tokenize on its own.
 */
function blankRanges(text: string, ranges: SkipRange[]): string {
  if (ranges.length === 0) return text;
  const chars = text.split('');
  for (const range of ranges) {
    for (let i = range.start; i < range.end && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

function normalizeToken(
  kind: ts.SyntaxKind,
  raw: string,
  previous: ts.SyntaxKind | undefined,
): string | undefined {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) {
    // Member names carry API intent: `.filter` and `.map` are not interchangeable.
    return previous === ts.SyntaxKind.DotToken || previous === ts.SyntaxKind.QuestionDotToken
      ? raw
      : '$ID';
  }
  if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
    return '$STR';
  }
  if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral) {
    return '$NUM';
  }
  if (
    kind === ts.SyntaxKind.TemplateHead
    || kind === ts.SyntaxKind.TemplateMiddle
    || kind === ts.SyntaxKind.TemplateTail
    || kind === ts.SyntaxKind.RegularExpressionLiteral
    || kind === ts.SyntaxKind.SingleLineCommentTrivia
    || kind === ts.SyntaxKind.MultiLineCommentTrivia
  ) {
    return undefined;
  }
  return raw;
}

function isLogicToken(kind: ts.SyntaxKind, raw: string): boolean {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) return false;
  return LOGIC_TOKENS.has(raw);
}

function tokenize(file: FileEntry): TokenUnit[] {
  const sourceFile = file.sourceFile
    ?? ts.createSourceFile(file.relPath, file.content, ts.ScriptTarget.Latest, false, scriptKindFor(file));
  const skips = collectSkipRanges(sourceFile);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    sourceFile.languageVariant,
    blankRanges(sourceFile.text, skips),
  );
  const units: TokenUnit[] = [];
  let skipIndex = 0;
  let previous: ts.SyntaxKind | undefined;

  let kind: ts.SyntaxKind;
  while ((kind = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    const start = scanner.getTokenStart();
    while (skipIndex < skips.length && skips[skipIndex]!.end <= start) skipIndex++;
    const skip = skips[skipIndex];
    if (skip && start >= skip.start && start < skip.end) continue;

    const raw = scanner.getTokenText();
    if (!raw) continue;
    const norm = normalizeToken(kind, raw, previous);
    if (norm === undefined) continue;

    units.push({
      norm,
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      logic: isLogicToken(kind, raw),
    });
    previous = kind;
  }
  return units;
}

function mergeWindows(windows: CloneWindow[]): CloneWindow[] {
  const sorted = windows
    .map((window) => ({ ...window }))
    .sort((a, b) => a.startToken - b.startToken || a.startLine - b.startLine);
  const merged: CloneWindow[] = [];

  for (const window of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push(window);
      continue;
    }
    const overlapsTokens = window.startToken <= last.endToken;
    const adjacentLines = window.startLine <= last.endLine + 1;
    if (overlapsTokens || adjacentLines) {
      last.startToken = Math.min(last.startToken, window.startToken);
      last.endToken = Math.max(last.endToken, window.endToken);
      last.startLine = Math.min(last.startLine, window.startLine);
      last.endLine = Math.max(last.endLine, window.endLine);
    } else {
      merged.push(window);
    }
  }
  return merged;
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
    const windowSize = Math.max(1, Math.floor(ctx.config.cloneMinTokens));
    const step = Math.max(1, Math.floor(windowSize / 3));
    const buckets = new Map<string, CloneWindow[]>();

    for (const file of ctx.files) {
      if (!isTsLikeFile(file) || /\.(test|spec|d)\./.test(file.relPath)) continue;
      const tokens = tokenize(file);
      if (tokens.length < windowSize) continue;

      const logicPrefix = new Array<number>(tokens.length + 1).fill(0);
      for (let i = 0; i < tokens.length; i++) {
        logicPrefix[i + 1] = logicPrefix[i]! + (tokens[i]!.logic ? 1 : 0);
      }

      for (let i = 0; i <= tokens.length - windowSize; i += step) {
        const end = i + windowSize;
        if (logicPrefix[end]! - logicPrefix[i]! < LOGIC_DENSITY_MIN) continue;

        const signature = tokens.slice(i, end).map((token) => token.norm).join(' ');
        const list = buckets.get(signature) ?? [];
        list.push({
          file: file.relPath,
          startLine: tokens[i]!.line,
          endLine: tokens[end - 1]!.line,
          startToken: i,
          endToken: end,
        });
        buckets.set(signature, list);
      }
    }

    const pairs = new Map<string, { first: string; second: string; windows: CloneWindow[] }>();
    for (const occurrences of buckets.values()) {
      const byFile = new Map<string, CloneWindow[]>();
      for (const occurrence of occurrences) {
        const list = byFile.get(occurrence.file) ?? [];
        list.push(occurrence);
        byFile.set(occurrence.file, list);
      }
      const fileNames = [...byFile.keys()].sort();
      if (fileNames.length < 2) continue;

      for (let a = 0; a < fileNames.length; a++) {
        for (let b = a + 1; b < fileNames.length; b++) {
          const first = fileNames[a]!;
          const second = fileNames[b]!;
          const key = `${first}\u0000${second}`;
          let entry = pairs.get(key);
          if (!entry) {
            entry = { first, second, windows: [] };
            pairs.set(key, entry);
          }
          entry.windows.push(...byFile.get(first)!, ...byFile.get(second)!);
        }
      }
    }

    const findings: Finding[] = [];
    for (const { first, second, windows } of pairs.values()) {
      const firstRegions = mergeWindows(windows.filter((window) => window.file === first));
      const secondRegions = mergeWindows(windows.filter((window) => window.file === second));
      if (firstRegions.length === 0 || secondRegions.length === 0) continue;

      for (let i = 0; i < secondRegions.length; i++) {
        const source = firstRegions[Math.min(i, firstRegions.length - 1)]!;
        const target = secondRegions[i]!;
        const tokenCount = target.endToken - target.startToken;
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.82,
          file: target.file,
          span: { line: target.startLine, column: 1, endLine: target.endLine },
          message: `Duplicate logic block (~${tokenCount} tokens) matches ${source.file}:${source.startLine}-${source.endLine}.`,
          evidence: `${target.file}:${target.startLine}-${target.endLine} <-> ${source.file}:${source.startLine}-${source.endLine}`,
        });
      }
    }

    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.span.line - b.span.line);
  },
};
