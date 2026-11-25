import path from 'node:path';
import ts from 'typescript';
import type { FileEntry, Finding, UnshitConfig } from '../../contracts.js';

const TS_LIKE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const STAR = '*';

interface ExportInfo {
  name: string;
  isTypeOnly: boolean;
  file: string;
  line: number;
  column: number;
  localName: string;
  isListed: boolean;
  isDefault: boolean;
  symbol: ts.Symbol;
}

interface DeepResult {
  findings: Finding[];
  analyzedFiles: Set<string>;
}

function posixRel(rootDir: string, abs: string): string | null {
  const rel = path.relative(rootDir, abs).replaceAll('\\', '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

function isTypeOnlySymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  const flags = symbol.getFlags();
  const valueFlags = ts.SymbolFlags.Value
    | ts.SymbolFlags.Function
    | ts.SymbolFlags.Class
    | ts.SymbolFlags.Enum
    | ts.SymbolFlags.Variable
    | ts.SymbolFlags.Method
    | ts.SymbolFlags.Property
    | ts.SymbolFlags.GetAccessor
    | ts.SymbolFlags.SetAccessor;
  if ((flags & valueFlags) !== 0) return false;
  const typeFlags = ts.SymbolFlags.Interface
    | ts.SymbolFlags.TypeAlias
    | ts.SymbolFlags.TypeParameter
    | ts.SymbolFlags.TypeLiteral;
  if ((flags & typeFlags) !== 0) return true;
  // Fallback: if it has no value declarations, treat as type.
  const decls = symbol.getDeclarations() ?? [];
  return decls.length > 0 && decls.every((d) =>
    ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isTypeParameterDeclaration(d),
  );
}

function declarationLocalName(decl: ts.Declaration): string | null {
  if (ts.isExportAssignment(decl)) return 'default';
  if (ts.isExportSpecifier(decl)) {
    return (decl.propertyName ?? decl.name).text;
  }
  const name = (decl as { name?: ts.Node }).name;
  if (name && ts.isIdentifier(name)) return name.text;
  if (name && ts.isStringLiteral(name)) return name.text;
  return null;
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

function collectExportInfos(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  rootDir: string,
): ExportInfo[] {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];
  const relPath = posixRel(rootDir, path.resolve(sourceFile.fileName));
  if (!relPath) return [];

  let exports: ts.Symbol[];
  try {
    exports = checker.getExportsOfModule(moduleSymbol);
  } catch {
    return [];
  }

  const infos: ExportInfo[] = [];
  const seen = new Set<string>();
  for (const exp of exports) {
    const name = exp.getName();
    if (name === '__esModule') continue;
    const resolved = (exp.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exp) : exp;
    const decls = (exp.getDeclarations() ?? resolved.getDeclarations() ?? []) as ts.Declaration[];
    // Prefer declaration in this file
    const localDecl = decls.find((d) => posixRel(rootDir, path.resolve(d.getSourceFile().fileName)) === relPath)
      ?? decls[0];
    if (!localDecl) continue;
    const declFile = posixRel(rootDir, path.resolve(localDecl.getSourceFile().fileName));
    if (declFile !== relPath) continue; // re-exported from elsewhere, belongs to that file
    // Skip re-export specifiers (export { x } from './y') - they are edges, not local declarations to report here.
    if (ts.isExportSpecifier(localDecl)) {
      const parentDecl = localDecl.parent?.parent;
      if (parentDecl && ts.isExportDeclaration(parentDecl) && parentDecl.moduleSpecifier) continue;
    }
    if (ts.isNamespaceExport(localDecl)) {
      const parentDecl = localDecl.parent;
      if (parentDecl && ts.isExportDeclaration(parentDecl) && parentDecl.moduleSpecifier) continue;
    }

    const isDefault = isDefaultExport(name, localDecl);
    const isListed = isListedExport(localDecl);
    const localName = declarationLocalName(localDecl) ?? name;
    const typeOnly = isTypeOnlySymbol(resolved, checker) && isTypeOnlySymbol(exp, checker);
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
      localName,
      isListed,
      isDefault,
      symbol: resolved,
    });
  }
  return infos;
}

