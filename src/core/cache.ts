import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Detector, Finding, UnshitConfig } from '../contracts.js';
import { VERSION } from '../version.js';

interface CacheEntry {
  v: string;
  c: string;
  f: CachedFinding[];
}

interface CachedFinding {
  ruleId: string;
  category: Finding['category'];
  tier: Finding['tier'];
  severity: Finding['severity'];
  fixability: Finding['fixability'];
  confidence: number;
  span: Finding['span'];
  message: string;
  evidence: string;
}

const CROSS_FILE_RULES = new Set(['code/duplicate-block', 'css/design-drift']);

export function isCacheableDetector(detector: Detector): boolean {
  return detector.scope !== 'project' && !CROSS_FILE_RULES.has(detector.id);
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hashConfig(config: UnshitConfig): string {
  // Only fields that affect per-file detector output. Keep stable key order.
  const relevant = {
    include: config.include,
    exclude: config.exclude,
    disabledRules: config.disabledRules,
    godFileMaxLines: config.godFileMaxLines,
    godFileMaxHooks: config.godFileMaxHooks,
    complexityMax: config.complexityMax,
    cloneMinTokens: config.cloneMinTokens,
    layers: config.layers ?? null,
    unassignedLayer: config.unassignedLayer ?? null,
    structure: config.structure ?? null,
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

export class FindingCache {
  private dir: string;
  private cfgHash: string;
  private version: string;
  private enabled = true;
  private ensured = false;

  constructor(rootDir: string, config: UnshitConfig, options?: { noCache?: boolean }) {
    this.dir = join(rootDir, '.unshit', 'cache');
    this.cfgHash = hashConfig(config);
    this.version = VERSION;
    this.enabled = !options?.noCache;
  }

  get(contentHash: string, relPath: string): Finding[] | undefined {
    if (!this.enabled) return undefined;
    try {
      const raw = readFileSync(join(this.dir, `${contentHash}.json`), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      if (entry.v !== this.version || entry.c !== this.cfgHash || !Array.isArray(entry.f)) {
        return undefined;
      }
      return entry.f.map((f) => ({ ...f, file: relPath }));
    } catch {
      return undefined;
    }
  }

  set(contentHash: string, findings: Finding[]): void {
    if (!this.enabled) return;
    try {
      if (!this.ensured) {
        mkdirSync(this.dir, { recursive: true });
        this.ensured = true;
      }
      const entry: CacheEntry = {
        v: this.version,
        c: this.cfgHash,
        f: findings.map((f) => ({
          ruleId: f.ruleId,
          category: f.category,
          tier: f.tier,
          severity: f.severity,
          fixability: f.fixability,
          confidence: f.confidence,
          span: f.span,
          message: f.message,
          evidence: f.evidence,
        })),
      };
      writeFileSync(join(this.dir, `${contentHash}.json`), JSON.stringify(entry));
    } catch {
      /* cache is best-effort; never fail a scan */
    }
  }
}
