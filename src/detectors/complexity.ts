import ts from 'typescript';
import type { Detector, DetectorContext, Finding, Span } from '../contracts.js';
import { isTestFile } from './ts-ast.js';

const LOGICAL_BINARY_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function spanOf(sf: ts.SourceFile, node: ts.Node): Span {
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

function isLogicalBinary(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && LOGICAL_BINARY_KINDS.has(node.operatorToken.kind);
}

/**
 * SonarSource-style cognitive complexity of one function: +1 per control
 * construct (plus +1 per nesting level), +1 per logical-operator sequence
 * (&&/||/??). Nested functions are not part of this score.
 */
function complexityOfBody(root: ts.Node): number {
  let score = 0;
  const walk = (node: ts.Node, nesting: number): void => {
    let increment = 0;
    let childNesting = nesting;
    if (ts.isIfStatement(node)) {
      increment = 1 + nesting;
      childNesting = nesting + 1;
    } else if (
      ts.isForStatement(node)
      || ts.isForOfStatement(node)
      || ts.isForInStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
    ) {
      increment = 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isSwitchStatement(node)) {
      increment = 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      increment = 1;
    } else if (ts.isCatchClause(node)) {
      increment = 1 + nesting;
      childNesting = nesting + 1;
    } else if (ts.isConditionalExpression(node)) {
      increment = 1 + nesting;
      childNesting = nesting + 1;
    } else if (isLogicalBinary(node)) {
      // Count a run of &&/||/?? as one +1; a new run starts when the operator
      // changes or there is no binary parent (e.g. the condition itself).
      const parent = node.parent;
      increment = !parent || !ts.isBinaryExpression(parent) || parent.operatorToken.kind !== node.operatorToken.kind ? 1 : 0;
    }
    score += increment;
    ts.forEachChild(node, (child) => {
      // Nested functions/arrows are scored separately by collectFunctions;
      // they do not add to this function's complexity.
      if (ts.isFunctionLike(child)) return;
      walk(child, childNesting);
    });
  };
  ts.forEachChild(root, (child) => walk(child, 0));
  return score;
}

function functionName(node: ts.Node): string {
  const named = node as ts.SignatureDeclaration;
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return 'anonymous';
}

function nameSpan(sf: ts.SourceFile, node: ts.Node): Span {
  const named = node as ts.SignatureDeclaration;
  return spanOf(sf, named.name ?? node);
}

function collectFunctions(root: ts.Node): Array<{ name: string; node: ts.Node; score: number }> {
  const fns: Array<{ name: string; node: ts.Node; score: number }> = [];
  const walk = (node: ts.Node): void => {
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
      if (!file.sourceFile || /\.d\.ts$/.test(file.relPath) || isTestFile(file.relPath)) continue;
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
