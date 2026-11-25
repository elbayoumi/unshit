import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Finding } from '../src/contracts.js';

const BIN = resolve(import.meta.dirname, '../../bin/unshit.js');

interface RpcResponse {
  id: number | string;
  result?: {
    content?: Array<{ type: string; text: string }>;
    serverInfo?: { name?: string; version?: string };
    tools?: Array<{ name: string }>;
  };
}

/** Minimal MCP stdio client: sends JSON-RPC lines to the spawned server, resolves responses by id. */
class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number | string, (value: RpcResponse) => void>();

  constructor(bin: string) {
    this.proc = spawn(process.execPath, [bin, 'mcp'], { stdio: 'pipe' });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: RpcResponse;
      try {
        msg = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        waiter(msg);
      }
    }
  }

  call(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`);
    });
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`MCP call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function withMcp<T>(fn: (client: McpClient) => Promise<T>): Promise<T> {
  const client = new McpClient(BIN);
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function callTool(
  client: McpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ path?: string; verdict?: string; introduced: Finding[]; error?: string }> {
  const res = await withTimeout(client.call('tools/call', { name, arguments: args }), 20000);
  const text = res.result?.content?.[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as { path?: string; verdict?: string; introduced?: Finding[]; error?: string };
  return { path: parsed.path, verdict: parsed.verdict, introduced: parsed.introduced ?? [], error: parsed.error };
}

function toolNames(list: RpcResponse): string[] {
  return (list.result?.tools ?? []).map((tool) => tool.name);
}

async function withTempRepo(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-check-patch-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content, 'utf8');
    }
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('MCP protocol: initialize and tools/list expose unshit_check_patch', async () => {
  await withMcp(async (client) => {
    const init = await withTimeout(client.call('initialize'), 10000);
    assert.equal(init.result?.serverInfo?.name, 'unshit');
    const names = toolNames(await withTimeout(client.call('tools/list'), 10000));
    assert.ok(names.includes('unshit_scan'));
    assert.ok(names.includes('unshit_check_patch'));
  });
});

test('unshit_check_patch: a clean { path, content } edit reports pass with no introduced findings', async () => {
  const content = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
  await withTempRepo({ 'src/app.ts': content }, async (dir) => {
    await withMcp(async (client) => {
      const output = await callTool(client, 'unshit_check_patch', { root: dir, path: 'src/app.ts', content });
      assert.equal(output.verdict, 'pass');
      assert.equal(output.path, 'src/app.ts');
      assert.deepEqual(output.introduced, []);
    });
  });
});

test('unshit_check_patch: a { path, content } edit adding `any` + raw setTimeout reports fail with severity', async () => {
  const before = 'export const ready = true;\n';
  const after = `${before}export const run = (x: any): void => { setTimeout(() => x(), 1000); };\n`;
  await withTempRepo({ 'src/timer.ts': before }, async (dir) => {
    await withMcp(async (client) => {
      const output = await callTool(client, 'unshit_check_patch', { root: dir, path: 'src/timer.ts', content: after });
      assert.equal(output.verdict, 'fail');
      const rules = new Set((output.introduced ?? []).map((finding) => finding.ruleId));
      assert.ok(rules.has('ts/no-explicit-any'), `expected ts/no-explicit-any in ${JSON.stringify(rules)}`);
      assert.ok(rules.has('slop/magic-timer'), `expected slop/magic-timer in ${JSON.stringify(rules)}`);
      for (const finding of output.introduced ?? []) {
        assert.equal(typeof finding.severity, 'string');
        assert.ok(['error', 'warn', 'info'].includes(finding.severity));
      }
    });
  });
});

test('unshit_check_patch: a unified diff is applied and introducing diff reports fail', async () => {
  const diff = [
    '--- a/src/diffed.ts',
    '+++ b/src/diffed.ts',
    '@@ -1,1 +1,2 @@',
    ' export const a = 1;',
    '+export const b: any = 2;',
    '',
  ].join('\n');
  await withTempRepo({ 'src/diffed.ts': 'export const a = 1;\n' }, async (dir) => {
    await withMcp(async (client) => {
      const output = await callTool(client, 'unshit_check_patch', { root: dir, diff });
      assert.equal(output.verdict, 'fail');
      assert.ok((output.introduced ?? []).some((finding) => finding.ruleId === 'ts/no-explicit-any'));
    });
  });
});

test('unshit_check_patch: a unified diff that changes nothing reports pass', async () => {
  const diff = [
    '--- a/src/same.ts',
    '+++ b/src/same.ts',
    '@@ -1,1 +1,2 @@',
    ' export const a = 1;',
    '+// a harmless comment',
    '',
  ].join('\n');
  await withTempRepo({ 'src/same.ts': 'export const a = 1;\n' }, async (dir) => {
    await withMcp(async (client) => {
      const output = await callTool(client, 'unshit_check_patch', { root: dir, diff });
      assert.equal(output.verdict, 'pass');
      assert.equal(output.introduced.length, 0);
    });
  });
});

test('unshit_check_patch: malformed input returns an error payload', async () => {
  await withTempRepo({ 'src/app.ts': 'export const a = 1;\n' }, async (dir) => {
    await withMcp(async (client) => {
      const noInput = await callTool(client, 'unshit_check_patch', { root: dir });
      assert.ok(typeof noInput.error === 'string' && noInput.error.length > 0);
      const badDiff = await callTool(client, 'unshit_check_patch', { root: dir, diff: 'not a diff' });
      assert.ok(typeof badDiff.error === 'string' && badDiff.error.length > 0);
    });
  });
});
