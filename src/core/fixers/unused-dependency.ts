import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { FileEntry, Finding, Patch, TextEdit } from '../../contracts.js';
import type { ScanResult } from '../scanner.js';

const RULE = 'deps/unused-dependency';
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export function isUnusedDependencyRule(ruleId: string): boolean {
  return ruleId === RULE;
}

interface UnusedDependencySkip {
  file: string;
  ruleId: string;
  line: number;
  reason: string;
}

interface UnusedDependencyPlan {
  patches: Patch[];
  skipped: UnusedDependencySkip[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function posixDirname(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function packageName(spec: string): string | null {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || null;
}

/** Conservative text reference check, mirroring the detector's script/config checks. */
function mentionsName(text: string, name: string): boolean {
  if (!text) return false;
  if (name.startsWith('@')) return text.includes(name);
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text);
}

type AddSpec = (node: ts.StringLiteralLike) => void;

function collectNodeSpecs(node: ts.Node, add: AddSpec): void {
  if (ts.isCallExpression(node)) {
    const arg0 = node.arguments[0];
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if ((isImport || isRequire) && arg0 && ts.isStringLiteralLike(arg0)) add(arg0);
  } else if (
    ts.isImportTypeNode(node)
    && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteral(node.argument.literal)
  ) {
    add(node.argument.literal);
  }
  ts.forEachChild(node, (child) => collectNodeSpecs(child, add));
}

function collectStatementSpecs(stmt: ts.Statement, add: AddSpec): void {
  if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
    add(stmt.moduleSpecifier);
  } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
    add(stmt.moduleSpecifier);
  } else if (
    ts.isImportEqualsDeclaration(stmt)
    && ts.isExternalModuleReference(stmt.moduleReference)
    && ts.isStringLiteral(stmt.moduleReference.expression)
  ) {
    add(stmt.moduleReference.expression);
  }
}

function collectRegexSpecs(content: string, out: string[]): void {
  const patterns = [
    /\bimport\s+["']([^"'\n]+)["']/g,
    /\bfrom\s+["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) if (m[1]) out.push(m[1]);
  }
}

function specTexts(file: FileEntry): string[] {
  const out: string[] = [];
  const add: AddSpec = (node) => {
    if (node.text) out.push(node.text);
  };
  if (file.sourceFile) {
    for (const stmt of file.sourceFile.statements) collectStatementSpecs(stmt, add);
    collectNodeSpecs(file.sourceFile, add);
  } else {
    collectRegexSpecs(file.content, out);
  }
  return out;
}

/** Package names referenced by any import form in the scanned source set. */
function usedPackageNames(scan: ScanResult): Set<string> {
  const used = new Set<string>();
  for (const file of scan.files) {
    for (const spec of specTexts(file)) {
      if (spec.startsWith('node:')) {
        const rest = spec.slice('node:'.length);
        used.add(rest.split('/')[0] ?? rest);
        continue;
      }
      const name = packageName(spec);
      if (name) used.add(name);
    }
    if (/\.(?:css|scss|sass|less)$/i.test(file.relPath)) {
      for (const m of file.content.matchAll(/@(?:plugin|import|config|use|require)\s+["']([^"']+)["']/g)) {
        const name = packageName((m[1] ?? '').replace(/^~/, ''));
        if (name) used.add(name);
      }
    }
  }
  return used;
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function listNames(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** Manifest text minus dependency sections, so the key being removed is not a "reference". */
function manifestFieldsText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const copy: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const section of DEP_SECTIONS) delete copy[section];
    return JSON.stringify(copy);
  } catch {
    return '';
  }
}

/**
 * Re-checks references outside source imports: manifest scripts/fields, tool
 * config files in the owning package/root and CI workflow scripts. Any hit
 * means the key must be left in place.
 */
