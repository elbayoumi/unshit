import type { DetectorContext, FileEntry } from '../../contracts.js';
import type ts from 'typescript';

export interface ImportEdge {
  from: string;
  to: string;
  source: string;
  target: string;
  line?: number;
  spec?: string;
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
  stats: { internalSpecs: number; resolved: number; graphedFiles: number };
  /** Files with a resolved import of themselves; kept out of `edges` so reachability is unchanged. */
  selfLoops: string[];
  get(file: string): string[];
  has(file: string): boolean;
  incomingOf(file: string): string[];
  outgoingOf(file: string): string[];
};

export interface TsConfigInfo {
  configPath: string | null;
  options: ts.CompilerOptions;
  pathPatterns: string[];
}

export interface PubspecInfo {
  rootRel: string;
  name: string;
}

export interface ResolvedImport {
  spec: string;
  target: string | null;
  line: number;
  internal: boolean;
}

export interface PythonParseState {
  results: ResolvedImport[];
  skipIndent: number | null;
  file: FileEntry;
  fileSet: Set<string>;
  roots: string[];
}

export interface RustParseState {
  results: ResolvedImport[];
  lines: string[];
  fileSet: Set<string>;
  crateRoot: string;
  childDir: string;
  containingDir: string;
}

export interface RustUseStatement {
  statement: string;
  endLine: number;
}

export interface EdgeDetails {
  line?: number;
  spec?: string;
}

export interface GraphState {
  ctx: DetectorContext;
  rootDir: string;
  fileSet: Set<string>;
  absToRel: Map<string, string>;
  outgoing: Map<string, Set<string>>;
  selfTargets: Set<string>;
  edgeDetails: Map<string, EdgeDetails>;
  internalSpecs: number;
  resolved: number;
  tsconfigCache: Map<string, TsConfigInfo>;
  resolutionCaches: Map<string, ts.ModuleResolutionCache>;
  pubspecCache: Map<string, PubspecInfo | null>;
  packageNames: string[];
}

export interface TsSpecResolution {
  internal: boolean;
  target: string | null;
}