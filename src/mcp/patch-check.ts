import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { loadConfig } from '../config.js';
import type { DetectorContext, FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { findingFingerprint, isWaived } from '../core/finding-utils.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';
import { collectWorkspace } from '../walker.js';

type PatchCheckInput = {
  /** File the proposed edit concerns (diff mode: defaults to the diff's `+++` path). */
  path?: string;
  /** Unified diff applied to the current file content. */
  diff?: string;
  /** Proposed full file content (alternative to diff). */
  content?: string;
};

type PatchCheckOutput =
  | { path: string; verdict: 'pass' | 'fail'; introduced: Finding[] }
  | { error: string };

type ProposedEdit = { path: string; content: string };

interface DiffOp {
  kind: 'context' | 'remove' | 'add';
  text: string;
}

interface DiffHunk {
  oldStart: number;
  ops: DiffOp[];
}

interface DiffSection {
  path: string | null;
  hunks: DiffHunk[];
}

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function scriptKindFor(ext: string): ts.ScriptKind {
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function cleanDiffPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '/dev/null') return null;
  return trimmed.startsWith('b/') || trimmed.startsWith('a/') ? trimmed.slice(2) : trimmed;
}

/** Appends one hunk line (`+`, `-`, or ` `) to the in-progress hunk. */
function pushDiffOp(hunk: DiffHunk, line: string): void {
  if (line.startsWith('+')) hunk.ops.push({ kind: 'add', text: line.slice(1) });
  else if (line.startsWith('-')) hunk.ops.push({ kind: 'remove', text: line.slice(1) });
  else hunk.ops.push({ kind: 'context', text: line.slice(1) });
}

/** Parses the file sections of a unified diff: `---`/`+++` headers plus their hunks. */
function parseDiff(diff: string): DiffSection[] {
  const sections: DiffSection[] = [];
  let current: DiffSection | null = null;
  let hunk: DiffHunk | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const match = HUNK_RE.exec(line);
    if (match && current) {
      hunk = { oldStart: Number(match[1]), ops: [] };
      current.hunks.push(hunk);
    } else if (hunk) {
      pushDiffOp(hunk, line);
    } else if (line.startsWith('--- ')) {
      current = { path: null, hunks: [] };
      sections.push(current);
    } else if (line.startsWith('+++ ') && current && current.path === null) {
      current.path = cleanDiffPath(line.slice(4));
    }
  }
  return sections.filter((section) => section.hunks.length > 0);
}

/** Applies parsed hunks to `content`, returning the resulting file text. */
function applyHunks(content: string, hunks: DiffHunk[]): string {
  const oldLines = splitLines(content);
  const out: string[] = [];
  let oldIdx = 0;
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1);
    while (oldIdx < start && oldIdx < oldLines.length) out.push(oldLines[oldIdx++] as string);
    for (const op of hunk.ops) {
      if (op.kind === 'context') {
        if (oldIdx < oldLines.length) out.push(oldLines[oldIdx] as string);
        oldIdx += 1;
      } else if (op.kind === 'remove') {
        oldIdx += 1;
      } else {
        out.push(op.text);
      }
    }
  }
  while (oldIdx < oldLines.length) out.push(oldLines[oldIdx++] as string);
  const joined = out.join('\n');
  return content.endsWith('\n') && joined.length > 0 ? `${joined}\n` : joined;
}

async function readFileSafe(rootDir: string, relPath: string): Promise<string> {
  try {
    return await readFile(resolve(rootDir, relPath), 'utf8');
  } catch {
    return '';
  }
}

function buildFileEntry(rootDir: string, relPath: string, content: string): FileEntry {
  const ext = extname(relPath).toLowerCase();
  return {
    absPath: resolve(rootDir, relPath),
    relPath,
    ext,
    content,
    lines: splitLines(content),
    sourceFile: TS_EXTS.has(ext)
      ? ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, scriptKindFor(ext))
      : undefined,
  };
}

