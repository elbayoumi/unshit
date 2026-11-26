#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const CORPUS = '/Volumes/data/projects/unshit-bench/corpus';
const PROJECTS = process.env.FS_PROJECTS ? process.env.FS_PROJECTS.split(',') : ['hono', 'execa', 'zod', 'commander.js', 'fastify'];

function sh(cmd, args, opts = {}) {
  const outFile = join(tmpdir(), `unshit-fs-${process.pid}-${Math.random().toString(36).slice(2)}.out`);
  const errFile = `${outFile}.err`;
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const command = [cmd, ...args].map(q).join(' ') + ` > ${q(outFile)} 2> ${q(errFile)}`;
  try {
    execFileSync('bash', ['-lc', command], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
    return { ok: true, out: readFileSync(outFile, 'utf8'), err: readFileSync(errFile, 'utf8') };
  } catch (e) {
    const out = existsSync(outFile) ? readFileSync(outFile, 'utf8') : String(e.stdout ?? '');
    const err = existsSync(errFile) ? readFileSync(errFile, 'utf8') : String(e.stderr ?? e.message ?? e);
    return { ok: false, out, err };
  } finally {
    try { rmSync(outFile, { force: true }); } catch { /* temp cleanup */ }
    try { rmSync(errFile, { force: true }); } catch { /* temp cleanup */ }
  }
}

function scanJson(dir) {
  const r = sh('node', [BIN, 'scan', dir, '--format', 'json', '--no-cache'], { cwd: REPO_ROOT });
  const text = r.out.trim();
  try { return JSON.parse(text); } catch {
    const idx = text.indexOf('{');
    if (idx >= 0) return JSON.parse(text.slice(idx));
    throw new Error(`scan json parse failed for ${dir}: ${text.slice(0, 200)}\n${r.err}`);
  }
}

const runFixApply = (dir) => sh('node', [BIN, 'fix', dir, '--apply', '--no-cache'], { cwd: REPO_ROOT });
const findingKey = (f) => `${f.ruleId}|${f.file}|${f.span?.line}|${f.span?.column}|${f.message}`;

function findTsconfig(dir) {
  for (const c of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.typecheck.json']) {
    const p = join(dir, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function tscDiagnostics(dir, tsconfigPath) {
  if (!tsconfigPath) return { ok: false, reason: 'no tsconfig found', diagnostics: [], count: 0 };
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return { ok: false, reason: `tsconfig read error: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`, diagnostics: [], count: 0 };
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath), undefined, tsconfigPath);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diags = [...ts.getPreEmitDiagnostics(program), ...parsed.errors].map((d) => {
    const file = d.file ? d.file.fileName : '<global>';
    const rel = file.startsWith(dir) ? file.slice(dir.length + 1) : file;
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: -1, character: -1 };
    return { file: rel, line: pos.line + 1, column: pos.character + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
  });
  return { ok: true, diagnostics: diags, count: diags.length, fileNames: parsed.fileNames.length };
}

function diffDiagnostics(before, after) {
  const bc = new Map();
  for (const d of before) { const k = `${d.file}|${d.code}|${d.message}`; bc.set(k, (bc.get(k) ?? 0) + 1); }
  const ac = new Map();
  const out = [];
  for (const d of after) {
    const k = `${d.file}|${d.code}|${d.message}`;
    ac.set(k, (ac.get(k) ?? 0) + 1);
    if ((ac.get(k) ?? 0) > (bc.get(k) ?? 0)) out.push(d);
  }
  return out;
}

function diffFindings(before, after) {
  const bc = new Map();
  for (const f of before) { const k = findingKey(f); bc.set(k, (bc.get(k) ?? 0) + 1); }
  const ac = new Map();
  for (const f of after) { const k = findingKey(f); ac.set(k, (ac.get(k) ?? 0) + 1); }
  const fixed = [];
  for (const f of before) {
    const k = findingKey(f);
    const b = bc.get(k) ?? 0; const a = ac.get(k) ?? 0;
    if (a < b) { ac.set(k, a + 1); fixed.push(f); }
  }
  return fixed;
}

const parseSkips = (out) => [...out.matchAll(/^\s*SKIP \[([^\]]+)\] ([^:]+):(\d+) — (.*)$/gm)].map((m) => ({ ruleId: m[1], file: m[2], line: Number(m[3]), reason: m[4] }));
function parseApplied(out) {
  const m = out.match(/(\d+) deterministic patches \((\d+) applied\)/);
  const d = out.match(/deletions: (\d+) \((\d+) deleted\)/);
  return { patches: m ? Number(m[1]) : 0, applied: m ? Number(m[2]) : 0, deletions: d ? Number(d[1]) : 0, deleted: d ? Number(d[2]) : 0 };
}
const groupByRule = (items) => items.reduce((m, it) => { const a = m.get(it.ruleId) ?? []; a.push(it); m.set(it.ruleId, a); return m; }, new Map());

function setupWorkdir(name) {
  const src = join(CORPUS, name);
  if (!existsSync(src)) return { error: `missing corpus project: ${src}` };
  const tmpBase = mkdtempSync(join(tmpdir(), `unshit-fs-${name.replace(/[^a-z0-9]/gi, '_')}-`));
  const work = join(tmpBase, name);
  cpSync(src, work, { recursive: true });
  rmSync(join(work, '.git'), { recursive: true, force: true });
  return { tmpBase, work };
}

function checkIdempotency(work) {
  sh('git', ['add', '-A'], { cwd: work });
  sh('git', ['commit', '-q', '-m', 'after-fix1', '--no-gpg-sign', '--allow-empty'], { cwd: work });
  const fix2 = runFixApply(work);
  const out = `${fix2.out || ''}\n${fix2.err || ''}`;
  const applied = parseApplied(out);
  const changed = sh('git', ['diff', '--name-only'], { cwd: work }).out.split('\n').map((s) => s.trim()).filter(Boolean);
  return { ok: changed.length === 0 && applied.applied === 0 && applied.deleted === 0, secondApply: applied, changedFilesAfterSecond: changed.slice(0, 20) };
}

function attributeErrors(newTscErrors, fixedFindings, changedFiles) {
  const fixedFilesByRule = new Map();
  for (const f of fixedFindings) {
    const set = fixedFilesByRule.get(f.ruleId) ?? new Set();
    set.add(f.file);
    fixedFilesByRule.set(f.ruleId, set);
  }
  const newErrorsByRule = new Map();
  const unattributed = [];
  for (const d of newTscErrors) {
    const rules = [...fixedFilesByRule.entries()].filter(([, files]) => files.has(d.file)).map(([r]) => r);
    if (rules.length === 0) { if (changedFiles.has(d.file) || !changedFiles.has(d.file)) unattributed.push(d); continue; }
    for (const r of rules) {
      const arr = newErrorsByRule.get(r) ?? [];
      arr.push({ ...d, attributedRules: rules });
      newErrorsByRule.set(r, arr);
    }
  }
  return { newErrorsByRule, unattributed };
}

function buildPerRule(fixedByRule, skipsByRule, newErrorsByRule) {
  const allRules = new Set([...fixedByRule.keys(), ...skipsByRule.keys(), ...newErrorsByRule.keys()]);
  const perRule = {};
  for (const rule of [...allRules].sort()) {
    const skips = skipsByRule.get(rule) ?? [];
    const errs = newErrorsByRule.get(rule) ?? [];
    perRule[rule] = {
      fixed: (fixedByRule.get(rule) ?? []).length, skipped: skips.length, newCompileErrors: errs.length,
      newCompileErrorDetails: errs.slice(0, 20), skippedReasons: [...new Set(skips.map((s) => s.reason))].slice(0, 10),
    };
  }
  return perRule;
}

function analyzeProject(name) {
  const setup = setupWorkdir(name);
  if (setup.error) return { name, error: setup.error };
  const { tmpBase, work } = setup;
  try {
    const tsconfigPath = findTsconfig(work);
    const beforeTsc = tscDiagnostics(work, tsconfigPath);
    const beforeScan = scanJson(work);
    sh('git', ['init', '-q'], { cwd: work });
    sh('git', ['config', 'user.email', 'test@test'], { cwd: work });
    sh('git', ['config', 'user.name', 'test'], { cwd: work });
    sh('git', ['add', '-A'], { cwd: work });
    sh('git', ['commit', '-q', '-m', 'before', '--no-gpg-sign'], { cwd: work });
    const fix1 = runFixApply(work);
    const fixOutput = `${fix1.out || ''}\n${fix1.err || ''}`;
    const afterTsc = tscDiagnostics(work, tsconfigPath);
    let afterScan; try { afterScan = scanJson(work); } catch (e) { afterScan = { findings: [], error: String(e) }; }
    const changedFiles = new Set(sh('git', ['diff', '--name-only'], { cwd: work }).out.split('\n').map((s) => s.trim()).filter(Boolean));
    const idempotency = checkIdempotency(work);
    const fixedFindings = diffFindings(beforeScan.findings || [], afterScan.findings || []);
    const newTscErrors = (beforeTsc.ok && afterTsc.ok) ? diffDiagnostics(beforeTsc.diagnostics, afterTsc.diagnostics) : [];
    const { newErrorsByRule, unattributed } = attributeErrors(newTscErrors, fixedFindings, changedFiles);
    const afterKeys = new Set((afterScan.findings || []).map(findingKey));
    const stillPresent = fixedFindings.filter((f) => afterKeys.has(findingKey(f)));
    return {
      name, workdir: work, tsconfig: tsconfigPath ? tsconfigPath.slice(work.length + 1) : null,
      typecheck: { before: beforeTsc.ok ? { count: beforeTsc.count, files: beforeTsc.fileNames } : { error: beforeTsc.reason }, after: afterTsc.ok ? { count: afterTsc.count, files: afterTsc.fileNames } : { error: afterTsc.reason }, newErrors: newTscErrors.length, unattributedNewErrors: unattributed.slice(0, 20) },
      fix: { exitCode: fix1.ok ? 0 : 1, applied: parseApplied(fixOutput), skips: parseSkips(fixOutput).length, output: fixOutput.slice(0, 4000) },
      idempotency, rescan: { beforeFindings: (beforeScan.findings || []).length, afterFindings: (afterScan.findings || []).length, fixedFindings: fixedFindings.length, fixedStillPresent: stillPresent.length, fixedStillPresentSample: stillPresent.slice(0, 10).map((f) => ({ ruleId: f.ruleId, file: f.file, line: f.span?.line, message: f.message })) },
      perRule: buildPerRule(groupByRule(fixedFindings), groupByRule(parseSkips(fixOutput)), newErrorsByRule),
    };
  } finally {
    if (process.env.FS_KEEP) console.error(`KEEP ${tmpBase}`);
    else rmSync(tmpBase, { recursive: true, force: true });
  }
}

function mdSummary(results) {
  const lines = ['## Summary', '', '| Project | tsconfig | tsc before | tsc after | new tsc errors | fixed findings | skipped | idempotent | fixed still present |', '|---|---|---:|---:|---:|---:|---:|:---:|---:|'];
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.name} | - | - | - | - | - | - | - | ERROR: ${r.error} |`); continue; }
    const b = r.typecheck.before.count ?? r.typecheck.before.error ?? '?';
    const a = r.typecheck.after.count ?? r.typecheck.after.error ?? '?';
    lines.push(`| ${r.name} | ${r.tsconfig ?? 'none'} | ${b} | ${a} | ${r.typecheck.newErrors} | ${r.rescan.fixedFindings} | ${r.fix.skips} | ${r.idempotency.ok ? 'yes' : 'NO'} | ${r.rescan.fixedStillPresent} |`);
  }
  lines.push('');
  return lines;
}

function mdRuleRows(perRule) {
  const rules = Object.keys(perRule).sort();
  if (rules.length === 0) return ['| (none) | 0 | 0 | 0 | no deterministic fixes/skips |'];
  return rules.map((rule) => {
    const p = perRule[rule];
    const notes = [];
    if (p.skippedReasons.length) notes.push(`skip: ${p.skippedReasons.join('; ')}`);
    if (p.newCompileErrorDetails.length) notes.push(`new: ${p.newCompileErrorDetails.slice(0, 3).map((d) => `${d.file}:${d.line} TS${d.code}`).join(', ')}`);
    return `| ${rule} | ${p.fixed} | ${p.skipped} | ${p.newCompileErrors} | ${notes.join(' / ').replace(/\|/g, '/').replace(/\n/g, ' ')} |`;
  });
}

function mdProject(r) {
  const lines = [`## ${r.name}`, ''];
  if (r.error) return [...lines, `Error: ${r.error}`, ''];
  const t = r.typecheck;
  lines.push(t.before.error ? `Typecheck: ${t.before.error}` : `Typecheck: ${t.before.count} -> ${t.after.count} (${t.newErrors} new, ${t.unattributedNewErrors.length} unattributed)`);
  lines.push(`Idempotent: ${r.idempotency.ok}. Fixed findings reappearing: ${r.rescan.fixedStillPresent}.`, '', '| Rule | fixed | skipped | new compile errors | notes |', '|---|---:|---:|---:|---|', ...mdRuleRows(r.perRule));
  if (r.typecheck.unattributedNewErrors.length) {
    lines.push('', 'Unattributed new diagnostics (file changed or diagnostic moved):');
    for (const d of r.typecheck.unattributedNewErrors.slice(0, 10)) lines.push(`- ${d.file}:${d.line} TS${d.code} ${d.message}`);
  }
  lines.push('');
  return lines;
}

