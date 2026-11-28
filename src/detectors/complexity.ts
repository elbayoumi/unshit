import { createRequire } from 'node:module';
import type * as TS from 'typescript';
const _require = createRequire(import.meta.url);
let _ts: typeof TS | undefined;
const ts: typeof TS = new Proxy({} as typeof TS, { get(_, p) { const mod = _ts ??= _require('typescript') as typeof TS; return (mod as Record<PropertyKey, unknown>)[p]; } });
import type { Detector, DetectorContext, Finding, Span } from '../contracts.js';
import { isDeclarationFile } from '../core/declaration-file.js';
import { isTestFile } from './ts-ast.js';

let _logicalBinaryKinds: Set<TS.SyntaxKind> | undefined;
function logicalBinaryKinds(): Set<TS.SyntaxKind> {
  if (!_logicalBinaryKinds) {
    _logicalBinaryKinds = new Set<TS.SyntaxKind>([
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ]);
  }
  return _logicalBinaryKinds;
}

function spanOf(sf: TS.SourceFile, node: TS.Node): Span {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    startOffset: node.getStart(sf),
    endOffset: node.getEnd(),
  };
}

function isLogicalBinary(node: TS.Node): node is TS.BinaryExpression {
  return ts.isBinaryExpression(node) && logicalBinaryKinds().has(node.operatorToken.kind);
}

/**
 * SonarSource-style cognitive complexity of one function: +1 per control
 * construct (plus +1 per nesting level), +1 per logical-operator sequence
 * (&&/||/??). Nested functions are not part of this score.
 */
function nestingIncrement(node: TS.Node, nesting: number): number {
  return 1 + nesting;
}

function isNestingConstruct(node: TS.Node): boolean {
  return ts.isIfStatement(node)
    || ts.isForStatement(node)
    || ts.isForOfStatement(node)
    || ts.isForInStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isSwitchStatement(node)
    || ts.isCatchClause(node)
    || ts.isConditionalExpression(node);
}

function logicalSequenceIncrement(node: TS.BinaryExpression): number {
  const parent = node.parent;
  if (!parent || !ts.isBinaryExpression(parent)) return 1;
  return parent.operatorToken.kind !== node.operatorToken.kind ? 1 : 0;
}

function complexityOfBody(root: TS.Node): number {
  let score = 0;
  const walk = (node: TS.Node, nesting: number): void => {
    let increment = 0;
    let childNesting = nesting;
    if (isNestingConstruct(node)) {
      increment = nestingIncrement(node, nesting);
      childNesting = nesting + 1;
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      increment = 1;
    } else if (isLogicalBinary(node)) {
      increment = logicalSequenceIncrement(node);
    }
    score += increment;
    ts.forEachChild(node, (child) => {
      if (ts.isFunctionLike(child)) return;
      walk(child, childNesting);
    });
  };
  ts.forEachChild(root, (child) => walk(child, 0));
  return score;
}

function functionName(node: TS.Node): string {
  const named = node as TS.SignatureDeclaration;
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return 'anonymous';
}

function nameSpan(sf: TS.SourceFile, node: TS.Node): Span {
  const named = node as TS.SignatureDeclaration;
  return spanOf(sf, named.name ?? node);
}

function collectFunctions(root: TS.Node): Array<{ name: string; node: TS.Node; score: number }> {
  const fns: Array<{ name: string; node: TS.Node; score: number }> = [];
  const walk = (node: TS.Node): void => {
    if (ts.isFunctionLike(node)) {
      fns.push({ name: functionName(node), node, score: complexityOfBody(node) });
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return fns;
}

export const highComplexityDetector: Detector = {
  id: 'code/high-complexity',
  category: 'architecture',
  tier: 'structural',
  severity: 'warn',
  description:
    'Flags functions, methods and arrows with cognitive complexity above `complexityMax` (SonarSource-style: +1 per control construct, +1 per nesting level, +1 per logical-operator sequence; recursion ignored).',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const max = ctx.config.complexityMax;
    for (const file of ctx.files) {
      if (!file.sourceFile || isDeclarationFile(file.relPath) || isTestFile(file.relPath)) continue;
      const sf = file.sourceFile;
      for (const fn of collectFunctions(sf)) {
        if (fn.score <= max) continue;
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.9,
          file: file.relPath,
          span: nameSpan(sf, fn.node),
          message: `Cognitive complexity ${fn.score} exceeds threshold ${max} in "${fn.name}"; simplify or extract the function.`,
          evidence: `Score: ${fn.score}, threshold: ${max}`,
        });
      }
    }
    return findings;
  },
};