function symbolId(symbol: ts.Symbol): number {
  return (symbol as ts.Symbol & { id?: number }).id ?? -1;
}

function isInScope(rel: string, fileSet: Set<string>): boolean {
  return fileSet.has(rel);
}

function addUsed(used: Map<string, Set<string>>, file: string, name: string): void {
  let set = used.get(file);
  if (!set) { set = new Set(); used.set(file, set); }
  set.add(name);
}

function resolveAliased(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try { return checker.getAliasedSymbol(symbol); } catch { return symbol; }
  }
  return symbol;
}

function markSymbolUsed(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  rootDir: string,
  used: Map<string, Set<string>>,
  nameHint?: string,
): void {
  const resolved = resolveAliased(symbol, checker);
  const decls = resolved.getDeclarations() ?? symbol.getDeclarations() ?? [];
  for (const decl of decls) {
    const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
    if (!rel) continue;
    const declName = declarationLocalName(decl) ?? resolved.getName();
    const name = nameHint ?? symbol.getName();
    // Mark the actual export name in that file. If we can't be sure, mark both.
    addUsed(used, rel, name);
    if (declName && declName !== name) addUsed(used, rel, declName);
    if (resolved.getName() && resolved.getName() !== name) addUsed(used, rel, resolved.getName());
  }
}

function markModuleAllUsed(
  moduleSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  rootDir: string,
  used: Map<string, Set<string>>,
): void {
  const decls = moduleSymbol.getDeclarations() ?? [];
  for (const decl of decls) {
    const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
    if (rel) addUsed(used, rel, STAR);
  }
  // Also mark exports of the module as used
  try {
    for (const exp of checker.getExportsOfModule(moduleSymbol)) {
      markSymbolUsed(exp, checker, rootDir, used, exp.getName());
    }
  } catch { /* ignore */ }
}

function getModuleSymbolFromSpecifier(
  specNode: ts.Expression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const sym = checker.getSymbolAtLocation(specNode);
  if (sym) return sym;
  // try resolving as module
  if (ts.isStringLiteralLike(specNode)) {
    // fallback: no direct symbol
  }
  return undefined;
}

