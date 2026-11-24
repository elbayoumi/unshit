import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { evaluateGuard, loadBaseline } from '../core/pinner.js';
import { runScan } from '../core/scanner.js';
import { computeScore } from '../core/scorer.js';

interface JsonRpcReq {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
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

    if (req.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'unshit', version: '0.1.0' },
        },
      });
      continue;
    }

    if (req.method === 'tools/list') {
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
      continue;
    }

    if (req.method === 'tools/call') {
      const name = String(req.params?.name ?? '');
      const args = (req.params?.arguments ?? {}) as { path?: string };
      const rootDir = resolve(args.path ?? process.cwd());
      const config = await loadConfig(rootDir);
      const scan = await runScan(rootDir, config);
      const score = computeScore(scan.files, scan.findings);

      let payload: unknown;
      if (name === 'unshit_score') {
        payload = score;
      } else if (name === 'unshit_guard') {
        const baseline = await loadBaseline(rootDir);
        payload = baseline ? evaluateGuard(scan, baseline) : { error: 'Missing unshit.baseline.json. Run unshit pin first.' };
      } else {
        payload = { score, findings: scan.findings.slice(0, 100), totalFindings: scan.findings.length };
      }

      send({
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
      });
    }
  }

  return 0;
}
