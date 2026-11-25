#!/usr/bin/env node
// Benchmark unshit vs knip (unused exports) and jscpd (duplicate code).
// Usage: node benchmark/run.mjs <corpus-dir>... [--tools <dir with node_modules/.bin/{knip,jscpd}>] [--out report.json]
// Install the competitors once:  mkdir /tmp/bench && cd /tmp/bench && npm i knip jscpd
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const tools = resolve(opt('--tools') ?? process.env.BENCH_TOOLS ?? '.');
const outFile = opt('--out');
const corpora = args.map((a) => resolve(a));
if (!corpora.length) { console.error('usage: run.mjs <corpus>... [--tools dir] [--out file]'); process.exit(2); }
const bin = (n) => join(tools, 'node_modules', '.bin', n);
const unshitBin = resolve(new URL('../bin/unshit.js', import.meta.url).pathname);

function timed(cmd, a, cwd) {
  const t = process.hrtime.bigint();
  // Redirect to a file: some CLIs exit before a pipe is fully flushed and truncate large JSON.
  const file = join(mkdtempSync(join(tmpdir(), 'bench-')), 'out');
  const fd = openSync(file, 'w');
  try { execFileSync(cmd, a, { cwd, stdio: ['ignore', fd, 'ignore'] }); } catch { /* non-zero exit is normal for linters */ }
  closeSync(fd);
  const out = readFileSync(file, 'utf8');
  return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}
const norm = (root, f) => relative(root, resolve(root, f)).replaceAll('\\', '/');
const key = (f, n) => `${f}#${n}`;

const results = [];
for (const root of corpora) {
  const r = { corpus: root };
  // unshit
  const u = timed('node', [unshitBin, 'scan', root, '--format', 'json'], root);
  const uj = JSON.parse(u.out || '{"findings":[]}');
  const ue = new Set(), ud = [], uf = new Set(), udep = new Set(), unl = new Set();
  let complex = 0;
  for (const f of uj.findings) {
    if (f.ruleId === 'ts/unused-export' || f.ruleId === 'ts/unused-type-export') ue.add(key(norm(root, f.file), (f.message.match(/[`'"]([\w$]+)[`'"]/) ?? [])[1] ?? f.message));
    if (f.ruleId === 'ts/unused-file') uf.add(norm(root, f.file));
    if (f.ruleId === 'deps/unused-dependency') udep.add(f.evidence);
    if (f.ruleId === 'deps/unlisted-dependency') unl.add(`${norm(root, f.file)}#${f.evidence}`);
    if (f.ruleId === 'code/high-complexity') complex++;
    if (f.ruleId === 'code/duplicate-block') ud.push({ file: norm(root, f.file), line: f.line });
  }
  r.unshit = { ms: u.ms, unusedExports: ue.size, duplicateBlocks: ud.length, unusedFiles: uf.size, unusedDependencies: udep.size, unlistedImports: unl.size, highComplexity: complex };
  // knip
  if (existsSync(bin('knip'))) {
    const k = timed(bin('knip'), ['--reporter', 'json', '--no-progress'], root);
    const ke = new Set(), kf = new Set(), kd = new Set(), kunl = new Set();
    try {
      for (const i of JSON.parse(k.out).issues ?? []) {
        for (const kind of ['exports', 'types']) for (const e of i[kind] ?? []) ke.add(key(norm(root, i.file), e.name));
        for (const e of i.files ?? []) kf.add(norm(root, i.file));
        for (const kind of ['dependencies', 'devDependencies']) for (const e of i[kind] ?? []) kd.add(e.name);
        for (const e of i.unlisted ?? []) kunl.add(`${norm(root, i.file)}#${e.name}`);
      }
    } catch { r.knipError = 'unparseable output (missing node_modules / config?)'; }
    r.knip = { ms: k.ms, unusedExports: ke.size, unusedFiles: kf.size, unusedDependencies: kd.size, unlistedImports: kunl.size };
    r.fileOverlap = { both: [...uf].filter((x) => kf.has(x)).length, onlyUnshit: [...uf].filter((x) => !kf.has(x)), onlyKnip: [...kf].filter((x) => !uf.has(x)) };
    r.depOverlap = { both: [...udep].filter((x) => kd.has(x)).length, onlyUnshit: [...udep].filter((x) => !kd.has(x)), onlyKnip: [...kd].filter((x) => !udep.has(x)) };
    r.exportOverlap = { both: [...ue].filter((x) => ke.has(x)).length, onlyUnshit: [...ue].filter((x) => !ke.has(x)), onlyKnip: [...ke].filter((x) => !ue.has(x)) };
  }
  // jscpd
  if (existsSync(bin('jscpd'))) {
    const dir = mkdtempSync(join(tmpdir(), 'jscpd-'));
    const j = timed(bin('jscpd'), [root, '--reporters', 'json', '--output', dir, '--silent', '--min-tokens', '80', '--ignore', '**/node_modules/**,**/dist/**,**/build/**', '--format', 'typescript,tsx,javascript,jsx'], root);
    try { const jr = JSON.parse(readFileSync(join(dir, 'jscpd-report.json'), 'utf8')); r.jscpd = { ms: j.ms, clones: jr.statistics.total.clones, duplicatedLines: jr.statistics.total.duplicatedLines }; }
    catch { r.jscpd = { ms: j.ms, error: 'no report' }; }
  }
  results.push(r);
}
const summary = results.map((r) => ({ corpus: r.corpus, unshit: r.unshit, knip: r.knip, jscpd: r.jscpd, fileOverlap: r.fileOverlap, depOverlap: r.depOverlap, exportOverlap: r.exportOverlap && { both: r.exportOverlap.both, onlyUnshit: r.exportOverlap.onlyUnshit.length, onlyKnip: r.exportOverlap.onlyKnip.length } }));
console.log(JSON.stringify(summary, null, 2));
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
