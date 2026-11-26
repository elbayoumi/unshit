import ts from 'typescript';
import type { FileEntry, Finding, Patch, TextEdit } from '../../contracts.js';
import type { FixSkip } from './skip.js';
import { skipCollector } from './skip.js';

const RULE_ID = 'slop/redundant-catch';

export function isRedundantCatchRule(ruleId: string): boolean {
  return ruleId === RULE_ID;
}

interface CatchPlan {
  patches: Patch[];
  skipped: FixSkip[];
}

type CandidateResult = { edit: TextEdit } | { reason: string };

function tryStatementAt(sf: ts.SourceFile, start: number, end: number): ts.TryStatement | null {
  let found: ts.TryStatement | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isTryStatement(node) && node.getStart(sf) === start && node.getEnd() === end) {
      found = node;
      return;
    }
    // Non-unwrappable findings are anchored on the catch clause instead.
    if (ts.isCatchClause(node) && node.getStart(sf) === start && node.getEnd() === end
      && node.parent && ts.isTryStatement(node.parent)) {
      found = node.parent;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Declarations that would leak into (or collide in) the enclosing scope if unwrapped. */
function leaksIntoEnclosingScope(stmt: ts.Statement): boolean {
  if (ts.isVariableStatement(stmt)) {
    const flags = stmt.declarationList.flags;
    return (flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;
  }
  return ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt)
    || ts.isEnumDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
    || ts.isTypeAliasDeclaration(stmt);
}

/** True when the try sits in a statement list, so unwrapping keeps one statement per slot. */
function inStatementList(stmt: ts.Statement): boolean {
  const parent = stmt.parent;
  return ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)
    || ts.isCaseClause(parent) || ts.isDefaultClause(parent);
}

/**
 * Rebuilds the replacement text from the try block's own source span. Only
 * leading indentation is adjusted; comments and the original text of the
 * statements are preserved verbatim.
 */
function replacementFor(
  sf: ts.SourceFile,
  content: string,
  tryBlock: ts.Block,
  indent: string,
  keepBlock: boolean,
): string | null {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const inner = content.slice(tryBlock.getStart(sf) + 1, tryBlock.getEnd() - 1);
  const lines = inner.split(/\r?\n/);
  while (lines.length > 1 && lines[lines.length - 1]!.trim() === '') lines.pop();
  while (lines.length > 1 && lines[0]!.trim() === '') lines.shift();

  if (lines.length === 1) {
    const trimmed = lines[0]!.trim();
    if (!keepBlock) return trimmed;
    return trimmed ? `{ ${trimmed} }` : '{}';
  }

  if (keepBlock) return ['{', ...lines, `${indent}}`].join(eol);

  const first = lines.find((line) => line.trim() !== '');
  if (!first) return '';
  const leading = /^[\t ]*/.exec(first)![0];
  if (!leading.startsWith(indent)) return null;
  const unit = leading.slice(indent.length);
  const dedented = lines.map((line) => {
    if (line.trim() === '') return '';
    if (unit && line.startsWith(indent + unit)) {
      return indent + line.slice(indent.length + unit.length);
    }
    return line;
  });
  // The existing line prefix already supplies the indentation for the first line.
  dedented[0] = dedented[0]!.startsWith(indent) ? dedented[0]!.slice(indent.length) : dedented[0]!;
  return dedented.join(eol);
}

