import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { DetectorContext, FileEntry } from '../contracts.js';

export type ProjectArchetype =
  | 'next-app'
  | 'vite-react'
  | 'node-lib'
  | 'flutter'
  | 'python'
  | 'rust'
  | 'monorepo'
  | 'unknown';

export type ProjectLayout = 'feature-first' | 'layer-first' | 'unknown';

export interface FeatureLocation {
  root: string;
  feature: string;
  subPath: string;
}

export interface BucketLocation {
  root: string;
  bucket: string;
}

export interface FlatDirMetric {
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

const NEXT_CONFIG_RE = /(^|\/)next\.config\.[cm]?[jt]s$/i;
const NEXT_ROUTE_RE =
  /(^|\/)app\/(layout|page|error|loading|template|default)\.[cm]?[jt]sx?$|(^|\/)pages\/(_app|_document|index)\.[cm]?[jt]sx?$/i;
const VITE_CONFIG_RE = /(^|\/)vite\.config\.[cm]?[jt]s$/i;
const REACT_IMPORT_RE = /\bfrom\s*['"]react['"]|\brequire\(\s*['"]react['"]\s*\)/;

function normalizeRelPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function toSegments(value: string): string[] {
  return normalizeRelPath(value).split('/').filter((segment) => segment.length > 0);
}

function basenameOf(normalized: string): string {
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function directoryOf(normalized: string): string {
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
}

const WORKSPACE_MANIFESTS = new Set(['package.json', 'pnpm-workspace.yaml', 'lerna.json']);

/** Collects manifest paths from the context without opening any files. */
function manifestPaths(ctx: DetectorContext): string[] {
  const paths = new Set<string>();
  const add = (raw: string): void => {
    if (typeof raw !== 'string' || raw.length === 0) return;

    let normalized = normalizeRelPath(raw);
    const windowsAbsolute = /^[A-Za-z]:\//.test(normalized);
    if (isAbsolute(raw) || windowsAbsolute) {
      const absolute = windowsAbsolute ? normalized.replace(/^[A-Za-z]:/, '') : raw;
      normalized = normalizeRelPath(relative(ctx.rootDir, absolute));
    }
    if (normalized.length === 0 || normalized.startsWith('../')) return;

    const segments = toSegments(normalized);
    if (segments.some((segment) => segment === 'node_modules')) return;
    paths.add(segments.join('/'));
  };

  for (const raw of ctx.manifests ?? []) add(raw);
  for (const file of ctx.files) {
    if (WORKSPACE_MANIFESTS.has(basenameOf(normalizeRelPath(file.relPath)).toLowerCase())) {
      add(file.relPath);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

/** Reads manifest content from already-loaded files, falling back to a read-only disk read. */
function manifestReader(ctx: DetectorContext): (relPath: string) => string | undefined {
  const loaded = new Map(ctx.files.map((file) => [normalizeRelPath(file.relPath), file.content]));
  return (relPath: string): string | undefined => {
    const content = loaded.get(relPath);
    if (content !== undefined) return content;
    try {
      return readFileSync(join(ctx.rootDir, ...toSegments(relPath)), 'utf8');
    } catch {
      return undefined;
    }
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function workspacePatterns(read: (relPath: string) => string | undefined, paths: string[]): string[] {
  const patterns = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string') {
      const pattern = value.trim();
      if (pattern) patterns.add(pattern);
    } else if (Array.isArray(value)) {
      for (const item of value) add(item);
    } else if (value !== null && typeof value === 'object') {
      add((value as Record<string, unknown>).packages);
    }
  };

  for (const relPath of paths) {
    const base = basenameOf(relPath).toLowerCase();
    if (!WORKSPACE_MANIFESTS.has(base)) continue;
    const text = read(relPath);
    if (!text) continue;

    if (base === 'pnpm-workspace.yaml') {
      let inPackages = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^packages\s*:/.test(line)) {
          inPackages = true;
          continue;
        }
        if (/^\S/.test(line)) {
          inPackages = false;
          continue;
        }
        if (!inPackages) continue;
        const item = /^\s*-\s*(.+?)\s*$/.exec(line)?.[1];
        if (item) add(item.replace(/^['"]|['"]$/g, ''));
      }
      continue;
    }

    const json = parseJsonObject(text);
    if (json) add(json.workspaces ?? (base === 'lerna.json' ? json.packages : undefined));
  }
  return [...patterns];
}

function patternMatchesDir(pattern: string, dir: string): boolean {
  const value = normalizeRelPath(pattern).replace(/\/+$/, '');
  if (!value || value.startsWith('!')) return false;

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
  return new RegExp(`^${re}$`).test(dir);
}

/**
 * A package.json directory is a workspace package only when it names itself or is
 * covered by a workspace pattern from a root manifest. Marker files such as
 * `{ "type": "module" }` are not packages on their own.
 */
function manifestInfo(ctx: DetectorContext): { packages: string[]; names: Set<string> } {
  const read = manifestReader(ctx);
  const paths = manifestPaths(ctx);
  const patterns = workspacePatterns(read, paths);
  const packagePaths = new Map<string, string>();
  const names = new Set<string>();

  for (const relPath of paths) {
    const segments = toSegments(relPath);
    const name = segments[segments.length - 1] ?? '';
    names.add(name.toLowerCase());
    if (name.toLowerCase() !== 'package.json') continue;

    const dir = segments.slice(0, -1).join('/');
    if (dir.length > 0 && dir !== '.') packagePaths.set(dir, relPath);
  }

  const packages = [...packagePaths.entries()]
    .filter(([dir, relPath]) => {
      const text = read(relPath);
      if (!text) return false;
      const json = parseJsonObject(text);
      if (typeof json?.name === 'string' && json.name.trim().length > 0) return true;

      const excluded = patterns.some((pattern) =>
        pattern.startsWith('!') && patternMatchesDir(pattern.slice(1), dir));
      if (excluded) return false;
      return patterns.some((pattern) => patternMatchesDir(pattern, dir));
    })
    .map(([dir]) => dir)
    .sort((a, b) => a.localeCompare(b));

  return { packages, names };
}

function inferArchetype(
  files: FileEntry[],
  packageCount: number,
  manifestNames: Set<string>,
): ProjectArchetype {
  if (packageCount > 0) return 'monorepo';

  let webCount = 0;
  let dartCount = 0;
  let rustCount = 0;
  let pythonCount = 0;
  let nextSignals = 0;
  let viteSignals = 0;

  for (const file of files) {
    const normalized = normalizeRelPath(file.relPath);
    const lower = normalized.toLowerCase();
    const base = basenameOf(lower);
    const ext = file.ext.toLowerCase();

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
      webCount += 1;
      if (REACT_IMPORT_RE.test(file.content?.slice(0, 4000) ?? '')) viteSignals += 1;
    } else if (ext === '.dart') {
      dartCount += 1;
    } else if (ext === '.rs') {
      rustCount += 1;
    } else if (ext === '.py') {
      pythonCount += 1;
    }

    if (NEXT_CONFIG_RE.test(lower) || NEXT_ROUTE_RE.test(lower)) nextSignals += 1;
    if (
      VITE_CONFIG_RE.test(lower)
      || base === 'main.tsx'
      || base === 'app.tsx'
      || base === 'index.html'
    ) {
      viteSignals += 1;
    }
  }

  const languageScores: { archetype: ProjectArchetype; score: number }[] = [
    {
      archetype: 'flutter',
      score: dartCount + (manifestNames.has('pubspec.yaml') ? 50 : 0),
    },
    { archetype: 'rust', score: rustCount + (manifestNames.has('cargo.toml') ? 50 : 0) },
    {
      archetype: 'python',
      score: pythonCount
        + (manifestNames.has('pyproject.toml') || manifestNames.has('requirements.txt') ? 50 : 0),
    },
  ];

  let bestArchetype: ProjectArchetype | null = null;
  let bestScore = 0;
  for (const candidate of languageScores) {
    if (candidate.score > bestScore) {
      bestScore = candidate.score;
      bestArchetype = candidate.archetype;
    }
  }
  if (bestArchetype && (webCount === 0 || bestScore >= webCount / 2)) return bestArchetype;

  if (nextSignals > 0) return 'next-app';
  if (viteSignals > 0) return 'vite-react';
  if (webCount > 0 || manifestNames.has('package.json')) return 'node-lib';
  return 'unknown';
}

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
export function inferShape(ctx: DetectorContext): ProjectShape {
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
