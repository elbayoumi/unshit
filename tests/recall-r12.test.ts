import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

interface Injection {
  ruleId: string;
  reportRuleId?: string;
  file: string;
  line: number;
  marker: string;
  kind: string;
  outOfScope?: boolean;
  sourceFile?: string;
  sourceLine?: number;
}

interface Wilson {
  low: number;
  high: number;
  center: number;
}

interface RuleRow {
  ruleId: string;
  injected: number;
  found: number;
  recall: number | null;
  wilson95: Wilson;
  outOfScope: boolean;
  misses: object[];
  projects?: Array<{ project: string; injected: number; found: number }>;
}

interface Counts {
  injected: number;
  found: number;
  recall: number | null;
  wilson95: Wilson;
}

interface ProjectRun {
  name: string;
  fileCount: number;
  rules: RuleRow[];
}

interface Summary {
  seed: number;
  projects: Array<{ name: string; recall: number | null; injected: number; found: number }>;
  pooled: Counts;
  outOfScope: Counts;
  rules: RuleRow[];
  target: number;
  met: boolean;
}

interface Lib {
  mulberry32(seed: number): () => number;
  findingMatchesInjection(finding: Record<string, unknown>, inj: Injection): boolean;
  listSourceFiles(root: string): string[];
  injectUnusedExports(
    work: string,
    files: string[],
    n: number,
    rand: () => number,
    options?: { skipFiles?: Set<string> },
  ): Injection[];
  evaluateRecall(injections: Injection[], findings: object[]): RuleRow[];
  wilson95(successes: number, trials: number): Wilson;
}

interface Entries {
  starConsumedFiles(work: string, repoRoot: string): Promise<Set<string>>;
  injectionScope(work: string, repoRoot: string): Promise<{
    starConsumed: Set<string>;
    scannedFiles: Set<string>;
    cloneFiles: Set<string>;
  }>;
  eligibleUnusedExportFiles(files: string[], star: Set<string>): string[];
  injectEntryPointExports(work: string, files: string[], n: number, rand: () => number): Injection[];
  nonTokenizedInjections(work: string, injections: Injection[], repoRoot: string): Promise<Injection[]>;
}

interface Aggregate {
  parseProjects(raw: string): string[];
  countsFromRules(rules: RuleRow[], outOfScope: boolean): Counts;
  poolRules(projects: ProjectRun[]): RuleRow[];
  summarizeRun(projects: ProjectRun[], seed: number, target?: number): Summary;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function load<T>(relative: string): Promise<T> {
  return import(new URL(relative, import.meta.url).href) as T;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-recall-r12-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'mini', version: '1.0.0', type: 'module' }) + '\n', 'utf8');
  await writeFile(join(dir, 'src', 'index.ts'), "export * from './lib.js';\n", 'utf8');
  await writeFile(join(dir, 'src', 'lib.ts'), "export * from './public.js';\n", 'utf8');
  await writeFile(join(dir, 'src', 'public.ts'), 'export const pub = 1;\n', 'utf8');
  await writeFile(join(dir, 'src', 'plain.ts'), 'export const plain = 2;\n', 'utf8');
  await writeFile(join(dir, 'src', 'other.ts'), 'export const other = 3;\n', 'utf8');
}

function row(ruleId: string, injected: number, found: number, outOfScope: boolean, wilson: Wilson): RuleRow {
  return { ruleId, injected, found, outOfScope, recall: injected ? found / injected : null, wilson95: wilson, misses: [] };
}

test('unused-export injection skips a supplied STAR-consumed skip set', async () => {
  const { listSourceFiles, injectUnusedExports, mulberry32 } = await load<Lib>('../../benchmark/recall/lib.mjs');
  await withTempDir(async (dir) => {
    await writeProject(dir);
    const files = listSourceFiles(dir);
    const skipFiles = new Set(['src/index.ts', 'src/lib.ts']);
    const injected = injectUnusedExports(dir, files, 3, mulberry32(11), { skipFiles });
    assert.equal(injected.length, 3);
    for (const item of injected) {
      assert.ok(!skipFiles.has(item.file), `unexpected target ${item.file}`);
      const content = await readFile(join(dir, item.file), 'utf8');
      assert.ok(content.includes(item.marker));
    }
  });
});

test('STAR-consumed set is derived from the built dead-export analysis, not heuristics', async () => {
  const { starConsumedFiles, eligibleUnusedExportFiles } = await load<Entries>('../../benchmark/recall/entries.mjs');
  const { listSourceFiles } = await load<Lib>('../../benchmark/recall/lib.mjs');
  await withTempDir(async (dir) => {
    await writeProject(dir);
    const star = await starConsumedFiles(dir, REPO_ROOT);
    assert.ok(star.has('src/index.ts'));
    assert.ok(star.has('src/lib.ts'));
    assert.ok(star.has('src/public.ts'));
    assert.ok(!star.has('src/plain.ts'));
    const eligible = eligibleUnusedExportFiles(listSourceFiles(dir), star);
    assert.deepEqual(eligible, ['src/other.ts', 'src/plain.ts']);
  });
});

