import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

interface SpecLoc {
  text: string;
  line: number;
  column: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function positionOf(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const line = before.split('\n').length;
  const column = index - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

/** 1-based line/column of the `"key":` occurrence for `key` in a JSON manifest. */
function keyLine(text: string, key: string): { line: number; column: number } | null {
  const m = new RegExp(`^(\\s*)"${escapeRegExp(key)}"`, 'm').exec(text);
  if (!m) return null;
  return positionOf(text, (m.index ?? 0) + (m[1] ?? '').length);
}

function readJson(rootDir: string, rel: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(rootDir, rel), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function safeReaddirNames(rootDir: string): string[] {
  try {
    return readdirSync(rootDir).filter((name) => name !== 'node_modules');
  } catch {
    return [];
  }
}

/** Package name a module specifier refers to: `lodash` → `lodash`, `@s/pkg/sub` → `@s/pkg`. */
function packageName(spec: string): string | null {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || null;
}

const BUILTINS = new Set(builtinModules.map((name) => name.split('/')[0] ?? name));

/** Bare specifier = not relative, not absolute, not `#` imports, not `node:` builtin. */
function isBareSpec(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || spec.startsWith('node:')) return false;
  return !BUILTINS.has(spec.split('/')[0] ?? spec);
}

/* ------------------------------------------------------------------ *
 * Module specifier collection
 * ------------------------------------------------------------------ */

function specLocFromNode(sf: ts.SourceFile, node: ts.StringLiteralLike): SpecLoc {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { text: node.text, line: pos.line + 1, column: pos.character + 1 };
}

/** Static imports, `export … from`, import-equals and dynamic `import()`/`require()` via AST. */
function collectSpecsFromAst(sf: ts.SourceFile): SpecLoc[] {
  const out: SpecLoc[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(specLocFromNode(sf, node.argument.literal));
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0];
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && arg0 && ts.isStringLiteralLike(arg0)) out.push(specLocFromNode(sf, arg0));
    }
    ts.forEachChild(node, visit);
  };
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      out.push(specLocFromNode(sf, stmt.moduleSpecifier));
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      out.push(specLocFromNode(sf, stmt.moduleSpecifier));
    } else if (
      ts.isImportEqualsDeclaration(stmt)
      && ts.isExternalModuleReference(stmt.moduleReference)
      && ts.isStringLiteral(stmt.moduleReference.expression)
    ) {
      out.push(specLocFromNode(sf, stmt.moduleReference.expression));
    }
  }
  visit(sf);
  return out;
}

/** Fallback for non-TS files: quoted module-specifier strings after import/from/require keywords. */
function collectSpecsFromRegex(content: string): SpecLoc[] {
  const out: SpecLoc[] = [];
  const patterns = [
    /\bimport\s+["']([^"'\n]+)["']/g,
    /\bfrom\s+["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      const text = m[1] ?? '';
      if (!text) continue;
      out.push({ text, ...positionOf(content, m.index + m[0].indexOf(text)) });
    }
  }
  return out;
}

function collectModuleSpecs(file: FileEntry): SpecLoc[] {
  return file.sourceFile ? collectSpecsFromAst(file.sourceFile) : collectSpecsFromRegex(file.content);
}

