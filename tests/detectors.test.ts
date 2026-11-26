import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { normalizePayload, scanSingleContent } from '../src/core/hook.js';
import { runInit } from '../src/core/init.js';
import { createBaseline, evaluateGuard } from '../src/core/pinner.js';
import { runScan } from '../src/core/scanner.js';
import { computeScore } from '../src/core/scorer.js';
import { abortSwarmFix, runSwarmFix } from '../src/core/swarm-fixer.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-test-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('detects TS any, double-cast, i18n ternary forms, window.setTimeout, redundant catch, and CSS !important', async () => {
  await withTempProject(
    {
      'useLocale.ts': `
export function Demo({ isAr, lang, isRtl, vw, clamped, rect }: { isAr: boolean; lang: string; isRtl: boolean; vw: number; clamped: number; rect: { left: number; right: number } }) {
  const a = isAr ? 'مرحبا' : 'Hello';
  const b = lang === 'ar' ? 'نعم' : 'Yes';
  const c = isRtl ? 'auto' : clamped;
  const d = isRtl ? vw - rect.right : rect.left;
  const raw = ({} as unknown as { id: string }).id;
  window.setTimeout(() => console.log(a, b, c, d, raw), 250);
  try {
    throw new Error('x');
  } catch (err: any) {
    throw err;
  }
}
`,
      'styles.css': `/* never use !important */\n.btn { color: red !important; }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const rules = new Set(scan.findings.map((f) => f.ruleId));

      const i18nHits = scan.findings.filter((f) => f.ruleId === 'i18n/no-inline-ternary');
      assert.equal(i18nHits.length, 2);
      assert.ok(rules.has('ts/no-double-cast'));
      assert.ok(rules.has('slop/magic-timer'));
      assert.ok(rules.has('ts/no-explicit-any'));
      assert.ok(rules.has('slop/redundant-catch'));

      const importantHits = scan.findings.filter((f) => f.ruleId === 'css/no-important');
      assert.equal(importantHits.length, 1);

      const score = computeScore(scan.files, scan.findings);
      assert.ok(score.score < 100);
    },
  );
});

test('css/duplicate-selector ignores @keyframes and scopes by @media', async () => {
  await withTempProject(
    {
      'anim.css': `
@keyframes pulseA { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes pulseB { 0% { transform: scale(1); } 100% { transform: scale(1.1); } }
.card { padding: 8px; }
@media (max-width: 600px) { .card { padding: 4px; } }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dups = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(dups.length, 0);
    },
  );
});

test('dry-run does not mutate, and --apply fixes catch(err: any) deterministically', async () => {
  await withTempProject(
    {
      'catch.ts': `export function run() { try { return 1; } catch (err: any) { return 0; } }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const dry = await runFix(scan, { apply: false, ai: false });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.appliedCount, 0);
      assert.deepEqual(
        dry.deterministicPatches.map((p) => p.ruleId).sort(),
        ['ts/no-explicit-any', 'ts/unused-export'],
      );

      const applied = await runFix(scan, { apply: true, ai: false });
      assert.equal(applied.dryRun, false);
      // The file becomes unused once its export is removed, so it is deleted
      // in the same converged run.
      assert.equal(applied.deletedCount, 1);
      await assert.rejects(() => readFile(join(dir, 'catch.ts'), 'utf8'));
    },
  );
});

test('slop/redundant-catch unwraps try/catch that only rethrows when no finally exists', async () => {
  await withTempProject(
    {
      'rethrow.ts': `export function unwrap() { try { return 42; } catch (e) { throw e; } }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const applied = await runFix(scan, { apply: true, ai: false });
      assert.equal(applied.appliedCount, 2); // redundant catch + unused export
      // The file becomes unused once its export is removed, so it is deleted
      // in the same converged run.
      assert.equal(applied.deletedCount, 1);
      await assert.rejects(() => readFile(join(dir, 'rethrow.ts'), 'utf8'));
    },
  );
});

