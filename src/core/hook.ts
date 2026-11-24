import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { loadConfig } from '../config.js';
import type { FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';

const SINGLE_FILE_SKIP = new Set(['ts/unused-export', 'code/duplicate-block']);

function getScriptKind(ext: string): ts.ScriptKind {
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

interface HookPayload {
  tool_input?: {
    file_path?: string;
    path?: string;
    content?: string;
    new_string?: string;
  };
}

/**
 * Live AI Guardrail Hook: exits 2 (blocking) when error/warn slop is detected in an edited file.
 */
export async function runHook(args: string[]): Promise<number> {
  const useStdin = args.includes('--stdin');
  const rootDir = process.cwd();
  const config = await loadConfig(rootDir);

  let targetPath = args.find((a) => !a.startsWith('-'));
  let overrideContent: string | undefined;

  if (useStdin) {
    const raw = await readStdin();
    if (!raw.trim()) return 0;
    try {
      const parsed = JSON.parse(raw) as HookPayload;
      const input = parsed.tool_input;
      targetPath = input?.file_path ?? input?.path ?? targetPath;
      if (typeof input?.content === 'string') {
        overrideContent = input.content;
      } else if (typeof input?.new_string === 'string' && !targetPath) {
        overrideContent = input.new_string;
      }
    } catch {
      return 0;
    }
  }

  if (!targetPath) return 0;
  const absPath = resolve(rootDir, targetPath);
  const relPath = relative(rootDir, absPath).replaceAll('\\', '/');

  let content = overrideContent;
  if (content === undefined) {
    try {
      content = await readFile(absPath, 'utf8');
    } catch {
      return 0;
    }
  }

  const findings = scanSingleContent(rootDir, relPath, content, config);
  const blocking = findings.filter((f) => f.severity === 'error' || f.severity === 'warn');

  if (blocking.length > 0) {
    console.error(`[unshit hook] Blocked ${blocking.length} slop finding(s) in ${relPath}:`);
    for (const f of blocking.slice(0, 10)) {
      console.error(`  - [${f.ruleId}] line ${f.span.line}: ${f.message}`);
    }
    return 2;
  }

  return 0;
}
