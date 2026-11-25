import type { Detector, DetectorContext, FileEntry, Finding, UnshitConfig } from '../contracts.js';
import { BUILTIN_DETECTORS } from '../detectors/index.js';
import { collectWorkspace } from '../walker.js';
import { FindingCache, hashContent, isCacheableDetector } from './cache.js';
import { isWaived } from './finding-utils.js';


const DEEP_UNUSED_RULES = new Set(['ts/unused-export', 'ts/unused-type-export']);

async function applyDeepUnusedExports(
  raw: Finding[],
  syntacticUnused: Detector[],
  rootDir: string,
  config: UnshitConfig,
  files: FileEntry[],
  manifests?: string[],
): Promise<void> {
  const ctx: DetectorContext = { rootDir, config, files, manifests };
  try {
    const { detectDeepUnusedExports } = await import('./deep/unused-exports.js');
    const deep = await detectDeepUnusedExports(rootDir, config, files, manifests);
    for (let i = raw.length - 1; i >= 0; i--) {
      const f = raw[i]!;
      if (DEEP_UNUSED_RULES.has(f.ruleId) && deep.analyzedFiles.has(f.file)) raw.splice(i, 1);
    }
    raw.push(...deep.findings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`unshit: --deep unavailable, falling back to syntactic unused-export scan (${msg})`);
    for (const detector of syntacticUnused) raw.push(...detector.detect(ctx));
  }
}
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
  deep?: boolean;
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

  let syntacticUnused: Detector[] = [];
  let crossFileRun = crossFile;
  if (options.deep) {
    syntacticUnused = crossFile.filter((d) => DEEP_UNUSED_RULES.has(d.id));
    crossFileRun = crossFile.filter((d) => !DEEP_UNUSED_RULES.has(d.id));
  }

  if (crossFileRun.length > 0) {
    const ctx: DetectorContext = { rootDir, config, files, manifests };
    for (const detector of crossFileRun) {
      raw.push(...detector.detect(ctx));
    }
  }

  if (options.deep) {
    await applyDeepUnusedExports(raw, syntacticUnused, rootDir, config, files, manifests);
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
