import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';
import {
  collectModuleSpecs, collectModuleSpecsFromContext, collectUsedNames,
  isBareSpec, isCommonTooling, isConfigFileNamed, keyLine, packageName,
  readJson, safeReadText, safeReaddirNames, scriptsReference,
} from './deps-shared.js';

/* ------------------------------------------------------------------ *
 * Package.json top-level config keys
 *
 * A dependency counts as used when its exact package name — or, for
 * known tools, the documented top-level config key — appears as a
 * top-level key of the package.json that declares it. Exact key match
 * only, no substring matching. In a monorepo a matching key in the
 * root package.json also counts; keys in unrelated workspace packages
 * do not.
 * ------------------------------------------------------------------ */

/** Known tools whose documented top-level package.json key differs from the package name. */
const CONFIG_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  eslint: ['eslintConfig'],
  prettier: ['prettier'],
  jest: ['jest'],
  '@babel/core': ['babel'],
  stylelint: ['stylelint'],
  commitlint: ['commitlint'],
  'lint-staged': ['lint-staged'],
  nyc: ['nyc'],
  ava: ['ava'],
  c8: ['c8'],
  xo: ['xo'],
  browserslist: ['browserslist'],
  'remark-cli': ['remarkConfig'],
};

/**
 * Standard package.json fields. A dependency that happens to share one of
 * these names (e.g. a package called `module` next to a `"module"` entry
 * point field) is not configured by it.
 */
const STANDARD_PACKAGE_FIELDS: ReadonlySet<string> = new Set([
  'name', 'version', 'description', 'keywords', 'homepage', 'bugs', 'license',
  'author', 'contributors', 'funding', 'files', 'main', 'module', 'browser',
  'types', 'typings', 'type', 'exports', 'imports', 'bin', 'man', 'directories',
  'repository', 'scripts', 'config', 'dependencies', 'devDependencies',
  'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies',
  'bundleDependencies', 'bundledDependencies', 'overrides', 'resolutions',
  'engines', 'os', 'cpu', 'private', 'publishConfig', 'workspaces',
  'packageManager', 'sideEffects',
]);

function hasTopLevelKey(pkg: Record<string, unknown>, key: string): boolean {
  if (STANDARD_PACKAGE_FIELDS.has(key)) return false;
  return Object.prototype.hasOwnProperty.call(pkg, key);
}

/** A `@types/x` package counts as unused when `x` itself is unused in the same package. */
function addUnusedTypes(deps: Map<string, unknown>, unusedRuntime: Set<string>, used: Set<string>): void {
  for (const name of deps.keys()) {
    if (!name.startsWith('@types/') || name === '@types/node') continue;
    const base = name.slice('@types/'.length);
    const runtime = base.includes('__') ? `@${base.replace('__', '/')}` : base;
    if (unusedRuntime.has(runtime) && !used.has(name)) unusedRuntime.add(name);
  }
}

/** True when `name` (or a documented config-key alias for it) is an exact top-level key of `pkg`. */
function configuredByTopLevelKey(pkg: Record<string, unknown>, name: string): boolean {
  if (hasTopLevelKey(pkg, name)) return true;
  const aliases = CONFIG_KEY_ALIASES[name];
  if (aliases) {
    for (const key of aliases) if (hasTopLevelKey(pkg, key)) return true;
  }
  return false;
}

