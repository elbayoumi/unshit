import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import type { FileEntry, Finding } from '../src/contracts.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { planRedundantCatchFixes } from '../src/core/fixers/redundant-catch.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-catchfix-r13-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function scan(dir: string) {
  return runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
}

async function fix(dir: string, apply: boolean) {
  return runFix(await scan(dir), { apply, ai: false });
}

function catchFindings(result: Awaited<ReturnType<typeof scan>>): Finding[] {
  return result.findings.filter((f) => f.ruleId === 'slop/redundant-catch');
}

/** A finding anchored on the first try statement, even when the detector stays silent. */
function findingForFirstTry(file: FileEntry): Finding {
  let target: ts.TryStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (target || !file.sourceFile) return;
    if (ts.isTryStatement(node)) { target = node; return; }
    ts.forEachChild(node, visit);
  };
  if (file.sourceFile) visit(file.sourceFile);
  assert.ok(target, 'test source should contain a try statement');
  const sf = file.sourceFile!;
  const startOffset = target.getStart(sf);
  const pos = sf.getLineAndCharacterOfPosition(startOffset);
  return {
    ruleId: 'slop/redundant-catch',
    category: 'slop',
    tier: 'structural',
    severity: 'warn',
    fixability: 'safe',
    confidence: 1,
    file: file.relPath,
    span: { line: pos.line + 1, column: pos.character + 1, startOffset, endOffset: target.getEnd() },
    message: 'test finding',
    evidence: 'test finding',
  };
}

function assertCompiles(text: string): void {
  const out = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.deepEqual(out.diagnostics ?? [], []);
}

const SIMPLE = 'function run() {\n  try {\n    // keep this comment\n    step(); // trailing\n  } catch (e) {\n    throw e;\n  }\n}\nfunction step() {}\nrun();\n';
const UNWRAPPED = 'function run() {\n  // keep this comment\n  step(); // trailing\n}\nfunction step() {}\nrun();\n';

test('slop/redundant-catch: dry run prints a unified diff and writes nothing', async () => {
  await withTempProject({ 'src/index.ts': SIMPLE }, async (dir) => {
    const hits = catchFindings(await scan(dir));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.fixability, 'safe');

    const dry = await fix(dir, false);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.appliedCount, 0);
    assert.equal(dry.deterministicPatches.length, 1);
    assert.match(dry.diff, /--- a\/src\/index\.ts/);
    assert.match(dry.diff, /-  try \{/);
    assert.match(dry.diff, /\+  \/\/ keep this comment/);
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), SIMPLE);
  });
});

test('slop/redundant-catch: --apply unwraps the try and preserves interior comments', async () => {
  await withTempProject({ 'src/index.ts': SIMPLE }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.appliedCount, 1);
    assert.deepEqual(applied.skipped, []);
    const updated = await readFile(join(dir, 'src/index.ts'), 'utf8');
    assert.equal(updated, UNWRAPPED);
    assert.ok(!/try \{|catch \(/.test(updated));
    assertCompiles(updated);
    assert.equal(catchFindings(await scan(dir)).length, 0);
  });
});

test('slop/redundant-catch: keeps a bare block when a const would collide', async () => {
  const before = 'function run() {\n  const value = 1;\n  try {\n    const value = 2;\n    use(value);\n  } catch (e) {\n    throw e;\n  }\n  use(value);\n}\nfunction use(v: number) { console.log(v); }\nrun();\n';
  const expected = 'function run() {\n  const value = 1;\n  {\n    const value = 2;\n    use(value);\n  }\n  use(value);\n}\nfunction use(v: number) { console.log(v); }\nrun();\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.appliedCount, 1);
    const updated = await readFile(join(dir, 'src/index.ts'), 'utf8');
    assert.equal(updated, expected);
    assertCompiles(updated);
    assert.equal(catchFindings(await scan(dir)).length, 0);
  });
});