test('pin and guard tolerate line shifts and fail only on newly introduced findings', async () => {
  await withTempProject(
    {
      'a.ts': `export const x = ({} as unknown as number);\n`,
    },
    async (dir) => {
      const initialScan = await runScan(dir, { ...DEFAULT_CONFIG });
      const baseline = await createBaseline(initialScan);

      await writeFile(join(dir, 'a.ts'), `// top comment\nexport const x = ({} as unknown as number);\n`, 'utf8');
      const shiftedScan = await runScan(dir, { ...DEFAULT_CONFIG });
      const passGuard = evaluateGuard(shiftedScan, baseline);
      assert.equal(passGuard.passed, true);

      await writeFile(join(dir, 'b.css'), `.box { margin: 0 !important; }\n`, 'utf8');
      const dirtyScan = await runScan(dir, { ...DEFAULT_CONFIG });
      const failGuard = evaluateGuard(dirtyScan, baseline);
      assert.equal(failGuard.passed, false);
      assert.equal(failGuard.newFindings.length, 1);

      const scopedPass = evaluateGuard(dirtyScan, baseline, new Set(['a.ts']));
      assert.equal(scopedPass.passed, true);
    },
  );
});

test('polyglot detectors catch Rust unwrap, Dart dynamic/print, and Python bare except', async () => {
  await withTempProject(
    {
      'lib.rs': `pub fn load() -> String { std::fs::read_to_string("a").unwrap() }\n`,
      'widget.dart': `void logVal(dynamic x) { print(x); }\n`,
      'worker.py': `def run():\n    try:\n        pass\n    except:\n        pass\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const rules = new Set(scan.findings.map((f) => f.ruleId));
      assert.ok(rules.has('rust/no-unwrap'));
      assert.ok(rules.has('dart/no-dynamic-or-print'));
      assert.ok(rules.has('python/no-bare-except'));
    },
  );
});

test('scanSingleContent catches slop immediately for Live AI Guardrail Hook', () => {
  const hits = scanSingleContent('/tmp', 'src/App.css', '.btn { color: red !important; }\n', DEFAULT_CONFIG);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.ruleId, 'css/no-important');
});

test('normalizePayload supports both Claude Code and OpenCode Edit payloads', () => {
  const claude = normalizePayload({
    session_id: 's1',
    cwd: '/repo',
    tool_name: 'Edit',
    tool_input: { file_path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true },
  });
  assert.equal(claude?.filePath, 'a.ts');
  assert.equal(claude?.oldString, 'x');
  assert.equal(claude?.replaceAll, true);

  const opencode = normalizePayload({ filePath: 'b.rs', oldString: 'a', newString: 'b' });
  assert.equal(opencode?.filePath, 'b.rs');
  assert.equal(opencode?.newString, 'b');
});

test('polyglot exemptions: Map<String, dynamic>, lock().unwrap(), and mid-file #[cfg(test)]', async () => {
  await withTempProject(
    {
      'prod.rs': `#[cfg(test)]\nmod t { fn x() { a.unwrap(); } }\npub fn ok(m: Mutex<i32>) { let _ = m.lock().unwrap(); }\npub fn bad() { y.unwrap(); }\n`,
      'json.dart': `void parse(Map<String, dynamic> raw) { logger.print(raw); }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'rust/no-unwrap').length, 1);
      assert.equal(scan.findings.filter((f) => f.ruleId === 'dart/no-dynamic-or-print').length, 0);
    },
  );
});

test('multiset evaluateGuard detects second identical finding in the same file', async () => {
  await withTempProject(
    {
      'a.css': `.a { color: red !important; }\n`,
    },
    async (dir) => {
      const s1 = await runScan(dir, { ...DEFAULT_CONFIG });
      const base = await createBaseline(s1);
      await writeFile(join(dir, 'a.css'), `.a { color: red !important; }\n.b { color: red !important; }\n`, 'utf8');
      const s2 = await runScan(dir, { ...DEFAULT_CONFIG });
      const guard = evaluateGuard(s2, base);
      assert.equal(guard.passed, false);
      assert.equal(guard.newFindings.length, 1);
    },
  );
});

test('arch/import-cycle ignores .d.ts declaration files', async () => {
  await withTempProject(
    {
      'a.d.ts': `import { B } from './b.js';\nexport type A = B;\n`,
      'b.d.ts': `import { A } from './a.js';\nexport type B = A;\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'arch/import-cycle').length, 0);
    },
  );
});

