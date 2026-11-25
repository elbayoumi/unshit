import { resolve } from 'node:path';
import type { ScoreBreakdown, Severity, UnshitConfig } from '../contracts.js';
import type { OutputFormat } from '../core/reporters.js';
import type { ScanResult } from '../core/scanner.js';

export const SEV_RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };

export interface CommandContext {
  rest: string[];
  targetDir: string;
  config: UnshitConfig;
  scan: ScanResult;
  score: ScoreBreakdown;
  format: OutputFormat;
}

export function getFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function getOpt(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

export function getTargetPath(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--format' || a === '--runner' || a === '--model' || a === '--fail-on' || a === '--base' || a === '--since' || a === '--top' || a === '--concurrency' || a === '--max-files' || a === '--max-diff-lines' || a === '--kind' || a === '--file') {
      i += 1;
      continue;
    }
    if (!a.startsWith('-')) return resolve(a);
  }
  return process.cwd();
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
