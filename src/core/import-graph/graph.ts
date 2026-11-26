import path from 'node:path';
import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import {
  ImportGraph, GraphState, EdgeDetails, TsConfigInfo, TsSpecResolution, PubspecInfo,
} from './types.js';
import {
  TS_EXTS, COMPONENT_EXTS, NON_GRAPHABLE_RE,
} from './constants.js';
import { normalizeRel, toRel } from './util.js';
import * as TSM from './ts.js';
import * as DartM from './dart.js';
import * as PythonM from './python.js';
import * as RustM from './rust.js';

const cache = new WeakMap<DetectorContext, ImportGraph>();
const filesCache = new WeakMap<FileEntry[], ImportGraph>();

function emitEdge(
  state: GraphState,
  from: string,
  spec: string,
  target: string | null,
  line: number | undefined,
  internal: boolean,
): void {
  if (!internal) return;
  state.internalSpecs++;
  if (!target || !state.fileSet.has(target)) return;
  state.resolved++;
  if (target === from) return;
  state.outgoing.get(from)!.add(target);
  const key = `${from}\u0000${target}`;
  if (!state.edgeDetails.has(key)) state.edgeDetails.set(key, { line, spec });
}

function processTsSource(
  state: GraphState,
  fromRel: string,
  containingAbs: string,
  sf: ts.SourceFile,
  lineOffset: number,
): void {
  const { rootDir, tsconfigCache, resolutionCaches, packageNames, fileSet, absToRel } = state;
  const info = TSM.loadTsConfigInfo(path.dirname(containingAbs), rootDir, tsconfigCache);
  const resolutionCache = TSM.getResolutionCache(info, rootDir, resolutionCaches);

  const emitSpec = (spec: string, line: number): void => {
    const clean = spec.split('?')[0] ?? spec;
    if (!clean) return;
    const isComponentSpec = COMPONENT_EXTS.has(path.posix.extname(clean).toLowerCase());
    if (NON_GRAPHABLE_RE.test(clean) && !isComponentSpec) return;
    if (!TSM.isInternalTsSpec(clean, info, rootDir, packageNames, fileSet)) return;
    let target = TSM.tryResolveTs(clean, containingAbs, info, resolutionCache, absToRel, fileSet, rootDir);
    if (!target || !fileSet.has(target)) {
      target = TSM.resolveRelativeTs(clean, fromRel, fileSet) ?? TSM.resolveAliasFallback(clean, fileSet);
    }
    // A component that is not a scanned file is an asset, not a broken import.
    if (isComponentSpec && !target) return;
    emitEdge(state, fromRel, clean, target, line, true);
  };

  TSM.collectTsJsEdges(sf, emitSpec, lineOffset);
}

