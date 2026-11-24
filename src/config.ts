import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UnshitConfig } from './contracts.js';

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
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UnshitConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      include: parsed.include ?? DEFAULT_CONFIG.include,
      exclude: parsed.exclude ?? DEFAULT_CONFIG.exclude,
      disabledRules: parsed.disabledRules ?? DEFAULT_CONFIG.disabledRules,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
