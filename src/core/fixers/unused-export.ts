import ts from 'typescript';
import type { FileEntry, Finding, Patch, TextEdit } from '../../contracts.js';
import type { FixSkip } from './skip.js';
import { skipCollector } from './skip.js';

const RULES = new Set(['ts/unused-export', 'ts/unused-type-export']);

export function isUnusedExportRule(ruleId: string): boolean {
  return RULES.has(ruleId);
}

interface UnusedExportPlan {
  patches: Patch[];
  skipped: FixSkip[];
}

interface Declaration {
  stmt: ts.Statement;
  name: string;
  nameNode: ts.Node;
  hasExport: boolean;
  exportModifier?: ts.ModifierLike;
  isDefault: boolean;
  isDeclare: boolean;
  isExportClause: boolean;
  isDefaultAssignment: boolean;
}

interface Candidate {
  finding: Finding;
  decl: Declaration;
  edit: TextEdit;
}

function positionOfFinding(sf: ts.SourceFile, finding: Finding): number | undefined {
  const { line, column } = finding.span;
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return undefined;
  try {
    return sf.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    return undefined;
  }
}

/**
 * Identifiers that appear in the emitted signature of a declaration. Function
 * bodies and variable initializers are intentionally not visited: they never
 * appear in a .d.ts signature, so they must not block a safe removal.
 */
function mentionsInExportedSignature(stmt: ts.Statement, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionLike(node)) {
      for (const typeParam of node.typeParameters ?? []) visit(typeParam);
      for (const param of node.parameters) if (param.type) visit(param.type);
      if (node.type) visit(node.type);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      visit(node.name);
      if (node.type) visit(node.type);
      return;
    }
    if (ts.isPropertyDeclaration(node) && !node.type) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(stmt);
  return found;
}

function displayName(declarations: Declaration[], stmt: ts.Statement): string {
  const named = declarations.find((d) => d.stmt === stmt && d.name !== 'default');
  return named?.name ?? 'another exported declaration';
}

function declarationsForStatement(stmt: ts.Statement, add: (decl: Declaration) => void): void {
  const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
  const exportModifier = mods?.find((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  const isDeclare = mods?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  const base: Omit<Declaration, 'name' | 'nameNode'> = {
    stmt,
    hasExport: exportModifier !== undefined,
    exportModifier,
    isDefault,
    isDeclare,
    isExportClause: false,
    isDefaultAssignment: false,
  };
  const addNamed = (name: string, nameNode: ts.Node, extra: Partial<Declaration> = {}): void => {
    add({ ...base, name, nameNode, ...extra });
  };

  if (ts.isExportDeclaration(stmt)) {
    // `export { … }` has no modifier node: the keyword is part of the syntax kind.
    if (!stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        addNamed(el.name.text, el.name, { isExportClause: true, hasExport: true });
      }
    }
    return;
  }
  if (ts.isExportAssignment(stmt)) {
    addNamed('default', stmt, { isDefaultAssignment: true, hasExport: true });
    return;
  }
  if (isDefault) {
    // The detector anchors a default export finding on the whole statement.
    addNamed('default', stmt);
    return;
  }
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) addNamed(decl.name.text, decl.name);
    }
  } else if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)
    || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
    || ts.isEnumDeclaration(stmt)) {
    if (stmt.name) addNamed(stmt.name.text, stmt.name);
  }
}

function declarationsOf(sf: ts.SourceFile): Declaration[] {
  const declarations: Declaration[] = [];
  for (const stmt of sf.statements) {
    declarationsForStatement(stmt, (decl) => declarations.push(decl));
  }
  return declarations;
}

type CandidateResult = { candidate: Candidate } | { reason: string };

