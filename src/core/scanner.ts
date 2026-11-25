import type { Detector, DetectorContext, FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';
import { collectWorkspace } from '../walker.js';
import { FindingCache, hashContent, isCacheableDetector } from './cache.js';

export interface ScanResult {
  rootDir: string;
  config: UnshitConfig;
  files: FileEntry[];
  manifests?: string[];
  findings: Finding[];
  detectors: Detector[];
}

export interface ScanOptions {
  noCache?: boolean;
}

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

/**
 * Runs all enabled detectors read-only and returns deterministically sorted findings.
 */
export async function runScan(
  rootDir: string,
  config: UnshitConfig,
  extraDetectors: Detector[] = [],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { files, manifests } = await collectWorkspace(rootDir, config);
  const disabled = new Set(config.disabledRules);
  const detectors = [...BUILTIN_DETECTORS, ...extraDetectors].filter((d) => !disabled.has(d.id));
  const fileMap = new Map(files.map((f) => [f.relPath, f]));

  const cacheable: Detector[] = [];
  const crossFile: Detector[] = [];
  for (const detector of detectors) {
    (isCacheableDetector(detector) ? cacheable : crossFile).push(detector);
  }

  const cache = new FindingCache(rootDir, config, { noCache: options.noCache });
  const raw: Finding[] = [];

  for (const file of files) {
    const contentHash = hashContent(file.content);
    const cached = cache.get(contentHash, file.relPath);
    if (cached) {
      raw.push(...cached);
      continue;
    }
    if (cacheable.length === 0) {
      cache.set(contentHash, []);
      continue;
    }
    const ctx: DetectorContext = { rootDir, config, files: [file], manifests };
    const fileFindings: Finding[] = [];
    for (const detector of cacheable) {
      fileFindings.push(...detector.detect(ctx));
    }
    cache.set(contentHash, fileFindings);
    raw.push(...fileFindings);
  }

  if (crossFile.length > 0) {
    const ctx: DetectorContext = { rootDir, config, files, manifests };
    for (const detector of crossFile) {
      raw.push(...detector.detect(ctx));
    }
  }

  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const f of raw) {
    const file = fileMap.get(f.file);
    if (file && isWaived(file.lines, f)) continue;
    const key = `${f.ruleId}|${f.file}|${f.span.line}|${f.span.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
  }

  findings.sort((a, b) =>
    a.file.localeCompare(b.file)
    || a.span.line - b.span.line
    || a.span.column - b.span.column
    || a.ruleId.localeCompare(b.ruleId),
  );

  return { rootDir, config, files, manifests, findings, detectors };
}
