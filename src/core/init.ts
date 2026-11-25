import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../config.js';
import { createBaseline } from './pinner.js';
import { runScan } from './scanner.js';

const CONFIG_FILENAME = 'unshit.config.json';
const BASELINE_FILENAME = 'unshit.baseline.json';
const SETTINGS_DIR = '.claude';
const SETTINGS_FILENAME = 'settings.json';
const SETTINGS_BACKUP_FILENAME = 'settings.json.bak';
const HOOK_MATCHER = 'Write|Edit|MultiEdit';
const HOOK_COMMAND = 'npx -y unshit hook --stdin';

type HookEntry = { type?: string; command?: string; [key: string]: unknown };
type HookGroup = { matcher?: string; hooks?: HookEntry[]; [key: string]: unknown };
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(value: unknown, code: string): boolean {
  return (
    value instanceof Error &&
    'code' in value &&
    (value as NodeJS.ErrnoException).code === code
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return false;
    throw err;
  }
}

async function backupSettingsAndReport(
  settingsPath: string,
  backupPath: string,
  raw: string,
  reason: string,
): Promise<number> {
  await writeFile(backupPath, raw, 'utf8');
  console.error(
    `[unshit init] ${reason} in ${settingsPath}; backed up to ${backupPath}. ` +
      `Add this hook manually: matcher "${HOOK_MATCHER}", command "${HOOK_COMMAND}".`,
  );
  return 2;
}

function hasUnshitHook(groups: HookGroup[]): boolean {
  return groups.some(
    (group) =>
      isRecord(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some(
        (hook) =>
          isRecord(hook) &&
          typeof hook.command === 'string' &&
          hook.command.trim() === HOOK_COMMAND,
      ),
  );
}

/**
 * Reads or creates `.claude/settings.json` and adds the unshit PreToolUse hook
 * without removing other settings, hooks, or hook groups.
 */
async function ensureClaudeHook(rootDir: string): Promise<number> {
  const dir = join(rootDir, SETTINGS_DIR);
  const settingsPath = join(dir, SETTINGS_FILENAME);
  const backupPath = join(dir, SETTINGS_BACKUP_FILENAME);

  let raw: string | undefined;
  try {
    raw = await readFile(settingsPath, 'utf8');
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) throw err;
  }

  if (raw === undefined) {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] }] },
    };
    await mkdir(dir, { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    console.log(`[unshit init] Created ${settingsPath} with unshit PreToolUse hook.`);
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return backupSettingsAndReport(
      settingsPath,
      backupPath,
      raw,
      `Invalid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!isRecord(parsed)) {
    return backupSettingsAndReport(settingsPath, backupPath, raw, 'Expected a JSON object');
  }
  if ('hooks' in parsed && parsed.hooks !== undefined && !isRecord(parsed.hooks)) {
    return backupSettingsAndReport(settingsPath, backupPath, raw, 'Invalid "hooks" section');
  }

  const hooks = (isRecord(parsed.hooks) ? parsed.hooks : {}) as Record<string, unknown>;
  if ('PreToolUse' in hooks && hooks.PreToolUse !== undefined && !Array.isArray(hooks.PreToolUse)) {
    return backupSettingsAndReport(settingsPath, backupPath, raw, 'Invalid "hooks.PreToolUse" section');
  }

  const preToolUse = (Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : []) as HookGroup[];
  if (hasUnshitHook(preToolUse)) {
    console.log(`[unshit init] Kept existing unshit hook in ${settingsPath}.`);
    return 0;
  }

  const target = preToolUse.find(
    (group) => isRecord(group) && group.matcher === HOOK_MATCHER,
  );
  if (target) {
    if (target.hooks === undefined) {
      target.hooks = [];
    } else if (!Array.isArray(target.hooks)) {
      return backupSettingsAndReport(settingsPath, backupPath, raw, 'Invalid PreToolUse "hooks" array');
    }
    target.hooks.push({ type: 'command', command: HOOK_COMMAND });
  } else {
    preToolUse.push({
      matcher: HOOK_MATCHER,
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
  }

  const next: ClaudeSettings = {
    ...parsed,
    hooks: { ...hooks, PreToolUse: preToolUse },
  };
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`[unshit init] Merged unshit PreToolUse hook into ${settingsPath}.`);
  return 0;
}

/**
 * Bootstraps unshit config, the Claude Code guardrail hook, and a baseline snapshot.
 * Returns 0 on success and a non-zero exit code on failure.
 */
export async function runInit(rootDir: string, options: { force?: boolean } = {}): Promise<number> {
  const force = options.force === true;
  const configPath = join(rootDir, CONFIG_FILENAME);
  const baselinePath = join(rootDir, BASELINE_FILENAME);

  try {
    if (force || !(await exists(configPath))) {
      await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
      console.log(`[unshit init] Wrote ${configPath}.`);
    } else {
      console.log(`[unshit init] Kept existing ${configPath}.`);
    }

    const settingsCode = await ensureClaudeHook(rootDir);
    if (settingsCode !== 0) return settingsCode;

    if (force || !(await exists(baselinePath))) {
      const config = await loadConfig(rootDir);
      const scan = await runScan(rootDir, config);
      const snapshot = await createBaseline(scan);
      console.log(
        `[unshit init] Wrote ${baselinePath}: ${snapshot.score.score}/100 ` +
          `(${snapshot.fingerprints.length} findings, ${Object.keys(snapshot.fileHashes).length} files).`,
      );
    } else {
      console.log(`[unshit init] Kept existing ${baselinePath}.`);
    }
    return 0;
  } catch (err) {
    console.error(`[unshit init] ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