/**
 * Runs all enabled detectors on the given in-memory file set and returns findings
 * the same way `runScan` does (waiver + dedup + sort).
 */
function scanContents(rootDir: string, config: UnshitConfig, files: FileEntry[], manifests: string[]): Finding[] {
  const disabled = new Set(config.disabledRules);
  const detectors = BUILTIN_DETECTORS.filter((d) => !disabled.has(d.id));
  const fileMap = new Map(files.map((f) => [f.relPath, f]));
  const ctx: DetectorContext = { rootDir, config, files, manifests };
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const detector of detectors) {
    for (const finding of detector.detect(ctx)) {
      const file = fileMap.get(finding.file);
      if (file && isWaived(file.lines, finding)) continue;
      const key = `${finding.ruleId}|${finding.file}|${finding.span.line}|${finding.span.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }
  findings.sort((a, b) =>
    a.file.localeCompare(b.file)
    || a.span.line - b.span.line
    || a.span.column - b.span.column
    || a.ruleId.localeCompare(b.ruleId),
  );
  return findings;
}

/** Builds the proposed edits from a unified diff (diff mode). */
async function buildProposedEdits(rootDir: string, input: PatchCheckInput): Promise<ProposedEdit[] | { error: string }> {
  const parsed = parseDiff(input.diff as string);
  if (parsed.length === 0) return { error: 'Could not parse the diff: no hunks found.' };
  const edits: ProposedEdit[] = [];
  for (const section of parsed) {
    const path = input.path ?? section.path;
    if (!path) return { error: 'The diff has no file path (expected a +++ b/<path> header).' };
    edits.push({ path, content: applyHunks(await readFileSafe(rootDir, path), section.hunks) });
  }
  return edits;
}

/** Collects findings in the after-state that are new versus the before-state (fingerprint diff). */
function introducedFindings(scan: Finding[], beforeKeys: Set<string>, seen: Set<string>): Finding[] {
  const fresh: Finding[] = [];
  for (const finding of scan) {
    const key = findingFingerprint(finding);
    if (beforeKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(finding);
  }
  return fresh;
}

/**
 * Read-only charter: runs the real scanner/detectors on in-memory proposed content
 * and reports only the findings the patch would introduce (new fingerprints) versus
 * the current file content. Nothing is written to disk.
 */
export async function checkPatch(rootDir: string, input: PatchCheckInput): Promise<PatchCheckOutput> {
  const hasDiff = typeof input.diff === 'string' && input.diff.length > 0;
  const hasContent = typeof input.content === 'string' && typeof input.path === 'string';
  if (!hasDiff && !hasContent) {
    return { error: 'Provide either a unified diff or a { path, content } proposed edit.' };
  }

  const proposed: ProposedEdit[] | { error: string } = hasDiff
    ? await buildProposedEdits(rootDir, input)
    : [{ path: input.path as string, content: input.content as string }];
  if ('error' in proposed) return proposed;

  const config = await loadConfig(rootDir);
  const { files, manifests } = await collectWorkspace(rootDir, config);
  const beforeKeys = new Set(scanContents(rootDir, config, files, manifests ?? []).map((f) => findingFingerprint(f)));

  const afterFiles = [...files];
  const introduced: Finding[] = [];
  const seen = new Set<string>();
  for (const edit of proposed) {
    const entry = buildFileEntry(rootDir, edit.path, edit.content);
    const idx = afterFiles.findIndex((f) => f.relPath === edit.path);
    if (idx >= 0) afterFiles[idx] = entry;
    else afterFiles.push(entry);
    introduced.push(...introducedFindings(scanContents(rootDir, config, afterFiles, manifests ?? []), beforeKeys, seen));
  }

  return { path: proposed[0]?.path ?? '', verdict: introduced.length > 0 ? 'fail' : 'pass', introduced };
}
