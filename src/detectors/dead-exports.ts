import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { Detector, DetectorContext, Finding } from '../contracts.js';

interface ExportDecl {
  name: string;
  isTypeOnly: boolean;
  file: string;
  line: number;
  column: number;
}

function isEntryFile(relPath: string): boolean {
  return /(^|\/)(index|main|cli|app|server|vite\.config|vitest\.config)\.[cm]?[jt]sx?$/i.test(relPath)
    || /\.(test|spec|d)\./.test(relPath);
}

const FRAMEWORK_EXPORTS = new Set([
  'metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'viewport', 'generateViewport', 'dynamicParams', 'fetchCache', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'config', 'loader', 'action', 'meta', 'links',
]);

function isPluginOrIntegrationFile(relPath: string): boolean {
  return /(^|\/)integrations?\//.test(relPath);
}

/**
 * Source files that package.json publishes (exports/main/module/types/bin).
 * Build outputs (dist/…) are mapped back to their source counterpart.
 */
function publicEntryFiles(rootDir: string, files: Set<string>): Set<string> {
  const entries = new Set<string>();
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  } catch {
    return entries;
  }
  const targets: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') targets.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  const record = pkg as Record<string, unknown>;
  for (const key of ['exports', 'main', 'module', 'types', 'typings']) walk(record[key]);

  for (const target of targets) {
    const clean = target.replace(/^\.\//, '').replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
    const variants = [clean, clean.replace(/^(dist|build|lib|out)\//, '')];
    for (const variant of variants) {
      for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
        const candidate = variant + ext;
        if (files.has(candidate)) entries.add(candidate);
      }
    }
  }
  return entries;
}

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g;

function collectExportedDecls(ctx: DetectorContext): {
  decls: ExportDecl[];
  identifierCountsByFile: Map<string, Map<string, number>>;
} {
  const decls: ExportDecl[] = [];
  const publicEntries = publicEntryFiles(ctx.rootDir, new Set(ctx.files.map((f) => f.relPath)));
  const seenKey = new Set<string>();
  const identifierCountsByFile = new Map<string, Map<string, number>>();

  for (const file of ctx.files) {
    const counts = new Map<string, number>();
    IDENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENT_RE.exec(file.content)) !== null) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    }
    identifierCountsByFile.set(file.relPath, counts);

    if (!file.sourceFile || isEntryFile(file.relPath) || publicEntries.has(file.relPath) || isPluginOrIntegrationFile(file.relPath)) continue;
    const sf = file.sourceFile;

    const isAppRouterFile = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation)\.[jt]sx?$/.test(file.relPath);
    const record = (nameNode: ts.Node, name: string, isTypeOnly: boolean): void => {
      if (isAppRouterFile && FRAMEWORK_EXPORTS.has(name)) return;
      if (isTypeOnly && /Props$/.test(name)) return;
      const key = `${file.relPath}::${name}::${isTypeOnly ? 'T' : 'V'}`;
      if (seenKey.has(key)) return;
      seenKey.add(key);
      const pos = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf));
      decls.push({ name, isTypeOnly, file: file.relPath, line: pos.line + 1, column: pos.character + 1 });
    };

    for (const stmt of sf.statements) {
      const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
      const isExported = mods?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isDefault = mods?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      const isDeclare = mods?.some((mod) => mod.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
      if (!isExported || isDefault) continue;

      if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
        record(stmt.name, stmt.name.text, true);
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
        record(stmt.name, stmt.name.text, isDeclare);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            record(decl.name, decl.name.text, isDeclare);
          }
        }
      }
    }
  }

  return { decls, identifierCountsByFile };
}

function findUnused(ctx: DetectorContext, wantTypeOnly: boolean, ruleId: string): Finding[] {
  const { decls, identifierCountsByFile } = collectExportedDecls(ctx);
  const findings: Finding[] = [];

  for (const exp of decls) {
    if (exp.isTypeOnly !== wantTypeOnly) continue;

    let referencedElsewhere = false;
    for (const [otherFile, counts] of identifierCountsByFile) {
      if (otherFile === exp.file) continue;
      if ((counts.get(exp.name) ?? 0) > 0) {
        referencedElsewhere = true;
        break;
      }
    }
    if (referencedElsewhere) continue;

    const ownCount = identifierCountsByFile.get(exp.file)?.get(exp.name) ?? 1;
    const isOverExported = ownCount >= 2;
    // A type used inside its own module is usually part of an exported signature; dropping `export` breaks consumers' typing.
    if (isOverExported && wantTypeOnly) continue;

    findings.push({
      ruleId,
      category: 'dead-code',
      tier: 'structural',
      severity: 'info',
      fixability: 'unsafe',
      confidence: isOverExported ? 0.65 : 0.85,
      file: exp.file,
      span: { line: exp.line, column: exp.column },
      message: isOverExported
        ? `Exported ${wantTypeOnly ? 'type' : 'symbol'} \`${exp.name}\` is used only locally; drop the \`export\` keyword.`
        : `Exported ${wantTypeOnly ? 'type' : 'symbol'} \`${exp.name}\` has zero references; safe to delete.`,
      evidence: `export ... ${exp.name}`,
    });
  }

  return findings;
}

/**
 * Flags runtime value exports never referenced outside their defining file.
 */
export const unusedExportDetector: Detector = {
  id: 'ts/unused-export',
  category: 'dead-code',
  tier: 'structural',
  severity: 'info',
  scope: 'project',
  description: 'Flags runtime value exports that are never referenced in any other file.',
  detect(ctx: DetectorContext): Finding[] {
    return findUnused(ctx, false, this.id);
  },
};

/**
 * Flags exported interfaces/type aliases never referenced outside their defining file.
 */
export const unusedTypeExportDetector: Detector = {
  id: 'ts/unused-type-export',
  category: 'dead-code',
  tier: 'structural',
  severity: 'info',
  scope: 'project',
  description: 'Flags type/interface exports that are never referenced in any other file.',
  detect(ctx: DetectorContext): Finding[] {
    return findUnused(ctx, true, this.id);
  },
};
