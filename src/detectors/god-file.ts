import type { Detector, DetectorContext, Finding } from '../contracts.js';

const HOOK_RE = /\buse(State|Effect|Memo|Callback|Ref|Reducer|Context|LayoutEffect)\s*\(/g;

export const godFileDetector: Detector = {
  id: 'react/god-file',
  category: 'architecture',
  tier: 'heuristic',
  severity: 'warn',
  description: 'Flags oversized files or hooks exceeding line/hook-density thresholds.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const { godFileMaxLines, godFileMaxHooks } = ctx.config;

    for (const file of ctx.files) {
      if (!file.sourceFile || /\.(test|spec)\./.test(file.relPath)) continue;
      const lineCount = file.lines.length;
      const hookMatches = file.content.match(HOOK_RE);
      const hookCount = hookMatches ? hookMatches.length : 0;

      if (lineCount > godFileMaxLines || hookCount > godFileMaxHooks) {
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.9,
          file: file.relPath,
          span: { line: 1, column: 1 },
          message: `Oversized module (${lineCount} lines, ${hookCount} hooks; limits: ${godFileMaxLines} lines / ${godFileMaxHooks} hooks). Split by domain.`,
          evidence: `${lineCount} LOC, ${hookCount} React hooks`,
        });
      }
    }
    return findings;
  },
};
