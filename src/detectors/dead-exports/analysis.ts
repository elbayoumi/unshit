import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../../contracts.js';
import { createTsSpecResolver } from '../../core/import-graph.js';
import { entryPointFileSet } from './entries.js';
import type { ExportDecl, ReexportInfo, Analysis, FileAnalysis, AnalysisState } from './handlers.js';
import { processStatementsFirstPass, walkDynamic, processNamespaceUsage, recordExports, consume } from './handlers.js';
import {
  FRAMEWORK_EXPORTS,
  TS_LIKE,
  IDENT_RE,
  ASSET_SPEC_RE,
  STAR,
  leftmost,
  isDeclarationName,
  posixJoin,
} from './utils.js';

const analysisCache = new WeakMap<DetectorContext, Analysis>();

function createState(ctx: DetectorContext): AnalysisState {
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  return {
    ctx,
    resolveFile: createTsSpecResolver(ctx),
    fileSet,
    entryPoints: entryPointFileSet(ctx, ctx.files),
    decls: [],
    consumed: new Map(),
    fuzzy: new Set(),
    reexports: new Map(),
    queue: [],
  };
}


function processFile(state: AnalysisState, file: FileEntry): void {
  if (state.entryPoints.has(file.relPath)) consume(state, file.relPath, STAR);
  if (!file.sourceFile) {
    if (/\.(vue|svelte|astro)$/.test(file.relPath)) {
      IDENT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IDENT_RE.exec(file.content)) !== null) state.fuzzy.add(m[0]);
    }
    return;
  }
  if (!TS_LIKE.has(file.ext)) return;
  const sf = file.sourceFile;
  const reexp: ReexportInfo = { named: [], stars: [] };
  state.reexports.set(file.relPath, reexp);
  const bindings = new Map<string, { target: string | null; internal: boolean; imported: string }>();
  const nsLocals = new Map<string, { target: string | null; internal: boolean }>();
  const topLevelKinds = new Map<string, boolean>();
  const nsMembers = new Map<string, { members: Set<string>; star: boolean }>();
  const fa: FileAnalysis = { state, file, sf, bindings, nsLocals, topLevelKinds, reexp, nsMembers };
  processStatementsFirstPass(fa);
  walkDynamic(fa);
  processNamespaceUsage(fa);
  recordExports(fa);
}

export function analyze(ctx: DetectorContext): Analysis {
  const cached = analysisCache.get(ctx);
  if (cached) return cached;
  const state = createState(ctx);
  for (const file of ctx.files) processFile(state, file);

  while (state.queue.length > 0) {
    const [file, name] = state.queue.pop()!;
    const info = state.reexports.get(file);
    if (!info) continue;
    for (const r of info.named) {
      if (name === STAR || r.exported === name) consume(state, r.target, r.orig);
    }
    for (const target of info.stars) {
      if (name === STAR) consume(state, target, STAR);
      else if (name !== 'default') consume(state, target, name);
    }
  }

  const analysis = { decls: state.decls, consumed: state.consumed, fuzzy: state.fuzzy };
  analysisCache.set(ctx, analysis);
  return analysis;
}