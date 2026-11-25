import type { Detector, DetectorContext, Finding } from '../../contracts.js';
import { analyze } from './analysis.js';
import { STAR, identifierCount, isConventionalDefaultFile } from './utils.js';

function unusedExportConfidence(exp: { isDefault: boolean; isListed: boolean }, isOverExported: boolean): number {
  if (isOverExported) return 0.7;
  if (exp.isDefault) return 0.75;
  return 0.9;
}

function unusedExportMessage(exp: { name: string; isDefault: boolean }, kind: string, isOverExported: boolean): string {
  if (exp.isDefault) return 'Default export `default` is never imported by any other file.';
  if (isOverExported) return `Exported ${kind} \`${exp.name}\` is used only locally; drop the \`export\` keyword.`;
  return `Exported ${kind} \`${exp.name}\` has zero references; safe to delete.`;
}

function findUnused(ctx: DetectorContext, wantTypeOnly: boolean, ruleId: string): Finding[] {
  const { decls, consumed, fuzzy } = analyze(ctx);
  const contentByFile = new Map(ctx.files.map((f) => [f.relPath, f.content]));
  const findings: Finding[] = [];
  for (const exp of decls) {
    if (exp.isTypeOnly !== wantTypeOnly) continue;
    const used = consumed.get(exp.file);
    if (used && (used.has(STAR) || used.has(exp.name))) continue;
    if (fuzzy.has(exp.name) || (exp.isDefault && isConventionalDefaultFile(exp.file))) continue;
    const content = contentByFile.get(exp.file) ?? '';
    const ownCount = exp.isDefault ? 0 : identifierCount(content, exp.localName);
    const isOverExported = ownCount >= (exp.isListed ? 3 : 2);
    const kind = wantTypeOnly ? 'type' : 'symbol';
    findings.push({
      ruleId, category: 'dead-code', tier: 'structural', severity: 'info', fixability: 'unsafe',
      confidence: unusedExportConfidence(exp, isOverExported),
      file: exp.file, span: { line: exp.line, column: exp.column },
      message: unusedExportMessage(exp, kind, isOverExported),
      evidence: exp.isDefault ? 'export default ...' : `export ... ${exp.name}`,
    });
  }
  return findings;
}

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