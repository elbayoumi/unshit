import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import type { DetectorContext, FileEntry } from '../../contracts.js';

export const FRAMEWORK_EXPORTS = new Set([
  'metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'viewport', 'generateViewport', 'dynamicParams', 'fetchCache', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'config', 'loader', 'action', 'meta', 'links',
]);

export const TS_LIKE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

const PKG_TARGET_KEYS = ['exports', 'main', 'module', 'types', 'typings', 'bin', 'workspaces'] as const;
const PKG_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export const SCRIPT_RUNNER_RE = /\b(?:node|tsx|ts-node|vite-node)\b[ \t]+([^\s&|;<>"']+)/g;
export const CONFIG_FILE_RE = /(^|\/)(vite|vitest|jest|webpack|rollup|next|nuxt|astro|svelte|tailwind|postcss|eslint|playwright|cypress|drizzle|prisma)\.config\.[cm]?[jt]s$/i;
export const CONFIG_SETUP_RE = /\b(setupFiles|globalSetup|globalSetupFile|input)\s*:\s*(?:\[([^\]]*)\]|"([^"]+)"|'([^']+)')/g;
export const CONFIG_SETUP_QUOTED_RE = /["']([^"']+)["']/g;
export const ASSET_SPEC_RE = /\.(json|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp[34]|webm|wasm|md|txt|html|ya?ml|csv)(\?.*)?$/i;
export const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g;
export const STAR = '*';

export function posixDirname(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

export function posixJoin(fromRel: string, rel: string): string {
  const parts = fromRel.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/') + (rel.endsWith('/') ? '/' : '');
}

export function readManifest(rootDir: string, rel: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, rel), 'utf8')) as Record<string, unknown>;
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

export function safeReaddir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

export function resolveSpecToFile(dirRel: string, spec: string, fileSet: Set<string>): string | null {
  const clean = (spec.split('?')[0] ?? spec).replace(/^<rootDir>\/?/, '');
  if (!clean) return null;
  const rootRelative = clean.startsWith('/');
  const bases = [posixJoin(dirRel ? `${dirRel}/x` : 'x', rootRelative ? clean.slice(1) : clean)];
  if (rootRelative) bases.push(clean.slice(1));
  for (const base of bases) {
    for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      const candidate = base + suffix;
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

export function addPkgEntryTargets(
  entries: Set<string>,
  files: Set<string>,
  dir: string,
  pkg: Record<string, unknown>,
): void {
  const targets: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') targets.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const key of PKG_TARGET_KEYS) walk(pkg[key]);

  for (const target of targets) {
    const clean = target.replace(/^\.\//, '').replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
    const variants = [clean, clean.replace(/^(dist|build|lib|out)\//, '')];
    for (const variant of variants) {
      const base = dir ? `${dir}/${variant}` : variant;
      for (const ext of PKG_EXTS) {
        const candidate = base + ext;
        if (files.has(candidate)) entries.add(candidate);
      }
    }
  }
}

export function addScriptEntryTargets(
  entries: Set<string>,
  files: Set<string>,
  dir: string,
  pkg: Record<string, unknown>,
): void {
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== 'object') return;
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string') continue;
    for (const m of value.matchAll(SCRIPT_RUNNER_RE)) {
      const raw = m[1] ?? '';
      if (!raw || raw.startsWith('-')) continue;
      const target = resolveSpecToFile(dir, raw, files);
      if (target) entries.add(target);
    }
  }
}

export function identifierCount(content: string, name: string): number {
  const escaped = name.replace(/[$]/g, '\\$');
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  return (content.match(re) ?? []).length;
}

export function isPluginOrIntegrationFile(relPath: string): boolean {
  return /(^|\/)integrations?\//.test(relPath);
}

export function isFrameworkEntryPath(relPath: string): boolean {
  return /(^|\/)(pages|app|layouts|middleware|plugins|server)\//.test(relPath)
    || /(^|\/)src\/routes\/(?:[^/]+\/)*\+[^/]*$/.test(relPath)
    || /(^|\/)middleware\.(ts|js|tsx|jsx|mts|cts)$/i.test(relPath);
}

export function isTestConventionEntry(relPath: string): boolean {
  return /(^|\/)__mocks__\//.test(relPath)
    || /(^|\/)(e2e|cypress|playwright)\//.test(relPath)
    || /(^|\/)\.storybook\//.test(relPath)
    || /[^/]*\.stories?\.[cm]?[jt]sx?$/.test(relPath);
}

export function isConventionalDefaultFile(relPath: string): boolean {
  return /(^|\/)(app|pages|routes|api|stories|\.storybook|e2e|migrations|scripts|plugins|middleware|layouts|views)\//.test(relPath)
    || /\.(stories|story|config|setup|workspace)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation|\+page|\+layout)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)[\w.-]*\.(config|rc)\.[cm]?[jt]s$/.test(relPath);
}

export function isRootEntry(relPath: string): boolean {
  return /^(src\/)?(index|main|cli|app|server|bin)\.[cm]?[jt]sx?$/i.test(relPath)
    || /^(docs|benchmark|benchmarks|examples?|fixtures|__fixtures__)\//.test(relPath)
    || CONFIG_FILE_RE.test(relPath)
    || /\.(test|spec|d)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(bin|scripts)\//.test(relPath);
}

export function leftmost(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : leftmost(name.left);
}

export function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  return (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && p.name === node;
}