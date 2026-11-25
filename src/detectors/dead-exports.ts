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

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g;

function collectExportedDecls(ctx: DetectorContext): {
  decls: ExportDecl[];
  identifierCountsByFile: Map<string, Map<string, number>>;
} {
  const decls: ExportDecl[] = [];
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

    if (!file.sourceFile || isEntryFile(file.relPath)) continue;
    const sf = file.sourceFile;

    const record = (nameNode: ts.Node, name: string, isTypeOnly: boolean): void => {
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
