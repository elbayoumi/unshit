import type ts from 'typescript';

export type Severity = 'error' | 'warn' | 'info';
export type DetectorTier = 'structural' | 'heuristic';
export type Fixability = 'safe' | 'unsafe' | 'ai' | 'manual';
export type Category = 'css' | 'types' | 'i18n' | 'architecture' | 'slop' | 'duplication' | 'dead-code';

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface Span {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface Finding {
  ruleId: string;
  category: Category;
  tier: DetectorTier;
  severity: Severity;
  fixability: Fixability;
  confidence: number;
  file: string;
  span: Span;
  message: string;
  evidence: string;
}

export interface TextEdit {
  startOffset: number;
  endOffset: number;
  replacement: string;
}

export interface Patch {
  file: string;
  ruleId: string;
  description: string;
  edits: TextEdit[];
}

export interface FileEntry {
  absPath: string;
  relPath: string;
  ext: string;
  content: string;
  lines: string[];
  sourceFile?: ts.SourceFile;
}

export interface UnshitConfig {
  include: string[];
  exclude: string[];
  disabledRules: string[];
  godFileMaxLines: number;
  godFileMaxHooks: number;
  cloneMinTokens: number;
  aiRunner: 'opencode' | 'claude';
  aiModel?: string;
  verifyCommand?: string;
}

export interface DetectorContext {
  rootDir: string;
  config: UnshitConfig;
  files: FileEntry[];
}

export interface Detector {
  id: string;
  category: Category;
  tier: DetectorTier;
  severity: Severity;
  description: string;
  scope?: 'file' | 'project';
  detect(ctx: DetectorContext): Finding[];
  fix?(file: FileEntry, finding: Finding): Patch | null;
}

export interface ScoreBreakdown {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  totalFiles: number;
  totalLines: number;
  totalFindings: number;
  byCategory: Record<Category, number>;
  bySeverity: Record<Severity, number>;
}

export interface BaselineSnapshot {
  version: 1;
  createdAt: string;
  rootDir: string;
  score: ScoreBreakdown;
  fingerprints: string[];
  fileHashes: Record<string, string>;
}
