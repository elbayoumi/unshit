import path from 'node:path';
import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../contracts.js';

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ImportEdge {
  from: string;
  to: string;
  source: string;
  target: string;
}

export type ImportGraph = Map<string, string[]> & {
  nodes: string[];
  files: string[];
  vertices: string[];
  edges: ImportEdge[];
  links: ImportEdge[];
  adjacency: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  imports: Record<string, string[]>;
  dependencies: Record<string, string[]>;
  dependents: Record<string, string[]>;
  get(file: string): string[];
  has(file: string): boolean;
  incomingOf(file: string): string[];
  outgoingOf(file: string): string[];
};

const cache = new WeakMap<DetectorContext, ImportGraph>();
const filesCache = new Map<FileEntry[], ImportGraph>();

const COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  module: ts.ModuleKind.NodeNext,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  resolveJsonModule: true,
};

function toRel(rootDir: string, absPath: string): string | null {
  const rel = path.relative(rootDir, absPath).replaceAll('\\', '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

function tryResolveTs(spec: string, containingAbs: string, rootDir: string, absToRel: Map<string, string>): string | null {
  if (typeof spec !== 'string' || spec.trim() === '') return null;
  try {
    const resolved = ts.resolveModuleName(spec, containingAbs, COMPILER_OPTIONS, ts.sys);
    const rf = resolved.resolvedModule?.resolvedFileName;
    if (!rf) return null;
    const resolvedAbs = path.resolve(rf);
    const direct = absToRel.get(resolvedAbs);
    if (direct) return direct;
    const rel = toRel(rootDir, resolvedAbs);
    if (rel && !absToRel.has(path.resolve(rootDir, rel))) {
      // allow if present in file set by relative path
    }
    // Check against file set via rel path membership is handled by caller; here just return rel if plausible.
    return rel;
  } catch {
    return null;
  }
}

function normalizeRel(p: string): string {
  return p.replaceAll('\\', '/');
}

function tryPyPath(rootDir: string, base: string, fileSet: Set<string>): string | null {
  const candidates = [`${base}.py`, `${base}/__init__.py`, base];
  for (const c of candidates) {
    const norm = normalizeRel(c);
    if (fileSet.has(norm)) return norm;
  }
  return null;
}

function resolvePyModule(
  fromRel: string,
  mod: string,
  level: number,
  rootDir: string,
  fileSet: Set<string>,
): string | null {
  const fromDir = path.posix.dirname(fromRel);
  if (level > 0) {
    let base = fromDir;
    for (let i = 1; i < level; i++) {
      base = path.posix.dirname(base);
    }
    const parts = mod ? mod.split('.').filter(Boolean) : [];
    const joined = parts.length ? path.posix.join(base, ...parts) : base;
    return tryPyPath(rootDir, joined, fileSet);
  }
  const parts = mod.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  // Try root-level and same-directory resolution.
  const rootCandidate = tryPyPath(rootDir, path.posix.join(...parts), fileSet);
  if (rootCandidate) return rootCandidate;
  const localCandidate = tryPyPath(rootDir, path.posix.join(fromDir, ...parts), fileSet);
  if (localCandidate) return localCandidate;
  return null;
}

function parsePythonImports(file: FileEntry, fileSet: Set<string>): string[] {
  const targets: string[] = [];
  const lines = file.content.split(/\r?\n/);
  let skipIndent: number | null = null;

  const resolve = (mod: string, level: number, importedNames: string[] = []): void => {
    const r = resolvePyModule(file.relPath, mod, level, '', fileSet);
    if (r && r !== file.relPath) targets.push(r);
    // Handle submodule imports like "from . import b"
    if (!mod && level > 0 && importedNames.length) {
      const fromDir = path.posix.dirname(file.relPath);
      let base = fromDir;
      for (let i = 1; i < level; i++) base = path.posix.dirname(base);
      for (const name of importedNames) {
        const clean = name.split(/\s+as\s+/)[0].trim();
        if (!clean || clean === '*') continue;
        const sub = tryPyPath('', path.posix.join(base, clean), fileSet);
        if (sub && sub !== file.relPath) targets.push(sub);
      }
    }
    // Handle absolute/relative submodule imports: from pkg import sub
    if (mod && importedNames.length) {
      const r2 = resolvePyModule(file.relPath, mod, level, '', fileSet);
      if (r2) {
        // if r2 is a package, try submodule for each imported name
        for (const name of importedNames) {
          const clean = name.split(/\s+as\s+/)[0].trim();
          if (!clean || clean === '*') continue;
          const base = r2.replace(/\.py$/, '').replace(/\/__init__\.py$/, '');
          const sub = tryPyPath('', path.posix.join(base, clean), fileSet) || tryPyPath('', path.posix.join(base, clean, '__init__'), fileSet);
          // tryPyPath expects base path; adjust
          const cand1 = path.posix.join(base, clean + '.py');
          const cand2 = path.posix.join(base, clean, '__init__.py');
          if (fileSet.has(cand1) && cand1 !== file.relPath) targets.push(cand1);
          if (fileSet.has(cand2) && cand2 !== file.relPath) targets.push(cand2);
        }
      }
    }
  };

  const processImportLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === '') return;

    // from .x import y  /  from ..x import y  (also from . import y)
    let m = trimmed.match(/^from\s+(\.+)([^\s]*)\s+import\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const mod = m[2].trim().replace(/^\.+/ , '');
      const names = m[3].split(',').map((s) => s.trim()).filter(Boolean);
      resolve(mod, level, names);
      return;
    }

    // from module import y
    m = trimmed.match(/^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/);
    if (m) {
      const mod = m[1];
      if (mod === '__future__') return;
      const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      resolve(mod, 0, names);
      return;
    }

    // import a, b  /  import a.b
    m = trimmed.match(/^import\s+(.+)$/);
    if (m) {
      const mods = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
      for (const mod of mods) {
        if (!mod) continue;
        if (mod.startsWith('.')) {
          const dots = mod.match(/^\.+/)?.[0].length ?? 0;
          const rest = mod.slice(dots);
          resolve(rest, dots || 1, []);
        } else {
          resolve(mod, 0, []);
        }
      }
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (skipIndent !== null) {
      if (trimmed === '') continue;
      if (indent > skipIndent) continue;
      skipIndent = null;
    }

    if (/^if\s+(?:[\w.]+\.)?TYPE_CHECKING\s*:/.test(trimmed)) {
      skipIndent = indent;
      continue;
    }

    processImportLine(line);
  }

  return targets;
}

function computeGraph(ctx: DetectorContext): ImportGraph {
  const rootDir = ctx.rootDir;
  const filesSorted = [...ctx.files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const absToRel = new Map(ctx.files.map((f) => [path.resolve(f.absPath), f.relPath]));

  const outgoing = new Map<string, Set<string>>();
  for (const f of ctx.files) outgoing.set(f.relPath, new Set());

  // TS/JS edges
  for (const file of ctx.files) {
    if (!TS_EXTS.has(file.ext) || !file.sourceFile) continue;
    const sf = file.sourceFile;
    const specs: string[] = [];
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) {
        const clause = stmt.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const elems = clause.namedBindings.elements;
          if (elems.length > 0 && elems.every((e) => e.isTypeOnly)) continue;
        }
        const ms = stmt.moduleSpecifier;
        if (ms && ts.isStringLiteral(ms)) specs.push(ms.text);
      } else if (ts.isExportDeclaration(stmt)) {
        if (stmt.isTypeOnly) continue;
        const ms = stmt.moduleSpecifier;
        if (ms && ts.isStringLiteral(ms)) specs.push(ms.text);
      }
    }
    for (const spec of specs) {
      const resolved = tryResolveTs(spec, file.absPath, rootDir, absToRel);
      let target: string | null = resolved;
      if (target && !fileSet.has(target)) {
        // try relative fallback
        target = null;
      }
      if (!target) {
        // relative manual resolution fallback
        if (spec.startsWith('.')) {
          const baseDir = path.posix.dirname(file.relPath);
          const cand = path.posix.normalize(path.posix.join(baseDir, spec));
          // try extensions
          const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'];
          for (const ext of exts) {
            const c = normalizeRel(cand + ext);
            if (fileSet.has(c)) {
              target = c;
              break;
            }
          }
        }
      }
      if (target && fileSet.has(target)) {
        outgoing.get(file.relPath)!.add(target);
      }
    }
  }

  // Python edges
  for (const file of ctx.files) {
    if (file.ext !== '.py') continue;
    const targets = parsePythonImports(file, fileSet);
    for (const t of targets) {
      if (fileSet.has(t)) {
        outgoing.get(file.relPath)!.add(t);
      }
    }
  }

  const sortedNodes = [...outgoing.keys()].sort();
  const graph = new Map<string, string[]>() as ImportGraph;
  for (const node of sortedNodes) {
    graph.set(node, [...outgoing.get(node)!].sort());
  }

  const edges: ImportEdge[] = [];
  for (const from of sortedNodes) {
    for (const to of graph.get(from)!) {
      edges.push({ from, to, source: from, target: to });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const incoming = new Map<string, string[]>();
  for (const node of sortedNodes) incoming.set(node, []);
  for (const e of edges) {
    incoming.get(e.to)!.push(e.from);
  }
  for (const node of sortedNodes) {
    incoming.get(node)!.sort();
  }

  const importsRecord: Record<string, string[]> = {};
  const dependentsRecord: Record<string, string[]> = {};
  for (const node of sortedNodes) {
    importsRecord[node] = graph.get(node)!;
    dependentsRecord[node] = incoming.get(node)!;
  }

  const mapGet = graph.get.bind(graph);

  graph.nodes = sortedNodes;
  graph.files = sortedNodes;
  graph.vertices = sortedNodes;
  graph.edges = edges;
  graph.links = edges;
  graph.adjacency = new Map(graph);
  graph.outgoing = graph.adjacency;
  graph.incoming = incoming;
  graph.imports = importsRecord;
  graph.dependencies = importsRecord;
  graph.dependents = dependentsRecord;
  graph.get = (file: string): string[] => {
    const v = mapGet(file);
    return v ? [...v] : [];
  };
  graph.has = (file: string): boolean => sortedNodes.includes(file) || mapGet(file) !== undefined;
  graph.incomingOf = (file: string): string[] => [...(incoming.get(file) ?? [])];
  graph.outgoingOf = (file: string): string[] => {
    const v = mapGet(file);
    return v ? [...v] : [];
  };

  return graph;
}

export function buildImportGraph(ctx: DetectorContext): ImportGraph {
  const cached = cache.get(ctx);
  if (cached) return cached;
  // secondary cache by files array identity
  for (const [key, val] of filesCache.entries()) {
    if (key === ctx.files) {
      cache.set(ctx, val);
      return val;
    }
  }
  const graph = computeGraph(ctx);
  cache.set(ctx, graph);
  filesCache.set(ctx.files, graph);
  return graph;
}
