import ts from 'typescript';
import type { FileEntry, Finding, Patch, TextEdit } from '../../contracts.js';

const RULES = new Set(['ts/unused-export', 'ts/unused-type-export']);

export function isUnusedExportRule(ruleId: string): boolean {
  return RULES.has(ruleId);
}

interface UnusedExportSkip {
  file: string;
  ruleId: string;
  line: number;
  reason: string;
}

interface UnusedExportPlan {
  patches: Patch[];
  skipped: UnusedExportSkip[];
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

/**
 * Plans modifier-only fixes: `export const x` becomes `const x`, never a
 * deletion. A declaration is left alone while any other declaration that
 * stays exported references its name in an emitted signature.
 */
export function planUnusedExportFixes(file: FileEntry, findings: Finding[]): UnusedExportPlan {
  const skipped: UnusedExportSkip[] = [];
  if (findings.length === 0) return { patches: [], skipped };

  const skip = (finding: Finding, reason: string): void => {
    skipped.push({ file: file.relPath, ruleId: finding.ruleId, line: finding.span.line, reason });
  };
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

  const declarations: Declaration[] = [];
  for (const stmt of sf.statements) {
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
    const add = (name: string, nameNode: ts.Node, extra: Partial<Declaration> = {}): void => {
      declarations.push({ ...base, name, nameNode, ...extra });
    };

    if (ts.isExportDeclaration(stmt)) {
      // `export { … }` has no modifier node: the keyword is part of the syntax kind.
      if (!stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          add(el.name.text, el.name, { isExportClause: true, hasExport: true });
        }
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      add('default', stmt, { isDefaultAssignment: true, hasExport: true });
      continue;
    }
    if (isDefault) {
      // The detector anchors a default export finding on the whole statement.
      add('default', stmt);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) add(decl.name.text, decl.name);
      }
    } else if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)
      || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
      || ts.isEnumDeclaration(stmt)) {
      if (stmt.name) add(stmt.name.text, stmt.name);
    }
  }

  const candidates = new Map<ts.Statement, Candidate>();
  for (const finding of findings) {
    const offset = positionOfFinding(sf, finding);
    const decl = offset === undefined
      ? undefined
      : declarations.find((d) => d.nameNode.getStart(sf) === offset);
    if (!decl) {
      skip(finding, 'could not locate the declared name in the TypeScript AST');
      continue;
    }
    if (!decl.hasExport) {
      skip(finding, 'declaration is no longer exported');
      continue;
    }
    if (decl.isExportClause) {
      skip(finding, 'listed export clause: removing only `export` would delete the re-export');
      continue;
    }
    if (decl.isDefault || decl.isDefaultAssignment) {
      skip(finding, 'default export: removing only `export` would leave an invalid declaration');
      continue;
    }
    if (decl.isDeclare) {
      skip(finding, 'ambient (`declare`) declaration: removing `export` may change declaration emit');
      continue;
    }
    const modifier = decl.exportModifier;
    if (!modifier) {
      skip(finding, 'no `export` modifier found on the declaration');
      continue;
    }
    const startOffset = modifier.getStart(sf);
    if (file.content.slice(startOffset, modifier.end) !== 'export') {
      skip(finding, 'unexpected `export` modifier text');
      continue;
    }
    let endOffset = modifier.end;
    while (endOffset < file.content.length
      && (file.content[endOffset] === ' ' || file.content[endOffset] === '\t')) {
      endOffset += 1;
    }
    const edit: TextEdit = { startOffset, endOffset, replacement: '' };
    if (!candidates.has(decl.stmt)) candidates.set(decl.stmt, { finding, decl, edit });
  }

  // Fixed point: a declaration skipped below stays exported, so it may in turn
  // protect declarations that reference it from being un-exported.
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
