import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { evaluateGuard, loadBaseline } from '../core/pinner.js';
import { runScan } from '../core/scanner.js';
import { computeScore } from '../core/scorer.js';
import { VERSION } from '../version.js';
import { explainArchitecture } from './architecture-explain.js';
import { previewFixes } from './fix-preview.js';
import { checkPatch } from './patch-check.js';

interface JsonRpcReq {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendInitialize(req: JsonRpcReq): void {
  send({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'unshit', version: VERSION },
    },
  });
}

function sendToolsList(req: JsonRpcReq): void {
  send({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: {
      tools: [
        { name: 'unshit_scan', description: 'Read-only codebase scan for dead code, clones, CSS !important, i18n leaks, and slop.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'unshit_score', description: 'Compute 0-100 codebase health score.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'unshit_guard', description: 'Verify current codebase against unshit.baseline.json.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
        {
          name: 'unshit_check_patch',
          description: 'Read-only check: the unshit findings a proposed patch (unified diff or { path, content }) would introduce versus current file content; writes nothing to disk.',
          inputSchema: {
            type: 'object',
            properties: {
              root: { type: 'string', description: 'Scan root (default: server working directory).' },
              path: { type: 'string', description: 'File the proposed edit concerns (diff mode: defaults to the diff +++ path).' },
              diff: { type: 'string', description: 'Unified diff to apply to current file content.' },
              content: { type: 'string', description: 'Proposed full file content (alternative to diff).' },
            },
          },
        },
        {
          name: 'unshit_explain_architecture',
          description: 'Read-only layer map (config layers/structure, project shape and structure verdict); with a path, the file\'s layer, allowed imports, importers and architecture findings.',
          inputSchema: {
            type: 'object',
            properties: {
              root: { type: 'string', description: 'Scan root (default: server working directory).' },
              path: { type: 'string', description: 'Optional root-relative file to explain.' },
            },
            required: ['root'],
          },
        },
        {
          name: 'unshit_fix_preview',
          description: 'Read-only dry run: unified diffs of the deterministic safe fixes that would be applied to a file, without writing anything to disk.',
          inputSchema: {
            type: 'object',
            properties: {
              root: { type: 'string', description: 'Scan root (default: server working directory).' },
              path: { type: 'string', description: 'Root-relative file to preview fixes for.' },
              ruleId: { type: 'string', description: 'Optional rule id to restrict the preview.' },
            },
            required: ['root', 'path'],
          },
        },
      ],
    },
  });
}

async function toolPayload(req: JsonRpcReq, rootDir: string): Promise<unknown> {
  const name = String(req.params?.name ?? '');
  const args = (req.params?.arguments ?? {}) as { path?: string; ruleId?: string };
  const fresh = name === 'unshit_explain_architecture' || name === 'unshit_fix_preview';
  const config = await loadConfig(rootDir);
  const scan = await runScan(rootDir, config, [], { noCache: fresh });
  const score = computeScore(scan.files, scan.findings);
  if (name === 'unshit_score') return score;
  if (name === 'unshit_guard') {
    const baseline = await loadBaseline(rootDir);
    return baseline ? evaluateGuard(scan, baseline) : { error: 'Missing unshit.baseline.json. Run unshit pin first.' };
  }
  if (name === 'unshit_explain_architecture') return explainArchitecture(scan, args.path);
  if (name === 'unshit_fix_preview') return previewFixes(scan, args.path ?? '', args.ruleId);
  return { score, findings: scan.findings.slice(0, 100), totalFindings: scan.findings.length };
}

async function handleRequest(req: JsonRpcReq): Promise<void> {
  if (req.method === 'initialize') return sendInitialize(req);
  if (req.method === 'tools/list') return sendToolsList(req);
  if (req.method !== 'tools/call') return;
  if (String(req.params?.name ?? '') === 'unshit_check_patch') return sendCheckPatchResult(req);
  const args = (req.params?.arguments ?? {}) as { path?: string; root?: string };
  const rootDir = resolve(typeof args.root === 'string' ? args.root : (args.path ?? process.cwd()));
  const payload = await toolPayload(req, rootDir);
  send({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
  });
}

/** Routes tools/call to unshit_check_patch with its { path, diff, content } arguments. */
async function sendCheckPatchResult(req: JsonRpcReq): Promise<void> {
  const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
  const rootDir = resolve(typeof args.root === 'string' ? args.root : process.cwd());
  const output = await checkPatch(rootDir, {
    path: typeof args.path === 'string' ? args.path : undefined,
    diff: typeof args.diff === 'string' ? args.diff : undefined,
    content: typeof args.content === 'string' ? args.content : undefined,
  });
  send({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] },
  });
}

/**
 * Minimal stdio MCP server exposing read-only `unshit_scan`, `unshit_score`, `unshit_guard`,
 * `unshit_check_patch`, `unshit_explain_architecture` and `unshit_fix_preview`.
 */
export async function runMcpServer(): Promise<number> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: JsonRpcReq;
    try {
      req = JSON.parse(line) as JsonRpcReq;
    } catch {
      continue;
    }
    await handleRequest(req);
  }

  return 0;
}
