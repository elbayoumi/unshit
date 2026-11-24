import type { Category, FileEntry, Finding, ScoreBreakdown, Severity } from '../contracts.js';

const WEIGHT: Record<Severity, number> = {
  error: 4,
  warn: 2,
  info: 0.5,
};

/**
 * Computes a deterministic 0-100 codebase health score from findings and codebase size.
 */
export function computeScore(files: FileEntry[], findings: Finding[]): ScoreBreakdown {
  const totalFiles = files.length;
  const totalLines = files.reduce((acc, f) => acc + f.lines.length, 0);

  const byCategory: Record<Category, number> = {
    css: 0,
    types: 0,
    i18n: 0,
    architecture: 0,
    slop: 0,
    duplication: 0,
    'dead-code': 0,
  };
  const bySeverity: Record<Severity, number> = { error: 0, warn: 0, info: 0 };

  let penaltyPoints = 0;
  for (const f of findings) {
    byCategory[f.category] += 1;
    bySeverity[f.severity] += 1;
    penaltyPoints += WEIGHT[f.severity];
  }

  const kloc = Math.max(1, totalLines / 1000);
  const densityPenalty = (penaltyPoints / kloc) * 1.4;
  const score = Math.max(0, Math.min(100, Math.round(100 - densityPenalty)));

  let grade: ScoreBreakdown['grade'] = 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 78) grade = 'B';
  else if (score >= 62) grade = 'C';
  else if (score >= 45) grade = 'D';

  return {
    score,
    grade,
    totalFiles,
    totalLines,
    totalFindings: findings.length,
    byCategory,
    bySeverity,
  };
}
