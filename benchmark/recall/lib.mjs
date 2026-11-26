import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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

export function pickN(arr, n, rand) {
  return shuffle(arr, rand).slice(0, n);
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

export function findCorpusProject(corpusDir, preferred = 'hono') {
  const candidate = join(corpusDir, preferred);
  if (existsSync(candidate)) return candidate;
  const fallback = ['hono', 'execa', 'zod', 'commander.js', 'fastify']
    .map((n) => join(corpusDir, n))
    .find((p) => existsSync(p));
  if (!fallback) throw new Error(`No corpus project found in ${corpusDir}`);
  return fallback;
}

export function copyCorpusToTmp(projectPath) {
  const name = basename(projectPath);
  const base = mkdtempSync(join(tmpdir(), `unshit-recall-${name}-`));
  const work = join(base, name);
  cpSync(projectPath, work, { recursive: true });
  rmSync(join(work, '.git'), { recursive: true, force: true });
  return { base, work };
}

export function scanJson(binPath, projectDir, cwd) {
  const out = execFileSync(process.execPath, [binPath, 'scan', projectDir, '--format', 'json', '--no-cache'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out);
  if (!parsed || !Array.isArray(parsed.findings)) throw new Error('scan output missing findings');
  return parsed.findings;
}

export function listSourceFiles(root, exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'test', 'tests', '__tests__', 'benchmarks', 'perf-measures', 'examples', 'docs']);
  function walk(dir, rel = '') {
    let entries;
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        walk(dir, rp);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf('.');
        const ext = dot >= 0 ? e.name.slice(dot) : '';
        if (exts.has(ext) && !/\.d\.ts$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !/\.config\./.test(e.name)) out.push(rp);
      }
    }
  }
  walk(root);
  return out;
}

function appendLine(filePath, line) {
  const prev = readFileSync(filePath, 'utf8');
  const sep = prev.endsWith('\n') ? '' : '\n';
  writeFileSync(filePath, prev + sep + line + '\n', 'utf8');
  return prev.split('\n').length + (sep ? 1 : 0); // 1-based line of inserted line
}

function insertAtLine(filePath, lineNumber1Based, text) {
  const prev = readFileSync(filePath, 'utf8');
  const lines = prev.split('\n');
  const idx = Math.max(0, Math.min(lines.length, lineNumber1Based - 1));
  lines.splice(idx, 0, text);
  writeFileSync(filePath, lines.join('\n'), 'utf8');
  return idx + 1;
}

function injectLinePerFile(work, files, n, rand, extRe, build) {
  const candidates = files.filter((f) => extRe.test(f) && !/\.d\.ts$/.test(f));
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const spec = build(i, rand);
    const line = appendLine(join(work, file), spec.text);
    injections.push({ ...spec.meta, file, line });
  }
  return injections;
}

export function injectUnusedExports(work, files, n, rand) {
  return injectLinePerFile(work, files, n, rand, /\.(ts|tsx|js|jsx|mjs|cjs)$/, (i, r) => {
    const marker = `__unshitRecallUnusedExport_${i}_${Math.floor(r() * 1e6)}`;
    return { text: `export function ${marker}(v) { return v + ${i}; }`, meta: { ruleId: 'ts/unused-export', marker, kind: 'unused-export' } };
  });
}

export function injectUnusedFiles(work, n, rand) {
  const dir = existsSync(join(work, 'src')) ? 'src' : '';
  const injections = [];
  for (let i = 0; i < n; i++) {
    const name = `__unshit_recall_unused_file_${i}_${Math.floor(rand() * 1e6)}.ts`;
    const rel = dir ? `${dir}/${name}` : name;
    const abs = join(work, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `export const __unshitRecallUnusedFile_${i} = ${i};\n`, 'utf8');
    injections.push({ ruleId: 'ts/unused-file', file: rel, line: 1, marker: name, kind: 'unused-file' });
  }
  return injections;
}

