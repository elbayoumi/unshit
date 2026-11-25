import path from 'node:path';
import type { FileEntry } from '../../contracts.js';
import type { ResolvedImport, PythonParseState } from './types.js';
import { normalizeRel } from './util.js';

// local tryPyPath defined here

function tryPyPath(base: string, fileSet: Set<string>): string | null {
  const norm = normalizeRel(base);
  for (const candidate of [`${norm}.py`, `${norm}/__init__.py`, norm]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/** Recognises src/<pkg> and lib/<pkg> layouts in addition to a flat package at the root. */
export function pythonPackageRoots(fileSet: Set<string>): string[] {
  const roots = new Set<string>(['']);
  for (const file of fileSet) {
    if (!file.endsWith('.py')) continue;
    const parts = file.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === 'src' || parts[i] === 'lib') {
        roots.add(parts.slice(0, i + 1).join('/'));
      }
    }
  }
  return [...roots].sort((a, b) => b.length - a.length);
}

function relativePyBase(fromRel: string, level: number, mod: string): string {
  let base = path.posix.dirname(fromRel);
  for (let i = 1; i < level; i++) base = path.posix.dirname(base);
  const parts = mod.split('.').filter(Boolean);
  return parts.length ? path.posix.join(base, ...parts) : base;
}

function resolvePyModule(
  fromRel: string,
  mod: string,
  level: number,
  roots: string[],
  fileSet: Set<string>,
): string | null {
  if (level > 0) return tryPyPath(relativePyBase(fromRel, level, mod), fileSet);
  const parts = mod.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  for (const root of roots) {
    const hit = tryPyPath(path.posix.join(root, ...parts), fileSet);
    if (hit) return hit;
  }
  return null;
}

function splitPyNames(raw: string): string[] {
  return raw
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter((name) => name !== '' && name !== '*');
}

function pyPackageBase(moduleFile: string): string {
  return moduleFile.replace(/\/__init__\.py$/, '').replace(/\.py$/, '');
}

function pushPyImport(
  state: PythonParseState,
  spec: string,
  target: string | null,
  line: number,
  internal: boolean,
): void {
  state.results.push({ spec, target, line, internal });
}

function parseRelativePyImport(state: PythonParseState, trimmed: string, line: number): boolean {
  const match = /^from\s+(\.+)([^\s]*)\s+import\s+(.+)$/.exec(trimmed);
  if (!match) return false;
  const level = match[1].length;
  const mod = (match[2] ?? '').replace(/^\.+/, '');
  const spec = '.'.repeat(level) + mod;
  const baseTarget = resolvePyModule(state.file.relPath, mod, level, state.roots, state.fileSet);
  const base = baseTarget ? pyPackageBase(baseTarget) : relativePyBase(state.file.relPath, level, mod);
  let resolvedNames = 0;
  for (const name of splitPyNames(match[3] ?? '')) {
    const hit = tryPyPath(path.posix.join(base, name), state.fileSet);
    if (hit) {
      pushPyImport(state, `${spec}.${name}`, hit, line, true);
      resolvedNames++;
    }
  }
  // `from . import sibling` depends on the sibling modules, not on the package __init__ itself.
  if (mod !== '' || resolvedNames === 0) {
    pushPyImport(state, spec, baseTarget, line, level > 0 || baseTarget !== null);
  }
  return true;
}

function parseFromPyImport(state: PythonParseState, trimmed: string, line: number): boolean {
  const match = /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(trimmed);
  if (!match) return false;
  const mod = match[1]!;
  if (mod === '__future__') return true;
  const baseTarget = resolvePyModule(state.file.relPath, mod, 0, state.roots, state.fileSet);
  pushPyImport(state, mod, baseTarget, line, baseTarget !== null);
  if (baseTarget) {
    const base = pyPackageBase(baseTarget);
    for (const name of splitPyNames(match[2] ?? '')) {
      const hit = tryPyPath(path.posix.join(base, name), state.fileSet);
      if (hit) pushPyImport(state, `${mod}.${name}`, hit, line, true);
    }
  }
  return true;
}

function parsePlainPyImport(state: PythonParseState, trimmed: string, line: number): void {
  const match = /^import\s+(.+)$/.exec(trimmed);
  if (!match) return;
  for (const rawMod of (match[1] ?? '').split(',')) {
    let mod = rawMod.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
    if (!mod) continue;
    let level = 0;
    if (mod.startsWith('.')) {
      level = mod.match(/^\.+/)?.[0].length ?? 1;
      mod = mod.slice(level);
    }
    const target = resolvePyModule(state.file.relPath, mod, level, state.roots, state.fileSet);
    pushPyImport(state, level ? '.'.repeat(level) + mod : mod, target, line, level > 0 || target !== null);
  }
}

function parsePythonLine(state: PythonParseState, raw: string, indent: number, line: number): void {
  const trimmed = raw.trim();
  if (state.skipIndent !== null) {
    if (trimmed === '' || indent > state.skipIndent) return;
    state.skipIndent = null;
  }
  if (/^if\s+(?:[\w.]+\.)?TYPE_CHECKING\s*:/.test(trimmed)) {
    state.skipIndent = indent;
    return;
  }
  if (parseRelativePyImport(state, trimmed, line)) return;
  if (parseFromPyImport(state, trimmed, line)) return;
  parsePlainPyImport(state, trimmed, line);
}

export function parsePythonImports(file: FileEntry, fileSet: Set<string>, roots: string[]): ResolvedImport[] {
  const state: PythonParseState = { results: [], skipIndent: null, file, fileSet, roots };
  for (let i = 0; i < file.lines.length; i++) {
    const raw = file.lines[i] ?? '';
    parsePythonLine(state, raw, raw.length - raw.trimStart().length, i + 1);
  }
  return state.results;
}