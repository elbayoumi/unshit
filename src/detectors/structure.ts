import path from 'node:path';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';
import { buildImportGraph, type ImportEdge } from '../core/import-graph.js';
import inferShape, { type ProjectShape } from '../core/project-shape.js';
import { tarjanSCC } from './arch.js';

type StructureEdge = ImportEdge;
type Feature = { root: string; name: string };
type FeatureResolver = (relPath: string) => Feature | null;

export const STRUCTURE_RULES = {
  crossPackage: 'structure/cross-package-import',
  deepImport: 'structure/feature-deep-import',
  sharedImportsFeature: 'structure/shared-imports-feature',
  featureCycle: 'structure/feature-cycle',
  junkDrawer: 'structure/junk-drawer',
} as const;

const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs'];
const DEFAULT_FEATURE_CONTAINERS = ['features', 'modules', 'domains'];
const SHARED_BUCKETS = new Set(['shared', 'common', 'utils', 'util', 'helpers', 'lib', 'ui', 'components', 'hooks']);
const APP_BUCKETS = new Set(['app', 'pages', 'routes', 'screens']);
const JUNK_GROUPS = [
  new Set(['utils', 'util', 'helpers', 'helper']),
  new Set(['common', 'shared']),
];
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.dart']);

function normalizeRel(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Package directories come from the shape, which validates manifest names/workspace membership. */
function packageDirs(shape: ProjectShape): string[] {
  return [...new Set(shape.packages.map((dir) => normalizeRel(dir)))]
    .map((d) => (d === '.' ? '' : d))
    .filter((d) => d !== '' && !d.startsWith('..'))
    .sort((a, b) => a.localeCompare(b));
}

function ownerPackage(relPath: string, dirs: string[]): string | null {
  let owner: string | null = null;
  for (const dir of dirs) {
    if (relPath.startsWith(`${dir}/`) && (!owner || dir.length > owner.length)) owner = dir;
  }
  return owner;
}

function containersOf(ctx: DetectorContext): string[] {
  const configured = ctx.config?.structure?.featureContainers ?? [];
  const values = configured.length > 0 ? configured : DEFAULT_FEATURE_CONTAINERS;
  const result = values
    .flatMap((value) => normalizeRel(value).split('/'))
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.toLowerCase());
  return [...new Set(result)];
}

/** Reconstructs the feature directory from the shape's feature location. */
function featureFromShape(shape: ProjectShape, relPath: string): Feature | null {
  const location = shape.featureOf(relPath);
  if (!location) return null;
  const segments = normalizeRel(relPath).split('/');
  const rootParts = location.root ? location.root.split('/').filter(Boolean) : [];
  let index = rootParts.length;
  const container = segments[index];
  if (container && shape.featureContainers.some((c) => normalizeRel(c).toLowerCase() === container.toLowerCase())) {
    index += 1;
  }
  if (segments[index] !== location.feature) return null;
  return { root: segments.slice(0, index + 1).join('/'), name: location.feature };
}

function featureInContainers(relPath: string, containers: string[]): Feature | null {
  const parts = relPath.split('/').slice(0, -1);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    for (const container of containers) {
      const cParts = container.split('/').filter(Boolean);
      if (cParts.length > i + 1) continue;
      const suffix = parts.slice(i + 1 - cParts.length, i + 1).map((part) => part.toLowerCase());
      if (!suffix.every((part, idx) => part === cParts[idx])) continue;
      const name = parts[i + 1];
      if (!name || name.includes('.')) return null;
      return { root: parts.slice(0, i + 2).join('/'), name };
    }
  }
  return null;
}

function makeFeatureResolver(ctx: DetectorContext, shape: ProjectShape): FeatureResolver {
  const containers = containersOf(ctx);
  return (relPath: string): Feature | null =>
    featureFromShape(shape, relPath) ?? featureInContainers(relPath, containers);
}

function isTestFile(relPath: string): boolean {
  const norm = normalizeRel(relPath);
  const parts = norm.split('/');
  if (parts.includes('__tests__') || parts.includes('__test__')) return true;
  const name = parts[parts.length - 1] ?? '';
  return (
    /\.(test|spec|stories)\.[^/]+$/i.test(name)
    || /_test\.dart$/i.test(name)
    || /^test_.+\.py$/i.test(name)
  );
}

function isCodeFile(file: FileEntry): boolean {
  return CODE_EXTS.has(file.ext.toLowerCase());
}

