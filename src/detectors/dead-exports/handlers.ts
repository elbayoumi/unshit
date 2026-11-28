export interface ExportDecl {
  name: string;
  isTypeOnly: boolean;
  file: string;
  line: number;
  column: number;
  localName: string;
  isListed: boolean;
  isDefault: boolean;
}

export interface ReexportInfo {
  named: Array<{ exported: string; target: string; orig: string }>;
  stars: string[];
}

export interface Analysis {
  decls: ExportDecl[];
  consumed: Map<string, Set<string>>;
  fuzzy: Set<string>;
}

export interface FileAnalysis {
  state: AnalysisState;
  file: FileEntry;
  sf: ts.SourceFile;
  bindings: Map<string, { target: string | null; internal: boolean; imported: string }>;
  nsLocals: Map<string, { target: string | null; internal: boolean }>;
  topLevelKinds: Map<string, boolean>;
  reexp: ReexportInfo;
  nsMembers: Map<string, { members: Set<string>; star: boolean }>;
}

export interface AnalysisState {
  ctx: DetectorContext;
  resolveFile: ReturnType<typeof createTsSpecResolver>;
  fileSet: Set<string>;
  entryPoints: Set<string>;
  decls: ExportDecl[];
  consumed: Map<string, Set<string>>;
  fuzzy: Set<string>;
  reexports: Map<string, ReexportInfo>;
  queue: Array<[string, string]>;
}

import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import { createTsSpecResolver } from '../../core/import-graph.js';
import { posixJoin } from './utils.js';
import { leftmost, isDeclarationName } from './utils.js';
import { STAR, ASSET_SPEC_RE, FRAMEWORK_EXPORTS } from './utils.js';
import { collectNonModuleLoadingPathTargets } from '../path-literals.js';

function handleImportDeclaration(fa: FileAnalysis, stmt: ts.ImportDeclaration): void {
  const { state, file } = fa;
  const resolve = (spec: string, f: FileEntry) => state.resolveFile(spec, f);
  const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
  const res = resolve(spec, file);
  const clause = stmt.importClause;
  if (!clause) return;
  if (clause.name) {
    fa.bindings.set(clause.name.text, { target: res.target, internal: res.internal, imported: 'default' });
    useSpec(state, file, resolve, spec, ['default']);
  }
  const nb = clause.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) {
    fa.nsLocals.set(nb.name.text, { target: res.target, internal: res.internal });
  } else if (nb) {
    for (const el of nb.elements) {
      const imported = (el.propertyName ?? el.name).text;
      fa.bindings.set(el.name.text, { target: res.target, internal: res.internal, imported });
      useSpec(state, file, resolve, spec, [imported]);
    }
  }
}

function handleReexportDeclaration(fa: FileAnalysis, stmt: ts.ExportDeclaration): void {
  const { state, file, reexp } = fa;
  const resolve = (spec: string, f: FileEntry) => state.resolveFile(spec, f);
  const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
  const res = resolve(spec, file);
  if (!res.internal) return;
  if (!res.target) {
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) state.fuzzy.add((el.propertyName ?? el.name).text);
    }
    return;
  }
  if (!stmt.exportClause) reexp.stars.push(res.target);
  else if (ts.isNamespaceExport(stmt.exportClause)) reexp.named.push({ exported: stmt.exportClause.name.text, target: res.target, orig: STAR });
  else for (const el of stmt.exportClause.elements) reexp.named.push({ exported: el.name.text, target: res.target, orig: (el.propertyName ?? el.name).text });
}

function recordTopLevelKind(fa: FileAnalysis, stmt: ts.Statement): void {
  if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
    fa.topLevelKinds.set(stmt.name.text, true);
  } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
    fa.topLevelKinds.set(stmt.name.text, false);
  } else if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) fa.topLevelKinds.set(d.name.text, false);
  }
}