function candidateForFinding(
  file: FileEntry,
  sf: ts.SourceFile,
  finding: Finding,
  declarations: Declaration[],
): CandidateResult {
  const offset = positionOfFinding(sf, finding);
  const decl = offset === undefined
    ? undefined
    : declarations.find((d) => d.nameNode.getStart(sf) === offset);
  if (!decl) return { reason: 'could not locate the declared name in the TypeScript AST' };
  if (!decl.hasExport) return { reason: 'declaration is no longer exported' };
  if (decl.isExportClause) {
    return { reason: 'listed export clause: removing only `export` would delete the re-export' };
  }
  if (decl.isDefault || decl.isDefaultAssignment) {
    return { reason: 'default export: removing only `export` would leave an invalid declaration' };
  }
  if (decl.isDeclare) {
    return { reason: 'ambient (`declare`) declaration: removing `export` may change declaration emit' };
  }
  const modifier = decl.exportModifier;
  if (!modifier) return { reason: 'no `export` modifier found on the declaration' };
  const startOffset = modifier.getStart(sf);
  if (file.content.slice(startOffset, modifier.end) !== 'export') {
    return { reason: 'unexpected `export` modifier text' };
  }
  let endOffset = modifier.end;
  while (endOffset < file.content.length
    && (file.content[endOffset] === ' ' || file.content[endOffset] === '\t')) {
    endOffset += 1;
  }
  return { candidate: { finding, decl, edit: { startOffset, endOffset, replacement: '' } } };
}

function collectCandidates(
  file: FileEntry,
  sf: ts.SourceFile,
  findings: Finding[],
  declarations: Declaration[],
  skip: (finding: Finding, reason: string) => void,
): Map<ts.Statement, Candidate> {
  const candidates = new Map<ts.Statement, Candidate>();
  for (const finding of findings) {
    const result = candidateForFinding(file, sf, finding, declarations);
    if ('reason' in result) {
      skip(finding, result.reason);
      continue;
    }
    const { candidate } = result;
    if (!candidates.has(candidate.decl.stmt)) candidates.set(candidate.decl.stmt, candidate);
  }
  return candidates;
}

/**
 * Fixed point: a declaration skipped below stays exported, so it may in turn
 * protect declarations that reference it from being un-exported.
 */
function pruneProtectedCandidates(
  declarations: Declaration[],
  candidates: Map<ts.Statement, Candidate>,
  skip: (finding: Finding, reason: string) => void,
): Map<ts.Statement, Candidate> {
  const removable = new Map(candidates);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [stmt, candidate] of [...removable]) {
      let blocker: string | undefined;
      for (const other of declarations) {
        if (!other.hasExport || other.stmt === stmt || other.isExportClause) continue;
        if (removable.has(other.stmt)) continue;
        if (mentionsInExportedSignature(other.stmt, candidate.decl.name)) {
          blocker = displayName(declarations, other.stmt);
          break;
        }
      }
      if (blocker) {
        removable.delete(stmt);
        skip(
          candidate.finding,
          `could break declaration emit: \`${candidate.decl.name}\` is referenced by the exported signature of \`${blocker}\` (kept conservatively)`,
        );
        changed = true;
      }
    }
  }
  return removable;
}

/**
 * Plans modifier-only fixes: `export const x` becomes `const x`, never a
 * deletion. A declaration is left alone while any other declaration that
 * stays exported references its name in an emitted signature.
 */
export function planUnusedExportFixes(file: FileEntry, findings: Finding[]): UnusedExportPlan {
  const { skipped, skip } = skipCollector(file.relPath);
  if (findings.length === 0) return { patches: [], skipped };

  const sf = file.sourceFile;
  const isDeclarationFile = /\.d\.[cm]?ts$/.test(file.relPath);
  if (!sf || isDeclarationFile || !/\.[cm]?[jt]sx?$/.test(file.relPath)) {
    const reason = !sf
      ? 'no TypeScript AST available for this file'
      : isDeclarationFile
        ? 'declaration file: removing `export` changes the public API'
        : 'not a TypeScript/JavaScript source file';
    for (const finding of findings) skip(finding, reason);
    return { patches: [], skipped };
  }

  const declarations = declarationsOf(sf);
  const candidates = collectCandidates(file, sf, findings, declarations, skip);
  const removable = pruneProtectedCandidates(declarations, candidates, skip);
  const patches: Patch[] = [...removable.values()]
    .sort((a, b) => a.edit.startOffset - b.edit.startOffset)
    .map(({ finding, decl, edit }) => ({
      file: file.relPath,
      ruleId: finding.ruleId,
      description: `Remove \`export\` from ${decl.name}, keep the declaration`,
      edits: [edit],
    }));
  return { patches, skipped };
}
