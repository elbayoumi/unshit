import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import type { FileEntry, UnshitConfig } from './contracts.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const GENERATED_FILE_RE = /\.min\.(?:css|[cm]?js)$|\.bundle\.js$/i;
const READ_BATCH_SIZE = 32;
const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'Cargo.toml',
  'pubspec.yaml',
  'pyproject.toml',
  'angular.json',
]);

function isManifest(name: string): boolean {
  return MANIFEST_NAMES.has(name) || name.startsWith('next.config.');
}

function isCompiledBundle(content: string, lines: string[]): boolean {
  return /[/*]# sourceMappingURL=/.test(content.slice(-300))
    || (content.length > 20_000 && content.length / lines.length > 300);
}

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
 * Manifest paths are collected in the same readdir pass, independent of `config.include`.
 */
export async function collectWorkspace(
  rootDir: string,
  config: UnshitConfig,
): Promise<{ files: FileEntry[]; manifests: string[] }> {
  const excludes = config.exclude;
  const includeSet = new Set(config.include);
  const paths: string[] = [];
  const manifests: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.agent') continue;
      const fullPath = join(dir, entry.name);
      const rel = relative(rootDir, fullPath).replaceAll('\\', '/');
      if (excludes.some((e) => e.includes('/')
        ? rel === e || rel.startsWith(`${e}/`)
        : entry.name === e)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (GENERATED_FILE_RE.test(entry.name)) continue;
        if (isManifest(entry.name)) {
          manifests.push(relative(rootDir, fullPath).replaceAll('\\', '/'));
        }
        const ext = extname(entry.name).toLowerCase();
        if (includeSet.has(ext)) {
          paths.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  paths.sort();
  manifests.sort();

  const files: FileEntry[] = [];
  for (let start = 0; start < paths.length; start += READ_BATCH_SIZE) {
    const batch = paths.slice(start, start + READ_BATCH_SIZE);
    const batchFiles = await Promise.all(batch.map(async (absPath): Promise<FileEntry | null> => {
      const content = await readFile(absPath, 'utf8');
      const lines = content.split(/\r?\n/);
      if (isCompiledBundle(content, lines)) return null;
      const relPath = relative(rootDir, absPath).replaceAll('\\', '/');
      const ext = extname(absPath).toLowerCase();
      const sourceFile = TS_EXTS.has(ext)
        ? ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, getScriptKind(ext))
        : undefined;
      return { absPath, relPath, ext, content, lines, sourceFile };
    }));
    files.push(...batchFiles.filter((file): file is FileEntry => file !== null));
  }

  return { files, manifests };
}

/** Backward-compatible wrapper: returns only the parsed files. */
export async function collectFiles(rootDir: string, config: UnshitConfig): Promise<FileEntry[]> {
  const { files } = await collectWorkspace(rootDir, config);
  return files;
}
