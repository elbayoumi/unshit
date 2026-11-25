import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Finding, Patch, ScoreBreakdown, Severity, TextEdit } from '../contracts.js';
import { getChangedLineRanges, type LineRange } from './changed-files.js';
import { formatUnifiedDiff } from './fixers/diff.js';
import { runFix } from './fixer.js';
import { computeScore } from './scorer.js';
import { runScan, type ScanResult } from './scanner.js';

const execFileAsync = promisify(execFile);

/** One finding introduced on changed lines, plus an optional fix diff. */
export interface PrFinding {
  file: string;
  ruleId: string;
  severity: Severity;
  line: number;
  message: string;
  /** Ready unified diff when the deterministic fixer has a safe fix for it. */
  suggestion?: string;
}

export interface PrReport {
  baseRef: string;
  verdict: 'pass' | 'warn' | 'fail';
  findings: PrFinding[];
  errorCount: number;
  warnCount: number;
  infoCount: number;
  /** Current score minus base score when cheaply available, else null. */
  scoreDelta: number | null;
}

const BASE_REF_CANDIDATES = ['main', 'master', 'HEAD~1'] as const;

function findingKey(finding: Finding): string {
  return `${finding.ruleId}|${finding.file}|${finding.span.line}`;
}

/** Inclusive overlap of a finding span with the changed line ranges of its file. */
function overlapsRanges(ranges: LineRange[] | undefined, finding: Finding): boolean {
  if (!ranges || ranges.length === 0) return false;
  const start = finding.span.line;
  const end = finding.span.endLine ?? finding.span.line;
  return ranges.some((range) => start <= range.end && end >= range.start);
}

async function revParseExists(rootDir: string, ref: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: rootDir });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Default PR base: merge-base with origin/main, then main, master, HEAD~1. */
export async function resolvePrBaseRef(rootDir: string, baseArg?: string): Promise<string> {
  if (baseArg) return baseArg;
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: rootDir });
    const sha = stdout.trim();
    if (sha) return sha;
  } catch {
    /* No origin/main in this repository. */
  }
  for (const ref of BASE_REF_CANDIDATES) {
    if (await revParseExists(rootDir, ref)) return ref;
  }
  return 'HEAD';
}

export async function isGitWorkTree(rootDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootDir });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function applyPatchEdits(content: string, edits: TextEdit[]): string {
  let next = content;
  for (const edit of [...edits].sort((a, b) => b.startOffset - a.startOffset)) {
    next = next.slice(0, edit.startOffset) + edit.replacement + next.slice(edit.endOffset);
  }
  return next;
}

/**
 * Builds a per-finding unified diff from the deterministic dry-run fixer
 * (`runFix` never writes when `apply` is false), consuming one patch per finding.
 */
async function collectFixSuggestions(scan: ScanResult, findings: Finding[]): Promise<Map<string, string>> {
  const suggestions = new Map<string, string>();
  const files = new Map(scan.files.map((f) => [f.relPath, f]));
  const patchesByRule = new Map<string, Patch[]>();
  try {
    const summary = await runFix(scan, { apply: false, ai: false });
    for (const patch of summary.deterministicPatches) {
      if (patch.edits.length === 0) continue;
      const key = `${patch.ruleId}|${patch.file}`;
      const list = patchesByRule.get(key) ?? [];
      list.push(patch);
      patchesByRule.set(key, list);
    }
    for (const finding of findings) {
      const patch = patchesByRule.get(`${finding.ruleId}|${finding.file}`)?.shift();
      const file = patch ? files.get(finding.file) : undefined;
      if (!patch || !file) continue;
      const after = applyPatchEdits(file.content, patch.edits);
      const diff = formatUnifiedDiff([{ file: finding.file, before: file.content, after }]);
      if (diff) suggestions.set(findingKey(finding), diff);
    }
  } catch {
    /* Suggestions are best-effort; the report still lists the findings. */
  }
  return suggestions;
}

function countSeverity(findings: PrFinding[], severity: Severity): number {
  return findings.filter((f) => f.severity === severity).length;
}

function verdictFor(findings: PrFinding[]): PrReport['verdict'] {
  if (findings.some((f) => f.severity === 'error')) return 'fail';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'pass';
}