test('entry-point injections are labelled out of scope and land only in STAR files', async () => {
  const { starConsumedFiles, injectEntryPointExports } = await load<Entries>('../../benchmark/recall/entries.mjs');
  const { mulberry32 } = await load<Lib>('../../benchmark/recall/lib.mjs');
  await withTempDir(async (dir) => {
    await writeProject(dir);
    const star = await starConsumedFiles(dir, REPO_ROOT);
    const targets = [...star].sort();
    const injected = injectEntryPointExports(dir, targets, 3, mulberry32(23));
    assert.equal(injected.length, 3);
    for (const item of injected) {
      assert.ok(star.has(item.file));
      assert.equal(item.outOfScope, true);
      assert.match(item.reportRuleId ?? '', /entry-point, out of scope/);
      const content = await readFile(join(dir, item.file), 'utf8');
      assert.ok(content.includes(item.marker));
    }
  });
});

test('injections outside the clone-token stream are identified for annotation', async () => {
  const { injectUnusedExports, mulberry32 } = await load<Lib>('../../benchmark/recall/lib.mjs');
  const { nonTokenizedInjections } = await load<Entries>('../../benchmark/recall/entries.mjs');
  await withTempDir(async (dir) => {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'normal.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(join(dir, 'src', 'comment.ts'), 'export const b = 2;\n/* unterminated\n', 'utf8');
    const injected = injectUnusedExports(dir, ['src/normal.ts', 'src/comment.ts'], 2, mulberry32(3));
    const dropped = await nonTokenizedInjections(dir, injected, REPO_ROOT);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.file, 'src/comment.ts');
  });
});

test('evaluateRecall keeps the out-of-scope entry-point row separate', async () => {
  const { evaluateRecall, wilson95 } = await load<Lib>('../../benchmark/recall/lib.mjs');
  const inScope: Injection = { ruleId: 'ts/unused-export', file: 'src/a.ts', line: 1, marker: 'm1', kind: 'unused-export' };
  const outOfScope: Injection = {
    ruleId: 'ts/unused-export',
    reportRuleId: 'ts/unused-export [entry-point, out of scope]',
    file: 'src/index.ts',
    line: 2,
    marker: 'm2',
    kind: 'entry-point-unused-export',
    outOfScope: true,
  };
  const findings = [{ ruleId: 'ts/unused-export', file: 'src/a.ts', message: 'has zero references; m1', evidence: 'm1' }];
  const rules = evaluateRecall([inScope, outOfScope], findings);
  assert.equal(rules.length, 2);
  const normal = rules.find((r) => r.ruleId === 'ts/unused-export');
  const entry = rules.find((r) => r.outOfScope);
  assert.ok(normal && entry);
  assert.deepEqual([normal.injected, normal.found], [1, 1]);
  assert.deepEqual([entry.injected, entry.found], [1, 0]);
  assert.equal(entry.misses.length, 1);
  assert.deepEqual(entry.wilson95, wilson95(0, 1));
});

test('multi-project aggregation pools counts instead of averaging intervals', async () => {
  const { parseProjects, countsFromRules, poolRules, summarizeRun } = await load<Aggregate>('../../benchmark/recall/aggregate.mjs');
  const { wilson95 } = await load<Lib>('../../benchmark/recall/lib.mjs');
  assert.deepEqual(parseProjects('hono, zod,,execa, hono'), ['hono', 'zod', 'execa']);

  const scopeRow = (injected: number): RuleRow => row('ts/unused-export [entry-point, out of scope]', injected, 0, true, wilson95(0, injected));
  const projects: ProjectRun[] = [
    {
      name: 'a',
      fileCount: 100,
      rules: [row('ts/unused-file', 10, 9, false, wilson95(9, 10)), scopeRow(5)],
    },
    {
      name: 'b',
      fileCount: 80,
      rules: [row('ts/unused-file', 10, 8, false, wilson95(8, 10)), scopeRow(5)],
    },
  ];
  const pooled = countsFromRules(projects.flatMap((p) => p.rules), false);
  assert.deepEqual([pooled.injected, pooled.found], [20, 17]);
  assert.equal(pooled.recall, 0.85);
  assert.deepEqual(pooled.wilson95, wilson95(17, 20));
  const byRule = poolRules(projects);
  const fileRule = byRule.find((r) => r.ruleId === 'ts/unused-file');
  assert.ok(fileRule);
  assert.deepEqual((fileRule.projects ?? []).map((p) => p.project), ['a', 'b']);
  const outOfScope = countsFromRules(projects.flatMap((p) => p.rules), true);
  assert.deepEqual([outOfScope.injected, outOfScope.found], [10, 0]);

  const summary = summarizeRun(projects, 20261126, 0.9);
  assert.equal(summary.met, false);
  assert.deepEqual(summary.projects.map((p) => p.recall), [0.9, 0.8]);
  assert.deepEqual([summary.pooled.injected, summary.pooled.found], [20, 17]);
});

test('duplicate-block hits require the injected copy to be one side of the clone pair', async () => {
  const { findingMatchesInjection } = await load<Lib>('../../benchmark/recall/lib.mjs');
  const inj: Injection = {
    ruleId: 'code/duplicate-block',
    file: 'src/b.ts',
    sourceFile: 'src/a.ts',
    line: 400,
    sourceLine: 50,
    marker: '__unshitRecallDup_0',
    kind: 'duplicate-block',
  };
  const preExisting = { ruleId: 'code/duplicate-block', file: 'src/b.ts', evidence: 'src/b.ts:10-30 <-> src/a.ts:50-70' };
  assert.equal(findingMatchesInjection(preExisting, inj), false);
  const injected = { ruleId: 'code/duplicate-block', file: 'src/b.ts', evidence: 'src/b.ts:401-420 <-> src/c.ts:9-28' };
  assert.equal(findingMatchesInjection(injected, inj), true);
});
