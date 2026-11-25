import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';
import { createTsSpecResolver } from '../core/import-graph.js';

const FRAMEWORK_EXPORTS = new Set([
  'metadata', 'generateMetadata', 'generateStaticParams', 'dynamic', 'revalidate', 'runtime',
  'viewport', 'generateViewport', 'dynamicParams', 'fetchCache', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'config', 'loader', 'action', 'meta', 'links',
]);

function isPluginOrIntegrationFile(relPath: string): boolean {
  return /(^|\/)integrations?\//.test(relPath);
}

/**
 * Source files that package.json publishes (exports/main/module/types/typings/bin),
 * plus scripts that run files. Build outputs (dist/…) are mapped back to their
 * source counterpart.
 */
const PKG_TARGET_KEYS = ['exports', 'main', 'module', 'types', 'typings', 'bin', 'workspaces'] as const;
const PKG_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function readManifest(rootDir: string, rel: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, rel), 'utf8')) as Record<string, unknown>;
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

function posixDirname(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function addPkgEntryTargets(
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

/**
 * Files a package.json script executes (`node x.js`, `tsx x.ts`, `ts-node`,
 * `vite-node`), resolved relative to the manifest's directory.
 */
function addScriptEntryTargets(
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
      if (!raw || raw.startsWith('-')) continue; // runner flags like `node --inspect`
      const target = resolveSpecToFile(dir, raw, files);
      if (target) entries.add(target);
    }
  }
}

/**
 * Source files referenced by package.json manifests (the root one or workspace
 * packages): exports/main/module/types/typings/bin plus script runners.
 */
function manifestEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const entries = new Set<string>();
  const rels = new Set<string>(ctx.manifests ?? []);
  rels.add('package.json');
  for (const rel of rels) {
    const pkg = readManifest(ctx.rootDir, rel);
    if (!pkg) continue;
    const dir = posixDirname(rel);
    addPkgEntryTargets(entries, files, dir, pkg);
    addScriptEntryTargets(entries, files, dir, pkg);
  }
  return entries;
}

