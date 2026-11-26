import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

interface CacheIndex {
  v: string;
  c: string;
  entries: Record<string, CachedFinding[]>;
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

function toCachedFindings(findings: Finding[]): CachedFinding[] {
  return findings.map((f) => ({
    ruleId: f.ruleId,
    category: f.category,
    tier: f.tier,
    severity: f.severity,
    fixability: f.fixability,
    confidence: f.confidence,
    span: f.span,
    message: f.message,
    evidence: f.evidence,
  }));
}

function fromCachedFindings(cached: CachedFinding[], relPath: string): Finding[] {
  return cached.map((f) => ({ ...f, file: relPath }));
}

export class FindingCache {
  private dir: string;
  private indexPath: string;
  private cfgHash: string;
  private version: string;
  private enabled = true;
  private ensured = false;
  private indexLoaded = false;
  private indexDirty = false;
  private index: Map<string, CachedFinding[]> = new Map();

  constructor(rootDir: string, config: UnshitConfig, options?: { noCache?: boolean }) {
    this.dir = join(rootDir, '.unshit', 'cache');
    this.indexPath = join(this.dir, '_index.json');
    this.cfgHash = hashConfig(config);
    this.version = VERSION;
    this.enabled = !options?.noCache;
  }

  private loadIndex(): void {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    if (!this.enabled) return;
    try {
      const raw = readFileSync(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as CacheIndex;
      if (parsed.v !== this.version || parsed.c !== this.cfgHash || !parsed.entries || typeof parsed.entries !== 'object') {
        return;
      }
      for (const [hash, findings] of Object.entries(parsed.entries)) {
        if (Array.isArray(findings)) this.index.set(hash, findings);
      }
    } catch {
      /* best-effort; fall back to per-file cache entries */
    }
  }

  get(contentHash: string, relPath: string): Finding[] | undefined {
    if (!this.enabled) return undefined;
    this.loadIndex();
    const indexed = this.index.get(contentHash);
    if (indexed) return fromCachedFindings(indexed, relPath);
    try {
      const raw = readFileSync(join(this.dir, `${contentHash}.json`), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      if (entry.v !== this.version || entry.c !== this.cfgHash || !Array.isArray(entry.f)) {
        return undefined;
      }
      // Promote to in-memory index so repeated lookups (and flush) are cheap.
      this.index.set(contentHash, entry.f);
      this.indexDirty = true;
      return fromCachedFindings(entry.f, relPath);
    } catch {
      return undefined;
    }
  }

  set(contentHash: string, findings: Finding[]): void {
    if (!this.enabled) return;
    this.loadIndex();
    const cached = toCachedFindings(findings);
    this.index.set(contentHash, cached);
    this.indexDirty = true;
    try {
      if (!this.ensured) {
        mkdirSync(this.dir, { recursive: true });
        this.ensured = true;
      }
      const entry: CacheEntry = {
        v: this.version,
        c: this.cfgHash,
        f: cached,
      };
      // Keep per-hash files for compatibility with existing tools/tests.
      writeFileSync(join(this.dir, `${contentHash}.json`), JSON.stringify(entry));
    } catch {
      /* cache is best-effort; never fail a scan */
    }
  }

  flush(): void {
    if (!this.enabled || !this.indexDirty) return;
    try {
      if (!this.ensured) {
        mkdirSync(this.dir, { recursive: true });
        this.ensured = true;
      }
      const payload: CacheIndex = {
        v: this.version,
        c: this.cfgHash,
        entries: Object.fromEntries(this.index),
      };
      const tmp = `${this.indexPath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload));
      renameSync(tmp, this.indexPath);
      this.indexDirty = false;
    } catch {
      /* cache is best-effort; never fail a scan */
    }
  }
}
