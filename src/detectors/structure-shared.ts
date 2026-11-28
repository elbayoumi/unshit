import path from 'node:path';
import type { DetectorContext, FileEntry, Finding } from '../contracts.js';
import { buildImportGraph, type ImportEdge } from '../core/import-graph.js';
import inferShape, { type ProjectShape } from '../core/project-shape.js';

type StructureEdge = ImportEdge;
type Feature = { root: string; name: string };
type FeatureResolver = (relPath: string) => Feature | null;

export const INDEX_FILES = ['index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];
const DEFAULT_FEATURE_CONTAINERS = ['features', 'modules', 'domains'];
const SHARED_BUCKETS = new Set(['shared', 'common', 'utils', 'util', 'helpers', 'lib', 'ui', 'components', 'hooks']);
const APP_BUCKETS = new Set(['app', 'pages', 'routes', 'screens']);
export const JUNK_GROUPS = [
  new Set(['utils', 'util', 'helpers', 'helper']),
  new Set(['common', 'shared']),
];
export const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.dart']);

function normalizeRel(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function packageDirs(shape: ProjectShape): string[] {
  return [...new Set(shape.packages.map((dir) => normalizeRel(dir)))]
    .map((d) => (d === '.' ? '' : d))
    .filter((d) => d !== '' && !d.startsWith('..'))
    .sort((a, b) => a.localeCompare(b));
}

export function ownerPackage(relPath: string, dirs: string[]): string | null {
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

export function makeFeatureResolver(ctx: DetectorContext, shape: ProjectShape): FeatureResolver {
  const containers = containersOf(ctx);
  return (relPath: string): Feature | null =>
    featureFromShape(shape, relPath) ?? featureInContainers(relPath, containers);
}

export function isTestFile(relPath: string): boolean {
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

export function isCodeFile(file: FileEntry): boolean {
  return CODE_EXTS.has(file.ext.toLowerCase());
}

function globToRegExp(glob: string): RegExp {
  const value = normalizeRel(glob);
  if (!/[*?]/.test(value)) {
    return new RegExp(`^${value.replace(/[.+^${}()|[\]\\]/g, '\\$&')}(?:/.*)?$`);
  }
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*').replace(/\?/g, '[^/]');
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

export function structureContext(ctx: DetectorContext): StructureContextData {
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

export function isAllowed(allowed: StructureContextData['allowed'], from: string, to: string): boolean {
  return allowed.some((pair) => pair.from.test(from) && pair.to.test(to));
}

export function importLine(edge: StructureEdge, fileMap: Map<string, FileEntry>): number {
  if (typeof edge.line === 'number' && Number.isInteger(edge.line) && edge.line > 0) return edge.line;
  if (edge.spec) {
    const file = fileMap.get(edge.from);
    const idx = file?.lines.findIndex((line) => line.includes(edge.spec!)) ?? -1;
    if (idx >= 0) return idx + 1;
  }
  return 1;
}

export function isRelativeEdge(edge: StructureEdge, fileMap: Map<string, FileEntry>): boolean {
  if (typeof edge.spec === 'string') return edge.spec.startsWith('.');
  const file = fileMap.get(edge.from);
  return Boolean(file?.lines.some((line) => /from\s+['"]\.\.?\//.test(line) || /import\s*\(\s*['"]\.\.?\//.test(line)));
}

export function finding(
  ruleId: string,
  severity: Finding['severity'],
  file: string,
  line: number,
  message: string,
  evidence: string,
): Finding {
  return {
    ruleId, category: 'architecture', tier: 'structural', severity,
    fixability: 'manual', confidence: 1,
    file, span: { line: Math.max(1, line), column: 1 }, message, evidence,
  };
}

export function classify(relPath: string, resolve: FeatureResolver, shape: ProjectShape): 0 | 1 | 2 | 3 {
  if (resolve(relPath)) return 2;
  const bucket = (shape.bucketOf(relPath)?.bucket ?? '').toLowerCase();
  if (APP_BUCKETS.has(bucket)) return 3;
  if (SHARED_BUCKETS.has(bucket)) return 1;
  return 0;
}

export function packageDirsOf(shape: ProjectShape): string[] {
  return packageDirs(shape);
}