function collectModuleSpecsFromContext(ctx: DetectorContext): SpecLoc[] {
  const out: SpecLoc[] = [];
  for (const file of ctx.files) {
    out.push(...collectModuleSpecs(file));
    if (/\.(css|scss|sass|less)$/i.test(file.relPath)) {
      for (const m of file.content.matchAll(/@(?:plugin|import|config|use|require)\s+["']([^"']+)["']/g)) {
        const text = (m[1] ?? '').replace(/^~/, '');
        if (text) out.push({ text, line: 1, column: 1 } as SpecLoc);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * deps/unused-dependency
 * ------------------------------------------------------------------ */

/** Small list of common tooling: rarely imported as a module but present as dev deps. */
const TOOLING_PREFIXES = [
  'typescript', 'vitest', 'jest', 'tsx', 'ts-node', 'prettier', 'eslint', 'stylelint', 'tailwindcss', 'tailwind',
];

function isCommonTooling(name: string): boolean {
  return TOOLING_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

function scriptsReference(scripts: Record<string, unknown> | undefined, name: string): boolean {
  if (!scripts) return false;
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  return Object.values(scripts).some((value) => typeof value === 'string' && re.test(value));
}

/** Dep referenced by name in a root config-file name, e.g. `xo.config.js` → dep `xo`. */
function isConfigFileNamed(base: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}([^A-Za-z0-9]|$)`).test(base);
}

function collectUsedNames(specs: SpecLoc[]): Set<string> {
  const names = new Set<string>();
  for (const spec of specs) {
    if (spec.text.startsWith('node:')) {
      const rest = spec.text.slice('node:'.length);
      names.add(rest.split('/')[0] ?? rest);
      names.add('node');
      continue;
    }
    const name = packageName(spec.text);
    if (name) names.add(name);
  }
  return names;
}

/**
 * Flags packages declared in root package.json `dependencies`/`devDependencies`
 * that nothing imports/requires and no script or root config file references.
 */
export const unusedDependencyDetector: Detector = {
  id: 'deps/unused-dependency',
  category: 'dead-code',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Flags packages in package.json dependencies/devDependencies that nothing imports, requires or runs via scripts or references in configs such as CI workflows.',
  detect(ctx: DetectorContext): Finding[] {
    if (!existsSync(join(ctx.rootDir, 'package.json'))) return [];

    // Group files by their nearest package.json directory ('' = root package).
    const pkgCache = new Map<string, boolean>();
    const hasPkg = (dir: string): boolean => {
      let v = pkgCache.get(dir);
      if (v === undefined) {
        v = existsSync(join(ctx.rootDir, dir, 'package.json'));
        pkgCache.set(dir, v);
      }
      return v;
    };
    const ownerOf = (relPath: string): string => {
      const parts = relPath.split('/').slice(0, -1);
      for (let i = parts.length; i > 0; i--) {
        const dir = parts.slice(0, i).join('/');
        if (hasPkg(dir)) return dir;
      }
      return '';
    };
    const groups = new Map<string, FileEntry[]>();
    for (const file of ctx.files) {
      if (/(^|\/)(docs|fixtures|__fixtures__)\//.test(file.relPath)) continue;
      const owner = ownerOf(file.relPath);
      let list = groups.get(owner);
      if (!list) groups.set(owner, (list = []));
      list.push(file);
    }
    const findings: Finding[] = [];
    const allUsed = collectUsedNames(collectModuleSpecsFromContext(ctx));
    const workspaceNames = new Set<string>();
    for (const dir of groups.keys()) {
      const sub = dir ? readJson(ctx.rootDir, `${dir}/package.json`) : null;
      if (sub && typeof sub.name === 'string') workspaceNames.add(sub.name);
    }

    const dirs = new Set<string>(['', ...groups.keys()]);
    for (const dir of dirs) {
      const rel = dir ? `${dir}/package.json` : 'package.json';
      const pkg = readJson(ctx.rootDir, rel);
      if (!pkg) continue;
      const files = groups.get(dir) ?? [];
      if (dir && files.length === 0) continue;
      const text = safeReadText(join(ctx.rootDir, rel));

      const deps = new Map<string, unknown>();
      for (const section of ['dependencies', 'devDependencies'] as const) {
        const value = pkg[section];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, version] of Object.entries(value as Record<string, unknown>)) deps.set(name, version);
        }
      }
      if (deps.size === 0) continue;

      // The root package may serve hoisted dependencies to workspaces, so for it any usage in the repo counts.
      const used = dir === '' ? allUsed : collectUsedNames(files.flatMap((f) => collectModuleSpecsFromContext({ ...ctx, files: [f] })));
      const scripts = (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts))
        ? pkg.scripts as Record<string, unknown>
        : undefined;
      const pkgDirAbs = join(ctx.rootDir, dir);
      const dirFiles = safeReaddirNames(pkgDirAbs);
      const configTexts = dirFiles
        .filter((file) => /(config|rc)(\.|$)/i.test(file) && !file.endsWith('.lock'))
        .map((file) => safeReadText(join(pkgDirAbs, file)));
      const workflowTexts: string[] = [];
      try {
        const wfDir = join(ctx.rootDir, '.github', 'workflows');
        for (const entry of readdirSync(wfDir, { withFileTypes: true })) {
          if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
          workflowTexts.push(safeReadText(join(wfDir, entry.name)));
        }
      } catch {
        // No CI directory: nothing to reference.
      }

      const unusedRuntime = new Set<string>();
      for (const name of deps.keys()) {
        if (isCommonTooling(name) || name.startsWith('@types/')) continue;
        if (used.has(name)) continue;
        if (scriptsReference(scripts, name)) continue;
        if (dirFiles.some((file) => isConfigFileNamed(file, name))) continue;
        if (configTexts.some((t) => t.includes(name))) continue;
        if (workflowTexts.some((t) => t.includes(name))) continue;
        unusedRuntime.add(name);
      }
      // `@types/x` is dead only when the runtime package `x` is declared here and itself unused.
      for (const name of deps.keys()) {
        if (!name.startsWith('@types/') || name === '@types/node') continue;
        const base = name.slice('@types/'.length);
        const runtime = base.includes('__') ? `@${base.replace('__', '/')}` : base;
        if (unusedRuntime.has(runtime) && !used.has(name)) unusedRuntime.add(name);
      }
      for (const name of deps.keys()) {
        if (!unusedRuntime.has(name)) continue;
        const pos = keyLine(text, name);
        if (!pos) continue;
        findings.push({
          ruleId: this.id,
          category: 'dead-code',
          tier: 'structural',
          severity: 'warn',
          fixability: 'manual',
          confidence: workspaceNames.has(name) ? 0.7 : 0.85,
          file: rel,
          span: pos,
          message: `Dependency \`${name}\` is never imported, required or referenced by name in scripts${dir ? ` of ${dir}` : ''}.`,
          evidence: name,
        });
      }
    }
    return findings;
  },
};

