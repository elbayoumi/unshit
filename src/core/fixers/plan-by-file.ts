import type { FileEntry, Finding, Patch } from '../../contracts.js';
import type { FixSkip } from './skip.js';

interface FilePlan {
  patches: Patch[];
  skipped: FixSkip[];
}

export type PlanForFile = (file: FileEntry, findings: Finding[]) => FilePlan;

/** Groups findings that a file-level planner can fix together. */
export function groupFindingsByFile(
  findings: Finding[],
  matches: (ruleId: string) => boolean,
): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (!matches(finding.ruleId)) continue;
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  return byFile;
}
