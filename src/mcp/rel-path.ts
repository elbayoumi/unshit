import { relative, resolve, sep } from 'node:path';

/** Turns a tool-supplied path into a root-relative POSIX path for lookups. */
export function mcpRelativePath(rootDir: string, raw: string): string {
  return relative(rootDir, resolve(rootDir, raw)).split(sep).join('/');
}