test('arch/import-cycle and arch/layer-violation detect cycles and layer breaches (skipping type-only)', async () => {
  await withTempProject(
    {
      'a.ts': `import { b } from './b.js';\nexport const a = 1 + b;\n`,
      'b.ts': `import { a } from './a.js';\nexport const b = 2 + a;\n`,
      'types_only.ts': `import type { a } from './a.js';\nexport type T = typeof a;\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, {
        ...DEFAULT_CONFIG,
        layers: [
          { name: 'core', include: ['a.ts'], allowImportsFrom: [] },
          { name: 'ui', include: ['b.ts'], allowImportsFrom: ['core'] },
        ],
      });
      const cycles = scan.findings.filter((f) => f.ruleId === 'arch/import-cycle');
      const violations = scan.findings.filter((f) => f.ruleId === 'arch/layer-violation');
      assert.equal(cycles.length, 1);
      assert.equal(violations.length, 1);
      assert.equal(violations[0]?.file, 'a.ts');
    },
  );
});

test('runInit creates config, merges .claude/settings.json idempotently, and pins baseline', async () => {
  await withTempProject(
    {
      'ok.ts': `export const ok = 1;\n`,
    },
    async (dir) => {
      const code1 = await runInit(dir);
      assert.equal(code1, 0);
      const settings1 = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8')) as {
        hooks?: { PreToolUse?: unknown[] };
      };
      assert.equal(settings1.hooks?.PreToolUse?.length, 1);

      const code2 = await runInit(dir);
      assert.equal(code2, 0);
      const settings2 = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8')) as {
        hooks?: { PreToolUse?: unknown[] };
      };
      assert.equal(settings2.hooks?.PreToolUse?.length, 1);
    },
  );
});

test('runSwarmFix refuses non-git/dirty tree safely and abortSwarmFix cleans up', async () => {
  await withTempProject(
    {
      'a.ts': `export const x = ({} as unknown as number);\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      await assert.rejects(() => runSwarmFix(scan, { apply: false }));
      const code = await abortSwarmFix(dir);
      assert.equal(code, 0);
    },
  );
});

test('i18n/no-inline-ternary exempts BCP-47 locale tags and dictionary object selectors', async () => {
  await withTempProject(
    {
      'locale.ts': `
const dictAr = { ok: 'نعم' };
const dictEn = { ok: 'Yes' };
export function fmt(language: string) {
  const bcp = language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  const dict = language === 'ar' ? dictAr : dictEn;
  const bad = language === 'ar' ? 'مرحبا' : 'Hello';
  return { bcp, dict, bad };
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const hits = scan.findings.filter((f) => f.ruleId === 'i18n/no-inline-ternary');
      assert.equal(hits.length, 1);
      assert.match(hits[0]?.evidence ?? '', /مرحبا/);
    },
  );
});

test('css/no-important catches multiple !important declarations on the same line', async () => {
  await withTempProject(
    {
      'multi.css': `.btn { margin: 0 !important; padding: 4px !important; }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const hits = scan.findings.filter((f) => f.ruleId === 'css/no-important');
      assert.equal(hits.length, 2);
    },
  );
});

test('CLI supports --json shorthand for scan and score', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await withTempProject(
    {
      'ok.ts': `export const ok = 1;\n`,
    },
    async (dir) => {
      const { stdout } = await execFileAsync('node', [fileURLToPath(new URL('../../bin/unshit.js', import.meta.url)), 'score', dir, '--json']);
      const parsed = JSON.parse(stdout) as { score: number; grade: string };
      assert.equal(typeof parsed.score, 'number');
      assert.equal(parsed.grade, 'A');
    },
  );
});

