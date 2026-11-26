import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

async function loadLib(): Promise<any> {
  return import(new URL('../../benchmark/recall-extra/lib.mjs', import.meta.url).href);
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-recall-extra-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeMiniProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'mini', version: '1.0.0', dependencies: { react: '19.0.0' } }, null, 2) + '\n', 'utf8');
  await writeFile(join(dir, 'src', 'a.ts'), 'export function a(v: number): number { return v + 1; }\n', 'utf8');
  await writeFile(join(dir, 'src', 'b.ts'), 'export function b(v: number): number { return v + 2; }\n', 'utf8');
  await writeFile(join(dir, 'src', 'c.tsx'), 'export function C() { return <div>c</div>; }\n', 'utf8');
}

function files() {
  return ['src/a.ts', 'src/b.ts', 'src/c.tsx'];
}

test('no-double-cast injector shape and matcher', async () => {
  const { injectNoDoubleCast, injectNoDoubleCastNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectNoDoubleCast(dir, files(), 2, () => 0.1);
    assert.equal(inj.length, 2);
    for (const i of inj) {
      assert.equal(i.ruleId, 'ts/no-double-cast');
      assert.equal(i.kind, 'no-double-cast');
      assert.match(i.marker, /__unshitRecallDoubleCast_/);
      const content = await readFile(join(dir, i.file), 'utf8');
      assert.match(content, /as unknown as number/);
      assert.ok(findingMatchesInjection({ ruleId: i.ruleId, file: i.file, span: { line: i.line } }, i));
      assert.ok(!findingMatchesInjection({ ruleId: i.ruleId, file: i.file, span: { line: i.line + 20 } }, i));
    }
    const neg = injectNoDoubleCastNegatives(dir, files(), 2, () => 0.2);
    assert.equal(neg.length, 2);
    for (const i of neg) {
      assert.equal(i.expect, 'negative');
      const content = await readFile(join(dir, i.file), 'utf8');
      assert.match(content, new RegExp(i.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

test('redundant-catch injector shape and matcher', async () => {
  const { injectRedundantCatch, injectRedundantCatchNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectRedundantCatch(dir, files(), 2, () => 0.1);
    assert.equal(inj.length, 2);
    for (const i of inj) {
      assert.equal(i.ruleId, 'slop/redundant-catch');
      assert.equal(i.kind, 'redundant-catch');
      const content = await readFile(join(dir, i.file), 'utf8');
      assert.match(content, /catch \(e\) \{\n    throw e;\n  \}/);
      assert.ok(findingMatchesInjection({ ruleId: i.ruleId, file: i.file, span: { line: i.line } }, i));
    }
    const neg = injectRedundantCatchNegatives(dir, files(), 2, () => 0.2);
    for (const i of neg) {
      assert.equal(i.ruleId, 'slop/redundant-catch');
      assert.equal(i.expect, 'negative');
    }
  });
});

test('high-complexity injector shape and matcher', async () => {
  const { injectHighComplexity, injectHighComplexityNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectHighComplexity(dir, files(), 1, () => 0.1, 25);
    assert.equal(inj.length, 1);
    assert.equal(inj[0].ruleId, 'code/high-complexity');
    assert.equal(inj[0].kind, 'high-complexity');
    const content = await readFile(join(dir, inj[0].file), 'utf8');
    assert.match(content, new RegExp(`export function ${inj[0].marker}`));
    assert.ok(findingMatchesInjection({ ruleId: inj[0].ruleId, file: inj[0].file, message: `Cognitive complexity 26 exceeds threshold 25 in "${inj[0].marker}"` }, inj[0]));
    const neg = injectHighComplexityNegatives(dir, files(), 1, () => 0.2, 25);
    assert.equal(neg[0].kind, 'high-complexity-neg');
    assert.equal(neg[0].score, 25);
  });
});

test('react/god-file injector shape and matcher', async () => {
  const { injectGodFile, injectGodFileNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectGodFile(dir, files(), 2, () => 0.1);
    assert.equal(inj.length, 2);
    for (const i of inj) {
      assert.equal(i.ruleId, 'react/god-file');
      assert.ok(i.file.endsWith('.tsx'));
      const content = await readFile(join(dir, i.file), 'utf8');
      if (i.mode === 'hooks') assert.match(content, /useState/);
      else assert.ok(content.split(/\r?\n/).length >= 360);
      assert.ok(findingMatchesInjection({ ruleId: i.ruleId, file: i.file, span: { line: 1 } }, i));
    }
    const neg = injectGodFileNegatives(dir, files(), 2, () => 0.2);
    for (const i of neg) {
      assert.equal(i.expect, 'negative');
      const content = await readFile(join(dir, i.file), 'utf8');
      if (i.mode === 'hooks') assert.equal((content.match(/useState\(/g) ?? []).length, 15);
      else assert.equal(content.split(/\r?\n/).length, 350);
    }
  });
});

test('import-cycle injector shape and matcher', async () => {
  const { injectImportCycle, injectImportCycleNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectImportCycle(dir, files(), 1, () => 0.1);
    assert.equal(inj.length, 1);
    assert.equal(inj[0].ruleId, 'arch/import-cycle');
    const a = await readFile(join(dir, inj[0].file), 'utf8');
    const b = await readFile(join(dir, inj[0].otherFile), 'utf8');
    assert.match(a, /import \{ b \} from/);
    assert.match(b, /import \{ a \} from/);
    assert.ok(findingMatchesInjection({ ruleId: 'arch/import-cycle', file: inj[0].file, evidence: `${inj[0].file} -> ${inj[0].otherFile} -> ${inj[0].file}` }, inj[0]));
    const neg = injectImportCycleNegatives(dir, files(), 1, () => 0.2);
    assert.equal(neg[0].expect, 'negative');
    const na = await readFile(join(dir, neg[0].file), 'utf8');
    assert.match(na, /import type \{ B \}/);
  });
});

test('unused-type-export injector shape and matcher', async () => {
  const { injectUnusedTypeExport, injectUnusedTypeExportNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectUnusedTypeExport(dir, files(), 2, () => 0.1);
    assert.equal(inj.length, 2);
    for (const i of inj) {
      assert.equal(i.ruleId, 'ts/unused-type-export');
      const content = await readFile(join(dir, i.file), 'utf8');
      assert.match(content, new RegExp(`export type ${i.marker}`));
      assert.ok(findingMatchesInjection({ ruleId: i.ruleId, file: i.file, message: `Exported type \`${i.marker}\` has zero references; safe to delete.` }, i));
    }
    const neg = injectUnusedTypeExportNegatives(dir, files(), 1, () => 0.2);
    assert.equal(neg[0].expect, 'negative');
    const consumer = await readFile(join(dir, neg[0].consumer), 'utf8');
    assert.match(consumer, new RegExp(`import type \\{ ${neg[0].marker} \\}`));
  });
});

test('unlisted-dependency injector shape and matcher', async () => {
  const { injectUnlistedDependency, injectUnlistedDependencyNegatives, findingMatchesInjection } = await loadLib();
  await withTempDir(async (dir) => {
    await makeMiniProject(dir);
    const inj = injectUnlistedDependency(dir, files(), 2, () => 0.1);
    assert.equal(inj.length, 2);
    for (const i of inj) {
      assert.equal(i.ruleId, 'deps/unlisted-dependency');
      const content = await readFile(join(dir, i.file), 'utf8');
      assert.match(content, new RegExp(`import '${i.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
      assert.ok(findingMatchesInjection({ ruleId: i.ruleId, file: i.file, evidence: `import '${i.marker}'`, message: i.marker }, i));
    }
    const neg = injectUnlistedDependencyNegatives(dir, files(), 2, () => 0.2);
    assert.equal(neg.length, 2);
    for (const i of neg) {
      assert.equal(i.expect, 'negative');
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      assert.equal(pkg.devDependencies[i.marker], '1.0.0');
    }
  });
});

test('evaluateRecall and evaluateFalsePositives compute rates', async () => {
  const { evaluateRecall, evaluateFalsePositives } = await loadLib();
  const injections = [
    { ruleId: 'ts/no-double-cast', file: 'a.ts', line: 10, marker: 'm1', kind: 'no-double-cast' },
    { ruleId: 'ts/no-double-cast', file: 'a.ts', line: 20, marker: 'm2', kind: 'no-double-cast' },
  ];
  const findings = [{ ruleId: 'ts/no-double-cast', file: 'a.ts', span: { line: 10 }, message: '', evidence: '' }];
  const recall = evaluateRecall(injections, findings);
  assert.equal(recall[0].found, 1);
  assert.equal(recall[0].injected, 2);

  const negatives = [
    { ruleId: 'ts/no-double-cast', file: 'a.ts', line: 30, marker: 'n1', kind: 'no-double-cast-neg', expect: 'negative' },
  ];
  const fp = evaluateFalsePositives(negatives, findings);
  assert.equal(fp[0].falsePositives, 0);
  assert.equal(fp[0].negatives, 1);
});