function renderMarkdown(results) {
  return [
    '# Fix soundness (round 11)', '', `Generated: ${new Date().toISOString()}`, '',
    'Method: for each corpus project, copy to a fresh `/tmp` dir (corpus read-only), run `node bin/unshit.js fix <copy> --apply --no-cache`, then compare TypeScript program diagnostics before/after using this repo\'s `typescript` package over the project\'s `tsconfig.json`. "New compile errors" are diagnostics present after but not before (keyed by file+code+message). Idempotency = second `fix --apply` makes no changes and applies 0 patches/deletions. Re-scan = fixed findings do not reappear.', '',
    ...mdSummary(results),
    ...results.flatMap(mdProject),
  ].join('\n');
}

function main() {
  if (!existsSync(BIN)) { console.error('missing bin/unshit.js'); process.exit(2); }
  const results = PROJECTS.map((name) => {
    console.error(`==> ${name}`);
    const r = analyzeProject(name);
    console.error(r.error ? `  ERROR: ${r.error}` : `  fixed=${r.rescan.fixedFindings} skipped=${r.fix.skips} newTsc=${r.typecheck.newErrors} idempotent=${r.idempotency.ok}`);
    return r;
  });
  const outJson = join(HERE, 'results.json');
  const outMd = join(REPO_ROOT, 'docs', 'research', 'fix-soundness.md');
  mkdirSync(dirname(outJson), { recursive: true });
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outJson, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  writeFileSync(outMd, renderMarkdown(results));
  console.error(`Wrote ${outJson}`);
  console.error(`Wrote ${outMd}`);
  const totalNew = results.reduce((s, r) => s + (r.typecheck?.newErrors ?? 0), 0);
  const totalFixed = results.reduce((s, r) => s + (r.rescan?.fixedFindings ?? 0), 0);
  console.log(`RESULT: ${totalNew === 0 ? 'PASS' : 'WARN'} fixed=${totalFixed} newTscErrors=${totalNew}`);
}

main();