const SCRIPT_RUNNER_RE = /\b(?:node|tsx|ts-node|vite-node)\b[ \t]+([^\s&|;<>"']+)/g;

/** Resolves a module spec (relative or root-absolute) against the scanned file set. */
function resolveSpecToFile(dirRel: string, spec: string, fileSet: Set<string>): string | null {
  const clean = (spec.split('?')[0] ?? spec).replace(/^<rootDir>\/?/, '');
  if (!clean) return null;
  // A leading "/" is root-relative (Vite serves `/src/main.tsx` from the project dir): try the file's dir, then the root.
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

function safeReaddir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** `<script type="module" src>` targets in any .html file on disk, read-only. */
function htmlScriptEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const targets = new Set<string>();
  const process = (relPath: string, content: string): void => {
    const re = /<script\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const attrs = m[1] ?? '';
      if (!/\btype\s*=\s*(?:"module"|'module'|module(?![\w-]))/i.test(attrs)) continue;
      const srcM = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
      const spec = srcM?.[1] ?? srcM?.[2] ?? srcM?.[3];
      if (!spec) continue;
      const target = resolveSpecToFile(posixDirname(relPath), spec, files);
      if (target) targets.add(target);
    }
  };
  const walk = (dir: string): void => {
    const entries = safeReaddir(dir);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.html$/i.test(entry.name)) {
        const rel = relative(ctx.rootDir, full).replaceAll('\\', '/');
        process(rel, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(ctx.rootDir);
  return targets;
}

const CONFIG_FILE_RE = /(^|\/)(vite|vitest|jest|webpack|rollup|next|nuxt|astro|svelte|tailwind|postcss|eslint|playwright|cypress|drizzle|prisma)\.config\.[cm]?[jt]s$/i;

const CONFIG_SETUP_RE = /\b(setupFiles|globalSetup|globalSetupFile|input)\s*:\s*(?:\[([^\]]*)\]|"([^"]+)"|'([^']+)')/g;
const CONFIG_SETUP_QUOTED_RE = /["']([^"']+)["']/g;

/**
 * Files referenced by `setupFiles`/`globalSetup` keys of tool configs,
 * resolved relative to the config file's directory.
 */
function configSetupEntryFiles(files: FileEntry[], fileSet: Set<string>): Set<string> {
  const entries = new Set<string>();
  for (const file of files) {
    if (!CONFIG_FILE_RE.test(file.relPath)) continue;
    const dir = posixDirname(file.relPath);
    for (const m of file.content.matchAll(CONFIG_SETUP_RE)) {
      if (m[2] !== undefined) {
        for (const qm of m[2].matchAll(CONFIG_SETUP_QUOTED_RE)) {
          const target = resolveSpecToFile(dir, (qm[1] ?? '').replace(/^<rootDir>\/?/, ''), fileSet);
          if (target) entries.add(target);
        }
      } else {
        const target = resolveSpecToFile(dir, m[3] ?? m[4] ?? '', fileSet);
        if (target) entries.add(target);
      }
    }
  }
  return entries;
}

/**
 * Files picked up by `moduleNameMapper` patterns of tool configs (Jest, Vitest),
 * e.g. moduleNameMapper pattern `^app/(.*)$` mapped to `<rootDir>/app/$1`, resolved
 * against the scanned file set.
 */
function moduleMapperEntryFiles(files: FileEntry[]): Set<string> {
  const entries = new Set<string>();
  const patternsByFile = new Map<string, RegExp[]>();
  const patternRe = /['"`]([^'"`]+)['"`]/g;
  for (const file of files) {
    if (!CONFIG_FILE_RE.test(file.relPath)) continue;
    const patterns: RegExp[] = [];
    for (const m of file.content.matchAll(patternRe)) {
      const pattern = m[1] ?? '';
      if (!pattern.startsWith('^') || !pattern.endsWith('$')) continue;
      try {
        patterns.push(new RegExp(pattern));
      } catch {
        // Invalid pattern: skip it instead of failing the whole scan.
      }
    }
    if (patterns.length > 0) patternsByFile.set(file.relPath, patterns);
  }
  for (const file of files) {
    const patterns = patternsByFile.get(file.relPath);
    if (!patterns) continue;
    const base = file.relPath.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/, '');
    if (!patterns.some((re) => re.test(base))) continue;
    entries.add(file.relPath);
  }
  return entries;
}

/** Files referenced by `run:` script invocations in GitHub workflow files. */
function workflowScriptEntryFiles(ctx: DetectorContext, files: Set<string>): Set<string> {
  const entries = new Set<string>();
  const list = safeReaddir(join(ctx.rootDir, '.github', 'workflows'));
  if (!list) return entries;
  for (const entry of list) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const full = join(ctx.rootDir, '.github', 'workflows', entry.name);
    let content = '';
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(SCRIPT_RUNNER_RE)) {
      const raw = m[1] ?? '';
      if (!raw || raw.startsWith('-')) continue; // runner flags like `node --inspect`
      const target = resolveSpecToFile('', raw, files);
      if (target) entries.add(target);
    }
  }
  return entries;
}

/** Framework routing/app dirs whose files are loaded externally (Next `app/`, Nuxt, Remix, Astro, …). */
function isFrameworkEntryPath(relPath: string): boolean {
  return /(^|\/)(pages|app|layouts|middleware|plugins|server)\//.test(relPath)
    || /(^|\/)src\/routes\/(?:[^/]+\/)*\+[^/]*$/.test(relPath)
    || /(^|\/)middleware\.(ts|js|tsx|jsx|mts|cts)$/i.test(relPath);
}

/** Test/Storybook conventions whose files are entry points. */
function isTestConventionEntry(relPath: string): boolean {
  return /(^|\/)__mocks__\//.test(relPath)
    || /(^|\/)(e2e|cypress|playwright)\//.test(relPath)
    || /(^|\/)\.storybook\//.test(relPath)
    || /[^/]*\.stories?\.[cm]?[jt]sx?$/.test(relPath);
}

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g;
const STAR = '*';
const ASSET_SPEC_RE = /\.(json|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp[34]|webm|wasm|md|txt|html|ya?ml|csv)(\?.*)?$/i;

function identifierCount(content: string, name: string): number {
  const escaped = name.replace(/[$]/g, '\\$');
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  return (content.match(re) ?? []).length;
}

/** Locations where a default export is consumed by a framework or tool, not by an import. */
function isConventionalDefaultFile(relPath: string): boolean {
  return /(^|\/)(app|pages|routes|api|stories|\.storybook|e2e|migrations|scripts|plugins|middleware|layouts|views)\//.test(relPath)
    || /\.(stories|story|config|setup|workspace)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation|\+page|\+layout)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)[\w.-]*\.(config|rc)\.[cm]?[jt]s$/.test(relPath);
}

/** Files whose exports are consumed from outside the scanned code. */
function isRootEntry(relPath: string): boolean {
  return /^(src\/)?(index|main|cli|app|server|bin)\.[cm]?[jt]sx?$/i.test(relPath)
    || /^(docs|benchmark|benchmarks|examples?|fixtures|__fixtures__)\//.test(relPath)
    || CONFIG_FILE_RE.test(relPath)
    || /\.(test|spec|d)\.[cm]?[jt]sx?$/.test(relPath)
    || /(^|\/)(bin|scripts)\//.test(relPath);
}

interface ExportDecl {
  name: string;
  isTypeOnly: boolean;
  file: string;
  line: number;
  column: number;
  /** Number of identifier occurrences that mean "used locally" (the declaration itself excluded). */
  localName: string;
  isListed: boolean;
  isDefault: boolean;
}

interface ReexportInfo {
  named: Array<{ exported: string; target: string; orig: string }>;
  stars: string[];
}

interface Analysis {
  decls: ExportDecl[];
  consumed: Map<string, Set<string>>;
  fuzzy: Set<string>;
}

const analysisCache = new WeakMap<DetectorContext, Analysis>();

const TS_LIKE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Source files treated as entry points: package.json targets (exports/main/bin/
 * scripts), tool-setup, moduleNameMapper and HTML script targets, GitHub workflow
 * script references, framework routing conventions and test/spec/storybook files.
 */
export function entryPointFileSet(ctx: DetectorContext, files: FileEntry[]): Set<string> {
  const fileSet = new Set(files.map((f) => f.relPath));
  const entries = new Set<string>([
    ...manifestEntryFiles(ctx, fileSet),
    ...configSetupEntryFiles(files, fileSet),
    ...moduleMapperEntryFiles(files),
    ...htmlScriptEntryFiles(ctx, fileSet),
    ...workflowScriptEntryFiles(ctx, fileSet),
  ]);
  for (const file of files) {
    if (isRootEntry(file.relPath)
      || isPluginOrIntegrationFile(file.relPath)
      || isFrameworkEntryPath(file.relPath)
      || isTestConventionEntry(file.relPath)) {
      entries.add(file.relPath);
    }
  }
  return entries;
}

function analyze(ctx: DetectorContext): Analysis {
  const cached = analysisCache.get(ctx);
  if (cached) return cached;

  const resolve = createTsSpecResolver(ctx);
  const fileSet = new Set(ctx.files.map((f) => f.relPath));
  const entryPoints = entryPointFileSet(ctx, ctx.files);
  const decls: ExportDecl[] = [];
  const consumed = new Map<string, Set<string>>();
  const fuzzy = new Set<string>();
  const reexports = new Map<string, ReexportInfo>();
  const queue: Array<[string, string]> = [];

  const consume = (file: string, name: string): void => {
    let set = consumed.get(file);
    if (!set) { set = new Set(); consumed.set(file, set); }
    if (set.has(name)) return;
    set.add(name);
    queue.push([file, name]);
  };

  for (const file of ctx.files) {
    if (entryPoints.has(file.relPath)) {
      consume(file.relPath, STAR);
    }

    if (!file.sourceFile) {
      // Vue/Svelte/Astro script blocks are not parsed here: be conservative and treat every identifier as a use.
      if (/\.(vue|svelte|astro)$/.test(file.relPath)) {
        IDENT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IDENT_RE.exec(file.content)) !== null) fuzzy.add(m[0]);
      }
      continue;
    }
    if (!TS_LIKE.has(file.ext)) continue;
    const sf = file.sourceFile;
    const reexp: ReexportInfo = { named: [], stars: [] };
    reexports.set(file.relPath, reexp);

    // local import bindings: local name -> where it came from
    const bindings = new Map<string, { target: string | null; internal: boolean; imported: string }>();
    const nsLocals = new Map<string, { target: string | null; internal: boolean }>();
    const topLevelKinds = new Map<string, boolean>(); // local name -> isTypeOnly

    const useSpec = (spec: string, names: string[] | typeof STAR): void => {
      const res = resolve(spec, file);
      if (!res.internal) return;
      if (!res.target) {
        // Internal specifier we could not map to a file: fall back to name-based matching.
        // Asset imports (json/css/svg…) and default bindings never match by name.
        if (names !== STAR && !ASSET_SPEC_RE.test(spec)) for (const n of names) if (n !== 'default') fuzzy.add(n);
        return;
      }
      if (names === STAR) consume(res.target, STAR);
      else for (const n of names) consume(res.target, n);
    };

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        const res = resolve(spec, file);
        const clause = stmt.importClause;
        if (!clause) continue; // side-effect import: edge only
        if (clause.name) {
          bindings.set(clause.name.text, { target: res.target, internal: res.internal, imported: 'default' });
          useSpec(spec, ['default']);
        }
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) {
          nsLocals.set(nb.name.text, { target: res.target, internal: res.internal });
        } else if (nb) {
          for (const el of nb.elements) {
            const imported = (el.propertyName ?? el.name).text;
            bindings.set(el.name.text, { target: res.target, internal: res.internal, imported });
            useSpec(spec, [imported]);
          }
        }
      } else if (ts.isImportEqualsDeclaration(stmt) && ts.isExternalModuleReference(stmt.moduleReference)
        && ts.isStringLiteral(stmt.moduleReference.expression)) {
        useSpec(stmt.moduleReference.expression.text, STAR);
      } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        const res = resolve(spec, file);
        if (!res.internal) continue;
        if (!res.target) {
          if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) for (const el of stmt.exportClause.elements) fuzzy.add((el.propertyName ?? el.name).text);
          continue;
        }
        if (!stmt.exportClause) reexp.stars.push(res.target);
        else if (ts.isNamespaceExport(stmt.exportClause)) reexp.named.push({ exported: stmt.exportClause.name.text, target: res.target, orig: STAR });
        else for (const el of stmt.exportClause.elements) reexp.named.push({ exported: el.name.text, target: res.target, orig: (el.propertyName ?? el.name).text });
      } else if (ts.isExportAssignment(stmt) && stmt.isExportEquals) {
        consume(file.relPath, STAR);
      }

      // top-level local declarations (needed to resolve `export { a }`)
      if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))) topLevelKinds.set(stmt.name.text, true);
      else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) topLevelKinds.set(stmt.name.text, false);
      else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) topLevelKinds.set(d.name.text, false);
      }
    }

    // Walk the whole file for dynamic imports, require(), import types, namespace usage, import.meta.glob.
    const nsMembers = new Map<string, { members: Set<string>; star: boolean }>();
    for (const name of nsLocals.keys()) nsMembers.set(name, { members: new Set(), star: false });
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const arg0 = node.arguments[0];
        const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        if ((isImportCall || isRequire) && arg0 && ts.isStringLiteralLike(arg0)) {
          const parent = node.parent;
          if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name) && !parent.name.elements.some((e) => e.dotDotDotToken)) {
            useSpec(arg0.text, parent.name.elements.map((e) => (e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : STAR)));
          } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            useSpec(arg0.text, [parent.name.text]);
          } else {
            useSpec(arg0.text, STAR);
          }
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob'
          && ts.isMetaProperty(node.expression.expression) && arg0) {
          const patterns: string[] = [];
          if (ts.isStringLiteralLike(arg0)) patterns.push(arg0.text);
          else if (ts.isArrayLiteralExpression(arg0)) for (const e of arg0.elements) if (ts.isStringLiteralLike(e)) patterns.push(e.text);
          for (const pattern of patterns) {
            const base = pattern.replace(/^!/, '').split(/[*{[]/)[0] ?? '';
            const dir = base.startsWith('/') ? base.slice(1) : base.startsWith('.') ? posixJoin(file.relPath, base) : null;
            if (dir === null) continue;
            for (const other of fileSet) if (other.startsWith(dir.endsWith('/') ? dir : dir.replace(/[^/]*$/, ''))) consume(other, STAR);
          }
        }
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const q = node.qualifier;
        const first = q ? (ts.isIdentifier(q) ? q.text : leftmost(q)) : null;
        useSpec(node.argument.literal.text, first ? [first] : STAR);
      } else if (ts.isIdentifier(node) && nsMembers.has(node.text)) {
        const parent = node.parent;
        const entry = nsMembers.get(node.text)!;
        if (ts.isNamespaceImport(parent)) {
          // declaration site
        } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          entry.members.add(parent.name.text);
        } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
          // unrelated member with the same name
        } else if (ts.isQualifiedName(parent) && parent.left === node) {
          entry.members.add(parent.right.text);
        } else if (ts.isElementAccessExpression(parent) && parent.expression === node && parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)) {
          entry.members.add(parent.argumentExpression.text);
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name) && !parent.name.elements.some((e) => e.dotDotDotToken)) {
          for (const e of parent.name.elements) entry.members.add(e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : STAR);
        } else if (ts.isExportSpecifier(parent) || ts.isShorthandPropertyAssignment(parent) || !isDeclarationName(node)) {
          entry.star = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const [local, info] of nsLocals) {
      const usage = nsMembers.get(local)!;
      if (!info.internal) continue;
      if (!info.target) { for (const m of usage.members) fuzzy.add(m); continue; }
      if (usage.star || usage.members.has(STAR)) consume(info.target, STAR);
      else for (const m of usage.members) consume(info.target, m);
    }

    // exports of this file
    const isAppRouterFile = /(^|\/)(page|layout|route|loading|error|not-found|template|default|middleware|instrumentation)\.[jt]sx?$/.test(file.relPath);
    const seen = new Set<string>();
    const record = (nameNode: ts.Node, exported: string, local: string, isTypeOnly: boolean, isListed: boolean, isDefault = false): void => {
      if (isAppRouterFile && FRAMEWORK_EXPORTS.has(exported)) return;
      if (isTypeOnly && /Props$/.test(exported)) return;
      const key = `${exported}::${isTypeOnly ? 'T' : 'V'}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pos = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf));
      decls.push({ name: exported, isTypeOnly, file: file.relPath, line: pos.line + 1, column: pos.character + 1, localName: local, isListed, isDefault });
    };

    for (const stmt of sf.statements) {
      if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          const binding = bindings.get(local);
          if (binding) {
            // `import { x } from './y'; export { x }` is a re-export.
            if (binding.target) reexp.named.push({ exported: el.name.text, target: binding.target, orig: binding.imported });
            continue;
          }
          if (nsLocals.has(local)) continue;
          const isType = el.isTypeOnly || stmt.isTypeOnly || topLevelKinds.get(local) === true;
          if (!topLevelKinds.has(local)) continue;
          record(el.name, el.name.text, local, isType, true, el.name.text === 'default');
        }
        continue;
      }
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        record(stmt, 'default', 'default', false, false, true);
        continue;
      }
      const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
      const isExported = mods?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isDefault = mods?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      const isDeclare = mods?.some((mod) => mod.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
      if (!isExported) continue;
      if (isDefault) {
        const isType = ts.isInterfaceDeclaration(stmt);
        record(stmt, 'default', 'default', isType, false, true);
        continue;
      }
      if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
        record(stmt.name, stmt.name.text, stmt.name.text, true, false);
      } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
        record(stmt.name, stmt.name.text, stmt.name.text, isDeclare, false);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) record(decl.name, decl.name.text, decl.name.text, isDeclare, false);
        }
      }
    }
  }

  // Propagate usage through re-export chains.
  while (queue.length) {
    const [file, name] = queue.pop()!;
    const info = reexports.get(file);
    if (!info) continue;
    for (const r of info.named) {
      if (name === STAR || r.exported === name) consume(r.target, r.orig);
    }
    for (const target of info.stars) {
      if (name === STAR) consume(target, STAR);
      else if (name !== 'default') consume(target, name);
    }
  }

  const analysis = { decls, consumed, fuzzy };
  analysisCache.set(ctx, analysis);
  return analysis;
}

