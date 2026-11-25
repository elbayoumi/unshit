import type { Finding } from '../contracts.js';

/**
 * Checks whether `finding` is waived by an `unshit-ignore:` comment on its line or the line above.
 * Supports comma-separated rule IDs and requires exact rule-ID token match.
 */
export function isWaived(lines: string[], finding: Finding): boolean {
  const lineIdx = finding.span.line - 1;
  const candidates = [lines[lineIdx] ?? '', lineIdx > 0 ? (lines[lineIdx - 1] ?? '') : ''];
  for (const text of candidates) {
    const match = /unshit-ignore:\s*([^\n—*]+)/.exec(text);
    if (!match) continue;
    const rawList = (match[1] ?? '').split(/[\s,]+/).filter(Boolean);
    if (rawList.includes(finding.ruleId)) return true;
  }
  return false;
}

export function findingFingerprint(f: Finding): string {
  const normEvidence = f.evidence.replace(/\s+/g, ' ').trim();
  return `${f.ruleId}::${f.file}::${normEvidence}`;
}
