// Corpus model: fresh file walk, regex statement extraction and resolution.
// Imports only local utilities; nothing from unshit's src/ or dist/.
import { join } from 'node:path';
import { toPosix, lineStarts, lineAt, codeMask, readProjectFiles, TRY_EXT, KNOWN_EXT } from './util.mjs';

const STATEMENT_PATTERNS = [
  { kind: 'import', re: /\bimport\s+(?:type\s+)?([\s\S]{0,600}?)\s+from\s*(['"])([^'"]+)\2/g, clause: 1, spec: 3 },
  { kind: 'export-from', re: /\bexport\s+(?:type\s+)?(?:\*\s+as\s+[A-Za-z_$][\w$]*\s*,\s*)?(?:\*\s+from|\{[\s\S]{0,600}?\}\s+from)\s*(['"])([^'"]+)\1/g, spec: 2 },
  { kind: 'import', re: /\bimport\s*(['"])([^'"]+)\1/g, spec: 2 },
  { kind: 'dynamic', re: /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, spec: 2 },
  { kind: 'require', re: /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, spec: 2 },
  { kind: 'type-ref', re: /<\s*reference\s+(path|types|lib)\s*=\s*(['"])([^'"]+)\2\s*\/?\s*>/g, spec: 3, refKind: 1 },
];

function importNamed(inner) {
  const out = [];
  for (const part of inner.split(',')) {
    const item = part.trim().replace(/^type\s+/, '').trim();
    if (!item) continue;
    const alias = /^(\S+)\s+as\s+([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')$/.exec(item);
    if (alias) out.push({ imported: alias[1], local: alias[2].replace(/^['"]|['"]$/g, '') });
    else if (/^[A-Za-z_$][\w$]*$/.test(item)) out.push({ imported: item, local: item });
  }
  return out;
}

function importBindings(clause) {
  if (!clause) return [];
  const c = clause.trim();
  if (c.startsWith('{')) return importNamed(c.slice(c.indexOf('{') + 1, c.lastIndexOf('}')));
  if (c.startsWith('*')) {
    const m = /\bas\s+([A-Za-z_$][\w$]*)/.exec(c);
    return m ? [{ imported: '*', local: m[1] }] : [];
  }
  const m = /^([A-Za-z_$][\w$]*)/.exec(c);
  return m ? [{ imported: 'default', local: m[1] }] : [];
}

function requireBindings(raw) {
  const at = raw.indexOf('require(');
  const before = at >= 0 ? raw.slice(Math.max(0, at - 200), at) : '';
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/.exec(before);
  if (!decl) return [];
  const d = decl[1].trim();
  if (d.startsWith('*')) return importBindings(d);
  if (!d.startsWith('{')) return [{ imported: '*', local: d }];
  const out = [];
  for (const part of d.slice(1, -1).split(',')) {
    const item = part.trim();
    if (!item) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(item);
    out.push(m ? { imported: m[1], local: m[2] } : { imported: item, local: item });
  }
  return out;
}

function parseBindings(kind, raw, clause) {
  if (kind === 'import') return importBindings(clause);
  if (kind === 'require') return requireBindings(raw);
  return [];
}

function extractStatements(file) {
  const starts = lineStarts(file.text);
  const mask = file.mask;
  const statements = [];
  for (const pattern of STATEMENT_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(file.text)) !== null) {
      if (!mask[m.index]) continue;
      const raw = m[0];
      statements.push({
        kind: pattern.kind,
        refKind: pattern.refKind ? m[pattern.refKind] : undefined,
        spec: m[pattern.spec],
        file: file.path,
        line: lineAt(starts, m.index),
        lastLine: lineAt(starts, m.index + raw.length - 1),
        raw: raw.replace(/\s+/g, ' ').trim().slice(0, 400),
        index: m.index,
        bindings: parseBindings(pattern.kind, raw, pattern.clause ? m[pattern.clause] : ''),
      });
    }
  }
  statements.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return statements;
}

function pathCandidates(base) {
  const known = KNOWN_EXT.filter((ext) => base.endsWith(ext));
  const stripped = known.length ? base.slice(0, -known[0].length) : base;
  const out = [base];
  for (const ext of TRY_EXT) {
    out.push(stripped + ext);
    if (!base.endsWith('/index')) out.push(`${stripped}/index${ext}`);
  }
  return [...new Set(out)];
}

export function resolveSpec(project, fromFile, spec, visited = new Set()) {
  if (!spec || typeof spec !== 'string') return [];
  const key = `${fromFile}\0${spec}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const out = [];
  const addBase = (base) => {
    for (const candidate of pathCandidates(toPosix(base))) {
      if (project.byPath.has(candidate)) out.push(candidate);
    }
  };
  if (spec.startsWith('.') || spec.startsWith('/')) {
    addBase(spec.startsWith('/') ? spec.slice(1) : join(fromFile, '..', spec));
    return [...new Set(out)];
  }
  const alias = project.aliasFor(spec);
  if (alias) addBase(alias);
  const self = project.package.name;
  if (self && (spec === self || spec.startsWith(`${self}/`))) {
    const sub = spec === self ? '' : spec.slice(self.length + 1);
    addBase(sub);
    addBase(join('src', sub));
  }
  return [...new Set(out)];
}

function parseAliases(text) {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
  } catch {
    return [];
  }
  const options = parsed?.compilerOptions;
  const paths = options?.paths;
  if (!paths || typeof paths !== 'object') return [];
  const aliases = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || typeof targets[0] !== 'string') continue;
    const star = pattern.indexOf('*');
    aliases.push({
      prefix: star < 0 ? pattern : pattern.slice(0, star),
      suffix: star < 0 ? '' : pattern.slice(star + 1),
      target: toPosix(join(options.baseUrl ?? '.', targets[0])),
      wildcard: star >= 0,
    });
  }
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}

function packageEntryFiles(project) {
  const entries = [];
  const add = (value) => {
    if (typeof value === 'string') entries.push(value);
    else if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === 'object') Object.values(value).forEach(add);
  };
  for (const key of ['main', 'module', 'types', 'typings', 'bin', 'exports']) add(project.package[key]);
  const out = [];
  for (const value of entries) {
    for (const candidate of pathCandidates(value.replace(/^\.\//, ''))) {
      if (project.byPath.has(candidate)) out.push(candidate);
    }
  }
  return [...new Set(out)];
}

function aliasFor(spec) {
  for (const alias of this.aliases) {
    if (alias.wildcard && spec.startsWith(alias.prefix) && spec.endsWith(alias.suffix)) {
      const middle = spec.slice(alias.prefix.length, spec.length - alias.suffix.length || undefined);
      return alias.target.replace('*', middle);
    }
    if (!alias.wildcard && spec === alias.prefix) return alias.target;
  }
  return null;
}

export function buildProject(root) {
  const files = readProjectFiles(root);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const project = { root, files, byPath, package: {}, packageRaw: null, aliases: [], aliasFor };
  const pkgFile = byPath.get('package.json');
  if (pkgFile) {
    project.packageRaw = pkgFile;
    try {
      project.package = JSON.parse(pkgFile.text);
    } catch {
      project.package = {};
    }
  }
  for (const f of files) {
    if (/^tsconfig([./-]|$)/.test(f.path)) project.aliases.push(...parseAliases(f.text));
    f.mask = codeMask(f.text);
    f.statements = extractStatements(f);
  }
  project.aliases.sort((a, b) => b.prefix.length - a.prefix.length);
  project.entryFiles = new Set(packageEntryFiles(project));
  project.statementsByTarget = new Map();
  for (const f of files) {
    for (const stmt of f.statements) {
      for (const target of resolveSpec(project, f.path, stmt.spec)) {
        if (!project.statementsByTarget.has(target)) project.statementsByTarget.set(target, []);
        project.statementsByTarget.get(target).push(stmt);
      }
    }
  }
  return project;
}

export function reexportClosure(project, target) {
  const closure = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of project.files) {
      if (closure.has(f.path)) continue;
      const reexports = f.statements.some((s) => s.kind === 'export-from' && resolveSpec(project, f.path, s.spec).some((r) => closure.has(r)));
      if (reexports) {
        closure.add(f.path);
        changed = true;
      }
    }
  }
  return closure;
}