function candidateFor(file: FileEntry, sf: ts.SourceFile, finding: Finding): CandidateResult {
  const { startOffset, endOffset } = finding.span;
  if (startOffset === undefined || endOffset === undefined) {
    return { reason: 'finding has no source offsets' };
  }
  const tryStmt = tryStatementAt(sf, startOffset, endOffset);
  if (!tryStmt) return { reason: 'finding is not anchored on a whole try statement' };
  if (tryStmt.finallyBlock) return { reason: 'try statement has a finally block' };

  const catchClause = tryStmt.catchClause;
  if (!catchClause) return { reason: 'try statement has no catch clause' };
  const name = catchClause.variableDeclaration?.name;
  if (!name || !ts.isIdentifier(name)) {
    return { reason: 'catch parameter is missing or destructured' };
  }
  const stmts = catchClause.block.statements;
  if (stmts.length !== 1 || !ts.isThrowStatement(stmts[0])) {
    return { reason: 'catch clause does more than rethrow the caught error' };
  }
  const thrown = stmts[0].expression;
  if (!thrown || !ts.isIdentifier(thrown) || thrown.text !== name.text) {
    return { reason: 'catch clause does not rethrow the caught error itself' };
  }

  const content = file.content;
  const tryBlock = tryStmt.tryBlock;
  if (content.slice(tryStmt.getStart(sf) + 3, tryBlock.getStart(sf)).trim() !== '') {
    return { reason: 'comments between `try` and its block would be lost' };
  }
  if (content.slice(tryBlock.getEnd(), catchClause.getStart(sf)).trim() !== '') {
    return { reason: 'comments between the try and catch blocks would be lost' };
  }
  const beforeThrow = content.slice(catchClause.block.getStart(sf) + 1, stmts[0].getStart(sf));
  const afterThrow = content.slice(stmts[0].getEnd(), catchClause.block.getEnd() - 1);
  if (beforeThrow.trim() !== '' || afterThrow.trim() !== '') {
    return { reason: 'comments inside the catch block would be lost' };
  }

  const startPos = sf.getLineAndCharacterOfPosition(startOffset);
  const endPos = sf.getLineAndCharacterOfPosition(Math.max(startOffset, endOffset - 1));
  const singleLine = startPos.line === endPos.line;
  const lineStart = sf.getPositionOfLineAndCharacter(startPos.line, 0);
  const indent = singleLine ? '' : content.slice(lineStart, startOffset);
  if (!singleLine && indent.trim() !== '') {
    return { reason: 'multi-line try statement is not at the start of its line' };
  }

  const keepBlock = !inStatementList(tryStmt)
    || tryBlock.statements.some(leaksIntoEnclosingScope);
  const replacement = replacementFor(sf, content, tryBlock, indent, keepBlock);
  if (replacement === null) return { reason: 'unexpected indentation inside the try block' };
  return { edit: { startOffset, endOffset, replacement } };
}

/**
 * Unwraps a `try { … } catch (e) { throw e; }` into its try statements. A bare
 * block is kept when the try block declares block-scoped bindings that would
 * otherwise leak into the enclosing scope. Anything else is skipped with a
 * reason; edits cover only AST-derived source spans.
 */
export function planRedundantCatchFixes(file: FileEntry, findings: Finding[]): CatchPlan {
  if (findings.length === 0) return { patches: [], skipped: [] };
  const collector = skipCollector(file.relPath);
  const { skipped, skip } = collector;
  const sf = file.sourceFile;
  if (!sf) {
    findings.forEach((finding) => skip(finding, 'no TypeScript AST available for this file'));
    return { patches: [], skipped };
  }

  const edits: TextEdit[] = [];
  const claimed: Array<{ start: number; end: number }> = [];
  const ordered = [...findings]
    .sort((a, b) => (a.span.startOffset ?? Number.MAX_SAFE_INTEGER)
      - (b.span.startOffset ?? Number.MAX_SAFE_INTEGER));
  for (const finding of ordered) {
    const result = candidateFor(file, sf, finding);
    if ('reason' in result) {
      skip(finding, result.reason);
      continue;
    }
    const { startOffset, endOffset } = result.edit;
    if (claimed.some((r) => startOffset >= r.start && endOffset <= r.end)) {
      skip(finding, 'nested inside another redundant try/catch fixed in this pass');
      continue;
    }
    claimed.push({ start: startOffset, end: endOffset });
    edits.push(result.edit);
  }
  if (edits.length === 0) return { patches: [], skipped };

  return {
    patches: [{
      file: file.relPath,
      ruleId: RULE_ID,
      description: `Unwrap ${edits.length} redundant rethrow try/catch statement(s)`,
      edits,
    }],
    skipped,
  };
}