/* ------------------------------------------------------------------ *
 * deps/unlisted-dependency
 * ------------------------------------------------------------------ */

function declaredNames(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const value = pkg[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const name of Object.keys(value as Record<string, unknown>)) names.add(name);
    }
  }
  return names;
}

function tsconfigAliasKeys(rootDir: string): Set<string> {
  const pkg = readJson(rootDir, 'tsconfig.json');
  const compilerOptions = pkg?.compilerOptions;
  const paths = compilerOptions && typeof compilerOptions === 'object'
    ? (compilerOptions as Record<string, unknown>).paths
    : null;
  const keys = new Set<string>();
  if (paths && typeof paths === 'object') for (const key of Object.keys(paths)) keys.add(key);
  return keys;
}

function isTsconfigAlias(spec: string, keys: Set<string>): boolean {
  for (const key of keys) {
    if (key.endsWith('*')) {
      if (spec.startsWith(key.slice(0, -1))) return true;
    } else if (spec === key) {
      return true;
    }
  }
  return false;
}

function isBareImportSpec(spec: string, aliases: Set<string>): boolean {
  if (!isBareSpec(spec)) return false;
  return !isTsconfigAlias(spec, aliases);
}

function unlistedSpecName(
  specText: string,
  aliases: Set<string>,
  rootDeclared: Set<string>,
  fileDeclared: Set<string>,
  workspaceNames: Set<string>,
  projectName: string | null,
): string | null {
  if (!isBareImportSpec(specText, aliases)) return null;
  const name = packageName(specText);
  if (!name) return null;
  if (rootDeclared.has(name) || fileDeclared.has(name)) return null;
  if (workspaceNames.has(name) || (projectName && name === projectName)) return null;
  if (name.startsWith('@types/')) return null;
  if (fileDeclared.has(`@types/${name}`) || rootDeclared.has(`@types/${name}`)) return null;
  return name;
}

/**
 * Flags bare import specifiers whose package name is not declared in the root
 * package.json (dependencies, devDependencies, peerDependencies, optionalDependencies).
 */
export const unlistedDependencyDetector: Detector = {
  id: 'deps/unlisted-dependency',
  category: 'dead-code',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Flags bare import specifiers whose package is not declared in package.json.',
  detect(ctx: DetectorContext): Finding[] {
    const pkgPath = join(ctx.rootDir, 'package.json');
    if (!existsSync(pkgPath)) return [];
    const pkg = readJson(ctx.rootDir, 'package.json');
    if (!pkg) return [];

    const rootDeclared = declaredNames(pkg);
    const workspaceNames = new Set<string>();
    const nearestCache = new Map<string, Set<string>>();
    const declaredFor = (relPath: string): Set<string> => {
      const parts = relPath.split('/').slice(0, -1);
      for (let i = parts.length; i > 0; i--) {
        const dir = parts.slice(0, i).join('/');
        let cached = nearestCache.get(dir);
        if (!cached) {
          const sub = readJson(ctx.rootDir, `${dir}/package.json`);
          cached = new Set<string>();
          if (sub) {
            if (typeof sub.name === 'string') workspaceNames.add(sub.name);
            for (const n of declaredNames(sub)) cached.add(n);
            cached.add('\0pkg');
          }
          nearestCache.set(dir, cached);
        }
        if (cached.has('\0pkg')) return cached;
      }
      return rootDeclared;
    };
    const projectName = typeof pkg.name === 'string' ? pkg.name : null;
    for (const file of ctx.files) declaredFor(file.relPath);
    const aliases = tsconfigAliasKeys(ctx.rootDir);

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const file of ctx.files) {
      if (/(^|\/)(docs|fixtures|__fixtures__)\//.test(file.relPath)) continue;
      for (const spec of collectModuleSpecs(file)) {
        const name = unlistedSpecName(spec.text, aliases, rootDeclared, declaredFor(file.relPath), workspaceNames, projectName);
        if (!name) continue;
        const key = `${file.relPath}|${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: this.id, category: 'dead-code', tier: 'structural', severity: 'warn', fixability: 'manual',
          confidence: 0.85, file: file.relPath, span: { line: spec.line, column: spec.column },
          message: `Import of unlisted package \`${name}\` — add it to package.json dependencies/devDependencies.`,
          evidence: `import '${spec.text}'`,
        });
      }
    }
    return findings;
  },
};
