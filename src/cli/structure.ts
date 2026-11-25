import type { Severity } from '../contracts.js';
import type { ScanResult } from '../core/scanner.js';
import { SEV_RANK, getOpt, type CommandContext } from './shared.js';

export async function getStructureVerdict(
  scan: ScanResult,
): Promise<ReturnType<typeof import('../core/structure-verdict.js').computeStructureVerdict>> {
  const { computeStructureVerdict } = await import('../core/structure-verdict.js');
  return computeStructureVerdict(
    { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
    scan.findings,
  );
}

export async function runStructureCommand({ rest, scan, format }: CommandContext): Promise<number> {
  const failOnRaw = getOpt(rest, '--fail-on');
  if (failOnRaw !== undefined && !SEV_RANK[failOnRaw as Severity]) {
    console.error(`Invalid --fail-on: ${failOnRaw}. Expected error|warn|info.`);
    return 2;
  }
  const failOn = failOnRaw as Severity | undefined;
  const sv = await getStructureVerdict(scan);
  if (format === 'json') {
    console.log(JSON.stringify(sv, null, 2));
  } else {
    console.log(`Archetype  ${sv.archetype} · ${sv.layout}`);
    console.log(`Graph      ${sv.graph.graphedFiles}/${sv.graph.totalCodeFiles} code files graphed (${Math.round(sv.graph.resolvedRatio * 100)}% internal imports resolved)`);
    console.log(`Verdict    ${sv.verdict}${sv.reason ? ` — ${sv.reason}` : ''}`);
    console.log(`  Cycles          ${sv.metrics.cycles} (largest: ${sv.metrics.largestCycle} files)`);
    console.log(`  Boundary leaks  ${sv.metrics.boundaryLeaks}`);
    console.log(`  Largest flat    ${sv.metrics.largestFlatDir} files [metric only]`);
    if (sv.topFixes.length > 0) {
      console.log('Top fixes');
      sv.topFixes.slice(0, 3).forEach((fix, idx) => console.log(`  ${idx + 1}. ${fix}`));
    }
  }
  if (failOn) {
    const minRank = SEV_RANK[failOn];
    if (scan.findings.some(
      (f) => f.ruleId.startsWith('structure/') && SEV_RANK[f.severity] >= minRank,
    )) {
      return 1;
    }
  }
  return 0;
}
