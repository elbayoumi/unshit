import path from 'node:path';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import type { ResolvedImport, RustParseState, RustUseStatement } from './types.js';
import {
  RUST_SUFFIXES, RUST_USE_PREFIXES, RUST_MOD_RE, RUST_USE_RE,
} from './constants.js';
import { normalizeRel } from './util.js';

function tryRustPath(base: string, fileSet: Set<string>): string | null {
  const norm = normalizeRel(path.posix.normalize(base));
  for (const suffix of RUST_SUFFIXES) {
    const candidate = suffix === '' ? norm : norm + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function resolveRustPathParts(baseDir: string, parts: string[], fileSet: Set<string>): string | null {
  for (let len = parts.length; len > 0; len--) {
    const hit = tryRustPath(path.posix.join(baseDir, ...parts.slice(0, len)), fileSet);
    if (hit) return hit;
  }
  return null;
}

/** Directory holding a module's child modules (`src/foo.rs` owns `src/foo/`). */
function rustChildModuleDir(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  const stem = path.posix.basename(relPath, '.rs');
  if (stem === 'mod' || stem === 'lib' || stem === 'main') return dir;
  return path.posix.join(dir, stem);
}

export function rustCrateSrcRoots(ctx: DetectorContext, fileSet: Set<string>): string[] {
  const roots = new Set<string>();
  for (const manifest of ctx.manifests ?? []) {
    const norm = normalizeRel(manifest);
    if (!/(^|\/)Cargo\.toml$/.test(norm)) continue;
    const dir = path.posix.dirname(norm);
    roots.add(dir === '.' ? 'src' : path.posix.join(dir, 'src'));
  }
  if (!roots.has('src') && [...fileSet].some((file) => file.startsWith('src/'))) roots.add('src');
  return [...roots].sort((a, b) => b.length - a.length);
}

function nearestRustCrateRoot(relPath: string, roots: string[]): string {
  for (const root of roots) {
    if (relPath === root || relPath.startsWith(`${root}/`)) return root;
  }
  return roots.find((root) => root === 'src') ?? 'src';
}

function splitRustUseList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '(' || char === '[') depth++;
    else if (char === '}' || char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Expands `crate::{a, b::c}` into individual module paths. */
function expandRustUseTree(text: string): string[] {
  const trimmed = text.trim().replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
  const grouped = /^([^{}]*)\{([\s\S]*)\}$/.exec(trimmed);
  if (!grouped) return trimmed ? [trimmed] : [];
  const prefix = (grouped[1] ?? '').replace(/::\s*$/, '').trim();
  const expanded: string[] = [];
  for (const part of splitRustUseList(grouped[2] ?? '')) {
    const item = part.trim().replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
    if (!item || item === '*') continue;
    const combined = !prefix ? item : item === 'self' ? prefix : `${prefix}::${item}`;
    expanded.push(...expandRustUseTree(combined));
  }
  return expanded;
}

function parseRustModLine(state: RustParseState, trimmed: string, line: number): boolean {
  const modMatch = RUST_MOD_RE.exec(trimmed);
  if (!modMatch) return false;
  const name = modMatch[1]!;
  const target = tryRustPath(path.posix.join(state.childDir, name), state.fileSet)
    ?? tryRustPath(path.posix.join(state.containingDir, name), state.fileSet)
    ?? tryRustPath(path.posix.join(state.crateRoot, name), state.fileSet);
  state.results.push({ spec: `mod ${name}`, target, line, internal: true });
  return true;
}

function readRustUseStatement(lines: string[], index: number): RustUseStatement | null {
  const useMatch = RUST_USE_RE.exec((lines[index] ?? '').trim());
  if (!useMatch) return null;
  let body = useMatch[1] ?? '';
  let endLine = index;
  while (!body.includes(';') && endLine + 1 < lines.length) {
    endLine += 1;
    body += ` ${lines[endLine]?.trim() ?? ''}`;
  }
  const semi = body.indexOf(';');
  return { statement: (semi === -1 ? body : body.slice(0, semi)).trim(), endLine };
}

/** Resolves the crate/super/self prefix of a `use` statement. */
function rustUsePrefix(
  parts: string[],
  crateRoot: string,
  childDir: string,
): { baseDir: string; prefixLen: number } | null {
  const first = parts[0];
  if (!first || !RUST_USE_PREFIXES.has(first)) return null;
  let baseDir = first === 'crate' ? crateRoot : childDir;
  let prefixLen = first === 'crate' ? 1 : 0;
  while (parts[prefixLen] === 'super' || parts[prefixLen] === 'self') {
    if (parts[prefixLen] === 'super') baseDir = path.posix.dirname(baseDir);
    prefixLen += 1;
  }
  return { baseDir, prefixLen };
}

function parseRustUseLine(
  state: RustParseState,
  statement: string,
  line: number,
): void {
  const parts = statement.split('::').map((part) => part.trim()).filter(Boolean);
  const prefix = rustUsePrefix(parts, state.crateRoot, state.childDir);
  if (!prefix) return;
  const rest = expandRustUseTree(parts.slice(prefix.prefixLen).join('::'));
  for (const expanded of rest) {
    const moduleParts = expanded.split('::').map((part) => part.trim()).filter(Boolean);
    if (moduleParts.length === 0) continue;
    const target = resolveRustPathParts(prefix.baseDir, moduleParts, state.fileSet);
    state.results.push({ spec: statement, target, line, internal: true });
  }
}

export function parseRustImports(
  file: FileEntry,
  fileSet: Set<string>,
  crateRoots: string[],
): ResolvedImport[] {
  const state: RustParseState = {
    results: [],
    lines: file.lines,
    fileSet,
    crateRoot: nearestRustCrateRoot(file.relPath, crateRoots),
    childDir: rustChildModuleDir(file.relPath),
    containingDir: path.posix.dirname(file.relPath),
  };

  for (let i = 0; i < state.lines.length; i++) {
    const trimmed = (state.lines[i] ?? '').trim();
    if (parseRustModLine(state, trimmed, i + 1)) continue;
    const use = readRustUseStatement(state.lines, i);
    if (!use) continue;
    parseRustUseLine(state, use.statement, i + 1);
    i = use.endLine;
  }
  return state.results;
}