function handleTopLevelStatement(fa: FileAnalysis, stmt: ts.Statement): void {
  const { state, file } = fa;
  const resolve = (spec: string, f: FileEntry) => state.resolveFile(spec, f);
  if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
    handleImportDeclaration(fa, stmt as ts.ImportDeclaration);
    return;
  }
  if (ts.isImportEqualsDeclaration(stmt)
    && ts.isExternalModuleReference(stmt.moduleReference)
    && ts.isStringLiteral(stmt.moduleReference.expression)) {
    useSpec(state, file, resolve, stmt.moduleReference.expression.text, STAR);
    return;
  }
  if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
    handleReexportDeclaration(fa, stmt as ts.ExportDeclaration);
    return;
  }
  if (ts.isExportAssignment(stmt) && stmt.isExportEquals) {
    consume(state, file.relPath, STAR);
  }
}

export function processStatementsFirstPass(fa: FileAnalysis): void {
  const { sf } = fa;
  for (const stmt of sf.statements) {
    handleTopLevelStatement(fa, stmt);
    recordTopLevelKind(fa, stmt);
  }
}

function handleDynamicImport(fa: FileAnalysis, node: ts.CallExpression, arg0: ts.Expression, resolve: (spec: string, f: FileEntry) => { internal: boolean; target: string | null }): void {
  const { state, file } = fa;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name) && !parent.name.elements.some((e) => e.dotDotDotToken)) {
    const names = parent.name.elements.map((e) => (e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : STAR));
    useSpec(state, file, resolve, (arg0 as ts.StringLiteralLike).text, names);
  } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    useSpec(state, file, resolve, (arg0 as ts.StringLiteralLike).text, [parent.name.text]);
  } else {
    useSpec(state, file, resolve, (arg0 as ts.StringLiteralLike).text, STAR);
  }
}

function collectGlobPatterns(arg0: ts.Expression): string[] {
  if (ts.isStringLiteralLike(arg0)) return [arg0.text];
  if (ts.isArrayLiteralExpression(arg0)) {
    const out: string[] = [];
    for (const e of arg0.elements) if (ts.isStringLiteralLike(e)) out.push(e.text);
    return out;
  }
  return [];
}

function processGlobPattern(fa: FileAnalysis, pattern: string): void {
  const { state, file } = fa;
  const base = pattern.replace(/^!/, '').split(/[*{[]/)[0] ?? '';
  const dir = base.startsWith('/') ? base.slice(1) : base.startsWith('.') ? posixJoin(file.relPath, base) : null;
  if (dir === null) return;
  const prefix = dir.endsWith('/') ? dir : dir.replace(/[^/]*$/, '');
  for (const other of state.fileSet) if (other.startsWith(prefix)) consume(state, other, STAR);
}

function handleImportMetaGlob(fa: FileAnalysis, node: ts.CallExpression, arg0: ts.Expression): void {
  const { state } = fa;
  const patterns = collectGlobPatterns(arg0);
  for (const pattern of patterns) processGlobPattern(fa, pattern);
}

function handleCallExpression(fa: FileAnalysis, node: ts.CallExpression): void {
  const { state, file } = fa;
  const resolve = (spec: string, f: FileEntry) => state.resolveFile(spec, f);
  const arg0 = node.arguments[0];
  const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if ((isImportCall || isRequire) && arg0 && ts.isStringLiteralLike(arg0)) {
    handleDynamicImport(fa, node, arg0, resolve);
  }
  if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob'
    && ts.isMetaProperty(node.expression.expression) && arg0) {
    handleImportMetaGlob(fa, node, arg0);
  }
}

function handleImportTypeNode(fa: FileAnalysis, node: ts.ImportTypeNode): void {
  const { state, file } = fa;
  const resolve = (spec: string, f: FileEntry) => state.resolveFile(spec, f);
  const q = node.qualifier;
  const first = q ? (ts.isIdentifier(q) ? q.text : leftmost(q)) : null;
  useSpec(state, file, resolve, ((node.argument as ts.LiteralTypeNode).literal as ts.StringLiteral).text, first ? [first] : STAR);
}

function isPropertyAccessMember(parent: ts.Node, node: ts.Node): parent is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(parent) && parent.expression === node;
}