function markSymbolUsedQueued(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  rootDir: string,
  enqueue: (file: string, name: string) => void,
  nameHint?: string,
): void {
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

function collectUsage(
  program: ts.Program,
  checker: ts.TypeChecker,
  rootDir: string,
  fileSet: Set<string>,
  entryPoints: Set<string> = new Set(),
): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const reexports = new Map<string, Array<{ fromFile: string; exported: string; targetSpec: ts.Expression; targetName: string | typeof STAR }>>();
  const moduleStarReexports = new Map<string, Array<{ fromFile: string; targetSpec: ts.Expression }>>();
  const queue: Array<{ file: string; name: string }> = [];

  const enqueue = (file: string, name: string): void => {
    let set = used.get(file);
    if (!set) { set = new Set(); used.set(file, set); }
    if (set.has(name)) return;
    set.add(name);
    queue.push({ file, name });
  };

  const markModuleExport = (specNode: ts.Expression, name: string): void => {
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
    // Fallback: mark by name on module decl files
    const decls = modSym.getDeclarations() ?? [];
    for (const decl of decls) {
      const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
      if (rel) enqueue(rel, name);
    }
  };

  const markModuleAll = (specNode: ts.Expression): void => {
    markModuleExport(specNode, STAR);
  };

  for (const sf of program.getSourceFiles()) {
    const rel = posixRel(rootDir, path.resolve(sf.fileName));
    if (!rel || !isInScope(rel, fileSet)) continue;
    if (sf.isDeclarationFile) continue;

    ts.forEachChild(sf, function visit(node) {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause;
        if (clause.name) {
          const sym = checker.getSymbolAtLocation(clause.name);
          if (sym) markSymbolUsedQueued(sym, checker, rootDir, enqueue, 'default');
          else markModuleExport(node.moduleSpecifier, 'default');
        }
        const nb = clause.namedBindings;
        if (nb) {
          if (ts.isNamespaceImport(nb)) {
            const nsUsed = collectNamespaceUsage(sf, nb.name.text, checker, rootDir);
            if (nsUsed === STAR) markModuleAll(node.moduleSpecifier);
            else for (const name of nsUsed) markModuleExport(node.moduleSpecifier, name);
          } else {
            for (const el of nb.elements) {
              const sym = checker.getSymbolAtLocation(el.name);
              const importedName = (el.propertyName ?? el.name).text;
              if (sym) markSymbolUsedQueued(sym, checker, rootDir, enqueue, importedName);
              else markModuleExport(node.moduleSpecifier, importedName);
            }
          }
        }
      }
      if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          if (!node.exportClause) {
            const arr = moduleStarReexports.get(rel) ?? [];
            arr.push({ fromFile: rel, targetSpec: node.moduleSpecifier });
            moduleStarReexports.set(rel, arr);
          } else if (ts.isNamespaceExport(node.exportClause)) {
            markModuleAll(node.moduleSpecifier);
          } else {
            for (const el of node.exportClause.elements) {
              const importedName = (el.propertyName ?? el.name).text;
              const exportedName = el.name.text;
              const arr = reexports.get(rel) ?? [];
              arr.push({ fromFile: rel, exported: exportedName, targetSpec: node.moduleSpecifier, targetName: importedName });
              reexports.set(rel, arr);
            }
          }
        }
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        && ts.isStringLiteral(node.moduleReference.expression)) {
        markModuleAll(node.moduleReference.expression);
      }
      if (ts.isCallExpression(node)) {
        const arg0 = node.arguments[0];
        const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        if ((isImportCall || isRequire) && arg0 && ts.isStringLiteralLike(arg0)) {
          const parent = node.parent;
          if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)
            && !parent.name.elements.some((e) => e.dotDotDotToken)) {
            for (const e of parent.name.elements) {
              const name = e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text
                : ts.isIdentifier(e.name) ? e.name.text : null;
              if (name) markModuleExport(arg0, name);
            }
          } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            markModuleExport(arg0, parent.name.text);
          } else {
            markModuleAll(arg0);
          }
        }
      }
      ts.forEachChild(node, visit);
    });
  }

  for (const ep of entryPoints) enqueue(ep, STAR);

  // Propagate usage through re-export chains
  while (queue.length) {
    const { file, name } = queue.pop()!;
    const named = reexports.get(file);
    if (named) {
      for (const r of named) {
        if (name === STAR || r.exported === name) markModuleExport(r.targetSpec, r.targetName);
      }
    }
    const stars = moduleStarReexports.get(file);
    if (stars) {
      for (const r of stars) {
        if (name === STAR) markModuleAll(r.targetSpec);
        else if (name !== 'default') markModuleExport(r.targetSpec, name);
      }
    }
  }

  return used;
}

function collectNamespaceUsage(
  sf: ts.SourceFile,
  localName: string,
  checker: ts.TypeChecker,
  rootDir: string,
): Set<string> | typeof STAR {
  const members = new Set<string>();
  let star = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === localName) {
      const parent = node.parent;
      if (ts.isNamespaceImport(parent)) { /* decl */ }
      else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        members.add(parent.name.text);
      } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        // unrelated
      } else if (ts.isQualifiedName(parent) && parent.left === node) {
        members.add(parent.right.text);
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node
        && parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)) {
        members.add(parent.argumentExpression.text);
      } else if (ts.isVariableDeclaration(parent) && parent.initializer === node
        && ts.isObjectBindingPattern(parent.name)
        && !parent.name.elements.some((e) => e.dotDotDotToken)) {
        for (const e of parent.name.elements) {
          members.add(e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text
            : ts.isIdentifier(e.name) ? e.name.text : STAR);
        }
      } else if (ts.isExportSpecifier(parent)) {
        star = true;
      } else {
        // conservative: namespace escapes
        star = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (star || members.has(STAR)) return STAR;
  return members;
}

