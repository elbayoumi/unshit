import path from 'node:path';
import ts from 'typescript';
import { declarationLocalName, posixRel, type ExportInfo } from './shared.js';

export const FRAMEWORK_EXPORTS = new Set([
  'metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'viewport', 'generateViewport', 'dynamicParams', 'fetchCache', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'config', 'loader', 'action', 'meta', 'links',
]);

function isTypeOnlySymbol(symbol: ts.Symbol): boolean {
  const flags = symbol.getFlags();
  const valueFlags = ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class
    | ts.SymbolFlags.Enum | ts.SymbolFlags.Variable | ts.SymbolFlags.Method
    | ts.SymbolFlags.Property | ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor;
  if ((flags & valueFlags) !== 0) return false;
  const typeFlags = ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeParameter | ts.SymbolFlags.TypeLiteral;
  if ((flags & typeFlags) !== 0) return true;
  const decls = symbol.getDeclarations() ?? [];
  return decls.length > 0 && decls.every((d) =>
    ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isTypeParameterDeclaration(d));
}

function isListedExport(decl: ts.Declaration): boolean {
  return ts.isExportSpecifier(decl);
}

function isDefaultExport(name: string, decl: ts.Declaration): boolean {
  if (name === 'default') return true;
  if (ts.isExportAssignment(decl)) return !decl.isExportEquals;
  const mods = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function getExportDeclLine(decl: ts.Declaration, sf: ts.SourceFile): { line: number; column: number } {
  let node: ts.Node = decl;
  if (ts.isExportSpecifier(decl)) node = decl.name;
  if (ts.isExportAssignment(decl)) node = decl;
  const name = (decl as { name?: ts.Node }).name;
  if (name) node = name;
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function isReexportSpecifier(decl: ts.Declaration): boolean {
  if (ts.isExportSpecifier(decl)) {
    const parentDecl = decl.parent?.parent;
    return !!(parentDecl && ts.isExportDeclaration(parentDecl) && parentDecl.moduleSpecifier);
  }
  if (ts.isNamespaceExport(decl)) {
    const parentDecl = decl.parent;
    return !!(parentDecl && ts.isExportDeclaration(parentDecl) && parentDecl.moduleSpecifier);
  }
  return false;
}

function resolveLocalDecl(exp: ts.Symbol, resolved: ts.Symbol, relPath: string, rootDir: string): ts.Declaration | null {
  const decls = (exp.getDeclarations() ?? resolved.getDeclarations() ?? []) as ts.Declaration[];
  const localDecl = decls.find((d) => posixRel(rootDir, path.resolve(d.getSourceFile().fileName)) === relPath) ?? decls[0];
  if (!localDecl) return null;
  const declFile = posixRel(rootDir, path.resolve(localDecl.getSourceFile().fileName));
  if (declFile !== relPath) return null;
  if (isReexportSpecifier(localDecl)) return null;
  return localDecl;
}

export function collectExportInfos(sourceFile: ts.SourceFile, checker: ts.TypeChecker, rootDir: string): ExportInfo[] {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];
  const relPath = posixRel(rootDir, path.resolve(sourceFile.fileName));
  if (!relPath) return [];
  let exports: ts.Symbol[];
  try { exports = checker.getExportsOfModule(moduleSymbol); } catch { return []; }

  const infos: ExportInfo[] = [];
  const seen = new Set<string>();
  for (const exp of exports) {
    const name = exp.getName();
    if (name === '__esModule') continue;
    const resolved = (exp.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exp) : exp;
    const localDecl = resolveLocalDecl(exp, resolved, relPath, rootDir);
    if (!localDecl) continue;
    const typeOnly = isTypeOnlySymbol(resolved) && isTypeOnlySymbol(exp);
    const key = `${name}::${typeOnly ? 'T' : 'V'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pos = getExportDeclLine(localDecl, localDecl.getSourceFile());
    infos.push({
      name,
      isTypeOnly: typeOnly,
      file: relPath,
      line: pos.line,
      column: pos.column,
      localName: declarationLocalName(localDecl) ?? name,
      isListed: isListedExport(localDecl),
      isDefault: isDefaultExport(name, localDecl),
    });
  }
  return infos;
}
