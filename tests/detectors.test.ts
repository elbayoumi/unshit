import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
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
    },
  );
});