function globToRegExp(glob: string): RegExp {
  const value = normalizeRel(glob);
  if (!/[*?]/.test(value)) {
    const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(?:/.*)?$`);
  }
  let re = '';
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '*') {
      if (value[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function allowPairs(ctx: DetectorContext): Array<{ from: RegExp; to: RegExp }> {
  const pairs: Array<{ from: RegExp; to: RegExp }> = [];
  for (const raw of ctx.config?.structure?.allow ?? []) {
    const arrow = raw.indexOf('->');
    if (arrow < 0) continue;
    const from = raw.slice(0, arrow).trim();
    const to = raw.slice(arrow + 2).trim();
    if (!from || !to) continue;
    pairs.push({ from: globToRegExp(from), to: globToRegExp(to) });
  }
  return pairs;
}

type StructureContextData = {
  edges: StructureEdge[];
  fileMap: Map<string, FileEntry>;
  allowed: ReturnType<typeof allowPairs>;
};

const structureCache = new WeakMap<DetectorContext, StructureContextData>();

/** Builds and memoises the filtered/sorted edge list once per detector context. */
function structureContext(ctx: DetectorContext): StructureContextData {
  const cached = structureCache.get(ctx);
  if (cached) return cached;

  const fileMap = new Map(ctx.files.map((file) => [file.relPath, file]));
  const edges = (buildImportGraph(ctx).edges as StructureEdge[])
    .filter((edge) => edge.from !== edge.to)
    .filter((edge) => !isTestFile(edge.from))
    .sort((a, b) =>
      a.from.localeCompare(b.from)
      || a.to.localeCompare(b.to)
      || (a.line ?? 0) - (b.line ?? 0));
  const data = { edges, fileMap, allowed: allowPairs(ctx) };
  structureCache.set(ctx, data);
  return data;
}

function isAllowed(
  allowed: StructureContextData['allowed'],
  from: string,
  to: string,
): boolean {
  return allowed.some((pair) => pair.from.test(from) && pair.to.test(to));
}

function importLine(edge: StructureEdge, fileMap: Map<string, FileEntry>): number {
  if (typeof edge.line === 'number' && Number.isInteger(edge.line) && edge.line > 0) return edge.line;
  if (edge.spec) {
    const file = fileMap.get(edge.from);
    const idx = file?.lines.findIndex((line) => line.includes(edge.spec!)) ?? -1;
    if (idx >= 0) return idx + 1;
  }
  return 1;
}

function isRelativeEdge(edge: StructureEdge, fileMap: Map<string, FileEntry>): boolean {
  if (typeof edge.spec === 'string') return edge.spec.startsWith('.');
  const file = fileMap.get(edge.from);
  return Boolean(file?.lines.some((line) => /from\s+['"]\.\.?\//.test(line) || /import\s*\(\s*['"]\.\.?\//.test(line)));
}

function finding(
  ruleId: string,
  severity: Finding['severity'],
  file: string,
  line: number,
  message: string,
  evidence: string,
): Finding {
  return {
    ruleId,
    category: 'architecture',
    tier: 'structural',
    severity,
    fixability: 'manual',
    confidence: 1,
    file,
    span: { line: Math.max(1, line), column: 1 },
    message,
    evidence,
  };
}

/**
 * Only the directory immediately below the source root is a bucket. Deeper folders
 * such as `resources/js/Layouts/Components` must not be read as shared/UI layers.
 */
function classify(relPath: string, resolve: FeatureResolver, shape: ProjectShape): 0 | 1 | 2 | 3 {
  if (resolve(relPath)) return 2;
  const bucket = (shape.bucketOf(relPath)?.bucket ?? '').toLowerCase();
  if (APP_BUCKETS.has(bucket)) return 3;
  if (SHARED_BUCKETS.has(bucket)) return 1;
  return 0;
}

/** A relative import between two non-root workspace packages. */
export const crossPackageImportDetector: Detector = {
  id: STRUCTURE_RULES.crossPackage,
  category: 'architecture',
  tier: 'structural',
  severity: 'error',
  scope: 'project',
  description: 'Detects relative imports crossing between two non-root workspace packages.',
  detect(ctx: DetectorContext): Finding[] {
    const dirs = packageDirs(inferShape(ctx));
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
export const featureDeepImportDetector: Detector = {
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
export const sharedImportsFeatureDetector: Detector = {
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
export const featureCycleDetector: Detector = {
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
export const junkDrawerDetector: Detector = {
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

export const structureDetectors = STRUCTURE_DETECTORS;