function markModuleSpecifierAll(
  specNode: ts.Expression,
  checker: ts.TypeChecker,
  rootDir: string,
  used: Map<string, Set<string>>,
): void {
  const sym = checker.getSymbolAtLocation(specNode);
  if (sym) {
    markModuleAllUsed(sym, checker, rootDir, used);
    return;
  }
  // fallback: try to resolve by filename
  if (ts.isStringLiteralLike(specNode)) {
    // Can't resolve - be conservative, nothing to mark specifically
  }
}

function markModuleExportByName(
  specNode: ts.Expression,
  name: string,
  checker: ts.TypeChecker,
  rootDir: string,
  used: Map<string, Set<string>>,
): void {
  const modSym = checker.getSymbolAtLocation(specNode);
  if (!modSym) return;
  try {
    const exports = checker.getExportsOfModule(modSym);
    const exp = exports.find((e) => e.getName() === name);
    if (exp) {
      markSymbolUsed(exp, checker, rootDir, used, name);
      return;
    }
  } catch { /* ignore */ }
  // Fallback: mark module as star-used? No, be precise; but better safe than noisy.
  // If we can't find the export, mark STAR to avoid false positive.
  const decls = modSym.getDeclarations() ?? [];
  for (const decl of decls) {
    const rel = posixRel(rootDir, path.resolve(decl.getSourceFile().fileName));
    if (rel) addUsed(used, rel, name);
  }
}

const IDENT_RE_CACHE = new Map<string, RegExp>();
function identifierCount(content: string, name: string): number {
  let re = IDENT_RE_CACHE.get(name);
  if (!re) {
    const escaped = name.replace(/[$]/g, '\\$');
    re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
    IDENT_RE_CACHE.set(name, re);
  }
  re.lastIndex = 0;
  return (content.match(re) ?? []).length;
}

function unusedExportConfidence(exp: ExportInfo, isOverExported: boolean): number {
  if (isOverExported) return 0.7;
  if (exp.isDefault) return 0.75;
  return 0.9;
}

function unusedExportMessage(exp: ExportInfo, kind: string, isOverExported: boolean): string {
  if (exp.isDefault) return 'Default export `default` is never imported by any other file.';
  if (isOverExported) return `Exported ${kind} \`${exp.name}\` is used only locally; drop the \`export\` keyword.`;
  return `Exported ${kind} \`${exp.name}\` has zero references; safe to delete.`;
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
};

function loadProgram(rootDir: string, scannedFiles: FileEntry[]): ts.Program | null {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
    ?? ts.findConfigFile(rootDir, ts.sys.fileExists, 'jsconfig.json');

  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const host: ts.ParseConfigHost = {
        ...ts.sys,
        readDirectory: ts.sys.readDirectory,
      };
      const parsed = ts.parseJsonConfigFileContent(
        read.config ?? {},
        host,
        path.dirname(configPath),
        undefined,
        configPath,
      );
      const rootNames = parsed.fileNames.length > 0
        ? parsed.fileNames
        : scannedFiles.filter((f) => TS_LIKE.has(f.ext)).map((f) => f.absPath);
      const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, allowJs: true };
      try {
        return ts.createProgram({ rootNames, options, projectReferences: parsed.projectReferences });
      } catch {
        // fall through to defaults
      }
    }
  }

  // Sensible defaults fallback
  const rootNames = scannedFiles.filter((f) => TS_LIKE.has(f.ext)).map((f) => f.absPath);
  if (rootNames.length === 0) return null;
  try {
    return ts.createProgram({ rootNames, options: DEFAULT_COMPILER_OPTIONS });
  } catch {
    return null;
  }
}