export const unusedDependencyDetector: Detector = {
  id: 'deps/unused-dependency',
  category: 'dead-code',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Flags packages in package.json dependencies/devDependencies that nothing imports, requires or runs via scripts or references in configs such as CI workflows.',
  detect(ctx: DetectorContext): Finding[] {
    if (!existsSync(join(ctx.rootDir, 'package.json'))) return [];
    const pkgCache = new Map<string, boolean>();
    const hasPkg = (dir: string): boolean => {
      let v = pkgCache.get(dir);
      if (v === undefined) { v = existsSync(join(ctx.rootDir, dir, 'package.json')); pkgCache.set(dir, v); }
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
    const buildGroups = (): Map<string, FileEntry[]> => {
      const groups = new Map<string, FileEntry[]>();
      for (const file of ctx.files) {
        if (/(^|\/)(docs|fixtures|__fixtures__|examples)\//.test(file.relPath)) continue;
        const owner = ownerOf(file.relPath);
        const list = groups.get(owner) ?? [];
        list.push(file);
        groups.set(owner, list);
      }
      return groups;
    };
    const groups = buildGroups();
    const allUsed = collectUsedNames(collectModuleSpecsFromContext(ctx));
    const workspaceNames = new Set<string>();
    for (const dir of groups.keys()) {
      const sub = dir ? readJson(ctx.rootDir, `${dir}/package.json`) : null;
      if (sub && typeof sub.name === 'string') workspaceNames.add(sub.name);
    }
    const workflowTexts = (): string[] => {
      const out: string[] = [];
      try {
        for (const entry of readdirSync(join(ctx.rootDir, '.github', 'workflows'), { withFileTypes: true })) {
          if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(safeReadText(join(ctx.rootDir, '.github', 'workflows', entry.name)));
        }
      } catch { /* no workflows */ }
      return out;
    };
    const workflows = workflowTexts();
    const packageDeps = (pkg: Record<string, unknown>): Map<string, unknown> => {
      const deps = new Map<string, unknown>();
      for (const section of ['dependencies', 'devDependencies'] as const) {
        const value = pkg[section];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, version] of Object.entries(value as Record<string, unknown>)) deps.set(name, version);
        }
      }
      return deps;
    };
    const rootPkg = readJson(ctx.rootDir, 'package.json');
    const unusedInDir = (dir: string, pkg: Record<string, unknown>, files: FileEntry[], deps: Map<string, unknown>, root: Record<string, unknown> | null): Set<string> => {
      const used = dir === '' ? allUsed : collectUsedNames(files.flatMap((f) => collectModuleSpecsFromContext({ ...ctx, files: [f] })));
      const scripts = (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) ? pkg.scripts as Record<string, unknown> : undefined;
      const pkgDirAbs = join(ctx.rootDir, dir);
      const dirFiles = safeReaddirNames(pkgDirAbs);
      const configTexts = dirFiles.filter((f) => /(config|rc)(\.|$)/i.test(f) && !f.endsWith('.lock')).map((f) => safeReadText(join(pkgDirAbs, f)));
      const unusedRuntime = new Set<string>();
      const otherFileTexts = files.filter((f) => !/(^|\/)package\.json$/.test(f.relPath)).map((f) => f.content);
      const ownedManifests = (ctx.manifests ?? []).filter((m) => ownerOf(m) === dir && !/(^|\/)package\.json$/.test(m));
      const manifestTexts = ownedManifests.map((m) => safeReadText(join(ctx.rootDir, m)));
      const configured = (name: string): boolean =>
        configuredByTopLevelKey(pkg, name) || (dir !== '' && root !== null && configuredByTopLevelKey(root, name));
      const referencedElsewhere = (name: string): boolean =>
        configTexts.some((t) => t.includes(name))
        || workflows.some((t) => t.includes(name))
        || otherFileTexts.some((t) => t.includes(name))
        || manifestTexts.some((t) => t.includes(name));
      for (const name of deps.keys()) {
        if (isCommonTooling(name) || name.startsWith('@types/')) continue;
        if (used.has(name) || scriptsReference(scripts, name)) continue;
        if (configured(name)) continue;
        if (dirFiles.some((f) => isConfigFileNamed(f, name))) continue;
        if (referencedElsewhere(name)) continue;
        unusedRuntime.add(name);
      }
      addUnusedTypes(deps, unusedRuntime, used);
      return unusedRuntime;
    };
    const findings: Finding[] = [];
    const scanDir = (dir: string): void => {
      const rel = dir ? `${dir}/package.json` : 'package.json';
      const pkg = readJson(ctx.rootDir, rel);
      if (!pkg) return;
      const files = groups.get(dir) ?? [];
      if (dir && files.length === 0) return;
      const deps = packageDeps(pkg);
      if (deps.size === 0) return;
      const text = safeReadText(join(ctx.rootDir, rel));
      const unusedRuntime = unusedInDir(dir, pkg, files, deps, rootPkg);
      for (const name of deps.keys()) {
        if (!unusedRuntime.has(name)) continue;
        const pos = keyLine(text, name);
        if (!pos) continue;
        findings.push({
          ruleId: this.id, category: 'dead-code', tier: 'structural', severity: 'warn', fixability: 'manual',
          confidence: workspaceNames.has(name) ? 0.7 : 0.85, file: rel, span: pos,
          message: `Dependency \`${name}\` is never imported, required or referenced by name in scripts${dir ? ` of ${dir}` : ''}.`,
          evidence: name,
        });
      }
    };
    for (const dir of new Set<string>(['', ...groups.keys()])) scanDir(dir);
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
  if (name === '@std' || name.startsWith('@std/')) return null;
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
      if (/(^|\/)(docs|fixtures|__fixtures__|examples)\//.test(file.relPath)) continue;
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
