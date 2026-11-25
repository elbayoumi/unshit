import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import type { FileEntry, UnshitConfig } from './contracts.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const GENERATED_FILE_RE = /\.min\.(?:css|[cm]?js)$|\.bundle\.js$|\.(?:g|freezed|gr)\.dart$|_pb2(?:_grpc)?\.py$/i;
const READ_BATCH_SIZE = 32;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
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

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

interface IgnoreScope {
  baseDir: string;
  rules: IgnoreRule[];
}

function globSegmentToRegex(segment: string): string {
  let source = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else if (ch === '[') {
      const end = segment.indexOf(']', i + 1);
      if (end > i + 1) {
        let body = segment.slice(i + 1, end);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        source += `[${body.replace(/\\/g, '\\\\')}]`;
        i = end;
      } else {
        source += '\\[';
      }
    } else {
      source += ch.replace(REGEX_SPECIALS, '\\$&');
    }
  }
  return source;
}

/** Compiles one .gitignore line into a matcher relative to the file's directory. */
function compileIgnoreLine(line: string): IgnoreRule | null {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith('#')) return null;

  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!') || pattern.startsWith('\\#')) {
    pattern = pattern.slice(1);
  }
  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);

  const segments = pattern.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  let source = anchored ? '' : '(?:.*/)?';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment === '**') {
      source += i === segments.length - 1 ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    source += globSegmentToRegex(segment);
    if (i < segments.length - 1) source += '/';
  }
  return { regex: new RegExp(`^${source}$`), negated, directoryOnly };
}

function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const rule = compileIgnoreLine(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

/** Deeper .gitignore scopes override shallower ones; within a scope, the last rule wins. */
function isIgnored(fullPath: string, isDirectory: boolean, scopes: IgnoreScope[]): boolean {
  let ignored = false;
  for (const scope of scopes) {
    const rel = relative(scope.baseDir, fullPath).replaceAll('\\', '/');
    if (!rel || rel === '..' || rel.startsWith('../')) continue;
    for (const rule of scope.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.regex.test(rel)) ignored = !rule.negated;
    }
  }
  return ignored;
}

const VENDORED_DIR_RE = /(^|\/)static\/(lib|vendor)$/;

function isExcludedByConfig(rel: string, name: string, excludes: string[]): boolean {
  if (VENDORED_DIR_RE.test(rel)) return true;
  return excludes.some((exclude) => exclude.includes('/')
    ? rel === exclude || rel.startsWith(`${exclude}/`)
    : name === exclude);
}

interface WalkState {
  rootDir: string;
  config: UnshitConfig;
  includeSet: Set<string>;
  paths: string[];
  manifests: string[];
  ignoreScopes: IgnoreScope[];
}

async function visitEntry(entry: Dirent, dir: string, state: WalkState): Promise<void> {
  if (entry.name.startsWith('.') && entry.name !== '.agent') return;
  const fullPath = join(dir, entry.name);
  const rel = relative(state.rootDir, fullPath).replaceAll('\\', '/');
  if (isExcludedByConfig(rel, entry.name, state.config.exclude)) return;
  if (isIgnored(fullPath, entry.isDirectory(), state.ignoreScopes)) return;

  if (entry.isDirectory()) {
    await walkDirectory(fullPath, state);
  } else if (entry.isFile()) {
    if (GENERATED_FILE_RE.test(entry.name)) return;
    if (isManifest(entry.name)) state.manifests.push(rel);
    const ext = extname(entry.name).toLowerCase();
    if (state.includeSet.has(ext)) state.paths.push(fullPath);
  }
}

async function walkDirectory(dir: string, state: WalkState): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  const gitignore = entries.find((entry) => entry.name === '.gitignore' && entry.isFile());
  let scope: IgnoreScope | undefined;
  if (gitignore) {
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    scope = { baseDir: dir, rules: parseGitignore(content) };
    state.ignoreScopes.push(scope);
  }

  try {
    for (const entry of entries) {
      await visitEntry(entry, dir, state);
    }
  } finally {
    if (scope) state.ignoreScopes.pop();
  }
}

/**
 * Walks `rootDir` respecting `config.exclude`, `config.include`, and root/nested
 * `.gitignore` files, parsing TS/JS ASTs lazily.
 * Manifest paths are collected in the same readdir pass, independent of `config.include`.
 */
export async function collectWorkspace(
  rootDir: string,
  config: UnshitConfig,
): Promise<{ files: FileEntry[]; manifests: string[] }> {
  const state: WalkState = {
    rootDir,
    config,
    includeSet: new Set(config.include),
    paths: [],
    manifests: [],
    ignoreScopes: [],
  };

  await walkDirectory(rootDir, state);
  const { paths, manifests } = state;
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
async function collectFiles(rootDir: string, config: UnshitConfig): Promise<FileEntry[]> {
  const { files } = await collectWorkspace(rootDir, config);
  return files;
}
