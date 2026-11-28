import path from 'node:path';
import ts from 'typescript';
import type { FileEntry, Finding, UnshitConfig } from '../../contracts.js';
import { collectExportInfos, FRAMEWORK_EXPORTS } from './exports.js';
import { loadProgram } from './program.js';
import { TS_LIKE, posixRel, type DeepResult, type ExportInfo } from './shared.js';
import { collectUsage } from './usage.js';

function identifierCount(content: string, name: string): number {
  const escaped = name.replace(/[$]/g, '\\$');
  return (content.match(new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g')) ?? []).length;
}

function confidence(exp: ExportInfo, overExported: boolean): number {
  if (overExported) return 0.7;
  if (exp.isDefault) return 0.75;
  return 0.9;
}

function message(exp: ExportInfo, kind: string, overExported: boolean): string {
  if (exp.isDefault) return 'Default export `default` is never imported by any other file.';
  if (overExported) return `Exported ${kind} \`${exp.name}\` is used only locally; drop the \`export\` keyword.`;
  return `Exported ${kind} \`${exp.name}\` has zero references; safe to delete.`;
}

function isConventionalDefaultFile(relPath: string): boolean {
  return /(^|\/)(app|pages|routes|api|stories|\.storybook|e2e|migrations|scripts|plugins|middleware|layouts|views)\//.test(relPath)
    || /\.(stories|story|config|setup|workspace)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation|\+page|\+layout)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)[\w.-]*\.(config|rc)\.[cm]?[jt]s$/.test(relPath);
}

async function getEntryPoints(rootDir: string, config: UnshitConfig, files: FileEntry[], manifests?: string[]): Promise<Set<string>> {
  try {
    const { entryPointFileSet } = await import('../../detectors/dead-exports.js');
    return entryPointFileSet({ rootDir, config, files, manifests }, files);
  } catch {
    return new Set<string>();
  }
}

function isUnused(exp: ExportInfo, rel: string, used: Map<string, Set<string>>): boolean {
  if (/(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation)\.[cm]?[jt]sx?$/.test(rel)
    && FRAMEWORK_EXPORTS.has(exp.name)) return false;
  if (exp.isTypeOnly && /Props$/.test(exp.name)) return false;
  const usedSet = used.get(exp.file);
  if (usedSet && (usedSet.has('*') || usedSet.has(exp.name))) return false;
  if (exp.isDefault && isConventionalDefaultFile(rel)) return false;
  return true;
}

function toFinding(exp: ExportInfo, content: string): Finding {
  const ownCount = exp.isDefault ? 0 : identifierCount(content, exp.localName);
  const overExported = ownCount >= (exp.isListed ? 3 : 2);
  const kind = exp.isTypeOnly ? 'type' : 'symbol';
  return {
    ruleId: exp.isTypeOnly ? 'ts/unused-type-export' : 'ts/unused-export',
    category: 'dead-code',
    tier: 'structural',
    severity: 'info',
    fixability: 'unsafe',
    confidence: confidence(exp, overExported),
    file: exp.file,
    span: { line: exp.line, column: exp.column },
    message: message(exp, kind, overExported),
    evidence: exp.isDefault ? 'export default ...' : `export ... ${exp.name}`,
  };
}

export async function detectDeepUnusedExports(
  rootDir: string,
  config: UnshitConfig,
  files: FileEntry[],
  manifests?: string[],
): Promise<DeepResult> {
  const analyzedFiles = new Set(files.filter((f) => TS_LIKE.has(f.ext)).map((f) => f.relPath));
  const program = loadProgram(rootDir, files);
  if (!program) throw new Error('ts.createProgram failed');

  const checker = program.getTypeChecker();
  const fileSet = new Set(files.map((f) => f.relPath));
  const entryPoints = await getEntryPoints(rootDir, config, files, manifests);
  const used = collectUsage(program, checker, rootDir, fileSet, entryPoints);
  const contentByFile = new Map(files.map((f) => [f.relPath, f.content]));
  const findings: Finding[] = [];

  for (const sf of program.getSourceFiles()) {
    const rel = posixRel(rootDir, path.resolve(sf.fileName));
    if (!rel || !fileSet.has(rel) || sf.isDeclarationFile) continue;
    if (!TS_LIKE.has(path.extname(rel).toLowerCase())) continue;
    const content = contentByFile.get(rel) ?? sf.getFullText();
    for (const exp of collectExportInfos(sf, checker, rootDir)) {
      if (isUnused(exp, rel, used)) findings.push(toFinding(exp, content));
    }
  }

  return { findings, analyzedFiles };
}
