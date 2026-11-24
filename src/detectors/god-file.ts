import type { Detector, DetectorContext, Finding } from '../contracts.js';

const HOOK_RE = /\buse(State|Effect|Memo|Callback|Ref|Reducer|Context|LayoutEffect)\s*\(/g;
const POLYGLOT_CODE_EXTS = new Set(['.rs', '.dart', '.py']);

export const godFileDetector: Detector = {
  id: 'react/god-file',
  category: 'architecture',
  tier: 'heuristic',
  severity: 'warn',
  description: 'Flags oversized modules exceeding line/hook-density thresholds.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const { godFileMaxLines, godFileMaxHooks } = ctx.config;

    for (const file of ctx.files) {
      if ((!file.sourceFile && !POLYGLOT_CODE_EXTS.has(file.ext)) || /\.(test|spec)\.|_test\.(rs|dart|py)$/.test(file.relPath)) {
        continue;
      }
      const lineCount = file.lines.length;
      const hookMatches = file.sourceFile ? file.content.match(HOOK_RE) : null;
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
          message: `Oversized module (${lineCount} lines${hookCount ? `, ${hookCount} hooks` : ''}; limits: ${godFileMaxLines} lines / ${godFileMaxHooks} hooks). Split by domain.`,
          evidence: `${lineCount} LOC${hookCount ? `, ${hookCount} React hooks` : ''}`,
        });
      }
    }
    return findings;
  },
};