function externalReference(scan: ScanResult, ownerRel: string, name: string): string | null {
  for (const rel of scan.manifests ?? []) {
    const text = manifestFieldsText(readText(join(scan.rootDir, rel)));
    if (mentionsName(text, name)) return `\`${name}\` still referenced by ${rel} (scripts or config field)`;
  }
  const dirs = new Set(['', posixDirname(ownerRel)]);
  for (const dir of dirs) {
    const absDir = join(scan.rootDir, dir);
    for (const entry of listNames(absDir)) {
      if (!/(config|rc)(\.|$)/i.test(entry) || entry.endsWith('.lock')) continue;
      if (mentionsName(readText(join(absDir, entry)), name)) {
        return `\`${name}\` still referenced by config file ${dir ? `${dir}/` : ''}${entry}`;
      }
    }
  }
  const workflows = join(scan.rootDir, '.github', 'workflows');
  for (const entry of listNames(workflows)) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    if (mentionsName(readText(join(workflows, entry)), name)) {
      return `\`${name}\` still referenced by CI workflow .github/workflows/${entry}`;
    }
  }
  return null;
}

interface LineRemoval {
  name: string;
  start: number;
  end: number;
  hasComma: boolean;
}

/** Locates the dependency key lines and the edits that remove them without breaking JSON. */
function removalEdits(content: string, names: string[]): Map<string, TextEdit[]> | null {
  const removals: LineRemoval[] = [];
  for (const name of names) {
    const re = new RegExp(`^[ \\t]*"${escapeRegExp(name)}"[ \\t]*:`, 'm');
    const match = re.exec(content);
    if (!match) return null;
    const start = match.index;
    let end = content.indexOf('\n', start);
    if (end === -1) end = content.length;
    if (removals.some((r) => start < r.end && r.start < end)) return null;
    removals.push({ name, start, end, hasComma: content.slice(start, end).trimEnd().endsWith(',') });
  }
  removals.sort((a, b) => a.start - b.start);

  const removed = new Set(removals.map((r) => r.start));
  const editsByName = new Map<string, TextEdit[]>(
    removals.map(({ name, start, end }) => [name, [{
      startOffset: start,
      endOffset: end < content.length ? end + 1 : end,
      replacement: '',
    }]]),
  );
  const commaEdits = new Set<number>();
  for (const removal of removals) {
    if (removal.hasComma) continue;
    // Last property of its object: drop the trailing comma of the previous
    // surviving property line, if it is another property (not a closing brace).
    let searchEnd = removal.start - 1;
    while (searchEnd >= 0) {
      const searchStart = content.lastIndexOf('\n', searchEnd - 1) + 1;
      if (!removed.has(searchStart)) {
        const prev = content.slice(searchStart, searchEnd);
        const comma = prev.lastIndexOf(',');
        if (comma >= 0
          && prev.slice(comma + 1).trim() === ''
          && /^\s*"[^"]+"\s*:/.test(prev)
          && !commaEdits.has(searchStart + comma)) {
          commaEdits.add(searchStart + comma);
          editsByName.get(removal.name)!.push({
            startOffset: searchStart + comma,
            endOffset: searchStart + comma + 1,
            replacement: '',
          });
        }
        break;
      }
      searchEnd = searchStart - 1;
    }
  }
  for (const edits of editsByName.values()) edits.sort((a, b) => a.startOffset - b.startOffset);
  return editsByName;
}

function applyEdits(content: string, edits: TextEdit[]): string {
  let next = content;
  for (const edit of [...edits].sort((a, b) => b.startOffset - a.startOffset)) {
    next = next.slice(0, edit.startOffset) + edit.replacement + next.slice(edit.endOffset);
  }
  return next;
}

function expectedManifest(raw: string, names: string[]): unknown {
  const parsed: unknown = JSON.parse(raw);
  const copy: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const value = copy[section];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const deps = { ...(value as Record<string, unknown>) };
    for (const name of names) delete deps[name];
    copy[section] = deps;
  }
  return copy;
}

type SkipFn = (finding: Finding, reason: string) => void;

function skipAll(findings: Finding[], reason: string, skip: SkipFn): void {
  for (const finding of findings) skip(finding, reason);
}

