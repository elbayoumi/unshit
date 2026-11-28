import type { DetectorContext, Finding } from '../contracts.js';
import { tarjanSCC } from '../detectors/arch.js';
import { STRUCTURE_RULES } from '../detectors/structure.js';
import { buildImportGraph } from './import-graph.js';
import inferShape, { type ProjectShape } from './project-shape.js';

type StructureVerdictKind = 'HEALTHY' | 'NEEDS ATTENTION' | 'TANGLED' | 'NOT ASSESSED';

interface StructureVerdict {
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

const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.dart']);
const GRAPHED_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.dart']);
const BOUNDARY_RULES = new Set<string>([
  STRUCTURE_RULES.crossPackage,
  STRUCTURE_RULES.deepImport,
  STRUCTURE_RULES.sharedImportsFeature,
]);

function shapeInfo(shape: ProjectShape): { archetype: string; layout: string } {
  return { archetype: shape.archetype, layout: shape.layout };
}

interface GraphFacts {
  graphedFiles: number;
  totalCodeFiles: number;
  resolvedRatio: number;
  internalSpecs: number;
  edgeCount: number;
}

function graphFacts(ctx: DetectorContext, graph: ReturnType<typeof buildImportGraph>): GraphFacts {
  const stats: GraphStats = graph.stats;
  const codeFileCount = ctx.files.filter((file) => CODE_EXTS.has(file.ext.toLowerCase())).length;
  const graphedFiles = ctx.files.filter((file) => GRAPHED_EXTS.has(file.ext.toLowerCase())).length;
  return {
    graphedFiles,
    totalCodeFiles: stats.totalCodeFiles ?? codeFileCount,
    internalSpecs: stats.internalSpecs ?? 0,
    resolvedRatio: stats.resolvedRatio
      ?? ((stats.internalSpecs ?? 0) > 0 ? (stats.resolved ?? 0) / stats.internalSpecs! : 1),
    edgeCount: graph.edges.length,
  };
}

interface CycleFacts {
  cycles: number;
  largestCycle: number;
  filesInCycles: number;
  tangleSized: boolean;
}

function cycleFacts(
  graph: ReturnType<typeof buildImportGraph>,
  tangleMinFiles: number | undefined,
  graphedFiles: number,
): CycleFacts {
  const adjacency = new Map<string, string[]>(
    graph.nodes.map((node) => [node, [...(graph.get(node) ?? [])]]),
  );
  const sccs = tarjanSCC(graph.nodes, adjacency);
  const facts: CycleFacts = { cycles: 0, largestCycle: 0, filesInCycles: 0, tangleSized: false };
  const minCycle = Math.max(tangleMinFiles ?? 10, graphedFiles * 0.05);
  for (const scc of sccs) {
    const isCycle = scc.length > 1 || (scc.length === 1 && (adjacency.get(scc[0]) ?? []).includes(scc[0]));
    if (!isCycle) continue;
    facts.cycles += 1;
    facts.filesInCycles += scc.length;
    facts.largestCycle = Math.max(facts.largestCycle, scc.length);
    if (scc.length >= minCycle) facts.tangleSized = true;
  }
  return facts;
}

interface VerdictResult {
  verdict: StructureVerdictKind;
  reason?: string;
}

function decideVerdict(
  facts: GraphFacts,
  cycles: CycleFacts,
  errorCount: number,
  boundaryLeaks: number,
): VerdictResult {
  const { graphedFiles, totalCodeFiles, internalSpecs, resolvedRatio, edgeCount } = facts;
  const { filesInCycles, largestCycle, tangleSized } = cycles;
  if (totalCodeFiles === 0 || graphedFiles === 0) {
    return { verdict: 'NOT ASSESSED', reason: 'No code files were available to build an import graph.' };
  }
  if (graphedFiles >= 20 && edgeCount === 0 && internalSpecs === 0) {
    return {
      verdict: 'NOT ASSESSED',
      reason: `No imports were recognized across ${graphedFiles} graphed files; assessment withheld.`,
    };
  }
  if (graphedFiles / totalCodeFiles < 0.5) {
    return {
      verdict: 'NOT ASSESSED',
      reason: `Only ${graphedFiles}/${totalCodeFiles} code files are in the import graph (${Math.round(graphedFiles / totalCodeFiles * 100)}%).`,
    };
  }
  if (resolvedRatio < 0.8) {
    return {
      verdict: 'NOT ASSESSED',
      reason: `Only ${Math.round(resolvedRatio * 100)}% of imports resolved (80% required).`,
    };
  }
  if ((filesInCycles >= 5 && filesInCycles / graphedFiles >= 0.15) || tangleSized) {
    return {
      verdict: 'TANGLED',
      reason: `Cycles contain ${filesInCycles}/${graphedFiles} graphed files (${Math.round(filesInCycles / graphedFiles * 100)}%); largest cycle has ${largestCycle} file(s).`,
    };
  }
  if (errorCount > 0 || boundaryLeaks >= 3) {
    const causes: string[] = [];
    if (errorCount > 0) causes.push(`${errorCount} error-level structure finding(s)`);
    if (boundaryLeaks >= 3) causes.push(`${boundaryLeaks} boundary leak(s)`);
    return { verdict: 'NEEDS ATTENTION', reason: `${causes.join(', ')} require attention.` };
  }
  return { verdict: 'HEALTHY' };
}

function topFixesFor(counts: Map<string, number>, cycles: number, tangleSized: boolean): string[] {
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
  return topFixes;
}

/**
 * Turns structure findings and the import graph into a bounded, explainable verdict.
 * Assessment is withheld when the graph is too incomplete to trust cycle percentages.
 */
export function computeStructureVerdict(ctx: DetectorContext, findings: Finding[]): StructureVerdict {
  const graph = buildImportGraph(ctx);
  const shape = inferShape(ctx);
  const facts = graphFacts(ctx, graph);
  const cycles = cycleFacts(graph, ctx.config?.structure?.tangleMinFiles, facts.graphedFiles);

  const structureFindings = findings.filter((finding) => finding.ruleId.startsWith('structure/'));
  const errorCount = structureFindings.filter((finding) => finding.severity === 'error').length;
  const boundaryLeaks = structureFindings.filter((finding) => BOUNDARY_RULES.has(finding.ruleId)).length;
  const { verdict, reason } = decideVerdict(facts, cycles, errorCount, boundaryLeaks);

  const counts = new Map<string, number>();
  for (const finding of structureFindings) {
    counts.set(finding.ruleId, (counts.get(finding.ruleId) ?? 0) + 1);
  }

  return {
    verdict,
    ...(reason ? { reason } : {}),
    ...shapeInfo(shape),
    graph: {
      graphedFiles: facts.graphedFiles,
      totalCodeFiles: facts.totalCodeFiles,
      resolvedRatio: facts.resolvedRatio,
    },
    metrics: {
      cycles: cycles.cycles,
      largestCycle: cycles.largestCycle,
      boundaryLeaks,
      largestFlatDir: shape.largestFlatDir?.count ?? 0,
    },
    topFixes: topFixesFor(counts, cycles.cycles, cycles.tangleSized),
  };
}
