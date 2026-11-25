import path from 'node:path';
import ts from 'typescript';
import { STAR, addUsed, declarationLocalName, posixRel, resolveAliased } from './shared.js';

type Enqueue = (file: string, name: string) => void;

function markSymbolUsedQueued(symbol: ts.Symbol, checker: ts.TypeChecker, rootDir: string, enqueue: Enqueue, nameHint?: string): void {
  const resolved = resolveAliased(symbol, checker);
  const decls = resolved.getDeclarations() ?? symbol.getDeclarations() ?? [];
  for (const decl of decls) {
    const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
    if (!rel) continue;
    const declName = declarationLocalName(decl) ?? resolved.getName();
    const name = nameHint ?? symbol.getName();
    enqueue(rel, name);
    if (declName && declName !== name) enqueue(rel, declName);
    if (resolved.getName() && resolved.getName() !== name) enqueue(rel, resolved.getName());
  }
}

function markModuleExport(specNode: ts.Expression, name: string, checker: ts.TypeChecker, rootDir: string, enqueue: Enqueue): void {
  const modSym = checker.getSymbolAtLocation(specNode);
  if (!modSym) return;
  try {
    const exports = checker.getExportsOfModule(modSym);
    if (name === STAR) {
      for (const exp of exports) markSymbolUsedQueued(exp, checker, rootDir, enqueue, exp.getName());
      for (const decl of modSym.getDeclarations() ?? []) {
        const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
        if (rel) enqueue(rel, STAR);
      }
      return;
    }
    const exp = exports.find((e) => e.getName() === name);
    if (exp) { markSymbolUsedQueued(exp, checker, rootDir, enqueue, name); return; }
  } catch { /* ignore */ }
  for (const decl of modSym.getDeclarations() ?? []) {
    const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
    if (rel) enqueue(rel, name);
  }
}

function addNsDestructureMembers(pattern: ts.ObjectBindingPattern, members: Set<string>): void {
  for (const e of pattern.elements) {
    members.add(e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : STAR);
  }
}

function nsMemberAccess(node: ts.Identifier): string | typeof STAR | null {
  const parent = node.parent;
  if (ts.isNamespaceImport(parent)) return null;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return null;
  if (ts.isQualifiedName(parent) && parent.left === node) return parent.right.text;
  if (ts.isElementAccessExpression(parent) && parent.expression === node && parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)) {
    return parent.argumentExpression.text;
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)
    && !parent.name.elements.some((e) => e.dotDotDotToken)) return STAR; // handled by caller
  return STAR;
}

function collectNamespaceUsage(sf: ts.SourceFile, localName: string): Set<string> | typeof STAR {
  const members = new Set<string>();
  let star = false;
  const visit = (node: ts.Node): void => {
    if (!ts.isIdentifier(node) || node.text !== localName) { ts.forEachChild(node, visit); return; }
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)
      && !parent.name.elements.some((e) => e.dotDotDotToken)) {
      addNsDestructureMembers(parent.name, members);
    } else {
      const access = nsMemberAccess(node);
      if (access === STAR) star = true;
      else if (access !== null) members.add(access);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return star || members.has(STAR) ? STAR : members;
}

interface ReexportEdge { fromFile: string; exported: string; targetSpec: ts.Expression; targetName: string | typeof STAR }
interface StarReexport { fromFile: string; targetSpec: ts.Expression }
interface UsageState {
  checker: ts.TypeChecker;
  rootDir: string;
  fileSet: Set<string>;
  enqueue: Enqueue;
  reexports: Map<string, ReexportEdge[]>;
  starReexports: Map<string, StarReexport[]>;
}

function markImportBinding(specNode: ts.Expression, name: string, symNode: ts.Node, state: UsageState): void {
  const sym = state.checker.getSymbolAtLocation(symNode);
  if (sym) markSymbolUsedQueued(sym, state.checker, state.rootDir, state.enqueue, name);
  else markModuleExport(specNode, name, state.checker, state.rootDir, state.enqueue);
}

function handleImportDecl(node: ts.ImportDeclaration, sf: ts.SourceFile, state: UsageState): void {
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name) markImportBinding(node.moduleSpecifier, 'default', clause.name, state);
  const nb = clause.namedBindings;
  if (!nb) return;
  if (ts.isNamespaceImport(nb)) {
    const nsUsed = collectNamespaceUsage(sf, nb.name.text);
    if (nsUsed === STAR) markModuleExport(node.moduleSpecifier, STAR, state.checker, state.rootDir, state.enqueue);
    else for (const name of nsUsed) markModuleExport(node.moduleSpecifier, name, state.checker, state.rootDir, state.enqueue);
    return;
  }
  for (const el of nb.elements) markImportBinding(node.moduleSpecifier, (el.propertyName ?? el.name).text, el.name, state);
}