function isQualifiedNameLeft(parent: ts.Node, node: ts.Node): parent is ts.QualifiedName {
  return ts.isQualifiedName(parent) && parent.left === node;
}

function isElementAccessMember(parent: ts.Node, node: ts.Node): parent is ts.ElementAccessExpression {
  return ts.isElementAccessExpression(parent) && parent.expression === node && !!parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression);
}

function isObjectBindingMember(parent: ts.Node, node: ts.Node): parent is ts.VariableDeclaration {
  return ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name) && !(parent.name as ts.ObjectBindingPattern).elements.some((e) => e.dotDotDotToken);
}

function addBindingMembers(entry: { members: Set<string>; star: boolean }, parent: ts.VariableDeclaration): void {
  for (const e of (parent.name as ts.ObjectBindingPattern).elements) {
    const name = e.propertyName && ts.isIdentifier(e.propertyName)
      ? e.propertyName.text
      : ts.isIdentifier(e.name) ? e.name.text : STAR;
    entry.members.add(name);
  }
}

function handleNamespaceIdentifier(fa: FileAnalysis, node: ts.Identifier): void {
  const { nsMembers } = fa;
  const parent = node.parent;
  const entry = nsMembers.get(node.text)!;
  if (ts.isNamespaceImport(parent)) return;
  if (isPropertyAccessMember(parent, node)) { entry.members.add(parent.name.text); return; }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
  if (isQualifiedNameLeft(parent, node)) { entry.members.add(parent.right.text); return; }
  if (isElementAccessMember(parent, node)) { entry.members.add(((parent as ts.ElementAccessExpression).argumentExpression as ts.StringLiteral).text); return; }
  if (isObjectBindingMember(parent, node)) { addBindingMembers(entry, parent); return; }
  if (ts.isExportSpecifier(parent) || ts.isShorthandPropertyAssignment(parent) || !isDeclarationName(node)) {
    entry.star = true;
  }
}

function visitNode(fa: FileAnalysis, node: ts.Node): void {
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    handleImportTypeNode(fa, node as ts.ImportTypeNode);
  } else if (ts.isCallExpression(node)) {
    handleCallExpression(fa, node as ts.CallExpression);
  } else if (ts.isIdentifier(node) && fa.nsMembers.has(node.text)) {
    handleNamespaceIdentifier(fa, node as ts.Identifier);
  }
  ts.forEachChild(node, (child) => visitNode(fa, child));
}

export function walkDynamic(fa: FileAnalysis): void {
  const { state, nsLocals, nsMembers } = fa;
  for (const name of nsLocals.keys()) nsMembers.set(name, { members: new Set(), star: false });
  visitNode(fa, fa.sf);
  // Files passed by explicit relative path literal to a NON-module-loading call have unseen consumers; keep ALL exports. `import(...)`/bare `require(...)` excluded (`handleCallExpression` tracks them). See `path-literals.ts`.
  for (const target of collectNonModuleLoadingPathTargets(state.ctx)) consume(state, target, STAR);
}

export function processNamespaceUsage(fa: FileAnalysis): void {
  const { state, nsLocals, nsMembers } = fa;
  for (const [local, info] of nsLocals) {
    const usage = nsMembers.get(local)!;
    if (!info.internal) continue;
    if (!info.target) { for (const m of usage.members) state.fuzzy.add(m); continue; }
    if (usage.star || usage.members.has(STAR)) consume(state, info.target, STAR);
    else for (const m of usage.members) consume(state, info.target, m);
  }
}