function collectEdges(state: GraphState): void {
  const { ctx, rootDir, fileSet } = state;
  for (const file of ctx.files) {
    if (!TS_EXTS.has(file.ext) || !file.sourceFile || file.relPath.endsWith('.d.ts')) continue;
    processTsSource(state, file.relPath, file.absPath, file.sourceFile, 0);
  }
  for (const file of ctx.files) {
    if (!COMPONENT_EXTS.has(file.ext)) continue;
    for (const block of TSM.extractScriptBlocks(file)) {
      processTsSource(state, file.relPath, file.absPath, block.sourceFile, block.lineOffset);
    }
  }
  const rustRoots = RustM.rustCrateSrcRoots(ctx, fileSet);
  for (const file of ctx.files) {
    if (file.ext !== '.rs') continue;
    for (const imp of RustM.parseRustImports(file, fileSet, rustRoots)) {
      emitEdge(state, file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }
  for (const file of ctx.files) {
    if (file.ext !== '.dart') continue;
    const pubspec = DartM.loadPubspecInfo(path.dirname(file.absPath), rootDir, state.pubspecCache);
    for (const imp of DartM.parseDartImports(file, pubspec, fileSet)) {
      emitEdge(state, file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }
  const pyRoots = PythonM.pythonPackageRoots(fileSet);
  for (const file of ctx.files) {
    if (file.ext !== '.py') continue;
    for (const imp of PythonM.parsePythonImports(file, fileSet, pyRoots)) {
      emitEdge(state, file.relPath, imp.spec, imp.target, imp.line, imp.internal);
    }
  }
}

function finalizeGraph(state: GraphState, sortedNodes: string[]): ImportGraph {
  const graph = new Map<string, string[]>() as ImportGraph;
  for (const node of sortedNodes) {
    graph.set(node, [...state.outgoing.get(node)!].sort());
  }

  const edges: ImportGraph['edges'] = [];
  for (const from of sortedNodes) {
    for (const to of graph.get(from)!) {
      const details = state.edgeDetails.get(`${from}\u0000${to}`);
      edges.push({
        from,
        to,
        source: from,
        target: to,
        ...(details?.line !== undefined ? { line: details.line } : {}),
        ...(details?.spec !== undefined ? { spec: details.spec } : {}),
      });
    }
  }
  edges.sort((a, b) =>
    a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || (a.line ?? 0) - (b.line ?? 0));

  const incoming = new Map<string, string[]>();
  for (const node of sortedNodes) incoming.set(node, []);
  for (const edge of edges) {
    incoming.get(edge.to)!.push(edge.from);
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
  graph.stats = { internalSpecs: state.internalSpecs, resolved: state.resolved, graphedFiles: sortedNodes.length };
  graph.get = (file: string): string[] => {
    const value = mapGet(file);
    return value ? [...value] : [];
  };
  graph.has = (file: string): boolean => mapGet(file) !== undefined;
  graph.incomingOf = (file: string): string[] => [...(incoming.get(file) ?? [])];
  graph.outgoingOf = (file: string): string[] => {
    const value = mapGet(file);
    return value ? [...value] : [];
  };
  return graph;
}

function computeGraph(ctx: DetectorContext): ImportGraph {
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const outgoing = new Map<string, Set<string>>();
  for (const file of ctx.files) outgoing.set(file.relPath, new Set());

  const state: GraphState = {
    ctx,
    rootDir: ctx.rootDir,
    fileSet,
    absToRel: new Map(ctx.files.map((f) => [path.resolve(f.absPath), f.relPath])),
    outgoing,
    edgeDetails: new Map<string, EdgeDetails>(),
    internalSpecs: 0,
    resolved: 0,
    tsconfigCache: new Map<string, TsConfigInfo>(),
    resolutionCaches: new Map<string, ts.ModuleResolutionCache>(),
    pubspecCache: new Map<string, PubspecInfo | null>(),
    packageNames: TSM.loadPackageNames(ctx, ctx.rootDir),
  };

  collectEdges(state);
  const sortedNodes = [...ctx.files]
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
    .map((file) => file.relPath);
  return finalizeGraph(state, sortedNodes);
}

export function buildImportGraph(ctx: DetectorContext): ImportGraph {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const filesCached = filesCache.get(ctx.files);
  if (filesCached) {
    cache.set(ctx, filesCached);
    return filesCached;
  }
  const graph = computeGraph(ctx);
  cache.set(ctx, graph);
  filesCache.set(ctx.files, graph);
  return graph;
}

export function createTsSpecResolver(ctx: DetectorContext): (spec: string, from: FileEntry) => TsSpecResolution {
  const rootDir = ctx.rootDir;
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const absToRel = new Map(ctx.files.map((f) => [path.resolve(f.absPath), f.relPath]));
  const tsconfigCache = new Map<string, TsConfigInfo>();
  const resolutionCaches = new Map<string, ts.ModuleResolutionCache>();
  const packageNames = TSM.loadPackageNames(ctx, rootDir);

  return (rawSpec, from) => {
    const clean = rawSpec.split('?')[0] ?? rawSpec;
    if (!clean) return { internal: false, target: null };
    const info = TSM.loadTsConfigInfo(path.dirname(from.absPath), rootDir, tsconfigCache);
    if (!TSM.isInternalTsSpec(clean, info, rootDir, packageNames, fileSet)) return { internal: false, target: null };
    const resolutionCache = TSM.getResolutionCache(info, rootDir, resolutionCaches);
    let target = TSM.tryResolveTs(clean, from.absPath, info, resolutionCache, absToRel, fileSet, rootDir);
    if (!target || !fileSet.has(target)) {
      target = TSM.resolveRelativeTs(clean, from.relPath, fileSet) ?? TSM.resolveAliasFallback(clean, fileSet);
    }
    return { internal: true, target: target && fileSet.has(target) ? target : null };
  };
}