function isFrameworkEntryPath(relPath: string): boolean {
  return /(^|\/)(pages|app|layouts|middleware|plugins|server)\//.test(relPath)
    || /(^|\/)src\/routes\/(?:[^/]+\/)*\+[^/]*$/.test(relPath)
    || /(^|\/)middleware\.(ts|js|tsx|jsx|mts|cts)$/i.test(relPath);
}

function isConventionalDefaultFile(relPath: string): boolean {
  return /(^|\/)(app|pages|routes|api|stories|\.storybook|e2e|migrations|scripts|plugins|middleware|layouts|views)\//.test(relPath)
    || /\.(stories|story|config|setup|workspace)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation|\+page|\+layout)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)[\w.-]*\.(config|rc)\.[cm]?[jt]s$/.test(relPath);
}

export async function detectDeepUnusedExports(
  rootDir: string,
  config: UnshitConfig,
  files: FileEntry[],
  manifests?: string[],
): Promise<DeepResult> {
  const analyzedFiles = new Set<string>();
  const fileSet = new Set(files.map((f) => f.relPath));
  const tsFiles = files.filter((f) => TS_LIKE.has(f.ext));
  for (const f of tsFiles) analyzedFiles.add(f.relPath);

  const program = loadProgram(rootDir, files);
  if (!program) {
    throw new Error('ts.createProgram failed');
  }

  const checker = program.getTypeChecker();

  // Entry points - reuse same logic as syntactic detector
  let entryPoints = new Set<string>();
  try {
    const { entryPointFileSet } = await import('../../detectors/dead-exports.js');
    entryPoints = entryPointFileSet(
      { rootDir, config, files, manifests },
      files,
    );
  } catch {
    // fall back: no entry point suppression
  }

  const used = collectUsage(program, checker, rootDir, fileSet, entryPoints);

  // Collect exports and report
  const contentByFile = new Map(files.map((f) => [f.relPath, f.content]));
  const findings: Finding[] = [];
  const FRAMEWORK_EXPORTS = new Set([
    'metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
    'viewport', 'generateViewport', 'dynamicParams', 'fetchCache', 'preferredRegion', 'maxDuration',
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'config', 'loader', 'action', 'meta', 'links',
  ]);

  for (const sf of program.getSourceFiles()) {
    const rel = posixRel(rootDir, path.resolve(sf.fileName));
    if (!rel || !fileSet.has(rel)) continue;
    if (sf.isDeclarationFile) continue;
    if (!TS_LIKE.has(path.extname(rel).toLowerCase())) continue;

    const isAppRouterFile = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation)\.[jt]sx?$/.test(rel);
    const infos = collectExportInfos(sf, checker, rootDir);
    for (const exp of infos) {
      if (isAppRouterFile && FRAMEWORK_EXPORTS.has(exp.name)) continue;
      if (exp.isTypeOnly && /Props$/.test(exp.name)) continue;
      const usedSet = used.get(exp.file);
      if (usedSet && (usedSet.has(STAR) || usedSet.has(exp.name))) continue;
      if (exp.isDefault && isConventionalDefaultFile(rel)) continue;

      const content = contentByFile.get(exp.file) ?? sf.getFullText();
      const ownCount = exp.isDefault ? 0 : identifierCount(content, exp.localName);
      const isOverExported = ownCount >= (exp.isListed ? 3 : 2);
      const kind = exp.isTypeOnly ? 'type' : 'symbol';
      const ruleId = exp.isTypeOnly ? 'ts/unused-type-export' : 'ts/unused-export';
      findings.push({
        ruleId,
        category: 'dead-code',
        tier: 'structural',
        severity: 'info',
        fixability: 'unsafe',
        confidence: unusedExportConfidence(exp, isOverExported),
        file: exp.file,
        span: { line: exp.line, column: exp.column },
        message: unusedExportMessage(exp, kind, isOverExported),
        evidence: exp.isDefault ? 'export default ...' : `export ... ${exp.name}`,
      });
    }
  }

  return { findings, analyzedFiles };
}
