import path from 'node:path';
import ts from 'typescript';
import type { FileEntry } from '../../contracts.js';
import { TS_LIKE } from './shared.js';

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
};

function tryLoadTsconfig(rootDir: string, scannedFiles: FileEntry[]): ts.Program | null {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
    ?? ts.findConfigFile(rootDir, ts.sys.fileExists, 'jsconfig.json');
  if (!configPath) return null;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return null;
  const host: ts.ParseConfigHost = { ...ts.sys, readDirectory: ts.sys.readDirectory };
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, host, path.dirname(configPath), undefined, configPath);
  const rootNames = parsed.fileNames.length > 0
    ? parsed.fileNames
    : scannedFiles.filter((f) => TS_LIKE.has(f.ext)).map((f) => f.absPath);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, allowJs: true };
  try {
    return ts.createProgram({ rootNames, options, projectReferences: parsed.projectReferences });
  } catch {
    return null;
  }
}

export function loadProgram(rootDir: string, scannedFiles: FileEntry[]): ts.Program | null {
  const fromConfig = tryLoadTsconfig(rootDir, scannedFiles);
  if (fromConfig) return fromConfig;
  const rootNames = scannedFiles.filter((f) => TS_LIKE.has(f.ext)).map((f) => f.absPath);
  if (rootNames.length === 0) return null;
  try {
    return ts.createProgram({ rootNames, options: DEFAULT_COMPILER_OPTIONS });
  } catch {
    return null;
  }
}
