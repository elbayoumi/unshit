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

interface TarjanFrame {
  v: string;
  pi: number;
  neighbors: string[];
}

function popScc(stack: string[], onStack: Set<string>, root: string): string[] {
  const comp: string[] = [];
  let w: string;
  do {
    w = stack.pop()!;
    onStack.delete(w);
    comp.push(w);
  } while (w !== root);
  return comp;
}

// --- Tarjan SCC (iterative) ---
export function tarjanSCC(nodes: string[], adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  const work: TarjanFrame[] = [];
  let idx = 0;

  const pushFrame = (v: string): void => {
    index.set(v, idx);
    lowlink.set(v, idx);
    idx += 1;
    stack.push(v);
    onStack.add(v);
    work.push({ v, pi: 0, neighbors: [...(adj.get(v) ?? [])].sort() });
  };

  const finishFrame = (frame: TarjanFrame): void => {
    if (lowlink.get(frame.v) === index.get(frame.v)) result.push(popScc(stack, onStack, frame.v));
    work.pop();
    const parent = work.at(-1);
    if (parent) lowlink.set(parent.v, Math.min(lowlink.get(parent.v)!, lowlink.get(frame.v)!));
  };

  for (const start of [...nodes].sort()) {
    if (index.has(start)) continue;
    pushFrame(start);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.pi >= frame.neighbors.length) {
        finishFrame(frame);
        continue;
      }
      const w = frame.neighbors[frame.pi++]!;
      if (!index.has(w)) pushFrame(w);
      else if (onStack.has(w)) lowlink.set(frame.v, Math.min(lowlink.get(frame.v)!, index.get(w)!));
    }
  }
  return result;
}

function selfLoop(adj: Map<string, string[]>, node: string): boolean {
  return (adj.get(node) ?? []).includes(node);
}

function makeCycleFinding(
  detector: Detector,
  file: string,
  evidence: string,
  size: number,
  confidence = 1,
): Finding {
  return {
    ruleId: detector.id,
    category: detector.category,
    tier: detector.tier,
    severity: detector.severity,
    fixability: 'manual',
    confidence,
    file,
    span: { line: 1, column: 1 },
    message: `Import cycle detected among ${size} file(s).`,
    evidence,
  };
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
    const cyclic = new Set<string>();
    for (const scc of sccs) {
      const isCycle = scc.length > 1 || (scc.length === 1 && selfLoop(adj, scc[0]));
      if (!isCycle) continue;
      const anchor = [...scc].sort()[0];
      for (const node of scc) cyclic.add(node);
      findings.push(makeCycleFinding(
        this, anchor, shortestCyclePath(anchor, scc, adj), scc.length,
      ));
    }
    for (const file of graph.selfLoops) {
      if (cyclic.has(file)) continue;
      findings.push(makeCycleFinding(this, file, `${file} -> ${file}`, 1, 0.6));
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
