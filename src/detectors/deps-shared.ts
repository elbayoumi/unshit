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
  kind?: 'dynamic-import';
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
export function keyLine(text: string, key: string): { line: number; column: number } | null {
  const m = new RegExp(`^(\\s*)"${escapeRegExp(key)}"`, 'm').exec(text);
  if (!m) return null;
  return positionOf(text, (m.index ?? 0) + (m[1] ?? '').length);
}

export function readJson(rootDir: string, rel: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(rootDir, rel), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function safeReaddirNames(rootDir: string): string[] {
  try {
    return readdirSync(rootDir).filter((name) => name !== 'node_modules');
  } catch {
    return [];
  }
}

/** Package name a module specifier refers to: `lodash` → `lodash`, `@s/pkg/sub` → `@s/pkg`. */
export function packageName(spec: string): string | null {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || null;
}

const BUILTINS = new Set(builtinModules.map((name) => name.split('/')[0] ?? name));

// `npm:` is Deno's npm-package protocol, resolved outside package.json.
const RUNTIME_BUILTIN_PROTOCOLS = new Set(['node', 'bun', 'deno', 'jsr', 'npm', 'cloudflare', 'workerd', 'edge-runtime']);

/** Bare specifier = not relative, not absolute, not `#` imports, not a runtime builtin. */
export function isBareSpec(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return false;
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(spec)?.[1]?.toLowerCase();
  if (protocol && RUNTIME_BUILTIN_PROTOCOLS.has(protocol)) return false;
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
      if (isDynamicImport && arg0 && ts.isStringLiteralLike(arg0)) {
        out.push({ ...specLocFromNode(sf, arg0), kind: 'dynamic-import' });
      } else if (isRequire && arg0 && ts.isStringLiteralLike(arg0)) {
        out.push(specLocFromNode(sf, arg0));
      }
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

const specCache = new WeakMap<object, SpecLoc[]>();

export function collectModuleSpecs(file: FileEntry): SpecLoc[] {
  const key = file.sourceFile ?? file;
  const cached = specCache.get(key);
  if (cached) return cached;
  const specs = file.sourceFile ? collectSpecsFromAst(file.sourceFile) : collectSpecsFromRegex(file.content);
  specCache.set(key, specs);
  return specs;
}

export function collectModuleSpecsFromContext(ctx: DetectorContext): SpecLoc[] {
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

export function isCommonTooling(name: string): boolean {
  return TOOLING_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

export function scriptsReference(scripts: Record<string, unknown> | undefined, name: string): boolean {
  if (!scripts) return false;
  return Object.values(scripts).some((value) => typeof value === 'string' && value.includes(name));
}

/** Dep referenced by name in a root config-file name, e.g. `xo.config.js` → dep `xo`. */
export function isConfigFileNamed(base: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}([^A-Za-z0-9]|$)`).test(base);
}

export function collectUsedNames(specs: SpecLoc[]): Set<string> {
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
