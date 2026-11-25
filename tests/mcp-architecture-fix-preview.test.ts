import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Finding } from '../src/contracts.js';

const BIN = resolve(import.meta.dirname, '../../bin/unshit.js');

interface RpcReply {
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    tools?: Array<{ name: string }>;
  };
}

type Request = { method: string; params?: Record<string, unknown> };

/** Sends a batch of JSON-RPC lines to one stdio server and parses the replies in order. */
function rpc(requests: Request[]): RpcReply[] {
  const input = requests
    .map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request }))
    .join('\n') + '\n';
  const proc = spawnSync(process.execPath, [BIN, 'mcp'], {
    input, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(proc.status, 0, proc.stderr);
  return proc.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RpcReply);
}

function call(name: string, args: Record<string, unknown>): Request {
  return { method: 'tools/call', params: { name, arguments: args } };
}

function payload(reply: RpcReply): Record<string, any> {
  return JSON.parse(reply.result?.content?.[0]?.text ?? '{}') as Record<string, any>;
}

function withRepo(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-mcp-arch-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content, 'utf8');
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LAYERS = [
  { name: 'core', include: ['src/core/**'], allowImportsFrom: ['core'] },
  { name: 'ui', include: ['src/ui/**'], allowImportsFrom: ['core', 'ui'] },
];

const ARCH_FILES: Record<string, string> = {
  'unshit.config.json': JSON.stringify({ layers: LAYERS, structure: { featureContainers: ['features'] } }),
  'src/core/util.ts': 'export const x = 1;\n',
  'src/ui/view.ts': 'import { x } from "../core/util.js";\nexport const y = x;\n',
  'src/core/bad.ts': 'import { y } from "../ui/view.js";\nexport const z = y;\n',
};

test('MCP tools/list exposes both unshit_explain_architecture and unshit_fix_preview', () => {
  const [reply] = rpc([{ method: 'tools/list' }]);
  const names = (reply?.result?.tools ?? []).map((tool) => tool.name);
  assert.ok(names.includes('unshit_explain_architecture'));
  assert.ok(names.includes('unshit_fix_preview'));
});

test('unshit_explain_architecture returns the layer map and explains one file', () => {
  withRepo(ARCH_FILES, (dir) => {
    const [reply] = rpc([call('unshit_explain_architecture', { root: dir, path: 'src/ui/view.ts' })]);
    const result = payload(reply!);
    assert.deepEqual(result.layers, LAYERS);
    assert.deepEqual(result.structure, { featureContainers: ['features'] });
    assert.equal(typeof result.verdict.archetype, 'string');
    assert.equal(result.verdict.graph.graphedFiles, 3);
    assert.equal(result.file.layer, 'ui');
    assert.ok(result.file.mayImport.includes('core'));
    assert.ok(result.file.mayImportFiles.includes('src/core/util.ts'));
    assert.ok(result.file.imports.includes('src/core/util.ts'));
    assert.ok(result.file.importedBy.includes('src/core/bad.ts'));
    assert.deepEqual(result.file.bucket, { root: 'src', bucket: 'ui' });
    const rules = (result.file.findings as Finding[]).map((finding) => finding.ruleId);
    assert.ok(rules.includes('arch/layer-violation'), JSON.stringify(rules));
  });
});

test('unshit_explain_architecture: no path gives the map only; unknown path gives an error', () => {
  withRepo(ARCH_FILES, (dir) => {
    const [mapReply, missingReply] = rpc([
      call('unshit_explain_architecture', { root: dir }),
      call('unshit_explain_architecture', { root: dir, path: 'src/missing.ts' }),
    ]);
    const map = payload(mapReply!);
    assert.ok(Array.isArray(map.layers));
    assert.equal(map.file, undefined);
    const missing = payload(missingReply!);
    assert.match(String(missing.error), /src\/missing\.ts/);
  });
});

test('unshit_fix_preview returns unified diffs for safe fixes without changing the file bytes', () => {
  const source = 'export const orphan = 1;\nexport function f() { try { g(); } catch (e) { throw e; } }\n';
  withRepo({ 'src/sample.ts': source }, (dir) => {
    const file = join(dir, 'src/sample.ts');
    const before = readFileSync(file);
    const [allReply, oneReply] = rpc([
      call('unshit_fix_preview', { root: dir, path: 'src/sample.ts' }),
      call('unshit_fix_preview', { root: dir, path: 'src/sample.ts', ruleId: 'slop/redundant-catch' }),
    ]);
    const all = payload(allReply!);
    assert.equal(all.dryRun, true);
    assert.equal(all.path, 'src/sample.ts');
    const rules = (all.fixes as Array<{ ruleId: string; diff: string }>).map((fix) => fix.ruleId);
    assert.ok(rules.includes('ts/unused-export'), JSON.stringify(rules));
    assert.ok(rules.includes('slop/redundant-catch'), JSON.stringify(rules));
    for (const fix of all.fixes as Array<{ diff: string }>) {
      assert.ok(fix.diff.startsWith('--- a/src/sample.ts\n+++ b/src/sample.ts\n'), fix.diff);
      assert.match(fix.diff, /^@@ /m);
    }
    const one = payload(oneReply!);
    assert.deepEqual((one.fixes as Array<{ ruleId: string }>).map((fix) => fix.ruleId), ['slop/redundant-catch']);
    assert.deepEqual(readFileSync(file), before);
  });
});

test('unshit_fix_preview reports an error for a path outside the scan', () => {
  withRepo({ 'src/sample.ts': 'export const a = 1;\n' }, (dir) => {
    const [reply] = rpc([call('unshit_fix_preview', { root: dir, path: 'src/nope.ts' })]);
    assert.match(String(payload(reply!).error), /src\/nope\.ts/);
  });
});
