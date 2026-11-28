// Files the default scan actually scans, derived from a REAL clean scan of the
// copy through the built unshit (no cache). Shared by recall-extra injectors.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..');

function distUrl(repoRoot, rel) {
  return pathToFileURL(join(repoRoot, 'dist', 'src', rel)).href;
}

/**
 * Files the default scan actually scans, derived from a REAL clean scan of the
 * copy through the built unshit (no cache): same config loading, same walker
 * exclusions (`config.exclude`, dotfiles, `.gitignore`, generated-bundle and
 * vendored-dir filtering), no hard-coded project paths.
 *
 * Returns repo-relative POSIX paths (`FileEntry.relPath`), i.e. `scan.files`.
 */
export async function scannedSourceFiles(work, repoRoot = DEFAULT_REPO_ROOT) {
  const { loadConfig } = await import(distUrl(repoRoot, 'config.js'));
  const { runScan } = await import(distUrl(repoRoot, 'core/scanner.js'));
  const config = await loadConfig(work);
  const scan = await runScan(work, config, [], { noCache: true });
  return scan.files.map((f) => f.relPath);
}
