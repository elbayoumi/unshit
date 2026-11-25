import type { Detector, DetectorContext, FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';
import { collectWorkspace } from '../walker.js';
import { FindingCache, hashContent, isCacheableDetector } from './cache.js';
import { isWaived } from './finding-utils.js';

export { findingFingerprint, isWaived } from './finding-utils.js';

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
