import path from 'node:path';
import type { Detector, DetectorContext, Finding } from '../contracts.js';
import inferShape from '../core/project-shape.js';
import { tarjanSCC } from './arch.js';
import {
  CODE_EXTS,
  INDEX_FILES,
  JUNK_GROUPS,
  classify,
  finding,
  importLine,
  isAllowed,
  isCodeFile,
  isRelativeEdge,
  isTestFile,
  makeFeatureResolver,
  ownerPackage,
  packageDirsOf,
  structureContext,
} from './structure-shared.js';

export const STRUCTURE_RULES = {
  crossPackage: 'structure/cross-package-import',
  deepImport: 'structure/feature-deep-import',
  sharedImportsFeature: 'structure/shared-imports-feature',
  featureCycle: 'structure/feature-cycle',
  junkDrawer: 'structure/junk-drawer',
} as const;

/** A relative import between two non-root workspace packages. */
const crossPackageImportDetector: Detector = {
  id: STRUCTURE_RULES.crossPackage,
  category: 'architecture',
  tier: 'structural',
  severity: 'error',
  scope: 'project',
  description: 'Detects relative imports crossing between two non-root workspace packages.',
  detect(ctx: DetectorContext): Finding[] {
    const dirs = packageDirsOf(inferShape(ctx));
    if (dirs.length < 2) return [];
    const { edges, fileMap, allowed } = structureContext(ctx);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const edge of edges) {
      if (!isRelativeEdge(edge, fileMap)) continue;
      const from = ownerPackage(edge.from, dirs);
      const to = ownerPackage(edge.to, dirs);
      if (!from || !to || from === to) continue;
      if (isAllowed(allowed, edge.from, edge.to)) continue;
      const key = `${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding(
        this.id,
        'error',
        edge.from,
        importLine(edge, fileMap),
        `Workspace package "${from}" must not relative-import internal files of "${to}".`,
        `${edge.from} -> ${edge.to}`,
      ));
    }
    return findings;
  },
};

/** A feature reaching into another feature's internal files instead of its public index. */
const featureDeepImportDetector: Detector = {
  id: STRUCTURE_RULES.deepImport,
  category: 'architecture',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Detects feature-to-feature imports that bypass the target feature index.',
  detect(ctx: DetectorContext): Finding[] {
    const shape = inferShape(ctx);
    const resolve = makeFeatureResolver(ctx, shape);
    const fileSet = new Set(ctx.files.map((file) => file.relPath));
    const { edges, fileMap, allowed } = structureContext(ctx);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const edge of edges) {
      const from = resolve(edge.from);
      const to = resolve(edge.to);
      if (!from || !to || from.root === to.root) continue;
      if (!INDEX_FILES.some((name) => fileSet.has(`${to.root}/${name}`))) continue;
      if (INDEX_FILES.some((name) => edge.to === `${to.root}/${name}`)) continue;
      if (isAllowed(allowed, edge.from, edge.to)) continue;
      const key = `${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding(
        this.id,
        'warn',
        edge.from,
        importLine(edge, fileMap),
        `Feature "${from.name}" imports an internal file of "${to.name}"; use its public index instead.`,
        `${edge.from} -> ${edge.to}`,
      ));
    }
    return findings;
  },
};