function groupFindingsByFile(findings: Finding[]): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  return byFile;
}

function readDeclared(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isDeclaredKey(declared: Record<string, unknown>, name: string): boolean {
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const value = declared[section];
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, name)) {
      return true;
    }
  }
  return false;
}

function selectRemovable(
  scan: ScanResult,
  relPath: string,
  list: Finding[],
  declared: Record<string, unknown>,
  used: Set<string>,
  skip: SkipFn,
): Finding[] {
  const owners = list.map((f) => f.evidence.trim());
  const removable: Finding[] = [];
  for (const finding of list) {
    const name = finding.evidence.trim();
    if (!owners.includes(name) || !isDeclaredKey(declared, name)) {
      skip(finding, 'dependency key is no longer declared in package.json');
    } else if (used.has(name)) {
      skip(finding, `\`${name}\` still imported (or required) by a scanned file anywhere in the project`);
    } else {
      const external = externalReference(scan, relPath, name);
      if (external) skip(finding, external);
      else removable.push(finding);
    }
  }
  return removable;
}

interface ManifestPlanContext {
  scan: ScanResult;
  manifests: Set<string>;
  used: Set<string>;
  skip: SkipFn;
}

function planForManifest(relPath: string, list: Finding[], ctx: ManifestPlanContext): Patch[] {
  if (!ctx.manifests.has(relPath) || !relPath.endsWith('package.json') || relPath.includes('..')) {
    skipAll(list, 'finding does not point at a scanned package.json', ctx.skip);
    return [];
  }
  const raw = readText(join(ctx.scan.rootDir, relPath));
  if (!raw) {
    skipAll(list, 'could not read the owning package.json', ctx.skip);
    return [];
  }
  const declared = readDeclared(raw);
  if (!declared) {
    skipAll(list, 'owning package.json is not valid JSON', ctx.skip);
    return [];
  }

  const removable = selectRemovable(ctx.scan, relPath, list, declared, ctx.used, ctx.skip);
  if (removable.length === 0) return [];

  const names = [...new Set(removable.map((f) => f.evidence.trim()))];
  const editsByName = removalEdits(raw, names);
  if (!editsByName || editsByName.size === 0) {
    skipAll(removable, 'could not locate the dependency key in package.json', ctx.skip);
    return [];
  }
  const updated = applyEdits(raw, [...editsByName.values()].flat());
  try {
    const after = JSON.parse(updated);
    if (JSON.stringify(after) !== JSON.stringify(expectedManifest(raw, names))) {
      throw new Error('unexpected manifest change');
    }
  } catch {
    skipAll(removable, 'removing this key would change package.json unexpectedly', ctx.skip);
    return [];
  }

  return [...editsByName].map(([name, edits]) => ({
    file: relPath,
    ruleId: RULE,
    description: `Remove unused dependency key \`${name}\` from ${relPath}`,
    edits,
  }));
}

/**
 * Plans key removals from the owning package.json files. Every name is
 * re-checked against the current sources/manifests/configs before it is
 * scheduled, and the edited manifest must parse to the original object minus
 * exactly those keys. Nothing is written here — `runFix` owns the writes.
 */
export function planUnusedDependencyFixes(scan: ScanResult, findings: Finding[]): UnusedDependencyPlan {
  const skipped: UnusedDependencySkip[] = [];
  if (findings.length === 0) return { patches: [], skipped };

  const skip: SkipFn = (finding, reason) => {
    skipped.push({ file: finding.file, ruleId: finding.ruleId, line: finding.span.line, reason });
  };
  const ctx: ManifestPlanContext = {
    scan,
    manifests: new Set(scan.manifests ?? []),
    used: usedPackageNames(scan),
    skip,
  };
  const patches: Patch[] = [];
  for (const [relPath, list] of groupFindingsByFile(findings)) {
    patches.push(...planForManifest(relPath, list, ctx));
  }
  return { patches, skipped };
}
