import type { DetectorContext, FileEntry } from '../contracts.js';
import { inferArchetype, type ProjectArchetype } from './project-archetype.js';
import { manifestInfo } from './project-manifests.js';
import { directoryOf, normalizeRelPath, toSegments } from './project-paths.js';

type ProjectLayout = 'feature-first' | 'layer-first' | 'unknown';

interface FeatureLocation {
  root: string;
  feature: string;
  subPath: string;
}

interface BucketLocation {
  root: string;
  bucket: string;
}

interface FlatDirMetric {
  dir: string;
  count: number;
}

export interface ProjectShape {
  packages: string[];
  sourceRoots: string[];
  archetype: ProjectArchetype;
  layout: ProjectLayout;
  featureContainers: string[];
  featureOf(relPath: string): FeatureLocation | null;
  bucketOf(relPath: string): BucketLocation | null;
  largestFlatDir: FlatDirMetric | null;
}

const DEFAULT_FEATURE_CONTAINERS = ['features', 'modules', 'domains'];

/** Longest-first so `resources/js` wins over a later `lib` marker in the same path. */
const SOURCE_ROOT_MARKERS = [
  ['resources', 'js'],
  ['resources', 'ts'],
  ['app', 'javascript'],
  ['src'],
  ['lib'],
] as const;

type SourceRootMatch = { start: number; length: number };

const WORKSPACE_CONTAINERS = new Set([
  'apps',
  'packages',
  'libs',
  'modules',
  'examples',
  'tools',
  'crates',
  'plugins',
]);

const LAYER_NAMES = new Set([
  'api',
  'assets',
  'component',
  'components',
  'config',
  'constant',
  'constants',
  'controller',
  'controllers',
  'core',
  'data',
  'domain',
  'entity',
  'entities',
  'helper',
  'helpers',
  'hook',
  'hooks',
  'infra',
  'lib',
  'model',
  'models',
  'provider',
  'providers',
  'repository',
  'repositories',
  'route',
  'routes',
  'screen',
  'screens',
  'service',
  'services',
  'shared',
  'state',
  'store',
  'style',
  'styles',
  'type',
  'types',
  'ui',
  'usecase',
  'use-cases',
  'usecases',
  'util',
  'utils',
  'view',
  'views',
  'widget',
  'widgets',
]);

/** Finds the earliest source-root marker, preferring a longer marker at the same position. */
function findSourceRoot(segments: string[]): SourceRootMatch | null {
  let best: SourceRootMatch | null = null;
  for (let i = 0; i < segments.length; i += 1) {
    for (const marker of SOURCE_ROOT_MARKERS) {
      if (i + marker.length > segments.length) continue;
      if (!marker.every((part, offset) => segments[i + offset] === part)) continue;
      if (!best || i < best.start || (i === best.start && marker.length > best.length)) {
        best = { start: i, length: marker.length };
      }
    }
  }
  return best;
}

function rootPatternFrom(segments: string[], match: SourceRootMatch): string {
  const marker = segments.slice(match.start, match.start + match.length).join('/') || 'src';
  const prefix = segments.slice(0, match.start);
  if (prefix.length === 0) return marker;

  const first = prefix[0] ?? '';
  if (WORKSPACE_CONTAINERS.has(first.toLowerCase()) && prefix.length >= 2) {
    return [first, ...prefix.slice(1).map(() => '*'), marker].join('/');
  }
  return [...prefix, marker].join('/');
}

function inferSourceRoots(files: FileEntry[]): string[] {
  const roots = new Set<string>();
  for (const file of files) {
    const segments = toSegments(file.relPath);
    const match = findSourceRoot(segments);
    if (!match) continue;
    roots.add(rootPatternFrom(segments, match));
  }
  return roots.size > 0 ? [...roots].sort((a, b) => a.localeCompare(b)) : [''];
}

function sourceRootSegmentsCount(segments: string[]): number {
  const match = findSourceRoot(segments);
  return match ? match.start + match.length : 0;
}