function handleExportDecl(node: ts.ExportDeclaration, rel: string, state: UsageState): void {
  if (!node.moduleSpecifier) return;
  if (!node.exportClause) {
    const arr = state.starReexports.get(rel) ?? [];
    arr.push({ fromFile: rel, targetSpec: node.moduleSpecifier });
    state.starReexports.set(rel, arr);
    return;
  }
  if (ts.isNamespaceExport(node.exportClause)) {
    markModuleExport(node.moduleSpecifier, STAR, state.checker, state.rootDir, state.enqueue);
    return;
  }
  for (const el of node.exportClause.elements) {
    const arr = state.reexports.get(rel) ?? [];
    arr.push({ fromFile: rel, exported: el.name.text, targetSpec: node.moduleSpecifier, targetName: (el.propertyName ?? el.name).text });
    state.reexports.set(rel, arr);
  }
}

function handleDynamicImportCall(node: ts.CallExpression, arg0: ts.Expression, state: UsageState): void {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name) && !parent.name.elements.some((e) => e.dotDotDotToken)) {
    for (const e of parent.name.elements) {
      const name = e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : null;
      if (name) markModuleExport(arg0, name, state.checker, state.rootDir, state.enqueue);
    }
    return;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    markModuleExport(arg0, parent.name.text, state.checker, state.rootDir, state.enqueue);
    return;
  }
  markModuleExport(arg0, STAR, state.checker, state.rootDir, state.enqueue);
}

function handleCall(node: ts.CallExpression, state: UsageState): void {
  const arg0 = node.arguments[0];
  if (!arg0 || !ts.isStringLiteralLike(arg0)) return;
  const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  if (!isImportCall && !isRequire) return;
  handleDynamicImportCall(node, arg0, state);
}

function visitNode(node: ts.Node, sf: ts.SourceFile, rel: string, state: UsageState): void {
  if (ts.isImportDeclaration(node)) handleImportDecl(node, sf, state);
  else if (ts.isExportDeclaration(node)) handleExportDecl(node, rel, state);
  else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && ts.isStringLiteral(node.moduleReference.expression)) {
    markModuleExport(node.moduleReference.expression, STAR, state.checker, state.rootDir, state.enqueue);
  } else if (ts.isCallExpression(node)) handleCall(node, state);
  ts.forEachChild(node, (child) => visitNode(child, sf, rel, state));
}

function propagate(queue: Array<{ file: string; name: string }>, state: UsageState): void {
  while (queue.length) {
    const { file, name } = queue.pop()!;
    const named = state.reexports.get(file);
    if (named) {
      for (const r of named) {
        if (name === STAR || r.exported === name) markModuleExport(r.targetSpec, r.targetName, state.checker, state.rootDir, state.enqueue);
      }
    }
    const stars = state.starReexports.get(file);
    if (stars) {
      for (const r of stars) {
        if (name === STAR) markModuleExport(r.targetSpec, STAR, state.checker, state.rootDir, state.enqueue);
        else if (name !== 'default') markModuleExport(r.targetSpec, name, state.checker, state.rootDir, state.enqueue);
      }
    }
  }
}

export function collectUsage(
  program: ts.Program,
  checker: ts.TypeChecker,
  rootDir: string,
  fileSet: Set<string>,
  entryPoints: Set<string> = new Set(),
): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const queue: Array<{ file: string; name: string }> = [];
  const enqueue: Enqueue = (file, name) => {
    let set = used.get(file);
    if (!set) { set = new Set(); used.set(file, set); }
    if (set.has(name)) return;
    set.add(name);
    queue.push({ file, name });
  };
  const state: UsageState = { checker, rootDir, fileSet, enqueue, reexports: new Map(), starReexports: new Map() };

  for (const sf of program.getSourceFiles()) {
    const rel = posixRel(rootDir, path.resolve(sf.fileName));
    if (!rel || !fileSet.has(rel) || sf.isDeclarationFile) continue;
    ts.forEachChild(sf, (node) => visitNode(node, sf, rel, state));
  }
  for (const ep of entryPoints) enqueue(ep, STAR);
  propagate(queue, state);
  return used;
}