test('slop/redundant-catch: a single-line try with a block-scoped declaration stays a block', async () => {
  const before = 'function run() { try { const x = 1; use(x); } catch (e) { throw e; } use(2); }\nfunction use(v: number) {}\nrun();\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.appliedCount, 1);
    const updated = await readFile(join(dir, 'src/index.ts'), 'utf8');
    assert.equal(updated, 'function run() { { const x = 1; use(x); } use(2); }\nfunction use(v: number) {}\nrun();\n');
    assertCompiles(updated);
  });
});

test('slop/redundant-catch: a finally block is skipped with a reason and left untouched', async () => {
  const before = 'function run() {\n  try {\n    step();\n  } catch (e) {\n    throw e;\n  } finally {\n    cleanup();\n  }\n}\nfunction step() {}\nfunction cleanup() {}\nrun();\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const result = await scan(dir);
    const hits = catchFindings(result);
    assert.equal(hits.length, 1);
    assert.notEqual(hits[0]?.fixability, 'safe');
    assert.equal((await fix(dir, true)).deterministicPatches.length, 0);
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), before);

    const file = result.files.find((f) => f.relPath === 'src/index.ts')!;
    const plan = planRedundantCatchFixes(file, [hits[0]!]);
    assert.equal(plan.patches.length, 0);
    assert.match(plan.skipped[0]!.reason, /finally block/);
  });
});

test('slop/redundant-catch: a catch that wraps or logs is skipped, not flagged as safe', async () => {
  const before = 'function run() {\n  try {\n    step();\n  } catch (e) {\n    console.error(e);\n    throw new Error("wrapped");\n  }\n}\nfunction step() {}\nrun();\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const result = await scan(dir);
    assert.equal(catchFindings(result).length, 0);
    assert.equal((await fix(dir, true)).deterministicPatches.length, 0);
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), before);

    const file = result.files.find((f) => f.relPath === 'src/index.ts')!;
    const plan = planRedundantCatchFixes(file, [findingForFirstTry(file)]);
    assert.equal(plan.patches.length, 0);
    assert.match(plan.skipped[0]!.reason, /does more than rethrow/);
  });
});

test('slop/redundant-catch: nested rethrow catches converge across fix passes', async () => {
  const before = 'function run() {\n  try {\n    try {\n      step();\n    } catch (inner) {\n      throw inner;\n    }\n  } catch (outer) {\n    throw outer;\n  }\n}\nfunction step() {}\nrun();\n';
  const expected = 'function run() {\n  step();\n}\nfunction step() {}\nrun();\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const applied = await fix(dir, true);
    assert.ok(applied.passes >= 2, 'nested catches should be fixed on a later pass');
    assert.ok(applied.appliedCount >= 2);
    const updated = await readFile(join(dir, 'src/index.ts'), 'utf8');
    assert.equal(updated, expected);
    assertCompiles(updated);
    assert.equal(catchFindings(await scan(dir)).length, 0);
  });
});

test('slop/redundant-catch: a second --apply is a no-op', async () => {
  await withTempProject({ 'src/index.ts': SIMPLE }, async (dir) => {
    await fix(dir, true);
    const again = await fix(dir, true);
    assert.equal(again.deterministicPatches.length, 0);
    assert.equal(again.appliedCount, 0);
    assert.equal(again.diff, '');
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), UNWRAPPED);
  });
});

test('slop/redundant-catch: a try that is the body of an if keeps its block so both statements stay guarded', async () => {
  const before = 'function run(c: boolean) { if (c) try { a(); b(); } catch (e) { throw e; } }\nfunction a() {}\nfunction b() {}\nrun(false);\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.appliedCount, 1);
    const updated = await readFile(join(dir, 'src/index.ts'), 'utf8');
    assert.equal(updated, 'function run(c: boolean) { if (c) { a(); b(); } }\nfunction a() {}\nfunction b() {}\nrun(false);\n');
    assertCompiles(updated);
  });
});
