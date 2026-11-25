import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Finding, Severity } from '../contracts.js';
import type { ScanResult } from './scanner.js';

const execFileAsync = promisify(execFile);

const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 4,
  warn: 2,
  info: 0.5,
};

export interface HotspotOptions {
  since?: string;
  top?: number;
}

export interface Hotspot {
  file: string;
  score: number;
  churnCommits: number;
  churnLines: number;
  findings: number;
  weightedFindings: number;
  lines: number;
  /** Alias of `file` (non-enumerable at runtime). */
  path: string;
  relPath?: string;
}

interface Churn {
  commits: number;
  lines: number;
}

/** `git log --numstat` paths are repo-root relative; normalize rename output. */
function normalizeLogPath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      path = JSON.parse(path) as string;
    } catch {
      path = path.slice(1, -1);
    }
  }
  path = path.replaceAll('\\', '/');
  // -M emits `dir/{old => new}/file.ts`, `{old => new}/file.ts`, or `old.ts => new.ts`.
  path = path.replace(/\{([^{}]* => [^{}]*)\}/g, (_match, inner: string) => {
    const parts = inner.split(' => ');
    return parts[parts.length - 1] ?? '';
  });
  if (path.includes(' => ')) {
    const parts = path.split(' => ');
    path = parts[parts.length - 1] ?? path;
  }
  return path.trim();
}

async function getPathPrefix(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: rootDir });
    const rel = relative(stdout.trim(), rootDir).replaceAll('\\', '/');
    return rel && rel !== '.' ? rel : '';
  } catch {
    return '';
  }
}

async function warnIfShallow(rootDir: string): Promise<void> {
  let gitDir = join(rootDir, '.git');
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: rootDir });
    const found = stdout.trim();
    if (found) gitDir = isAbsolute(found) ? found : resolve(rootDir, found);
  } catch {
    /* Not a git repo */
  }
  try {
    await access(join(gitDir, 'shallow'));
    console.warn('unshit hotspots: shallow clone detected; churn history may be incomplete');
  } catch {
    /* Full history */
  }
}

async function collectChurn(rootDir: string, since: string): Promise<Map<string, Churn>> {
  const churn = new Map<string, Churn>();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      [
        '-c',
        'core.quotepath=off',
        'log',
        '--numstat',
        '--no-merges',
        '-M',
        `--since=${since}`,
        '--format=format:__COMMIT__',
      ],
      { cwd: rootDir, maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch {
    /* Not a git repo or invalid --since value */
    return churn;
  }

  const prefix = await getPathPrefix(rootDir);
  let inCommit = false;
  const touchedInCommit = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('__COMMIT__')) {
      inCommit = true;
      touchedInCommit.clear();
      continue;
    }
    if (!inCommit || !line.trim()) continue;
    const columns = line.split('\t');
    if (columns.length < 3) continue;
    const added = columns[0] === '-' ? 0 : Number(columns[0]);
    const deleted = columns[1] === '-' ? 0 : Number(columns[1]);
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(deleted)) continue;
    let file = normalizeLogPath(columns.slice(2).join('\t'));
    if (!file) continue;
    if (prefix) {
      const p = prefix + '/';
      if (file.startsWith(p)) file = file.slice(p.length);
    }
    let entry = churn.get(file);
    if (!entry) {
      entry = { commits: 0, lines: 0 };
      churn.set(file, entry);
    }
    entry.lines += added + deleted;
    if (!touchedInCommit.has(file)) {
      entry.commits += 1;
      touchedInCommit.add(file);
    }
  }
  return churn;
}

/**
 * Ranks existing files by churn-weighted finding density (`unshit hotspots`).
 * Higher scores indicate files worth detoxing first.
 */
export async function computeHotspots(
  rootDir: string,
  scan: ScanResult,
  opts: HotspotOptions = {},
): Promise<Hotspot[]> {
  const limit = opts.top === undefined ? 10 : Math.max(0, Math.floor(opts.top));
  if (limit === 0) return [];

  await warnIfShallow(rootDir);
  const churn = await collectChurn(rootDir, opts.since ?? '90.days');

  const findingsByFile = new Map<string, Finding[]>();
  for (const finding of scan.findings) {
    const found = findingsByFile.get(finding.file);
    if (found) found.push(finding);
    else findingsByFile.set(finding.file, [finding]);
  }

  const hotspots: Hotspot[] = [];
  for (const file of scan.files) {
    const fileChurn = churn.get(file.relPath) ?? { commits: 0, lines: 0 };
    const fileFindings = findingsByFile.get(file.relPath) ?? [];
    const weightedFindings = fileFindings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
    const score =
      Math.log1p(fileChurn.commits + fileChurn.lines * 0.1) *
      ((weightedFindings / Math.max(20, file.lines.length)) * 100);

    const hotspot: Hotspot = {
      file: file.relPath,
      score,
      churnCommits: fileChurn.commits,
      churnLines: fileChurn.lines,
      findings: fileFindings.length,
      weightedFindings,
      lines: file.lines.length,
      path: file.relPath,
    };
    // Convenience aliases that stay out of JSON/deep-equality payloads.
    Object.defineProperty(hotspot, 'path', { enumerable: false });
    Object.defineProperty(hotspot, 'relPath', { value: file.relPath, enumerable: false });
    hotspots.push(hotspot);
  }

  hotspots.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return hotspots.slice(0, limit);
}
