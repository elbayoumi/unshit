import type { Severity } from '../contracts.js';
import { SEV_RANK, getOpt, type CommandContext } from './shared.js';
import { getStructureVerdict } from './structure.js';

export async function runScanCommand({ rest, scan, score, format }: CommandContext): Promise<number> {
  const { formatScanOutput } = await import('../core/reporters.js');
  console.log(formatScanOutput(scan.findings, score, format));
  if (format === 'human') {
    const sv = await getStructureVerdict(scan);
    console.log(`Structure: ${sv.verdict} (${sv.archetype} · ${sv.layout} · ${Math.round(sv.graph.resolvedRatio * 100)}% imports resolved)`);
  }
  const failOn = getOpt(rest, '--fail-on') as Severity | undefined;
  if (failOn && SEV_RANK[failOn]) {
    const minRank = SEV_RANK[failOn];
    if (scan.findings.some((f) => SEV_RANK[f.severity] >= minRank)) return 1;
  }
  return 0;
}
