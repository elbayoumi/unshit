// Independent classification rules. Each verdict is backed by text evidence;
// nothing here imports unshit's src/ or dist/.
import {
  evidence, verdict, symbolPattern, tokenPattern, linesOf, packageName, findingSymbol,
  pathTokenInLine, KNOWN_EXT,
} from './util.mjs';
import { reexportClosure, resolveSpec } from './model.mjs';

function defaultMemberAccess(raw) {
  return /\b(?:require\s*\(\s*['"][^'"]+['"]\s*\)|import\s*\([^)]*\))\s*\.\s*default\b/.test(raw);
}

function consumerDetail(stmt, name, isDefault, sameFile) {
  const details = [];
  for (const binding of stmt.bindings) {
    if (isDefault && binding.imported === 'default') {
      details.push(`default import as \`${binding.local}\``);
      continue;
    }
    if (isDefault || binding.imported !== name) continue;
    if (binding.imported === '*') {
      const ns = binding.local.replace(/[$]/g, '\\$');
      const member = new RegExp(`(?:\\b${ns}\\s*\\.\\s*|\\b${ns}\\s*\\[\\s*['"])${name.replace(/[$]/g, '\\$')}\\b`);
      if (member.test(sameFile.text)) details.push(`namespace \`${binding.local}.${name}\` usage`);
    } else {
      details.push(`named import of \`${name}\` as \`${binding.local}\``);
    }
  }
  if (isDefault && defaultMemberAccess(stmt.raw)) details.push('`.default` member access on a require/import expression');
  return details;
}

function findConsumers(project, name, isDefault, closure) {
  const found = [];
  const seenStmt = new Set();
  // A module and its mirrored twin are the same module for attribution
  // purposes: an import that resolves into the mirror of the audited file is an
  // import of the audited file (and vice versa).
  const candidates = new Set(closure);
  for (const candidate of closure) {
    const mirror = project.mirrorOf?.get?.(candidate);
    if (mirror) candidates.add(mirror);
  }
  for (const candidate of candidates) {
    for (const stmt of project.statementsByTarget.get(candidate) ?? []) {
      if (seenStmt.has(stmt)) continue;
      seenStmt.add(stmt);
      if (stmt.kind === 'export-from') continue; // chain, not a consumer
      const sameFile = project.byPath.get(stmt.file);
      if (!sameFile) continue;
      for (const detail of consumerDetail(stmt, name, isDefault, sameFile)) found.push({ stmt, detail });
    }
  }
  return found;
}

function reexportChainLines(project, closure) {
  const map = new Map();
  for (const f of project.files) {
    const lines = new Set();
    for (const stmt of f.statements) {
      if (stmt.kind !== 'export-from') continue;
      const inChain = resolveSpec(project, f.path, stmt.spec).some((r) => closure.has(r));
      if (!inChain) continue;
      for (let line = stmt.line; line <= stmt.lastLine; line++) lines.add(line);
    }
    map.set(f.path, lines);
  }
  return map;
}

function collectOccurrences(project, file, name, chainLines) {
  const pattern = symbolPattern(name);
  const occurrences = [];
  for (const f of project.files) {
    // Comments are masked out before matching; documentation prose and lockfile
    // text are not executable evidence, so they never count as usage.
    if (f.category === 'doc' || f.category === 'lock') continue;
    if (f.path === file) continue;
    const ignored = chainLines.get(f.path) ?? new Set();
    const lines = f.text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!ignored.has(i + 1)) {
        pattern.lastIndex = 0;
        const m = pattern.exec(lines[i]);
        if (m && f.mask[offset + m.index]) occurrences.push(evidence(f.path, i + 1, lines[i]));
      }
      offset += lines[i].length + 1;
    }
  }
  return occurrences;
}