/** Score of the base tree via read-only `git archive` + `tar` into a temp dir. */
async function computeScoreDelta(rootDir: string, baseRef: string, scan: ScanResult): Promise<number | null> {
  let tmp: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['archive', '--format=tar', baseRef], {
      cwd: rootDir,
      maxBuffer: 32 * 1024 * 1024,
    });
    tmp = await mkdtemp(join(tmpdir(), 'unshit-pr-'));
    const archivePath = join(tmp, 'base.tar');
    await writeFile(archivePath, stdout);
    await execFileAsync('tar', ['-xf', archivePath, '-C', tmp]);
    const baseScan = await runScan(tmp, scan.config, [], { noCache: true });
    const current = computeScore(scan.files, scan.findings);
    return current.score - computeScore(baseScan.files, baseScan.findings).score;
  } catch {
    return null;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Reviews the current branch against `baseRef` (default: merge-base with
 * origin/main, falling back to main/master/HEAD~1) and reports only the
 * findings introduced on changed lines. Strictly read-only.
 */
export async function reviewPullRequest(
  rootDir: string,
  scan: ScanResult,
  opts: { baseRef?: string } = {},
): Promise<PrReport> {
  const baseRef = opts.baseRef ?? (await resolvePrBaseRef(rootDir));
  const ranges = await getChangedLineRanges(rootDir, baseRef);
  const findings = scan.findings.filter((f) => overlapsRanges(ranges.get(f.file), f));
  const suggestions = await collectFixSuggestions(scan, findings);
  const prFindings: PrFinding[] = findings.map((f) => ({
    file: f.file,
    ruleId: f.ruleId,
    severity: f.severity,
    line: f.span.line,
    message: f.message,
    ...(suggestions.has(findingKey(f)) ? { suggestion: suggestions.get(findingKey(f)) } : {}),
  }));
  return {
    baseRef,
    verdict: verdictFor(prFindings),
    findings: prFindings,
    errorCount: countSeverity(prFindings, 'error'),
    warnCount: countSeverity(prFindings, 'warn'),
    infoCount: countSeverity(prFindings, 'info'),
    scoreDelta: await computeScoreDelta(rootDir, baseRef, scan),
  };
}

function verdictLabel(verdict: PrReport['verdict']): string {
  return { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[verdict];
}

export function formatPrJson(report: PrReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatPrHuman(report: PrReport): string {
  const counts = `error: ${report.errorCount}, warn: ${report.warnCount}, info: ${report.infoCount}`;
  const lines = [
    `unshit pr: ${verdictLabel(report.verdict)} — base ${report.baseRef} — ${report.findings.length} finding(s) on changed lines (${counts})`,
  ];
  if (report.scoreDelta !== null) {
    lines.push(`score delta vs base: ${report.scoreDelta >= 0 ? '+' : ''}${report.scoreDelta}`);
  }
  lines.push('');
  for (const f of report.findings) {
    lines.push(`${f.file}:${f.line} [${f.severity.toUpperCase()}] ${f.ruleId} — ${f.message}`);
    if (f.suggestion) lines.push(...f.suggestion.split('\n').map((line) => `    ${line}`));
  }
  return lines.join('\n');
}

function escapeMdCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

/** Returns the hunk body only when the diff is exactly one hunk, else ''. */
function suggestionBody(diff: string): string {
  const lines = diff.split('\n');
  const starts = lines.map((line, idx) => (line.startsWith('@@') ? idx : -1)).filter((idx) => idx !== -1);
  if (starts.length !== 1) return '';
  return lines.slice(starts[0]! + 1).join('\n').replace(/\n+$/, '');
}

function appendSuggestionBlock(lines: string[], finding: PrFinding): void {
  if (!finding.suggestion) return;
  const body = suggestionBody(finding.suggestion);
  lines.push(`**Fix** — ${finding.file}:${finding.line} (\`${finding.ruleId}\`):`, '');
  lines.push(body ? '```suggestion' : '```diff');
  lines.push(body || finding.suggestion.replace(/\n+$/, ''));
  lines.push('```', '');
}

export function formatPrMarkdown(report: PrReport): string {
  const lines = [
    `## PR Review — ${verdictLabel(report.verdict)} (base: ${report.baseRef})`,
    '',
    `Findings introduced on changed lines: **${report.findings.length}** (${report.errorCount} errors, ${report.warnCount} warns, ${report.infoCount} infos).`,
  ];
  if (report.scoreDelta !== null) {
    lines.push(`Score delta vs base: ${report.scoreDelta >= 0 ? '+' : ''}${report.scoreDelta}.`);
  }
  lines.push('');
  if (report.findings.length > 0) {
    lines.push('| File | Rule | Severity | Line | Message |');
    lines.push('|---|---|---|---|---|');
    for (const f of report.findings) {
      lines.push(`| \`${f.file}\` | \`${f.ruleId}\` | ${f.severity} | ${f.line} | ${escapeMdCell(f.message)} |`);
    }
    lines.push('');
    for (const f of report.findings) appendSuggestionBlock(lines, f);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