test('i18n/no-inline-ternary catches en/!== conditions and exempts En/Ar dict pairs', async () => {
  await withTempProject(
    {
      'en-check.ts': `
const dictAr = { ok: 'نعم' };
const dictEn = { ok: 'Yes' };
export function render(language: string, isEn: boolean) {
  const dict = language === 'en' ? dictEn : dictAr;
  const bad1 = language === 'en' ? 'Yes' : 'نعم';
  const bad2 = language !== 'ar' ? 'Close' : 'إغلاق';
  const bad3 = isEn ? 'Save' : 'حفظ';
  return { dict, bad1, bad2, bad3 };
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const hits = scan.findings.filter((f) => f.ruleId === 'i18n/no-inline-ternary');
      assert.equal(hits.length, 3);
    },
  );
});

test('css/no-important catches spaced/uppercase !important and css/duplicate-selector ignores braces in strings', async () => {
  await withTempProject(
    {
      'tricky.css': `
.icon::before { content: "{foo};"; }
.btn { margin: 0 ! important; padding: 4px !IMPORTANT; }
`,
      'other.css': `
.other { color: red; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const imp = scan.findings.filter((f) => f.ruleId === 'css/no-important');
      const dup = scan.findings.filter((f) => f.ruleId === 'css/duplicate-selector');
      assert.equal(imp.length, 2);
      assert.equal(dup.length, 0);
    },
  );
});

test('css waivers support comma lists, exact rule IDs, string masking, and [hidden]/@media print exemptions', async () => {
  await withTempProject(
    {
      'waive.css': `
.a { content: "!important"; }
.sr-only { position: absolute !important; }
[hidden] { display: none !important; }
@media print { .no-print { display: none !important; } }
/* unshit-ignore: css/no-important, css/duplicate-selector — intentional */
.waived { color: red !important; }
/* unshit-ignore: css/no-important-x */
.not-waived { color: blue !important; }
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const imp = scan.findings.filter((f) => f.ruleId === 'css/no-important');
      assert.equal(imp.length, 1);
      assert.match(imp[0]?.evidence ?? '', /blue/);
    },
  );
});

test('dead-exports separates ts/unused-export from ts/unused-type-export and distinguishes local-only use', async () => {
  await withTempProject(
    {
      'comp.tsx': `
export interface CompProps { title: string }
export type UnusedType = { a: number };
export function Comp(p: CompProps) { return p.title; }
export const deadConst = 42;
`,
      'index.ts': `import { Comp } from './comp.js'; export const ok = Comp({ title: 'hi' });\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const valDead = scan.findings.filter((f) => f.ruleId === 'ts/unused-export');
      const typeDead = scan.findings.filter((f) => f.ruleId === 'ts/unused-type-export');
      assert.equal(valDead.length, 1);
      assert.match(valDead[0]?.evidence ?? '', /deadConst/);
      // Locally used / *Props types are part of an exported signature, so only the truly unreferenced type is flagged.
      assert.equal(typeDead.length, 1);
      assert.match(typeDead[0]?.evidence ?? '', /UnusedType/);
    },
  );
});

test('clones ignores pure JSX/multi-line import boilerplate and catches duplicated logic', async () => {
  await withTempProject(
    {
      'a.tsx': `
import {\n  alpha,\n  beta,\n  gamma,\n} from 'pkg';
export function A(p: { x: string; y: string; z: string }) {
  return <div className={p.x} title={p.y} aria-label={p.z} data-id="1" />;
}
export async function handleA(items: number[]) {
  if (!items || items.length === 0) return [];
  const filtered = items.filter((n) => n > 0 && n < 100);
  if (filtered.length === 0) return [];
  return filtered.map((n) => n * 2 + 1);
}
`,
      'b.tsx': `
import {\n  alpha,\n  beta,\n  gamma,\n} from 'pkg';
export function B(p: { x: string; y: string; z: string }) {
  return <div className={p.x} title={p.y} aria-label={p.z} data-id="1" />;
}
export async function handleB(values: number[]) {
  if (!values || values.length === 0) return [];
  const filtered = values.filter((v) => v > 0 && v < 100);
  if (filtered.length === 0) return [];
  return filtered.map((v) => v * 2 + 1);
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 25 });
      const clones = scan.findings.filter((f) => f.ruleId === 'code/duplicate-block');
      assert.equal(clones.length, 1);
    },
  );
});

test('code/duplicate-block catches cross-file JSX-heavy clones with few logic tokens', async () => {
  await withTempProject(
    {
      'a.tsx': `export function Panel(p: { heading: string; note: string; items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {p.items.length === 0 ? (
        <EmptyState icon="📊" title="No data yet" description="Run the export to see results here." />
      ) : (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {p.note}
          <h3 style={{ fontWeight: 700, margin: '16px 0' }}>{p.heading}</h3>
        </div>
      )}
    </div>
  );
}
`,
      'b.tsx': `export function Panel(p: { heading: string; note: string; items: string[] }) {
const pad1 = 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {p.items.length === 0 ? (
        <EmptyState icon="📊" title="No data yet" description="Run the export to see results here." />
      ) : (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {p.note}
          <h3 style={{ fontWeight: 700, margin: '16px 0' }}>{p.heading}</h3>
        </div>
      )}
    </div>
  );
}
`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const clones = scan.findings.filter((f) => f.ruleId === 'code/duplicate-block');
      assert.ok(clones.length >= 1, 'expected the JSX-heavy cross-file clone to be caught');
      assert.ok(clones.some((f) => f.file === 'b.tsx'), 'expected a finding on the second file');
    },
  );
});

test('code/duplicate-block ignores .test-d.ts files', async () => {
  await withTempProject(
    {
      'a.test-d.ts': `export function one(v: number[]) {\n  if (!v) return [];\n  return v.map((x) => x + 1);\n}\nexport function two(w: number[]) {\n  if (!w) return [];\n  return w.map((x) => x + 1);\n}\n`,
      'b.test-d.ts': `export function one(v: number[]) {\n  if (!v) return [];\n  return v.map((x) => x + 1);\n}\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 25 });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'code/duplicate-block').length, 0);
    },
  );
});

