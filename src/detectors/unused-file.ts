import ts from 'typescript';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';
import { buildImportGraph, createTsSpecResolver } from '../core/import-graph.js';
import { entryPointFileSet } from './dead-exports.js';

const TS_LIKE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Resolved targets of dynamic `import()` calls anywhere in the scanned set. */
function dynamicImportTargets(ctx: DetectorContext): Set<string> {
  const resolve = createTsSpecResolver(ctx);
  const targets = new Set<string>();
  const visit = (file: FileEntry, node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
    ) {
      const arg = node.arguments[0]!;
      if (ts.isStringLiteralLike(arg)) {
        const res = resolve(arg.text, file);
        if (res.internal && res.target) targets.add(res.target);
      }
    }
    ts.forEachChild(node, (child) => visit(file, child));
  };
  for (const file of ctx.files) {
    if (!file.sourceFile) continue;
    visit(file, file.sourceFile);
  }
  return targets;
}

/**
 * Flags source files that no other scanned file imports (static, dynamic,
 * `require`, export-from or side-effect imports) and that are not entry
 * points.
 */
export const unusedFileDetector: Detector = {
  id: 'ts/unused-file',
  category: 'dead-code',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Flags source files that no other scanned file imports and that are not entry points.',
  detect(ctx: DetectorContext): Finding[] {
    const graph = buildImportGraph(ctx);
    const entries = entryPointFileSet(ctx, ctx.files);
    const dynamic = dynamicImportTargets(ctx);
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!TS_LIKE.has(file.ext) || file.relPath.endsWith('.d.ts')) continue;
      if (entries.has(file.relPath)) continue;
      if (graph.incomingOf(file.relPath).length > 0 || dynamic.has(file.relPath)) continue;
      findings.push({
        ruleId: this.id,
        category: 'dead-code',
        tier: 'structural',
        severity: 'warn',
        fixability: 'ai',
        confidence: 0.8,
        file: file.relPath,
        span: { line: 1, column: 1 },
        message: 'File is never imported by any other scanned file.',
        evidence: 'no incoming imports',
      });
    }
    findings.sort((a, b) => a.file.localeCompare(b.file));
    return findings;
  },
};
