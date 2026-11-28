import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function withTempProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-fs-r16-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function walkJsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: any;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsFiles(abs));
    else if (e.isFile() && /\.(?:js|cjs|mjs)$/i.test(e.name)) out.push(abs);
  }
  return out;
}

function syntacticJsDiagnostics(dir: string): { file: string; code: number; message: string }[] {
  const rootNames = walkJsFiles(dir);
  const options = { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
  const program = ts.createProgram({ rootNames, options });
  const rootSet = new Set(rootNames);
  const diags: { file: string; code: number; message: string }[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!rootSet.has(sf.fileName)) continue;
    for (const d of program.getSyntacticDiagnostics(sf)) {
      const rel = sf.fileName.startsWith(dir) ? sf.fileName.slice(dir.length + 1) : sf.fileName;
      diags.push({ file: rel, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
    }
  }
  return diags;
}

function diffDiagnostics(
  before: { file: string; code: number; message: string }[],
  after: { file: string; code: number; message: string }[],
): { file: string; code: number; message: string }[] {
  const bc = new Map<string, number>();
  for (const d of before) {
    const k = `${d.file}|${d.code}|${d.message}`;
    bc.set(k, (bc.get(k) ?? 0) + 1);
  }
  const ac = new Map<string, number>();
  const out: { file: string; code: number; message: string }[] = [];
  for (const d of after) {
    const k = `${d.file}|${d.code}|${d.message}`;
    ac.set(k, (ac.get(k) ?? 0) + 1);
    if ((ac.get(k) ?? 0) > (bc.get(k) ?? 0)) out.push(d);
  }
  return out;
}

test('fix-soundness JS fallback: a sound edit yields 0 new syntactic diagnostics', async () => {
  await withTempProject(
    { 'index.js': 'function foo() { return 1; }\n' },
    async (dir) => {
      const before = syntacticJsDiagnostics(dir);
      await writeFile(join(dir, 'index.js'), 'function foo() { return 1; }\nconsole.log(foo());\n', 'utf8');
      const after = syntacticJsDiagnostics(dir);
      const newDiags = diffDiagnostics(before, after);
      assert.equal(newDiags.length, 0, `expected 0 new diagnostics, got ${newDiags.length}: ${JSON.stringify(newDiags)}`);
    },
  );
});

test('fix-soundness JS fallback: a broken edit (unbalanced brace) yields >=1 new syntactic diagnostic', async () => {
  await withTempProject(
    { 'index.js': 'function foo() { return 1; }\n' },
    async (dir) => {
      const before = syntacticJsDiagnostics(dir);
      await writeFile(join(dir, 'index.js'), 'function foo() { return 1;\n', 'utf8');
      const after = syntacticJsDiagnostics(dir);
      const newDiags = diffDiagnostics(before, after);
      assert.ok(newDiags.length >= 1, `expected >=1 new diagnostic, got ${newDiags.length}`);
    },
  );
});

test('fix-soundness JS fallback: a pre-existing syntax error is not counted as new', async () => {
  await withTempProject(
    {
      'index.js': 'function foo() { return 1; }\n',
      'broken.js': 'function bar() {\n',
    },
    async (dir) => {
      const before = syntacticJsDiagnostics(dir);
      await writeFile(join(dir, 'index.js'), 'function foo() { return 1; }\nconsole.log(foo());\n', 'utf8');
      const after = syntacticJsDiagnostics(dir);
      const newDiags = diffDiagnostics(before, after);
      assert.equal(newDiags.length, 0, `expected 0 new diagnostics, got ${newDiags.length}: ${JSON.stringify(newDiags)}`);
    },
  );
});

test('fix-soundness JS fallback: diagnostics compared by file+code+message, shifted lines do not count as new', async () => {
  await withTempProject(
    { 'index.js': 'function foo() { return 1; }\nconsole.log(foo());\n' },
    async (dir) => {
      const before = syntacticJsDiagnostics(dir);
      await writeFile(join(dir, 'index.js'), '\n\nfunction foo() { return 1; }\nconsole.log(foo());\n', 'utf8');
      const after = syntacticJsDiagnostics(dir);
      const newDiags = diffDiagnostics(before, after);
      assert.equal(newDiags.length, 0, `expected 0 new diagnostics, got ${newDiags.length}: ${JSON.stringify(newDiags)}`);
    },
  );
});
