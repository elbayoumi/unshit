import ts from 'typescript';
import type { FileEntry, Finding, Patch, TextEdit } from '../../contracts.js';
import type { FixSkip } from './skip.js';
import { skipCollector } from './skip.js';

const RULE_ID = 'slop/magic-timer';
const PLAIN_INTEGER_RE = /^\d+$/;

export function isMagicTimerRule(ruleId: string): boolean {
  return ruleId === RULE_ID;
}

interface TimerCandidate {
  finding: Finding;
  name: string;
  literal: string;
  edit: TextEdit;
}

interface TimerPlan {
  patches: Patch[];
  skipped: FixSkip[];
}

type CandidateResult = { candidate: TimerCandidate } | { reason: string };

function numericLiteralAt(sf: ts.SourceFile, offset: number): ts.NumericLiteral | null {
  let found: ts.NumericLiteral | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isNumericLiteral(node) && node.getStart(sf) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function contextName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionLike(current) && current.name && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return 'timer';
}

function timerSuffix(call: ts.CallExpression): string | null {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text
    : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  if (name === 'setTimeout') return 'DELAY_MS';
  if (name === 'setInterval') return 'INTERVAL_MS';
  return null;
}

function constantName(node: ts.NumericLiteral, suffix: string): string {
  const base = contextName(node)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
  return `${base}_${suffix}`;
}

function identifiersOf(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isLeadingStatement(stmt: ts.Statement): boolean {
  return ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)
    || (ts.isExpressionStatement(stmt) && ts.isStringLiteralLike(stmt.expression));
}

function insertionOffset(sf: ts.SourceFile): number {
  const first = sf.statements.find((stmt) => !isLeadingStatement(stmt));
  return first ? first.getStart(sf) : sf.end;
}

function candidateFor(
  file: FileEntry,
  sf: ts.SourceFile,
  finding: Finding,
  identifiers: Set<string>,
  usedNames: Set<string>,
): CandidateResult {
  const offset = finding.span.startOffset;
  if (offset === undefined) return { reason: 'finding has no source offset' };
  const literal = numericLiteralAt(sf, offset);
  const call = literal?.parent;
  if (!literal || !call || !ts.isCallExpression(call)) {
    return { reason: 'delay literal is no longer a timer argument' };
  }
  const start = literal.getStart(sf);
  const text = file.content.slice(start, literal.getEnd());
  if (!PLAIN_INTEGER_RE.test(text)) return { reason: 'delay literal is not a plain decimal number' };
  const suffix = timerSuffix(call);
  if (!suffix) return { reason: 'delay literal is no longer a setTimeout/setInterval argument' };
  const name = constantName(literal, suffix);
  if (identifiers.has(name)) return { reason: `name \`${name}\` already exists in this file` };
  if (usedNames.has(name)) return { reason: `name \`${name}\` is already used by another timer fix in this file` };
  usedNames.add(name);
  return {
    candidate: {
      finding,
      name,
      literal: text,
      edit: { startOffset: start, endOffset: literal.getEnd(), replacement: name },
    },
  };
}

/**
 * Extracts plain numeric timer delays into module-level constants named from
 * the enclosing function/variable plus the timer kind. Everything else is
 * skipped with a reason; only the literal and one top-of-module insertion are
 * edited, so the fix is deterministic and idempotent.
 */
export function planMagicTimerFixes(file: FileEntry, findings: Finding[]): TimerPlan {
  const { skipped, skip } = skipCollector(file.relPath);
  if (findings.length === 0) return { patches: [], skipped };

  const sf = file.sourceFile;
  if (!sf) {
    for (const finding of findings) skip(finding, 'no TypeScript AST available for this file');
    return { patches: [], skipped };
  }

  const identifiers = identifiersOf(sf);
  const usedNames = new Set<string>();
  const candidates: TimerCandidate[] = [];
  for (const finding of findings) {
    const result = candidateFor(file, sf, finding, identifiers, usedNames);
    if ('reason' in result) skip(finding, result.reason);
    else candidates.push(result.candidate);
  }
  if (candidates.length === 0) return { patches: [], skipped };

  const at = insertionOffset(sf);
  const prefix = at === sf.end && !/[\r\n]$/.test(file.content) ? '\n' : '';
  const declarations = [...candidates]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `const ${c.name} = ${c.literal};\n`)
    .join('');
  const edits: TextEdit[] = [
    ...candidates.map((c) => c.edit),
    { startOffset: at, endOffset: at, replacement: `${prefix}${declarations}` },
  ];
  return {
    patches: [{
      file: file.relPath,
      ruleId: RULE_ID,
      description: `Extract ${candidates.length} magic timer delay(s) into named constants`,
      edits,
    }],
    skipped,
  };
}
