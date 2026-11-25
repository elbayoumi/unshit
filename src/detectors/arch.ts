import type { Detector, DetectorContext, Finding } from '../contracts.js';
import { buildImportGraph } from '../core/import-graph.js';

function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map<string, RegExp>();
function globMatch(glob: string, value: string): boolean {
  let rx = globCache.get(glob);
  if (!rx) {
    rx = globToRegExp(glob);
    globCache.set(glob, rx);
  }
  return rx.test(value);
}

function layerOf(config: DetectorContext['config'], relPath: string) {
  if (!config.layers) return null;
  for (const layer of config.layers) {
    if (layer.include.some((g) => globMatch(g, relPath))) return layer;
  }
  return null;
}

// --- Tarjan SCC (iterative) ---
function tarjanSCC(nodes: string[], adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let idx = 0;

  const sortedNodes = [...nodes].sort();
  for (const start of sortedNodes) {
    if (index.has(start)) continue;
    const work: { v: string; pi: number }[] = [{ v: start, pi: 0 }];
    index.set(start, idx);
    lowlink.set(start, idx);
    idx += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.v;
      const neighbors = [...(adj.get(v) ?? [])].sort();
      if (frame.pi < neighbors.length) {
        const w = neighbors[frame.pi];
        frame.pi += 1;
        if (!index.has(w)) {
          index.set(w, idx);
          lowlink.set(w, idx);
          idx += 1;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, pi: 0 });
        } else if (onStack.has(w)) {
          const curLow = lowlink.get(v)!;
          const wIndex = index.get(w)!;
          if (wIndex < curLow) lowlink.set(v, wIndex);
        }
      } else {
        if (lowlink.get(v) === index.get(v)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          result.push(comp);
        }
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].v;
          const parentLow = lowlink.get(parent)!;
          const vLow = lowlink.get(v)!;
          if (vLow < parentLow) lowlink.set(parent, vLow);
        }
      }
    }
  }
  return result;
}

function selfLoop(adj: Map<string, string[]>, node: string): boolean {
  return (adj.get(node) ?? []).includes(node);
}

function bfsShortestPath(
  start: string,
  target: string,
  sccSet: Set<string>,
  adj: Map<string, string[]>,
): string[] | null {
  if (start === target) return [start];
  const visited = new Set<string>([start]);
  const prev = new Map<string, string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === target) break;
    const neighbors = [...(adj.get(cur) ?? [])].sort();
    for (const n of neighbors) {
      if (!sccSet.has(n)) continue;
      if (visited.has(n)) continue;
      visited.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(target) && start !== target) {
    // target may be start? handled
  }
  if (!visited.has(target)) return null;
  const path: string[] = [];
  let cur: string | undefined = target;
  while (cur !== undefined) {
    path.unshift(cur);
    if (cur === start) break;
    cur = prev.get(cur);
  }
  return path;
}

function shortestCyclePath(anchor: string, scc: string[], adj: Map<string, string[]>): string {
  const sccSet = new Set(scc);
  if (selfLoop(adj, anchor)) {
    return `${anchor} -> ${anchor}`;
  }
  let best: string[] | null = null;
  const neighbors = [...(adj.get(anchor) ?? [])].sort().filter((n) => sccSet.has(n) && n !== anchor);
  for (const n of neighbors) {
    const p = bfsShortestPath(n, anchor, sccSet, adj);
    if (!p) continue;
    const cycle = [anchor, ...p];
    if (!best || cycle.length < best.length) best = cycle;
  }
  if (!best) {
    // fallback
    best = [anchor, ...scc.filter((x) => x !== anchor).slice(0, 1), anchor];
  }
  return best.join(' -> ');
}

export const importCycleDetector: Detector = {
  id: 'arch/import-cycle',
  category: 'architecture',
  tier: 'structural',
  severity: 'warn',
  scope: 'project',
  description: 'Detects circular import dependencies via Tarjan SCC.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const graph = buildImportGraph(ctx);
    const adj = new Map<string, string[]>();
    for (const node of graph.nodes) {
      adj.set(node, [...(graph.get(node) ?? [])]);
    }
    // include any nodes not in graph? no.

    const sccs = tarjanSCC(graph.nodes, adj);
    for (const scc of sccs) {
      const isCycle = scc.length > 1 || (scc.length === 1 && selfLoop(adj, scc[0]));
      if (!isCycle) continue;
      const anchor = [...scc].sort()[0];
      const evidence = shortestCyclePath(anchor, scc, adj);
      findings.push({
        ruleId: this.id,
        category: this.category,
        tier: this.tier,
        severity: this.severity,
        fixability: 'manual',
        confidence: 1,
        file: anchor,
        span: { line: 1, column: 1 },
        message: `Import cycle detected among ${scc.length} file(s).`,
        evidence,
      });
    }
    return findings;
  },
};

export const layerViolationDetector: Detector = {
  id: 'arch/layer-violation',
  category: 'architecture',
  tier: 'structural',
  severity: 'error',
  scope: 'project',
  description: 'Detects imports that violate configured architecture layer rules.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const config = ctx.config;
    if (!config.layers || config.layers.length === 0) return findings;

    const graph = buildImportGraph(ctx);
    for (const edge of graph.edges) {
      const fromLayer = layerOf(config, edge.from);
      const toLayer = layerOf(config, edge.to);

      if (!fromLayer || !toLayer) {
        if (config.unassignedLayer === 'warn') {
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'manual',
            confidence: 1,
            file: edge.from,
            span: { line: 1, column: 1 },
            message: `Layer violation: unassigned file ${edge.from} imports ${edge.to}.`,
            evidence: `${edge.from} -> ${edge.to}`,
          });
        }
        continue;
      }
      if (fromLayer === toLayer) continue;
      if (fromLayer.allowImportsFrom.includes(toLayer.name)) continue;

      findings.push({
        ruleId: this.id,
        category: this.category,
        tier: this.tier,
        severity: this.severity,
        fixability: 'manual',
        confidence: 1,
        file: edge.from,
        span: { line: 1, column: 1 },
        message: `Layer violation: ${fromLayer.name} may not import ${toLayer.name}.`,
        evidence: `${edge.from} -> ${edge.to}`,
      });
    }
    return findings;
  },
};
