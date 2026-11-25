import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { evaluateGuard, loadBaseline } from '../core/pinner.js';
import { runScan } from '../core/scanner.js';
import { computeScore } from '../core/scorer.js';
import { VERSION } from '../version.js';

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
      ],
    },
  });
}

async function toolPayload(req: JsonRpcReq, rootDir: string): Promise<unknown> {
  const name = String(req.params?.name ?? '');
  const config = await loadConfig(rootDir);
  const scan = await runScan(rootDir, config);
  const score = computeScore(scan.files, scan.findings);
  if (name === 'unshit_score') return score;
  if (name === 'unshit_guard') {
    const baseline = await loadBaseline(rootDir);
    return baseline ? evaluateGuard(scan, baseline) : { error: 'Missing unshit.baseline.json. Run unshit pin first.' };
  }
  return { score, findings: scan.findings.slice(0, 100), totalFindings: scan.findings.length };
}

async function handleRequest(req: JsonRpcReq): Promise<void> {
  if (req.method === 'initialize') return sendInitialize(req);
  if (req.method === 'tools/list') return sendToolsList(req);
  if (req.method !== 'tools/call') return;
  const args = (req.params?.arguments ?? {}) as { path?: string };
  const rootDir = resolve(args.path ?? process.cwd());
  const payload = await toolPayload(req, rootDir);
  send({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
  });
}

/**
 * Minimal stdio MCP server exposing read-only `unshit_scan`, `unshit_score`, and `unshit_guard`.
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
