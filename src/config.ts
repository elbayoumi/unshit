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

export const DEFAULT_CONFIG: UnshitConfig = {
  include: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.rs', '.dart', '.py'],
  exclude: [
    'node_modules',
    'dist',
    'build',
    '.git',
    '.oss-bench',
    '.unshit',
    'coverage',
    'target',
    'src-tauri',
    '.next',
    'playwright-report',
  ],
  disabledRules: [],
  godFileMaxLines: 350,
  godFileMaxHooks: 15,
  cloneMinTokens: 45,
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

  validateLayers(config);
  return config;
}