test('code/duplicate-block stays quiet on trivial boilerplate', async () => {
  await withTempProject(
    {
      'a.ts': `import { alpha, beta, gamma } from 'pkg';\nexport type Pair = [string, number];\nexport type Status = 'ok' | 'err';\nexport const first = 1;\nexport const second = 2;\n`,
      'b.ts': `import { alpha, beta, gamma } from 'pkg';\nexport type Pair = [string, number];\nexport type Status = 'ok' | 'err';\nexport const first = 3;\nexport const second = 4;\n`,
      'c.ts': `const same = 1;\nconst same = 1;\n`,
      'd.ts': `const same = 1;\nconst same = 1;\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const clones = scan.findings.filter((f) => f.ruleId === 'code/duplicate-block');
      assert.equal(clones.length, 0);
    },
  );
});

function cloneBody(n: string): string {
  return `  if (!${n} || ${n}.length === 0) return [];\n  const kept = ${n}.filter((v) => v > 0 && v < 100);\n  if (kept.length === 0) return [];\n  return kept.map((v) => v * 2 + 1);\n`;
}

test('code/duplicate-block catches a block repeated within one file once', async () => {
  await withTempProject(
    {
      'a.ts': `export function one(values: number[]) {\n${cloneBody('values')}}\nexport function two(items: number[]) {\n${cloneBody('items')}}\nexport function three(rows: number[]) {\n${cloneBody('rows')}}\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 25 });
      const clones = scan.findings.filter((f) => f.ruleId === 'code/duplicate-block');
      assert.ok(clones.length >= 1 && clones.length <= 2, `got ${clones.length}`);
      assert.ok(clones.every((f) => f.message.includes('in the same file')));
    },
  );
});

test('code/duplicate-block ignores same-file JSX siblings with few branches', async () => {
  const card = (t: string) => `      <div style={{ padding: '8px', margin: '4px', color: 'red', border: '1px solid blue' }}>\n        <h4 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>{lang === 'ar' ? 'a${t}' : 'b${t}'}</h4>\n        <p style={{ fontSize: '11px', margin: 0, lineHeight: 1.4 }}>{lang === 'ar' ? 'c${t}' : 'd${t}'}</p>\n      </div>\n`;
  await withTempProject(
    { 'a.tsx': `export function A({ lang }: { lang: string }) {\n  return (\n    <section>\n${card('1')}${card('2')}${card('3')}    </section>\n  );\n}\n` },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 25 });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'code/duplicate-block').length, 0);
    },
  );
});

test('code/duplicate-block ignores short same-file repeats', async () => {
  await withTempProject(
    {
      'a.ts': `export function one(v: number[]) {\n  if (!v) return [];\n  return v.map((x) => x + 1);\n}\nexport function two(w: number[]) {\n  if (!w) return [];\n  return w.map((x) => x + 1);\n}\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 40 });
      assert.equal(scan.findings.filter((f) => f.ruleId === 'code/duplicate-block').length, 0);
    },
  );
});

test('css/design-drift flags hardcoded colors when tokens exist and suggests matching var(--token)', async () => {
  await withTempProject(
    {
      'tokens.css': `:root { --brand: #ff0000; }\n`,
      'ui.css': `.btn { color: #ff0000; background: var(--bg, #123456); border-color: transparent; }\n`,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const drift = scan.findings.filter((f) => f.ruleId === 'css/design-drift');
      assert.equal(drift.length, 1);
      assert.match(drift[0]!.message, /use var\(--brand\)/);
    },
  );
});
