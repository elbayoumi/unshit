import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sampleStratified(findings, { seed, perRulePerCorpus, corpora }) {
  // Dedupe by stable id so the same reported location is not sampled twice.
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const id = stableFindingId(f);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(f);
  }
  // Group by corpus+ruleId
  const groups = new Map();
  for (const f of unique) {
    const corpus = f.corpus;
    const key = `${corpus}\u0000${f.ruleId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  // Stable order of keys
  const keys = [...groups.keys()].sort();
  const sampled = [];
  for (const key of keys) {
    const items = groups.get(key);
    // deterministic shuffle per group using shared rand stream? Better independent per group via derived seed
    // to make stratification stable regardless of group iteration side effects.
    const [corpus, ruleId] = key.split('\u0000');
    const groupRand = mulberry32((seed ^ hashStr(key)) >>> 0);
    const shuffled = shuffle(items, groupRand);
    const cap = perRulePerCorpus;
    const take = shuffled.slice(0, cap);
    // sort taken by file,line for stable output
    take.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
    sampled.push(...take);
  }
  // overall stable sort
  sampled.sort((a, b) => a.corpus.localeCompare(b.corpus) || a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file) || a.line - b.line);
  return sampled;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function stableFindingId(f) {
  return `${f.ruleId}|${f.file}|${f.line}`;
}

export function wilson95(successes, trials) {
  if (trials === 0) return { low: 0, high: 0, center: 0 };
  const z = 1.959963984540054;
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (phat + z2 / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat)) / trials + z2 / (4 * trials * trials));
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    center: phat,
  };
}

export function computePrecision(labels, { excludeUnsureFromDenominator = true } = {}) {
  // labels: array of {ruleId, label: TP|FP|UNSURE}
  const byRule = new Map();
  let totalTP = 0, totalFP = 0, totalUnsure = 0;
  for (const item of labels) {
    const row = byRule.get(item.ruleId) ?? { ruleId: item.ruleId, tp: 0, fp: 0, unsure: 0, total: 0 };
    row.total += 1;
    if (item.label === 'TP') { row.tp += 1; totalTP += 1; }
    else if (item.label === 'FP') { row.fp += 1; totalFP += 1; }
    else if (item.label === 'UNSURE') { row.unsure += 1; totalUnsure += 1; }
    else throw new Error(`Unknown label ${item.label} for ${item.ruleId}`);
    byRule.set(item.ruleId, row);
  }
  const rules = [...byRule.values()].map((r) => {
    const denom = excludeUnsureFromDenominator ? (r.tp + r.fp) : r.total;
    const num = r.tp;
    const precision = denom > 0 ? num / denom : null;
    return { ...r, precision, wilson95: wilson95(num, denom), denominator: denom };
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const pooledDenom = excludeUnsureFromDenominator ? (totalTP + totalFP) : (totalTP + totalFP + totalUnsure);
  return {
    rules,
    pooled: {
      tp: totalTP,
      fp: totalFP,
      unsure: totalUnsure,
      total: totalTP + totalFP + totalUnsure,
      denominator: pooledDenom,
      precision: pooledDenom > 0 ? totalTP / pooledDenom : null,
      wilson95: wilson95(totalTP, pooledDenom),
    },
  };
}

export function copyCorpusToTmp(projectPath, prefix = 'unshit-precision') {
  const name = basename(projectPath);
  const base = mkdtempSync(join(tmpdir(), `${prefix}-${name}-`));
  const work = join(base, name);
  cpSync(projectPath, work, { recursive: true });
  rmSync(join(work, '.git'), { recursive: true, force: true });
  return { base, work };
}

export function scanCorpus(binPath, projectDir, cwd) {
  const out = execFileSync(process.execPath, [binPath, 'scan', projectDir, '--format', 'json', '--no-cache'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  if (!parsed || !Array.isArray(parsed.findings)) throw new Error('scan output missing findings');
  return parsed.findings;
}
