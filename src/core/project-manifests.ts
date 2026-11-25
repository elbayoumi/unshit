import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { DetectorContext } from '../contracts.js';
import { basenameOf, normalizeRelPath, toSegments } from './project-paths.js';

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

function addWorkspacePattern(patterns: Set<string>, value: unknown): void {
  if (typeof value === 'string') {
    const pattern = value.trim();
    if (pattern) patterns.add(pattern);
  } else if (Array.isArray(value)) {
    for (const item of value) addWorkspacePattern(patterns, item);
  } else if (value !== null && typeof value === 'object') {
    addWorkspacePattern(patterns, (value as Record<string, unknown>).packages);
  }
}

function parsePnpmWorkspacePackages(text: string, add: (value: unknown) => void): void {
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
}

function workspacePatterns(read: (relPath: string) => string | undefined, paths: string[]): string[] {
  const patterns = new Set<string>();
  const add = (value: unknown): void => addWorkspacePattern(patterns, value);

  for (const relPath of paths) {
    const base = basenameOf(relPath).toLowerCase();
    if (!WORKSPACE_MANIFESTS.has(base)) continue;
    const text = read(relPath);
    if (!text) continue;

    if (base === 'pnpm-workspace.yaml') {
      parsePnpmWorkspacePackages(text, add);
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
export function manifestInfo(ctx: DetectorContext): { packages: string[]; names: Set<string> } {
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