function leftmost(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : leftmost(name.left);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  return (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && p.name === node;
}

function posixJoin(fromRel: string, rel: string): string {
  const parts = fromRel.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/') + (rel.endsWith('/') ? '/' : '');
}

function findUnused(ctx: DetectorContext, wantTypeOnly: boolean, ruleId: string): Finding[] {
  const { decls, consumed, fuzzy } = analyze(ctx);
  const contentByFile = new Map(ctx.files.map((f) => [f.relPath, f.content]));
  const findings: Finding[] = [];

  for (const exp of decls) {
    if (exp.isTypeOnly !== wantTypeOnly) continue;
    const used = consumed.get(exp.file);
    if (used && (used.has(STAR) || used.has(exp.name))) continue;
    if (fuzzy.has(exp.name)) continue;
    if (exp.isDefault && isConventionalDefaultFile(exp.file)) continue;

    const content = contentByFile.get(exp.file) ?? '';
    const ownCount = exp.isDefault ? 0 : identifierCount(content, exp.localName);
    const isOverExported = ownCount >= (exp.isListed ? 3 : 2);

    const kind = wantTypeOnly ? 'type' : 'symbol';
    findings.push({
      ruleId,
      category: 'dead-code',
      tier: 'structural',
      severity: 'info',
      fixability: 'unsafe',
      confidence: isOverExported ? 0.7 : exp.isDefault ? 0.75 : 0.9,
      file: exp.file,
      span: { line: exp.line, column: exp.column },
      message: exp.isDefault
        ? `Default export \`default\` is never imported by any other file.`
        : isOverExported
          ? `Exported ${kind} \`${exp.name}\` is used only locally; drop the \`export\` keyword.`
          : `Exported ${kind} \`${exp.name}\` has zero references; safe to delete.`,
      evidence: exp.isDefault ? 'export default ...' : `export ... ${exp.name}`,
    });
  }

  return findings;
}

/**
 * Flags runtime value exports never referenced outside their defining file.
 */
export const unusedExportDetector: Detector = {
  id: 'ts/unused-export',
  category: 'dead-code',
  tier: 'structural',
  severity: 'info',
  scope: 'project',
  description: 'Flags runtime value exports that are never referenced in any other file.',
  detect(ctx: DetectorContext): Finding[] {
    return findUnused(ctx, false, this.id);
  },
};

/**
 * Flags exported interfaces/type aliases never referenced outside their defining file.
 */
export const unusedTypeExportDetector: Detector = {
  id: 'ts/unused-type-export',
  category: 'dead-code',
  tier: 'structural',
  severity: 'info',
  scope: 'project',
  description: 'Flags type/interface exports that are never referenced in any other file.',
  detect(ctx: DetectorContext): Finding[] {
    return findUnused(ctx, true, this.id);
  },
};
