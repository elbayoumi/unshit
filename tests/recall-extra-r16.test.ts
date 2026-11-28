import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// R16: injection candidate files must be ONLY files the default scan actually scans.

interface Injection {
  file: string;
  ruleId: string;
  otherFile?: string;
}

interface RecallExtraLib {
  scannedSourceFiles(work: string, repoRoot?: string): Promise<string[]>;
  injectableFiles(work: string, opts?: { scannedFiles?: Set<string> | string[]; repoRoot?: string }): Promise<string[]>;
  injectAllPositives(work: string, seed: number, counts: Record<string, number>, opts?: Record<string, unknown>): Promise<Injection[]>;
  injectAllNegatives(work: string, seed: number, counts: Record<string, number>, opts?: Record<string, unknown>): Promise<Injection[]>;
}

async function loadLib(): Promise<RecallExtraLib> {
  return import(new URL('../../benchmark/recall-extra/lib.mjs', import.meta.url).href) as Promise<RecallExtraLib>;
}

/**
 * Tiny temp project: a scanned dir (`src/`) and a default-excluded `fixtures/`
 * dir. No project-specific config; nothing project-specific is hard-coded.
 */
function makeTinyProject(dir: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tiny', version: '1.0.0' }, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'src', 'a.ts'), 'export function a(v: number): number { return v + 1; }\n', 'utf8');
  writeFileSync(join(dir, 'src', 'b.ts'), 'export function b(v: number): number { return v + 2; }\n', 'utf8');
  // Inside `fixtures/` (default-excluded): must never be an injection candidate.
  writeFileSync(join(dir, 'fixtures', 'example.ts'), 'export function fixtureOnly(v: number): number { return v + 3; }\n', 'utf8');
  writeFileSync(join(dir, 'fixtures', 'other.ts'), 'export const fixtureOther = 1;\n', 'utf8');
}

async function withTinyProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-recall-r16-'));
  try {
    makeTinyProject(dir);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function noFixtures(inj: Injection[], scanned: Set<string>): void {
  for (const i of inj) {
    assert.ok(!i.file.startsWith('fixtures/'), `injected into non-scanned fixtures file: ${i.file}`);
    // created-file injectors create fresh scanned files; everything else must be scanned.
    const created = i.file.includes('__unshit_recall_');
    if (!created) assert.ok(scanned.has(i.file), `injected into non-scanned file: ${i.file}`);
    if (i.otherFile) assert.ok(!i.otherFile.startsWith('fixtures/'), `created against fixtures file: ${i.otherFile}`);
  }
}

test('scannedSourceFiles returns scanned set from a real clean scan, excluding fixtures/', async () => {
  const { scannedSourceFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    const scanned = await scannedSourceFiles(dir);
    assert.ok(scanned.includes('src/a.ts'), `expected src/a.ts in ${JSON.stringify(scanned)}`);
    assert.ok(scanned.includes('src/b.ts'), `expected src/b.ts in ${JSON.stringify(scanned)}`);
    assert.ok(!scanned.some((f) => f.startsWith('fixtures/')), `fixtures must be excluded: ${JSON.stringify(scanned)}`);
    assert.ok(!scanned.includes('fixtures/example.ts'));
  });
});

test('injectableFiles intersects base listing with scanned set; fixtures/ never a candidate', async () => {
  const { injectableFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    const pool = await injectableFiles(dir, {});
    assert.ok(pool.length > 0);
    assert.ok(pool.includes('src/a.ts'));
    assert.ok(!pool.some((f) => f.startsWith('fixtures/')), `fixtures must be excluded: ${JSON.stringify(pool)}`);
  });
});

test('injectableFiles honours a caller-supplied scanned set only by narrowing', async () => {
  const { injectableFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    assert.deepEqual(await injectableFiles(dir, { scannedFiles: new Set(['src/a.ts']) }), ['src/a.ts']);
    assert.deepEqual(await injectableFiles(dir, { scannedFiles: ['src/b.ts'] }), ['src/b.ts']);
    // a supplied set cannot add files the default scan does not scan.
    const pool = await injectableFiles(dir, { scannedFiles: new Set(['src/a.ts', 'fixtures/example.ts']) });
    assert.deepEqual(pool, ['src/a.ts']);
  });
});

test('injectAllPositives picks candidates only from scanned files (no fixtures/)', async () => {
  const { injectAllPositives, scannedSourceFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    const scanned = new Set(await scannedSourceFiles(dir));
    const inj = await injectAllPositives(dir, 1234, {
      noDoubleCast: 3, redundantCatch: 3, highComplexity: 3, godFile: 0,
      importCycle: 1, unusedTypeExport: 3, unlistedDependency: 3,
    }, { includeReactGodFile: false });

    assert.ok(inj.length > 0, 'expected injections');
    noFixtures(inj, scanned);
  });
});

test('injectAllNegatives picks candidates only from scanned files (no fixtures/)', async () => {
  const { injectAllNegatives, scannedSourceFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    const scanned = new Set(await scannedSourceFiles(dir));
    const inj = await injectAllNegatives(dir, 1234, {
      noDoubleCast: 3, redundantCatch: 3, highComplexity: 3, godFile: 0,
      importCycle: 1, unusedTypeExport: 3, unlistedDependency: 3,
    }, { includeReactGodFile: false });

    assert.ok(inj.length > 0, 'expected hard-negative injections');
    noFixtures(inj, scanned);
  });
});

test('passing scope scannedFiles still excludes fixtures/', async () => {
  const { injectAllPositives, scannedSourceFiles } = await loadLib();
  await withTinyProject(async (dir) => {
    const scannedFiles = new Set(await scannedSourceFiles(dir));
    const inj = await injectAllPositives(dir, 99, {
      noDoubleCast: 2, redundantCatch: 2, highComplexity: 2, godFile: 0,
      importCycle: 0, unusedTypeExport: 2, unlistedDependency: 2,
    }, { includeReactGodFile: false, scannedFiles });
    assert.ok(inj.length > 0);
    assert.ok(inj.every((i) => !i.file.startsWith('fixtures/')));
  });
});