function findFeature(
  segments: string[],
  containers: Set<string>,
): FeatureLocation | null {
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] ?? '';
    if (!containers.has(segment.toLowerCase())) continue;

    const feature = segments[i + 1] ?? '';
    if (feature.length === 0) continue;
    // `src/features/auth.ts` is a file in the container, not a feature directory.
    if (i + 1 === segments.length - 1 && feature.includes('.')) continue;

    return {
      root: segments.slice(0, i).join('/'),
      feature,
      subPath: segments.slice(i + 2).join('/'),
    };
  }
  return null;
}

function inferLayout(files: FileEntry[], containers: Set<string>): ProjectLayout {
  let featureFiles = 0;
  let layerFiles = 0;
  const features = new Set<string>();
  const layers = new Set<string>();

  for (const file of files) {
    const segments = toSegments(file.relPath);
    if (segments.length === 0) continue;

    const feature = findFeature(segments, containers);
    if (feature) {
      featureFiles += 1;
      features.add(feature.feature.toLowerCase());
      continue;
    }

    const rootCount = sourceRootSegmentsCount(segments);
    if (segments.length <= rootCount + 1) continue;
    const bucket = segments[rootCount] ?? '';
    if (!LAYER_NAMES.has(bucket.toLowerCase())) continue;
    layerFiles += 1;
    layers.add(bucket.toLowerCase());
  }

  const featureScore = featureFiles + features.size * 2;
  const layerScore = layerFiles + layers.size * 2;
  if (featureScore === 0 && layerScore === 0) return 'unknown';
  return featureScore >= layerScore ? 'feature-first' : 'layer-first';
}

function inferLargestFlatDir(files: FileEntry[]): FlatDirMetric | null {
  const counts = new Map<string, number>();
  for (const file of files) {
    const dir = directoryOf(normalizeRelPath(file.relPath));
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  let best: FlatDirMetric | null = null;
  for (const [dir, count] of counts) {
    if (!best || count > best.count || (count === best.count && dir.localeCompare(best.dir) < 0)) {
      best = { dir, count };
    }
  }
  return best;
}

const shapeCache = new WeakMap<DetectorContext, ProjectShape>();

/**
 * Infers the project's structural shape from the already-collected context.
 * Results are memoised per context object; no disk reads are performed.
 */
function inferShape(ctx: DetectorContext): ProjectShape {
  const cached = shapeCache.get(ctx);
  if (cached) return cached;

  const { packages, names } = manifestInfo(ctx);
  const archetype = inferArchetype(ctx.files, packages.length, names);
  const sourceRoots = inferSourceRoots(ctx.files);

  const configuredContainers = ctx.config?.structure?.featureContainers;
  const candidates = Array.isArray(configuredContainers) && configuredContainers.length > 0
    ? configuredContainers
    : DEFAULT_FEATURE_CONTAINERS;
  const featureContainers: string[] = [];
  const seenContainers = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const name = candidate.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seenContainers.has(key)) continue;
    seenContainers.add(key);
    featureContainers.push(name);
  }

  const layout = inferLayout(ctx.files, seenContainers);
  const shape: ProjectShape = {
    packages,
    sourceRoots,
    archetype,
    layout,
    featureContainers,
    largestFlatDir: inferLargestFlatDir(ctx.files),
    featureOf(relPath: string): FeatureLocation | null {
      return findFeature(toSegments(relPath), seenContainers);
    },
    bucketOf(relPath: string): BucketLocation | null {
      const segments = toSegments(relPath);
      const rootCount = sourceRootSegmentsCount(segments);
      if (segments.length <= rootCount + 1) return null;
      return {
        root: segments.slice(0, rootCount).join('/'),
        bucket: segments[rootCount] ?? '',
      };
    },
  };

  shapeCache.set(ctx, shape);
  return shape;
}

export default inferShape;
