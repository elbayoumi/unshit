import path from 'node:path';
import ts from 'typescript';
import type { Finding } from '../../contracts.js';

export const TS_LIKE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
export const STAR = '*';

export interface ExportInfo {
  name: string;
  isTypeOnly: boolean;
  file: string;
  line: number;
  column: number;
  localName: string;
  isListed: boolean;
  isDefault: boolean;
}

export interface DeepResult {
  findings: Finding[];
  analyzedFiles: Set<string>;
}

export function posixRel(rootDir: string, abs: string): string | null {
  const rel = path.relative(rootDir, abs).replaceAll('\\', '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

export function addUsed(used: Map<string, Set<string>>, file: string, name: string): void {
  let set = used.get(file);
  if (!set) { set = new Set(); used.set(file, set); }
  set.add(name);
}

export function resolveAliased(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try { return checker.getAliasedSymbol(symbol); } catch { return symbol; }
  }
  return symbol;
}

export function declarationLocalName(decl: ts.Declaration): string | null {
  if (ts.isExportAssignment(decl)) return 'default';
  if (ts.isExportSpecifier(decl)) return (decl.propertyName ?? decl.name).text;
  const name = (decl as { name?: ts.Node }).name;
  if (name && ts.isIdentifier(name)) return name.text;
  if (name && ts.isStringLiteral(name)) return name.text;
  return null;
}