function classifyExportLike(project, finding) {
  const file = finding.file;
  const name = findingSymbol(finding);
  if (!project.byPath.has(file) || !name) {
    return verdict(project, finding, 'UNSURE', [], 'Target file or symbol name could not be resolved from the finding');
  }
  const isDefault = name === 'default';
  const closure = reexportClosure(project, file);
  const consumed = findConsumers(project, name, isDefault, closure);
  if (consumed.length > 0) {
    const list = consumed.slice(0, 5).map(({ stmt, detail }) => evidence(stmt.file, stmt.line, `${stmt.raw} (${detail})`));
    return verdict(project, finding, 'CONTRADICTED', list, `Real consumer of \`${name}\` from \`${file}\` (or its re-export chain)`);
  }
  const occurrences = collectOccurrences(project, file, name, reexportChainLines(project, closure));
  if (!isDefault && project.entryFiles.has(file)) {
    const text = project.packageRaw?.text ?? '';
    const line = text.split('\n').findIndex((l) => l.includes(file.replace(/^\.\//, ''))) + 1 || 1;
    return verdict(project, finding, 'UNSURE', [evidence('package.json', line, `public entry point: ${file}`)], 'File is a package entry point; external consumers are invisible to text search');
  }
  if (occurrences.length === 0) {
    return verdict(project, finding, 'CONFIRMED', [], `Name \`${name}\` appears nowhere outside its declaration${isDefault ? ' and no default import was found' : ''}`);
  }
  const reason = isDefault
    ? 'The word "default" occurs in corpus text, but no default import of the file could be resolved; ambiguous by construction'
    : `Name \`${name}\` occurs ${occurrences.length} time(s) outside the declaration, but none could be attributed to an import from \`${file}\``;
  return verdict(project, finding, 'UNSURE', occurrences.slice(0, 5), reason);
}

function classifyUnusedFile(project, finding) {
  const file = finding.file;
  if (!project.byPath.has(file)) {
    return verdict(project, finding, 'UNSURE', [], 'Reported file is not present in the corpus copy');
  }
  const referenced = (project.statementsByTarget.get(file) ?? [])
    .filter((stmt) => stmt.file !== file)
    .map((stmt) => evidence(stmt.file, stmt.line, stmt.raw));
  if (project.entryFiles.has(file)) {
    const line = project.packageRaw?.text.split('\n').findIndex((l) => l.includes(file.replace(/^\.\//, ''))) + 1 || 1;
    referenced.push(evidence('package.json', line, `entry point: ${file}`));
  }
  if (referenced.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', referenced.slice(0, 5), `Resolved import/reference to \`${file}\``);
  }
  const noExt = KNOWN_EXT.reduce((s, ext) => (file.endsWith(ext) ? s.slice(0, -ext.length) : s), file);
  const variants = [...new Set([file, `./${file}`, ...(noExt.includes('/') ? [noExt, `./${noExt}`] : [])])];
  const raw = [];
  for (const f of project.files) {
    if (f.path === file) continue;
    f.text.split('\n').forEach((line, i) => {
      if (variants.some((v) => v.length > 2 && pathTokenInLine(line, v))) raw.push({ ...evidence(f.path, i + 1, line), category: f.category });
    });
  }
  if (raw.length === 0) {
    return verdict(project, finding, 'CONFIRMED', [], `No import, require, reference or path mention of \`${file}\` outside the file itself`);
  }
  const strong = raw.filter((r) => r.category === 'config' || r.category === 'package' || r.category === 'code');
  if (strong.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', strong.slice(0, 5).map(({ file: p, line, text }) => evidence(p, line, text)), `Literal path reference to \`${file}\` in a script/config/code file`);
  }
  return verdict(project, finding, 'UNSURE', raw.slice(0, 5).map(({ file: p, line, text }) => evidence(p, line, text)), `Path text of \`${file}\` appears only in non-executable text`);
}

const DEP_SECTIONS = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

function manifestScope(finding) {
  if (!finding.file.endsWith('package.json')) return { dir: '', manifestPath: 'package.json' };
  const dir = finding.file === 'package.json' ? '' : finding.file.slice(0, -'/package.json'.length);
  return { dir, manifestPath: finding.file };
}

function inScope(path, dir) {
  return dir === '' || path === dir || path.startsWith(`${dir}/`);
}

function manifestReferences(project, manifestPath, name) {
  const file = project.byPath.get(manifestPath);
  if (!file) return [];
  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    return [];
  }
  const re = tokenPattern(name);
  const out = [];
  for (const [key, value] of Object.entries(parsed ?? {})) {
    if (DEP_SECTIONS.has(key)) continue;
    const snippet = `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`;
    re.lastIndex = 0;
    if (!re.test(snippet)) continue;
    const line = file.text.split('\n').findIndex((l) => l.includes(`"${key}"`)) + 1;
    out.push(evidence(manifestPath, line || 1, snippet.replace(/\s+/g, ' ').slice(0, 300)));
  }
  return out;
}

function classifyUnusedDependency(project, finding) {
  const name = (finding.evidence ?? '').trim() || findingSymbol(finding);
  if (!name) return verdict(project, finding, 'UNSURE', [], 'Dependency name could not be read from the finding');
  const { dir, manifestPath } = manifestScope(finding);
  const files = project.files.filter((f) => inScope(f.path, dir));
  const imported = [];
  for (const f of files) {
    for (const stmt of f.statements) {
      if (packageName(stmt.spec) === name) imported.push(evidence(f.path, stmt.line, stmt.raw));
    }
  }
  if (imported.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', imported.slice(0, 5), `Package \`${name}\` is imported/required by a file in its package scope`);
  }
  const manifest = manifestReferences(project, manifestPath, name);
  if (manifest.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', manifest, `Package \`${name}\` is named in a script or config key of \`${manifestPath}\``);
  }
  const token = tokenPattern(name);
  const configNamed = files.filter((f) => {
    const base = f.path.split('/').pop() ?? '';
    token.lastIndex = 0;
    return f.category !== 'doc' && token.test(base);
  });
  if (configNamed.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', configNamed.slice(0, 5).map((f) => evidence(f.path, 1, `config file named for ${name}`)), `A config file named for \`${name}\` exists in its package scope`);
  }
  const strong = linesOf(project, token, { categories: new Set(['code', 'config', 'other']), skip: new Set([manifestPath]), includeComments: false })
    .filter((e) => inScope(e.file, dir));
  if (strong.length > 0) {
    return verdict(project, finding, 'CONTRADICTED', strong.slice(0, 5), `Package \`${name}\` appears in a config/type reference in its package scope`);
  }
  const weakFiles = new Set(files.map((f) => f.path));
  for (const p of weakFiles) if (p.endsWith('package.json')) weakFiles.delete(p);
  const weak = linesOf(project, token, { includeComments: true }).filter((e) => weakFiles.has(e.file));
  if (weak.length > 0) {
    return verdict(project, finding, 'UNSURE', weak.slice(0, 5), `Package \`${name}\` appears only in text (comment/doc/lockfile) in its scope`);
  }
  return verdict(project, finding, 'CONFIRMED', [], `Name \`${name}\` appears nowhere outside its ${dir ? `\`${dir}/package.json\` declaration` : 'package.json declaration'}`);
}

export function classifyFinding(project, finding) {
  switch (finding.ruleId) {
    case 'ts/unused-export':
    case 'ts/unused-type-export':
      return classifyExportLike(project, finding);
    case 'ts/unused-file':
      return classifyUnusedFile(project, finding);
    case 'deps/unused-dependency':
      return classifyUnusedDependency(project, finding);
    default:
      throw new Error(`unsupported oracle rule ${finding.ruleId}`);
  }
}