/** Shared/UI buckets importing upwards into features or app code. */
const sharedImportsFeatureDetector: Detector = {
  id: STRUCTURE_RULES.sharedImportsFeature,
  category: 'architecture',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Detects lower-rank shared buckets importing features or app/pages/routes/screens.',
  detect(ctx: DetectorContext): Finding[] {
    if (ctx.config.layers) return [];
    const shape = inferShape(ctx);
    const resolve = makeFeatureResolver(ctx, shape);
    const { edges, fileMap, allowed } = structureContext(ctx);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const edge of edges) {
      if (classify(edge.from, resolve, shape) !== 1) continue;
      const targetRank = classify(edge.to, resolve, shape);
      if (targetRank !== 2 && targetRank !== 3) continue;
      if (isAllowed(allowed, edge.from, edge.to)) continue;
      const key = `${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding(
        this.id,
        'warn',
        edge.from,
        importLine(edge, fileMap),
        `Shared-layer code imports ${targetRank === 2 ? 'feature' : 'app'} code; invert the dependency.`,
        `${edge.from} -> ${edge.to}`,
      ));
    }
    return findings;
  },
};

/** Strongly connected groups of features in the feature-level import graph. */
const featureCycleDetector: Detector = {
  id: STRUCTURE_RULES.featureCycle,
  category: 'architecture',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Detects cycles between features using Tarjan SCC.',
  detect(ctx: DetectorContext): Finding[] {
    const shape = inferShape(ctx);
    const resolve = makeFeatureResolver(ctx, shape);
    const { edges, fileMap } = structureContext(ctx);
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      const from = resolve(edge.from);
      const to = resolve(edge.to);
      if (!from || !to || from.root === to.root) continue;
      if (!adjacency.has(from.root)) adjacency.set(from.root, new Set());
      if (!adjacency.has(to.root)) adjacency.set(to.root, new Set());
      adjacency.get(from.root)!.add(to.root);
    }
    if (adjacency.size < 2) return [];
    const nodes = [...adjacency.keys()].sort();
    const sccs = tarjanSCC(nodes, new Map(nodes.map((node) => [node, [...adjacency.get(node)!]])));
    const findings: Finding[] = [];
    for (const scc of sccs) {
      if (scc.length < 2) continue;
      const members = new Set(scc);
      const anchor = edges.find((edge) => {
        const from = resolve(edge.from);
        const to = resolve(edge.to);
        return Boolean(from && to && members.has(from.root) && members.has(to.root));
      });
      const chain = [...scc].sort();
      findings.push(finding(
        this.id,
        'warn',
        anchor?.from ?? chain[0],
        anchor ? importLine(anchor, fileMap) : 1,
        `Feature cycle detected among ${scc.length} features.`,
        [...chain, chain[0]].join(' -> '),
      ));
    }
    return findings;
  },
};

/** Two or more synonymous utility folders competing in one directory. */
const junkDrawerDetector: Detector = {
  id: STRUCTURE_RULES.junkDrawer,
  category: 'architecture',
  tier: 'structural',
  severity: 'info',
  scope: 'project',
  description: 'Detects competing sibling folders such as utils/ and helpers/.',
  detect(ctx: DetectorContext): Finding[] {
    const byParent = new Map<string, Map<number, Set<string>>>();
    const filesByDir = new Map<string, string[]>();
    for (const file of ctx.files) {
      if (isTestFile(file.relPath) || !isCodeFile(file)) continue;
      const dir = path.posix.dirname(file.relPath);
      const name = path.posix.basename(dir).toLowerCase();
      const groupIndex = JUNK_GROUPS.findIndex((group) => group.has(name));
      if (groupIndex === -1) continue;
      const parent = path.posix.dirname(dir);
      if (!byParent.has(parent)) byParent.set(parent, new Map());
      const groups = byParent.get(parent)!;
      if (!groups.has(groupIndex)) groups.set(groupIndex, new Set());
      groups.get(groupIndex)!.add(dir);
      if (!filesByDir.has(dir)) filesByDir.set(dir, []);
      filesByDir.get(dir)!.push(file.relPath);
    }
    const findings: Finding[] = [];
    for (const [parent, groups] of [...byParent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const [groupIndex, dirs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        if (dirs.size < 2) continue;
        const sorted = [...dirs].sort();
        const representative = (filesByDir.get(sorted[0]) ?? []).sort()[0] ?? sorted[0];
        findings.push(finding(
          this.id,
          'info',
          representative,
          1,
          `Competing utility folders in ${parent === '.' ? 'the source root' : parent}: ${sorted.join(', ')}.`,
          sorted.join(' -> '),
        ));
      }
    }
    return findings;
  },
};

export const STRUCTURE_DETECTORS: Detector[] = [
  crossPackageImportDetector,
  featureDeepImportDetector,
  sharedImportsFeatureDetector,
  featureCycleDetector,
  junkDrawerDetector,
];

const structureDetectors = STRUCTURE_DETECTORS;
