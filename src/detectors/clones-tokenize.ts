import ts from 'typescript';
import type { FileEntry } from '../contracts.js';

export interface TokenUnit {
  norm: string;
  line: number;
  logic: boolean;
}

interface SkipRange {
  start: number;
  end: number;
}

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const LOGIC_TOKENS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'try', 'catch', 'finally', 'throw', 'return', 'await', 'yield',
  'break', 'continue', 'typeof', 'instanceof', 'in', 'void', 'delete',
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '?', '!',
]);

export function isTsLikeFile(file: FileEntry): boolean {
  return TS_EXTS.has(file.ext.toLowerCase())
    || (!file.ext && /\.[cm]?[jt]sx?$/i.test(file.relPath));
}

function scriptKindFor(file: FileEntry): ts.ScriptKind {
  const ext = (file.ext || file.relPath.match(/\.[cm]?[jt]sx?$/i)?.[0] || '').toLowerCase();
  switch (ext) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function collectSkipRanges(sourceFile: ts.SourceFile): SkipRange[] {
  const ranges: SkipRange[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)
      || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
      || ts.isTemplateLiteralTypeNode(node)
      || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node)
    ) {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

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

function normalizeToken(kind: ts.SyntaxKind, raw: string, previous: ts.SyntaxKind | undefined): string | undefined {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) {
    return previous === ts.SyntaxKind.DotToken || previous === ts.SyntaxKind.QuestionDotToken ? raw : '$ID';
  }
  if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) return '$STR';
  if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral) return '$NUM';
  if (
    kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle
    || kind === ts.SyntaxKind.TemplateTail || kind === ts.SyntaxKind.RegularExpressionLiteral
    || kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia
  ) {
    return undefined;
  }
  return raw;
}

function isLogicToken(kind: ts.SyntaxKind, raw: string): boolean {
  if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) return false;
  return LOGIC_TOKENS.has(raw);
}

export function tokenize(file: FileEntry): TokenUnit[] {
  const sourceFile = file.sourceFile
    ?? ts.createSourceFile(file.relPath, file.content, ts.ScriptTarget.Latest, false, scriptKindFor(file));
  const skips = collectSkipRanges(sourceFile);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, sourceFile.languageVariant, blankRanges(sourceFile.text, skips));
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
