import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayerRule, UnshitConfig } from './contracts.js';

function validateLayers(config: UnshitConfig): void {
  if (!config.layers) return;
  const names = new Set(config.layers.map((l) => l.name));
  for (const layer of config.layers) {
    if (!Array.isArray(layer.include) || layer.include.length === 0) {
      throw new Error(`Layer "${layer.name}" has empty include`);
    }
    if (layer.include.some((g) => typeof g !== 'string' || g.trim() === '')) {
      throw new Error(`Layer "${layer.name}" has empty include glob`);
    }
    for (const dep of layer.allowImportsFrom ?? []) {
      if (!names.has(dep)) {
        throw new Error(`Layer "${layer.name}" allows imports from unknown layer "${dep}"`);
      }
    }
  }
}

function validateStructure(config: UnshitConfig): void {
  const structure: unknown = config.structure;
  if (structure === undefined) return;
  if (typeof structure !== 'object' || structure === null || Array.isArray(structure)) {
    throw new Error('Structure config must be an object');
  }
  const value = structure as Record<string, unknown>;

  if (value.featureContainers !== undefined) {
    if (!Array.isArray(value.featureContainers)) {
      throw new Error('Structure "featureContainers" must be an array of non-empty strings');
    }
    value.featureContainers.forEach((container: unknown, idx: number) => {
      if (typeof container !== 'string' || container.trim() === '') {
        throw new Error(`Structure "featureContainers[${idx}]" must be a non-empty string`);
      }
    });
  }

  if (value.allow !== undefined) {
    if (!Array.isArray(value.allow)) {
      throw new Error('Structure "allow" must be an array of strings containing "->"');
    }
    value.allow.forEach((rule: unknown, idx: number) => {
      if (typeof rule !== 'string' || !rule.includes('->')) {
        throw new Error(`Structure "allow[${idx}]" must be a string containing "->"`);
      }
    });
  }

  if (value.tangleMinFiles !== undefined
    && (typeof value.tangleMinFiles !== 'number'
      || !Number.isFinite(value.tangleMinFiles)
      || value.tangleMinFiles <= 0)) {
    throw new Error('Structure "tangleMinFiles" must be a finite positive number');
  }
}

export const DEFAULT_CONFIG: UnshitConfig = {
  include: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.rs', '.dart', '.py'],
  exclude: [
    'node_modules',
    'dist',
    'build',
    '.git',
    '.oss-bench',
    'docs',
    'research',
    'fixtures',
    '__fixtures__',
    'benchmark/frozen',
    '.unshit',
    'coverage',
    'target',
    'src-tauri',
    '.next',
    'playwright-report',
    'vendor',
    'storage',
    '__pycache__',
    'venv',
    '.venv',
    '.dart_tool',
    'static/lib',
  ],
  disabledRules: [],
  godFileMaxLines: 350,
  godFileMaxHooks: 15,
  complexityMax: 25,
  cloneMinTokens: 80,
  aiRunner: 'opencode',
  aiModel: 'opencode/big-pickle',
};

/**
 * Loads `unshit.config.json` from `rootDir` if present, merged over defaults.
 */
export async function loadConfig(rootDir: string): Promise<UnshitConfig> {
  const configPath = join(rootDir, 'unshit.config.json');
  let parsed: Partial<UnshitConfig> | undefined;
  try {
    const raw = await readFile(configPath, 'utf8');
    parsed = JSON.parse(raw) as Partial<UnshitConfig>;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }

  const config: UnshitConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    include: parsed?.include ?? DEFAULT_CONFIG.include,
    exclude: parsed?.exclude ?? DEFAULT_CONFIG.exclude,
    disabledRules: parsed?.disabledRules ?? DEFAULT_CONFIG.disabledRules,
  };
  if (parsed?.layers !== undefined) config.layers = parsed.layers;
  if (parsed?.unassignedLayer !== undefined) config.unassignedLayer = parsed.unassignedLayer;
  if (parsed?.structure !== undefined) config.structure = parsed.structure;

  validateLayers(config);
  validateStructure(config);
  return config;
}
