import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { VERSION } from '../version.js';

export const FEEDBACK_KINDS = ['false-positive', 'improvement', 'scope-gap'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface FeedbackEntry {
  at: string;
  version: string;
  kind: FeedbackKind;
  rule: string;
  file?: string;
  note: string;
}

export function feedbackPath(rootDir: string): string {
  return join(rootDir, '.unshit', 'feedback.jsonl');
}

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export async function addFeedback(
  rootDir: string,
  entry: Omit<FeedbackEntry, 'at' | 'version'>,
): Promise<FeedbackEntry> {
  const full: FeedbackEntry = { at: new Date().toISOString(), version: VERSION, ...entry };
  const path = feedbackPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(full)}\n`, 'utf8');
  return full;
}

export async function readFeedback(rootDir: string): Promise<FeedbackEntry[]> {
  let raw: string;
  try {
    raw = await readFile(feedbackPath(rootDir), 'utf8');
  } catch {
    return [];
  }
  const entries: FeedbackEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as FeedbackEntry;
      if (parsed && isFeedbackKind(parsed.kind) && typeof parsed.rule === 'string') entries.push(parsed);
    } catch {
      // skip corrupt line
    }
  }
  return entries;
}

/** Markdown backlog grouped by rule, ordered by false-positive count, ready to paste into an issue. */
export function summarizeFeedback(entries: FeedbackEntry[]): string {
  if (entries.length === 0) return 'No feedback recorded yet. Use `unshit note <rule> "<text>" --kind false-positive|improvement|scope-gap`.';
  const byRule = new Map<string, FeedbackEntry[]>();
  for (const e of entries) byRule.set(e.rule, [...(byRule.get(e.rule) ?? []), e]);
  const rules = [...byRule.entries()].sort((a, b) => {
    const fp = (list: FeedbackEntry[]): number => list.filter((e) => e.kind === 'false-positive').length;
    return fp(b[1]) - fp(a[1]) || b[1].length - a[1].length;
  });
  const lines = [`# unshit feedback backlog (${entries.length} notes)`, ''];
  for (const [rule, list] of rules) {
    const counts = FEEDBACK_KINDS.map((k) => `${list.filter((e) => e.kind === k).length} ${k}`).join(', ');
    lines.push(`## ${rule} — ${counts}`);
    for (const e of list) lines.push(`- [${e.kind}] ${e.note}${e.file ? ` (${e.file})` : ''} — v${e.version}, ${e.at.slice(0, 10)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
