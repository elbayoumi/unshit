import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { loadConfig } from '../config.js';
import type { FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';

const SINGLE_FILE_SKIP = new Set(['ts/unused-export', 'code/duplicate-block']);

const BREAKER_PATH = join(tmpdir(), 'unshit-hook-breaker.json');

function getScriptKind(ext: string): ts.ScriptKind {
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export interface NormalizedHookEdit {
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export interface NormalizedHookPayload {
  filePath?: string;
  targetPath?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  edits?: NormalizedHookEdit[];
  content?: string;
  cwd?: string;
  rootDir?: string;
  sessionId?: string;
  toolName?: string;
  file_path?: string;
  target_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  session_id?: string;
  tool_name?: string;
  path?: string;
  file?: string;
}

function pickString(objs: Array<Record<string, unknown> | null | undefined>, keys: string[]): string | undefined {
  for (const obj of objs) {
    if (!obj) continue;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

function pickBool(objs: Array<Record<string, unknown> | null | undefined>, keys: string[]): boolean | undefined {
  for (const obj of objs) {
    if (!obj) continue;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'boolean') return value;
    }
  }
  return undefined;
}

function normalizeEdit(raw: unknown): NormalizedHookEdit {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const oldString = pickString([r], ['old_string', 'oldString', 'old']);
  const newString = pickString([r], ['new_string', 'newString', 'new']);
  const replaceAll = pickBool([r], ['replace_all', 'replaceAll', 'replaceAllOccurrences']);
  const edit: NormalizedHookEdit = {};
  if (oldString !== undefined) {
    edit.oldString = oldString;
    edit.old_string = oldString;
  }
  if (newString !== undefined) {
    edit.newString = newString;
    edit.new_string = newString;
  }
  if (replaceAll !== undefined) {
    edit.replaceAll = replaceAll;
    edit.replace_all = replaceAll;
  }
  return edit;
}

export function normalizePayload(raw: unknown): NormalizedHookPayload {
  let base: unknown = raw;
  if (typeof raw === 'string') {
    try {
      base = JSON.parse(raw);
    } catch {
      base = {};
    }
  }
  const root = base && typeof base === 'object' ? (base as Record<string, unknown>) : {};
  const toolInput =
    root.tool_input && typeof root.tool_input === 'object'
      ? (root.tool_input as Record<string, unknown>)
      : root.toolInput && typeof root.toolInput === 'object'
        ? (root.toolInput as Record<string, unknown>)
        : root;

  const objs = [toolInput, root];

  const filePath = pickString(objs, ['file_path', 'filePath', 'path', 'file', 'targetPath', 'target_path']);
  const oldString = pickString(objs, ['old_string', 'oldString', 'old']);
  const newString = pickString(objs, ['new_string', 'newString', 'new']);
  const replaceAll = pickBool(objs, ['replace_all', 'replaceAll', 'replaceAllOccurrences']);
  const content = pickString(objs, ['content', 'newContent', 'new_content']);
  const cwd = pickString(objs, ['cwd', 'rootDir', 'root_dir', 'workingDirectory', 'working_directory']);
  const sessionId = pickString(objs, ['session_id', 'sessionId']);
  const toolName = pickString(objs, ['tool_name', 'toolName', 'tool']);

  const rawEdits = toolInput.edits ?? root.edits;
  const edits = Array.isArray(rawEdits) ? rawEdits.map(normalizeEdit) : undefined;

  const result: NormalizedHookPayload = {};
  if (filePath !== undefined) {
    result.filePath = filePath;
    result.file_path = filePath;
    result.path = filePath;
    result.targetPath = filePath;
    result.target_path = filePath;
    result.file = filePath;
  }
  if (oldString !== undefined) {
    result.oldString = oldString;
    result.old_string = oldString;
  }
  if (newString !== undefined) {
    result.newString = newString;
    result.new_string = newString;
  }
  if (replaceAll !== undefined) {
    result.replaceAll = replaceAll;
    result.replace_all = replaceAll;
  }
  if (edits !== undefined) {
    result.edits = edits;
  }
  if (content !== undefined) {
    result.content = content;
  }
  if (cwd !== undefined) {
    result.cwd = cwd;
    result.rootDir = cwd;
  }
  if (sessionId !== undefined) {
    result.sessionId = sessionId;
    result.session_id = sessionId;
  }
  if (toolName !== undefined) {
    result.toolName = toolName;
    result.tool_name = toolName;
  }
  return result;
}

/**
 * Scans a single in-memory file payload in milliseconds for live AI agent hooks.
 */
export function scanSingleContent(
  rootDir: string,
  relPath: string,
  content: string,
  config: UnshitConfig,
): Finding[] {
  const ext = extname(relPath).toLowerCase();
  if (!config.include.includes(ext)) return [];

  const segments = relPath.split(/[\\/]/);
  if (config.exclude.some((ex) => segments.includes(ex))) return [];

  const isTs = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
  const file: FileEntry = {
    absPath: resolve(rootDir, relPath),
    relPath,
    ext,
    content,
    lines: content.split(/\r?\n/),
    sourceFile: isTs
      ? ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, getScriptKind(ext))
      : undefined,
  };

  const disabled = new Set(config.disabledRules);
  const ctx = { rootDir, config, files: [file] };
  const findings: Finding[] = [];
  for (const detector of BUILTIN_DETECTORS) {
    if (disabled.has(detector.id) || SINGLE_FILE_SKIP.has(detector.id)) continue;
    if (detector.scope === 'project') continue;
    findings.push(...detector.detect(ctx));
  }

  return findings.filter((f) => {
    const idx = f.span.line - 1;
    const cur = file.lines[idx] ?? '';
    const prev = idx > 0 ? (file.lines[idx - 1] ?? '') : '';
    const re = new RegExp(`unshit-ignore:\\s*${f.ruleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return !re.test(cur) && !re.test(prev);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function findingFingerprint(f: Finding): string {
  const normEvidence = f.evidence.replace(/\s+/g, ' ').trim();
  return `${f.ruleId}::${f.file}::${normEvidence}`;
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

/**
 * Live AI Guardrail Hook: exits 2 (blocking) when error/warn slop is newly introduced in an edited file.
 */
export async function runHook(args: string[]): Promise<number> {
  const useStdin = args.includes('--stdin');
  let rootDir = process.cwd();
  let targetPath = args.find((a) => !a.startsWith('-'));
  let overrideContent: string | undefined;

  let normalized: NormalizedHookPayload = {};

  if (useStdin) {
    const raw = await readStdin();
    if (!raw.trim()) return 0;
    try {
      normalized = normalizePayload(raw);
    } catch {
      return 0;
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

  if (!targetPath) return 0;
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
    const edits = normalized.edits ?? [];
    const oldString = normalized.oldString ?? normalized.old_string;
    const newString = normalized.newString ?? normalized.new_string;
    const replaceAll = normalized.replaceAll ?? normalized.replace_all ?? false;
    const content = normalized.content ?? overrideContent;

    if (edits.length > 0) {
      afterContent = beforeContent;
      for (const edit of edits) {
        const os = edit.oldString ?? edit.old_string;
        if (os === undefined) continue;
        const ns = edit.newString ?? edit.new_string ?? '';
        const ra = edit.replaceAll ?? edit.replace_all ?? false;
        const res = applyReplacement(afterContent, os, ns, ra);
        if (res === null) return 0;
        afterContent = res;
      }
    } else if (oldString !== undefined) {
      const res = applyReplacement(beforeContent, oldString, newString ?? '', replaceAll);
      if (res === null) return 0;
      afterContent = res;
    } else if (content !== undefined) {
      afterContent = content;
    } else if (overrideContent !== undefined) {
      afterContent = overrideContent;
    } else {
      afterContent = beforeContent;
    }
  } catch {
    return 0;
  }

  const beforeFindings = scanSingleContent(rootDir, relPath, beforeContent, config);
  const afterFindings = scanSingleContent(rootDir, relPath, afterContent, config);

  const newFindings = multisetNewFindings(afterFindings, beforeFindings);
  const blocking = newFindings.filter(
    (f) => (f.severity === 'error' || f.severity === 'warn') && f.confidence >= 0.9,
  );

  if (blocking.length === 0) return 0;

  const sessionId = normalized.sessionId ?? normalized.session_id ?? '';
  const ruleIds = Array.from(new Set(blocking.map((f) => f.ruleId)));
  const counts = await readBreaker();
  const shouldBreak = ruleIds.some((rid) => (counts[`${sessionId}::${relPath}::${rid}`] ?? 0) >= 3);
  if (shouldBreak) {
    console.error(`[unshit hook] Advisory: loop-breaker triggered for ${relPath}; skipping block.`);
    return 0;
  }
  for (const rid of ruleIds) {
    const key = `${sessionId}::${relPath}::${rid}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  await writeBreaker(counts);

  console.error(`[unshit hook] Blocked ${blocking.length} slop finding(s) in ${relPath}:`);
  for (const f of blocking.slice(0, 10)) {
    console.error(`  - [${f.ruleId}] line ${f.span.line}: ${f.message}`);
  }
  return 2;
}