function handleNamedExport(fa: FileAnalysis, stmt: ts.ExportDeclaration, record: (nameNode: ts.Node, exported: string, local: string, isTypeOnly: boolean, isListed: boolean, isDefault?: boolean) => void): void {
  const { bindings, nsLocals, topLevelKinds, reexp } = fa;
  for (const el of (stmt.exportClause as ts.NamedExports).elements) {
    const local = (el.propertyName ?? el.name).text;
    const binding = bindings.get(local);
    if (binding) {
      if (binding.target) reexp.named.push({ exported: el.name.text, target: binding.target, orig: binding.imported });
      continue;
    }
    if (nsLocals.has(local)) continue;
    const isType = el.isTypeOnly || stmt.isTypeOnly || topLevelKinds.get(local) === true;
    if (!topLevelKinds.has(local)) continue;
    record(el.name, el.name.text, local, isType, true, el.name.text === 'default');
  }
}

function handleModifiersExport(fa: FileAnalysis, stmt: ts.Statement, record: (nameNode: ts.Node, exported: string, local: string, isTypeOnly: boolean, isListed: boolean, isDefault?: boolean) => void): void {
  const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
  const isExported = mods?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (!isExported) return;
  const isDefault = mods?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  const isDeclare = mods?.some((mod) => mod.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
  if (isDefault) {
    const isType = ts.isInterfaceDeclaration(stmt);
    record(stmt, 'default', 'default', isType, false, true);
    return;
  }
  if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
    record(stmt.name, stmt.name.text, stmt.name.text, true, false);
  } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
    record(stmt.name, stmt.name.text, stmt.name.text, isDeclare, false);
  } else if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) record(decl.name, decl.name.text, decl.name.text, isDeclare, false);
    }
  }
}

function handleExportStatement(fa: FileAnalysis, stmt: ts.Statement, record: (nameNode: ts.Node, exported: string, local: string, isTypeOnly: boolean, isListed: boolean, isDefault?: boolean) => void): void {
  if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    handleNamedExport(fa, stmt as ts.ExportDeclaration, record);
    return;
  }
  if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
    record(stmt, 'default', 'default', false, false, true);
    return;
  }
  handleModifiersExport(fa, stmt, record);
}

export function recordExports(fa: FileAnalysis): void {
  const { state, file, sf } = fa;
  const isAppRouterFile = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation)\.[cm]?[jt]sx?$/.test(file.relPath);
  const seen = new Set<string>();
  const record = (nameNode: ts.Node, exported: string, local: string, isTypeOnly: boolean, isListed: boolean, isDefault = false): void => {
    if (isAppRouterFile && FRAMEWORK_EXPORTS.has(exported)) return;
    if (isTypeOnly && /Props$/.test(exported)) return;
    const key = `${exported}::${isTypeOnly ? 'T' : 'V'}`;
    if (seen.has(key)) return;
    seen.add(key);
    const pos = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf));
    state.decls.push({ name: exported, isTypeOnly, file: file.relPath, line: pos.line + 1, column: pos.character + 1, localName: local, isListed, isDefault });
  };
  for (const stmt of sf.statements) handleExportStatement(fa, stmt, record);
}


function useSpec(state: AnalysisState, file: FileEntry, resolve: (spec: string, f: FileEntry) => { internal: boolean; target: string | null }, spec: string, names: string[] | typeof STAR): void {
  const res = resolve(spec, file);
  if (!res.internal) return;
  if (!res.target) {
    if (names !== STAR && !ASSET_SPEC_RE.test(spec)) for (const n of names) if (n !== 'default') state.fuzzy.add(n);
    return;
  }
  if (names === STAR) consume(state, res.target, STAR);
  else for (const n of names) consume(state, res.target, n);
}

export function consume(state: AnalysisState, file: string, name: string): void {
  let set = state.consumed.get(file);
  if (!set) { set = new Set(); state.consumed.set(file, set); }
  if (set.has(name)) return;
  set.add(name);
  state.queue.push([file, name]);
}
