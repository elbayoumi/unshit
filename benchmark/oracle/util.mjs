// Text-search utilities for the independent oracle. No unshit imports.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage', '.cache', '.next', '.nuxt', '.turbo']);
export const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro']);
export const CONFIG_EXT = new Set(['.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.sh', '.bash', '.cmd', '.ps1']);
export const DOC_EXT = new Set(['.md', '.mdx', '.txt', '.rst']);
export const TRY_EXT = ['', '.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
export const KNOWN_EXT = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;

export function toPosix(p) {
  return String(p).split(sep).join('/').replace(/^\.\//, '');
}

function categoryOf(path) {
  const base = path.split('/').pop() ?? '';
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot < 0 ? '' : lower.slice(dot);
  if (lower === 'package.json') return 'package';
  if (/(^|[.-])lock\.(json|yaml)$/.test(lower) || lower === 'yarn.lock') return 'lock';
  if (CODE_EXT.has(ext) || /\.d\.[cm]?ts$/.test(lower)) return 'code';
  if (lower.startsWith('tsconfig') || lower.includes('.config.') || lower.startsWith('.')) return 'config';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (DOC_EXT.has(ext)) return 'doc';
  return 'other';
}

function walk(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(root, full, out);
    } else if (entry.isFile()) {
      let buf;
      try {
        buf = readFileSync(full);
      } catch {
        continue;
      }
      if (buf.length > MAX_FILE_BYTES || buf.includes(0)) continue;
      const path = toPosix(relative(root, full));
      out.push({ path, text: buf.toString('utf8'), category: categoryOf(path) });
    }
  }
}

export function readProjectFiles(root) {
  const files = [];
  walk(root, root, files);
  return files;
}

export function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

export function lineAt(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function codeState(ch, next, state, quote, mask, i) {
  if (state === 'line') {
    if (ch === '\n') return { state: 'code', quote, skip: 0 };
    mask[i] = 0;
    return { state, quote, skip: 0 };
  }
  if (state === 'block') {
    mask[i] = 0;
    if (ch === '*' && next === '/') {
      mask[i + 1] = 0;
      return { state: 'code', quote, skip: 1 };
    }
    return { state, quote, skip: 0 };
  }
  if (state === 'string') {
    if (ch === '\\') return { state, quote, skip: 1 };
    if (ch === quote) return { state: 'code', quote: '', skip: 0 };
    return { state, quote, skip: 0 };
  }
  if (ch === '/' && next === '/') {
    mask[i] = 0;
    mask[i + 1] = 0;
    return { state: 'line', quote, skip: 1 };
  }
  if (ch === '/' && next === '*') {
    mask[i] = 0;
    mask[i + 1] = 0;
    return { state: 'block', quote, skip: 1 };
  }
  if (ch === '"' || ch === "'" || ch === '`') return { state: 'string', quote: ch, skip: 0 };
  return { state: 'code', quote, skip: 0 };
}

/** Non-comment character mask; commented-out imports are not evidence. */
export function codeMask(text) {
  const mask = new Uint8Array(text.length);
  mask.fill(1);
  let state = 'code';
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const next = codeState(text[i], text[i + 1], state, quote, mask, i);
    state = next.state;
    quote = next.quote;
    i += next.skip;
  }
  return mask;
}

export function pathTokenInLine(line, variant) {
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$./-])${escaped}(?![A-Za-z0-9_$./-])`).test(line);
}

export function evidence(file, line, text) {
  return { file, line, text: String(text).trim().replace(/\s+/g, ' ').slice(0, 300) };
}

export function verdict(project, finding, kind, evidenceList, reason) {
  return {
    ruleId: finding.ruleId,
    corpus: finding.corpus ?? null,
    file: finding.file,
    symbol: finding.symbol ?? null,
    verdict: kind,
    reason,
    evidence: evidenceList,
  };
}

export function symbolPattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'g');
}

export function tokenPattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_@/.-])${escaped}(?![A-Za-z0-9_@/.-])`, 'g');
}

export function linesOf(project, pattern, { categories = null, skip = null, includeComments = true } = {}) {
  const found = [];
  for (const f of project.files) {
    if (skip && skip.has(f.path)) continue;
    if (categories && !categories.has(f.category)) continue;
    const lines = f.text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      const m = pattern.exec(lines[i]);
      if (m && (includeComments || f.mask[offset + m.index])) found.push(evidence(f.path, i + 1, lines[i]));
      offset += lines[i].length + 1;
    }
  }
  return found;
}

export function packageName(spec) {
  if (!spec || typeof spec !== 'string') return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || null;
}

export function findingSymbol(finding) {
  if (finding.symbol) return finding.symbol;
  const message = finding.message ?? '';
  const backtick = /`([^`]+)`/.exec(message);
  if (backtick) return backtick[1];
  const text = (finding.evidence ?? '').trim();
  const named = /export\s+(?:\.\.\.\s*)?([A-Za-z_$][\w$]*)$/.exec(text);
  return named ? named[1] : '';
}
