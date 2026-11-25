import { spawn } from 'node:child_process';

const HOOK_COMMAND = 'npx -y unshit hook --stdin';

/** Minimal payload accepted by `unshit hook --stdin`. */
export interface UnshitHookPayload {
  filePath?: string;
  oldString?: string;
  newString?: string;
  content?: string;
}

export interface HookRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface OpenCodeToolHookInput {
  tool?: string;
  sessionID?: string;
  callID?: string;
}

export interface OpenCodeToolHookOutput {
  args?: Record<string, unknown>;
}

export interface OpenCodePluginContext {
  directory?: string;
  worktree?: string;
}

export interface UnshitPluginHooks {
  'tool.execute.before': (
    input: OpenCodeToolHookInput,
    output: OpenCodeToolHookOutput,
  ) => Promise<void>;
}

export type UnshitOpenCodePlugin = (ctx?: OpenCodePluginContext) => Promise<UnshitPluginHooks>;

const EDIT_TOOLS = new Set(['edit', 'write', 'patch', 'apply_patch', 'multiedit', 'multi_edit']);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extracts the hook payload from OpenCode tool arguments. */
export function buildHookPayload(args: Record<string, unknown>): UnshitHookPayload | null {
  const filePath = nonEmptyString(args.filePath) ?? nonEmptyString(args.file_path) ?? nonEmptyString(args.path);
  if (!filePath) return null;

  const payload: UnshitHookPayload = { filePath };
  const oldString = nonEmptyString(args.oldString) ?? nonEmptyString(args.old_string);
  const newString = nonEmptyString(args.newString) ?? nonEmptyString(args.new_string);
  const content = nonEmptyString(args.content);
  if (oldString !== undefined) payload.oldString = oldString;
  if (newString !== undefined) payload.newString = newString;
  if (content !== undefined) payload.content = content;
  return payload;
}

/** Runs `unshit hook --stdin`, returning its exit code and captured output. */
export function invokeUnshitHook(
  payload: UnshitHookPayload,
  options: { cwd?: string; command?: string } = {},
): Promise<HookRunResult> {
  const command = options.command ?? HOOK_COMMAND;
  return new Promise<HookRunResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin?.on('error', () => {
      /* the hook may exit before consuming stdin */
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin?.end(`${JSON.stringify(payload)}\n`);
  });
}

/**
 * Lightweight OpenCode shim: forwards edit/write arguments to the unshit hook
 * and blocks the tool call (exit code 2) when new slop is detected.
 */
export const UnshitPlugin: UnshitOpenCodePlugin = async (ctx) => ({
  'tool.execute.before': async (input, output) => {
    const tool = (input.tool ?? '').toLowerCase();
    if (tool && !EDIT_TOOLS.has(tool)) return;

    const payload = buildHookPayload(output.args ?? {});
    if (!payload) return;

    let result: HookRunResult;
    try {
      result = await invokeUnshitHook(payload, { cwd: ctx?.worktree ?? ctx?.directory });
    } catch (err) {
      // Never break editing when the hook binary is unavailable.
      console.error(`[unshit] hook unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (result.code === 2) {
      const detail = result.stderr.trim() || result.stdout.trim() || 'new slop finding(s)';
      throw new Error(`[unshit] blocked by guardrail hook:\n${detail}`);
    }
  },
});

export const opencodeUnshitPlugin = UnshitPlugin;
export default UnshitPlugin;
