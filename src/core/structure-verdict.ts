import type { DetectorContext, Finding } from '../contracts.js';
import { tarjanSCC } from '../detectors/arch.js';
import { STRUCTURE_RULES } from '../detectors/structure.js';
import { buildImportGraph } from './import-graph.js';
import inferShape, { type ProjectShape } from './project-shape.js';

export type StructureVerdictKind = 'HEALTHY' | 'NEEDS ATTENTION' | 'TANGLED' | 'NOT ASSESSED';

export interface StructureVerdict {
  verdict: StructureVerdictKind;
  reason?: string;
  archetype: string;
  layout: string;
  graph: {
    graphedFiles: number;
    totalCodeFiles: number;
    resolvedRatio: number;
  };
  metrics: {
    cycles: number;
    largestCycle: number;
    boundaryLeaks: number;
    largestFlatDir: number;
  };
  topFixes: string[];
}

type GraphStats = {
  internalSpecs?: number;
  resolved?: number;
  graphedFiles?: number;
  totalCodeFiles?: number;
  resolvedRatio?: number;
};

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.dart']);
const GRAPHED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.dart']);
const BOUNDARY_RULES = new Set<string>([
  STRUCTURE_RULES.crossPackage,
  STRUCTURE_RULES.deepImport,
  STRUCTURE_RULES.sharedImportsFeature,
]);

function shapeInfo(shape: ProjectShape): { archetype: string; layout: string } {
  return { archetype: shape.archetype, layout: shape.layout };
}

/**
 * Turns structure findings and the import graph into a bounded, explainable verdict.
 * Assessment is withheld when the graph is too incomplete to trust cycle percentages.
 */
export function computeStructureVerdict(ctx: DetectorContext, findings: Finding[]): StructureVerdict {
  const graph = buildImportGraph(ctx);
  const shape = inferShape(ctx);
  const stats = (graph as unknown as { stats?: GraphStats }).stats ?? {};
  const codeFileCount = ctx.files.filter((file) => CODE_EXTS.has(file.ext.toLowerCase())).length;
  const graphedFiles = ctx.files.filter((file) => GRAPHED_EXTS.has(file.ext.toLowerCase())).length;
  const totalCodeFiles = stats.totalCodeFiles ?? codeFileCount;
  const internalSpecs = stats.internalSpecs ?? 0;
  const resolvedRatio = stats.resolvedRatio
    ?? (internalSpecs > 0 ? (stats.resolved ?? 0) / internalSpecs : 1);
  const graphInfo = { graphedFiles, totalCodeFiles, resolvedRatio };

  const adjacency = new Map<string, string[]>(
    graph.nodes.map((node) => [node, [...(graph.get(node) ?? [])]]),
  );
  const sccs = tarjanSCC(graph.nodes, adjacency);
  let cycles = 0;
  let largestCycle = 0;
  let filesInCycles = 0;
  let tangleSized = false;
  const minCycle = Math.max(ctx.config?.structure?.tangleMinFiles ?? 10, graphedFiles * 0.05);
  for (const scc of sccs) {
    const isCycle = scc.length > 1 || (scc.length === 1 && (adjacency.get(scc[0]) ?? []).includes(scc[0]));
    if (!isCycle) continue;
    cycles += 1;
    filesInCycles += scc.length;
    largestCycle = Math.max(largestCycle, scc.length);
    if (scc.length >= minCycle) tangleSized = true;
  }

  const structureFindings = findings.filter((finding) => finding.ruleId.startsWith('structure/'));
  const errorFindings = structureFindings.filter((finding) => finding.severity === 'error');
  const boundaryLeaks = structureFindings.filter((finding) => BOUNDARY_RULES.has(finding.ruleId)).length;
  const metrics = {
    cycles,
    largestCycle,
    boundaryLeaks,
    largestFlatDir: shape.largestFlatDir?.count ?? 0,
  };

  let verdict: StructureVerdictKind = 'HEALTHY';
  let reason: string | undefined;
  if (totalCodeFiles === 0 || graphedFiles === 0) {
    verdict = 'NOT ASSESSED';
    reason = 'No code files were available to build an import graph.';
  } else if (graphedFiles >= 20 && graph.edges.length === 0 && internalSpecs === 0) {
    verdict = 'NOT ASSESSED';
    reason = `No imports were recognized across ${graphedFiles} graphed files; assessment withheld.`;
  } else if (graphedFiles / totalCodeFiles < 0.5) {
    verdict = 'NOT ASSESSED';
    reason = `Only ${graphedFiles}/${totalCodeFiles} code files are in the import graph (${Math.round(graphedFiles / totalCodeFiles * 100)}%).`;
  } else if (resolvedRatio < 0.8) {
    verdict = 'NOT ASSESSED';
    reason = `Only ${Math.round(resolvedRatio * 100)}% of imports resolved (80% required).`;
  } else if ((filesInCycles >= 5 && filesInCycles / graphedFiles >= 0.15) || tangleSized) {
    verdict = 'TANGLED';
    reason = `Cycles contain ${filesInCycles}/${graphedFiles} graphed files (${Math.round(filesInCycles / graphedFiles * 100)}%); largest cycle has ${largestCycle} file(s).`;
  } else if (errorFindings.length > 0 || boundaryLeaks >= 3) {
    verdict = 'NEEDS ATTENTION';
    const causes: string[] = [];
    if (errorFindings.length > 0) causes.push(`${errorFindings.length} error-level structure finding(s)`);
    if (boundaryLeaks >= 3) causes.push(`${boundaryLeaks} boundary leak(s)`);
    reason = `${causes.join(', ')} require attention.`;
  }

  const counts = new Map<string, number>();
  for (const finding of structureFindings) {
    counts.set(finding.ruleId, (counts.get(finding.ruleId) ?? 0) + 1);
  }
  const topFixes: string[] = [];
  if (counts.get(STRUCTURE_RULES.crossPackage)) {
    topFixes.push('Replace cross-package relative imports with public package entry points.');
  }
  if (counts.get(STRUCTURE_RULES.deepImport)) {
    topFixes.push('Import features through their public index instead of internal files.');
  }
  if (counts.get(STRUCTURE_RULES.sharedImportsFeature)) {
    topFixes.push('Invert shared-to-feature imports, or add an explicit structure allow rule.');
  }
  if (cycles > 0 || tangleSized) {
    topFixes.push('Break import cycles by extracting shared abstractions.');
  }
  if (counts.get(STRUCTURE_RULES.junkDrawer)) {
    topFixes.push('Consolidate competing utility folders into one canonical folder.');
  }

  return {
    verdict,
    ...(reason ? { reason } : {}),
    ...shapeInfo(shape),
    graph: graphInfo,
    metrics,
    topFixes,
  };
}