export function injectUnusedDependencies(work, n, rand) {
  const pkgPath = join(work, 'package.json');
  if (!existsSync(pkgPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {};
  const injections = [];
  for (let i = 0; i < n; i++) {
    const name = `@unshit-recall/unused-dep-${i}-${Math.floor(rand() * 1e6)}`;
    pkg.dependencies[name] = '1.0.0';
    injections.push({ ruleId: 'deps/unused-dependency', file: 'package.json', line: 1, marker: name, kind: 'unused-dependency' });
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  const text = readFileSync(pkgPath, 'utf8').split('\n');
  for (const inj of injections) {
    const idx = text.findIndex((l) => l.includes(`"${inj.marker}"`));
    if (idx >= 0) inj.line = idx + 1;
  }
  return injections;
}

export function injectExplicitAny(work, files, n, rand) {
  return injectLinePerFile(work, files, n, rand, /\.(ts|tsx)$/, (i, r) => {
    const marker = `__unshitRecallAny_${i}_${Math.floor(r() * 1e6)}`;
    return { text: `const ${marker}: any = undefined; void ${marker};`, meta: { ruleId: 'ts/no-explicit-any', marker, kind: 'no-explicit-any' } };
  });
}

export function injectMagicTimers(work, files, n, rand) {
  return injectLinePerFile(work, files, n, rand, /\.(ts|tsx|js|jsx|mjs|cjs)$/, (i, r) => {
    const delay = 1000 + Math.floor(r() * 9000);
    const marker = `__unshitRecallTimer_${i}`;
    return { text: `function ${marker}() { setTimeout(() => { void 0; }, ${delay}); }`, meta: { ruleId: 'slop/magic-timer', marker, kind: 'magic-timer', delay } };
  });
}

function duplicateBlockSource(i) {
  // Enough logic tokens and size to cross cloneMinTokens window with LOGIC_DENSITY_MIN.
  return [
    `export function __unshitRecallDup_${i}(items, flag) {`,
    `  let total = 0;`,
    `  if (!items || items.length === 0) return total;`,
    `  for (let idx = 0; idx < items.length; idx++) {`,
    `    const value = items[idx];`,
    `    if (value === undefined) continue;`,
    `    if (flag && value > 10) {`,
    `      total += value * 2;`,
    `    } else if (!flag && value < 0) {`,
    `      total -= value;`,
    `    } else {`,
    `      total += value;`,
    `    }`,
    `    if (total > 1000) break;`,
    `  }`,
    `  while (total < 0) {`,
    `    total += 1;`,
    `  }`,
    `  switch (total % 3) {`,
    `    case 0: total += 1; break;`,
    `    case 1: total += 2; break;`,
    `    default: total += 3; break;`,
    `  }`,
    `  return total;`,
    `}`,
  ].join('\n');
}

export function injectDuplicateBlocks(work, files, n, rand) {
  const candidates = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f));
  const picked = pickN(candidates, Math.min(n * 2, candidates.length), rand);
  const injections = [];
  for (let i = 0; i < n && i * 2 + 1 < picked.length; i++) {
    const srcFile = picked[i * 2];
    const tgtFile = picked[i * 2 + 1];
    const blockA = duplicateBlockSource(i);
    const blockB = blockA; // identical normalized form; different files
    const lineA = appendLine(join(work, srcFile), blockA);
    const lineB = appendLine(join(work, tgtFile), blockB);
    injections.push({
      ruleId: 'code/duplicate-block',
      file: tgtFile,
      sourceFile: srcFile,
      line: lineB,
      sourceLine: lineA,
      marker: `__unshitRecallDup_${i}`,
      kind: 'duplicate-block',
    });
  }
  return injections;
}

export function injectAll(work, seed, counts) {
  const rand = mulberry32(seed);
  const files = listSourceFiles(work);
  const injections = [];
  injections.push(...injectUnusedExports(work, files, counts.unusedExport ?? 20, rand));
  // refresh file list for unused-file targets? files list unchanged; unused-file creates new files
  injections.push(...injectUnusedFiles(work, counts.unusedFile ?? 20, rand));
  injections.push(...injectUnusedDependencies(work, counts.unusedDependency ?? 20, rand));
  injections.push(...injectExplicitAny(work, files, counts.noExplicitAny ?? 20, rand));
  injections.push(...injectMagicTimers(work, files, counts.magicTimer ?? 20, rand));
  injections.push(...injectDuplicateBlocks(work, files, counts.duplicateBlock ?? 20, rand));
  return injections;
}

export function findingMatchesInjection(finding, inj) {
  if (finding.ruleId !== inj.ruleId) return false;
  switch (inj.kind) {
    case 'unused-export':
      return finding.file === inj.file && (String(finding.message).includes(inj.marker) || String(finding.evidence).includes(inj.marker));
    case 'unused-file':
      return finding.file === inj.file;
    case 'unused-dependency':
      return (finding.file === inj.file || /package\.json$/.test(finding.file)) && (String(finding.evidence).includes(inj.marker) || String(finding.message).includes(inj.marker));
    case 'no-explicit-any':
      return finding.file === inj.file && Math.abs((finding.span?.line ?? -999) - inj.line) <= 2;
    case 'magic-timer':
      return finding.file === inj.file && Math.abs((finding.span?.line ?? -999) - inj.line) <= 3;
    case 'duplicate-block':
      return (finding.file === inj.file || finding.file === inj.sourceFile) &&
        (String(finding.evidence).includes(inj.sourceFile) || String(finding.evidence).includes(inj.file) || String(finding.message).includes(inj.marker) || String(finding.evidence).includes(inj.marker));
    default:
      return false;
  }
}

export function evaluateRecall(injections, afterFindings) {
  const byRule = new Map();
  for (const inj of injections) {
    const row = byRule.get(inj.ruleId) ?? { ruleId: inj.ruleId, injected: 0, found: 0, misses: [], hits: [] };
    row.injected += 1;
    const match = afterFindings.find((f) => findingMatchesInjection(f, inj));
    if (match) {
      row.found += 1;
      row.hits.push({ injection: inj, finding: { ruleId: match.ruleId, file: match.file, line: match.span?.line, message: match.message } });
    } else {
      row.misses.push({ injection: inj, reason: 'no matching finding after injection' });
    }
    byRule.set(inj.ruleId, row);
  }
  const rules = [...byRule.values()].map((r) => {
    const w = wilson95(r.found, r.injected);
    return { ...r, recall: r.injected ? r.found / r.injected : null, wilson95: w };
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return rules;
}

export function diffNewFindings(before, after) {
  const key = (f) => `${f.ruleId}\u0000${f.file}\u0000${f.span?.line}\u0000${f.span?.column}\u0000${f.message}`;
  const counts = new Map();
  for (const f of before) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
  const out = [];
  for (const f of after) {
    const k = key(f);
    const c = counts.get(k) ?? 0;
    if (c > 0) counts.set(k, c - 1);
    else out.push(f);
  }
  return out;
}
