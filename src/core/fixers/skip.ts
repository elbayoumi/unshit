import type { Finding } from '../../contracts.js';

/** A fix that was deliberately not made, with the reason. */
export interface FixSkip {
  file: string;
  ruleId: string;
  line: number;
  reason: string;
}

/** Shared skip collector so every deterministic fixer reports skips identically. */
export function skipCollector(file: string): {
  skipped: FixSkip[];
  skip: (finding: Finding, reason: string) => void;
} {
  const skipped: FixSkip[] = [];
  return {
    skipped,
    skip: (finding, reason) => {
      skipped.push({ file, ruleId: finding.ruleId, line: finding.span.line, reason });
    },
  };
}
