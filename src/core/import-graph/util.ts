import path from 'node:path';
import ts from 'typescript';
import { JS_EXTS } from './constants.js';

export function normalizeRel(p: string): string {
  return p.replaceAll('\\', '/');
}

export function toRel(rootDir: string, absPath: string): string | null {
  const rel = path.relative(rootDir, absPath).replaceAll('\\', '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

/** Finds the nearest config file at or above `startDir`, stopping at `rootDir`. */
export function findNearestConfigFile(startDir: string, rootDir: string, filename: string): string | null {
  let current = path.resolve(startDir);
  const boundary = path.resolve(rootDir);
  for (;;) {
    const candidate = path.join(current, filename);
    if (ts.sys.fileExists(candidate)) return candidate;
    if (current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function resolveFromBase(
  baseRel: string,
  target: string,
  fileSet: Set<string>,
  suffixes: string[],
): string | null {
  const cand = normalizeRel(path.posix.normalize(path.posix.join(baseRel, target)));
  for (const suffix of suffixes) {
    const candidate = cand + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  const ext = path.posix.extname(cand);
  if (JS_EXTS.has(ext)) {
    const stem = cand.slice(0, -ext.length);
    for (const suffix of suffixes) {
      const candidate = stem + suffix;
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}