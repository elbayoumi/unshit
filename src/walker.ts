import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import type { FileEntry, UnshitConfig } from './contracts.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function getScriptKind(ext: string): ts.ScriptKind {
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Walks `rootDir` respecting `config.exclude` and `config.include`, parsing TS/JS ASTs lazily.
 */
export async function collectFiles(rootDir: string, config: UnshitConfig): Promise<FileEntry[]> {
  const excludeSet = new Set(config.exclude);
  const includeSet = new Set(config.include);
  const paths: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.agent') continue;
      if (excludeSet.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (includeSet.has(ext)) {
          paths.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  paths.sort();

  const files: FileEntry[] = [];
  for (const absPath of paths) {
    const content = await readFile(absPath, 'utf8');
    const relPath = relative(rootDir, absPath).replaceAll('\\', '/');
    const ext = extname(absPath).toLowerCase();
    const lines = content.split(/\r?\n/);
    const sourceFile = TS_EXTS.has(ext)
      ? ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, getScriptKind(ext))
      : undefined;

    files.push({ absPath, relPath, ext, content, lines, sourceFile });
  }

  return files;
}
