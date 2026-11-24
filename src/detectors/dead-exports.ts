import ts from 'typescript';
import type { Detector, DetectorContext, Finding } from '../contracts.js';

interface ExportDecl {
  name: string;
  file: string;
  line: number;
  column: number;
}

function isEntryFile(relPath: string): boolean {
  return /(^|\/)(index|main|cli|app|server|vite\.config|vitest\.config)\.[cm]?[jt]sx?$/i.test(relPath)
    || /\.(test|spec|d)\./.test(relPath);
}

/**
 * knip-inspired cross-file exported symbol reachability detector.
 */
export const unusedExportDetector: Detector = {
  id: 'ts/unused-export',
  category: 'dead-code',
  tier: 'structural',
  severity: 'info',
  description: 'Flags named exports that are never referenced in any other file.',
  detect(ctx: DetectorContext): Finding[] {
    const exportsList: ExportDecl[] = [];
    const allContents = new Map<string, string>();

    for (const file of ctx.files) {
      if (!file.sourceFile) continue;
      allContents.set(file.relPath, file.content);
      if (isEntryFile(file.relPath)) continue;

      const sf = file.sourceFile;
      const record = (nameNode: ts.Node, name: string): void => {
        const pos = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf));
        exportsList.push({ name, file: file.relPath, line: pos.line + 1, column: pos.character + 1 });
      };

      for (const stmt of sf.statements) {
        const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
        const isExported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
        const isDefault = mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
        if (!isExported || isDefault) continue;

        if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
          record(stmt.name, stmt.name.text);
        } else if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              record(decl.name, decl.name.text);
            }
          }
        }
      }
    }

    const findings: Finding[] = [];
    for (const exp of exportsList) {
      const symRe = new RegExp(`\\b${exp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      let referencedElsewhere = false;
      for (const [otherFile, content] of allContents) {
        if (otherFile === exp.file) continue;
        if (symRe.test(content)) {
          referencedElsewhere = true;
          break;
        }
      }
      if (!referencedElsewhere) {
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'unsafe',
          confidence: 0.78,
          file: exp.file,
          span: { line: exp.line, column: exp.column },
          message: `Exported symbol \`${exp.name}\` appears unused outside ${exp.file}.`,
          evidence: `export ... ${exp.name}`,
        });
      }
    }
    return findings;
  },
};
