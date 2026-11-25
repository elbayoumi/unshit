import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { normalizePayload, scanSingleContent } from '../src/core/hook.js';
import { createBaseline, evaluateGuard } from '../src/core/pinner.js';
import { runScan } from '../src/core/scanner.js';
import { computeScore } from '../src/core/scorer.js';

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
      assert.equal(dry.deterministicPatches.length, 1);

      const applied = await runFix(scan, { apply: true, ai: false });
      assert.equal(applied.dryRun, false);
      assert.equal(applied.appliedCount, 1);

      const updated = await readFile(join(dir, 'catch.ts'), 'utf8');
      assert.match(updated, /catch \(err: unknown\)/);
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
      assert.equal(applied.appliedCount, 1);
      const updated = await readFile(join(dir, 'rethrow.ts'), 'utf8');
      assert.equal(updated.trim(), 'export function unwrap() { return 42; }');
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
