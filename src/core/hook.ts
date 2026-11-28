import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type TS from 'typescript';
import { loadConfig } from '../config.js';
import type { Detector, FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { highComplexityDetector } from '../detectors/complexity.js';
import { cssDesignDriftDetector, cssDuplicateSelectorDetector, cssNoImportantDetector } from '../detectors/css.js';
import { godFileDetector } from '../detectors/god-file.js';
import { dartHygieneDetector, pythonBareExceptDetector, rustNoUnwrapDetector } from '../detectors/polyglot.js';
import {
  magicTimerDetector,
  noDoubleCastDetector,
  noExplicitAnyDetector,
  noInlineI18nTernaryDetector,
  redundantCatchDetector,
} from '../detectors/ts-ast.js';
import { FindingCache, hashContent } from './cache.js';
import { findingFingerprint, isWaived } from './finding-utils.js';
import { normalizePayload, type NormalizedHookPayload } from './hook-payload.js';

// Hook-eligible detectors: non-project scope, not in SINGLE_FILE_SKIP.
// Keep in sync with BUILTIN_DETECTORS in detectors/index.ts.
const HOOK_DETECTORS: Detector[] = [
  noExplicitAnyDetector,
  noDoubleCastDetector,
  noInlineI18nTernaryDetector,
  magicTimerDetector,
  redundantCatchDetector,
  highComplexityDetector,
  cssNoImportantDetector,
  cssDuplicateSelectorDetector,
  cssDesignDriftDetector,
  godFileDetector,
  rustNoUnwrapDetector,
  dartHygieneDetector,
  pythonBareExceptDetector,
];

const _require = createRequire(import.meta.url);
let _ts: typeof TS | undefined;
function getTs(): typeof TS {
  return (_ts ??= _require('typescript') as typeof TS);
}

export { normalizePayload } from './hook-payload.js';

const SINGLE_FILE_SKIP = new Set(['ts/unused-export', 'code/duplicate-block']);

const BREAKER_PATH = join(tmpdir(), 'unshit-hook-breaker.json');

function getScriptKind(ext: string): TS.ScriptKind {
  const ts = getTs();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

interface ScanSingleOptions {
  noCache?: boolean;
  cache?: FindingCache;
}

/**
 * Scans a single in-memory file payload in milliseconds for live AI agent hooks.
 */
export function scanSingleContent(
  rootDir: string,
  relPath: string,
  content: string,
  config: UnshitConfig,
  options: ScanSingleOptions = {},
): Finding[] {
  const ext = extname(relPath).toLowerCase();
  if (!config.include.includes(ext)) return [];

  const segments = relPath.split(/[\\/]/);
  if (config.exclude.some((ex) => segments.includes(ex))) return [];

  const lines = content.split(/\r?\n/);
  const cache = options.cache ?? new FindingCache(rootDir, config, { noCache: options.noCache });
  const contentHash = hashContent(content);
  const cached = cache.get(contentHash, relPath);
  if (cached) {
    return cached.filter((f) => !isWaived(lines, f));
  }

  const isTs = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
  const file: FileEntry = {
    absPath: resolve(rootDir, relPath),
    relPath,
    ext,
    content,
    lines,
    sourceFile: isTs
      ? getTs().createSourceFile(relPath, content, getTs().ScriptTarget.Latest, true, getScriptKind(ext))
      : undefined,
  };

  const disabled = new Set(config.disabledRules);
  const ctx = { rootDir, config, files: [file] };
  const findings: Finding[] = [];
  for (const detector of HOOK_DETECTORS) {
    if (disabled.has(detector.id) || SINGLE_FILE_SKIP.has(detector.id)) continue;
    if (detector.scope === 'project') continue;
    findings.push(...detector.detect(ctx));
  }

  cache.set(contentHash, findings);
  return findings.filter((f) => !isWaived(file.lines, f));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}



function applyReplacement(text: string, oldStr: string, newStr: string, replaceAll: boolean): string | null {
  if (oldStr === '') {
    return text;
  }
  if (replaceAll) {
    if (!text.includes(oldStr)) return null;
    return text.split(oldStr).join(newStr);
  }
  const idx = text.indexOf(oldStr);
  if (idx === -1) return null;
  return text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
}

async function readBreaker(): Promise<Record<string, number>> {
  try {
    const raw = await readFile(BREAKER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { counts?: Record<string, number> } | Record<string, number>;
    if (parsed && typeof parsed === 'object' && 'counts' in parsed && parsed.counts && typeof parsed.counts === 'object') {
      return parsed.counts as Record<string, number>;
    }
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeBreaker(counts: Record<string, number>): Promise<void> {
  try {
    await writeFile(BREAKER_PATH, JSON.stringify({ counts }, null, 2), 'utf8');
  } catch {
    /* fail open */
  }
}

function isEscaping(rootDir: string, relPath: string): boolean {
  if (relPath === '' ) return false;
  if (isAbsolute(relPath)) return true;
  if (relPath === '..' || relPath.startsWith('..' + '/') || relPath.startsWith('..' + '\\')) return true;
  if (relPath.includes('\0')) return true;
  const abs = resolve(rootDir, relPath);
  const root = resolve(rootDir);
  if (abs !== root && !abs.startsWith(root + '/') && !abs.startsWith(root + '\\')) return true;
  return false;
}

function multisetNewFindings(after: Finding[], before: Finding[]): Finding[] {
  const beforeCounts = new Map<string, number>();
  for (const f of before) {
    const fp = findingFingerprint(f);
    beforeCounts.set(fp, (beforeCounts.get(fp) ?? 0) + 1);
  }
  const result: Finding[] = [];
  for (const f of after) {
    const fp = findingFingerprint(f);
    const c = beforeCounts.get(fp) ?? 0;
    if (c > 0) {
      beforeCounts.set(fp, c - 1);
    } else {
      result.push(f);
    }
  }
  return result;
}

interface HookInvocation {
  rootDir: string;
  targetPath: string;
  overrideContent?: string;
  normalized: NormalizedHookPayload;
}

/** Resolves the edited path and optional in-memory content from CLI args or hook stdin. */
async function readHookInvocation(args: string[]): Promise<HookInvocation | null> {
  const useStdin = args.includes('--stdin');
  let rootDir = process.cwd();
  let targetPath = args.find((a) => !a.startsWith('-'));
  let overrideContent: string | undefined;
  let normalized: NormalizedHookPayload = {};

  if (useStdin) {
    const raw = await readStdin();
    if (!raw.trim()) return null;
    try {
      normalized = normalizePayload(raw);
    } catch {
      return null;
    }
    if (normalized.cwd || normalized.rootDir) rootDir = (normalized.cwd ?? normalized.rootDir)!;
    targetPath = normalized.filePath ?? normalized.file_path ?? normalized.path ?? targetPath;
    if (typeof normalized.content === 'string') {
      overrideContent = normalized.content;
    } else if (typeof normalized.newString === 'string' && !targetPath) {
      overrideContent = normalized.newString;
    } else if (typeof normalized.new_string === 'string' && !targetPath) {
      overrideContent = normalized.new_string;
    }
  }
  if (!targetPath) return null;
  return { rootDir, targetPath, overrideContent, normalized };
}

/** Applies the payload's edits to the on-disk content; null means "ignore this hook event". */
function computeAfterContent(
  beforeContent: string,
  normalized: NormalizedHookPayload,
  overrideContent: string | undefined,
): string | null {
  const edits = normalized.edits ?? [];
  const oldString = normalized.oldString ?? normalized.old_string;
  const newString = normalized.newString ?? normalized.new_string;
  const replaceAll = normalized.replaceAll ?? normalized.replace_all ?? false;
  const content = normalized.content ?? overrideContent;

  if (edits.length > 0) {
    let afterContent = beforeContent;
    for (const edit of edits) {
      const os = edit.oldString ?? edit.old_string;
      if (os === undefined) continue;
      const ns = edit.newString ?? edit.new_string ?? '';
      const ra = edit.replaceAll ?? edit.replace_all ?? false;
      const res = applyReplacement(afterContent, os, ns, ra);
      if (res === null) return null;
      afterContent = res;
    }
    return afterContent;
  }
  if (oldString !== undefined) {
    const res = applyReplacement(beforeContent, oldString, newString ?? '', replaceAll);
    return res === null ? null : res;
  }
  if (content !== undefined) return content;
  if (overrideContent !== undefined) return overrideContent;
  return beforeContent;
}

/** Loop-breaker: after three advisories for the same rule, stop blocking. */
async function breakerAllowsBlock(
  blocking: Finding[],
  normalized: NormalizedHookPayload,
  relPath: string,
): Promise<boolean> {
  const sessionId = normalized.sessionId ?? normalized.session_id ?? '';
  const ruleIds = Array.from(new Set(blocking.map((f) => f.ruleId)));
  const counts = await readBreaker();
  const shouldBreak = ruleIds.some((rid) => (counts[`${sessionId}::${relPath}::${rid}`] ?? 0) >= 3);
  if (shouldBreak) {
    console.error(`[unshit hook] Advisory: loop-breaker triggered for ${relPath}; skipping block.`);
    return false;
  }
  for (const rid of ruleIds) {
    const key = `${sessionId}::${relPath}::${rid}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  await writeBreaker(counts);
  return true;
}

/**
 * Live AI Guardrail Hook: exits 2 (blocking) when error/warn slop is newly introduced in an edited file.
 */
export async function runHook(args: string[]): Promise<number> {
  const invocation = await readHookInvocation(args);
  if (!invocation) return 0;
  const { rootDir, targetPath, overrideContent, normalized } = invocation;
  const absPath = resolve(rootDir, targetPath);
  const relPath = relative(rootDir, absPath).replaceAll('\\', '/');

  if (isEscaping(rootDir, relPath)) return 0;

  const config = await loadConfig(rootDir);

  const segments = relPath.split('/');
  if (config.exclude.some((ex) => segments.includes(ex))) return 0;

  let beforeContent = '';
  try {
    beforeContent = await readFile(absPath, 'utf8');
  } catch {
    beforeContent = '';
  }

  let afterContent: string;
  try {
    const computed = computeAfterContent(beforeContent, normalized, overrideContent);
    if (computed === null) return 0;
    afterContent = computed;
  } catch {
    return 0;
  }

  const noCache = args.includes('--no-cache');
  const cache = new FindingCache(rootDir, config, { noCache });
  const beforeFindings = scanSingleContent(rootDir, relPath, beforeContent, config, { cache });
  const afterFindings = scanSingleContent(rootDir, relPath, afterContent, config, { cache });

  const newFindings = multisetNewFindings(afterFindings, beforeFindings);
  const blocking = newFindings.filter(
    (f) => (f.severity === 'error' || f.severity === 'warn') && f.confidence >= 0.9,
  );

  if (blocking.length === 0) return 0;
  if (!(await breakerAllowsBlock(blocking, normalized, relPath))) return 0;

  console.error(`[unshit hook] Blocked ${blocking.length} slop finding(s) in ${relPath}:`);
  for (const f of blocking.slice(0, 10)) {
    console.error(`  - [${f.ruleId}] line ${f.span.line}: ${f.message}`);
  }
  return 2;
}
