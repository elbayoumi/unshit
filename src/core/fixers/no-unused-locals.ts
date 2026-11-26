import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const cache = new Map<string, boolean>();

function tsconfigValue(tsconfigPath: string, depth: number): boolean | undefined {
  if (depth > 4) return undefined;
  try {
    const raw = readFileSync(tsconfigPath, 'utf8');
    if (/"noUnusedLocals"\s*:\s*true\b/.test(raw)) return true;
    if (/"noUnusedLocals"\s*:\s*false\b/.test(raw)) return false;
    const ext = raw.match(/"extends"\s*:\s*"([^"]+)"/);
    if (!ext?.[1]) return undefined;
    const target = ext[1].endsWith('.json') ? ext[1] : `${ext[1]}.json`;
    const resolved = join(dirname(tsconfigPath), target);
    return existsSync(resolved) ? tsconfigValue(resolved, depth + 1) : undefined;
  } catch {
    return undefined;
  }
}

function checkDir(dir: string): boolean | undefined {
  const tsconfig = join(dir, 'tsconfig.json');
  return existsSync(tsconfig) ? tsconfigValue(tsconfig, 0) : undefined;
}

export function hasNoUnusedLocals(absPath: string): boolean {
  let dir = dirname(absPath);
  const seen: string[] = [];
  while (true) {
    const cached = cache.get(dir);
    if (cached !== undefined) {
      for (const d of seen) cache.set(d, cached);
      return cached;
    }
    seen.push(dir);
    const val = checkDir(dir);
    if (val === true) {
      for (const d of seen) cache.set(d, true);
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of seen) cache.set(d, false);
  return false;
}
