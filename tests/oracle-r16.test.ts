import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function loadLib(): Promise<any> {
  return import(new URL('../../benchmark/oracle/lib.mjs', import.meta.url).href);
}

function fixture(files: Record<string, string>, run: (project: any) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'oracle-r16-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(base, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    run(lib.buildProject(base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const lib = await loadLib();

function finding(ruleId: string, file: string, message = '', evidence = ''): any {
  return { corpus: 'fixture', ruleId, file, line: 1, message, evidence };
}

function exportFinding(ruleId: string, file: string, symbol: string): any {
  return finding(ruleId, file, `Exported symbol \`${symbol}\` has zero references; safe to delete.`, `export ... ${symbol}`);
}

test('twin files: an import resolving only into the other same-named file does not contradict the audited file', () => {
  fixture({
    'src/adapter/thing/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/consumer.ts': 'import { Handler } from "./handler";\nconst handler = new Handler();\n',
  }, (project) => {
    // The consumer resolves to adapters/thing/src/handler.ts, which is a
    // distinct deprecated copy in this layout, not to the audited handler.
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/adapter/thing/handler.ts', 'Handler'));
    assert.equal(result.verdict, 'UNSURE');
    assert.equal(result.evidence[0].file, 'adapters/thing/src/consumer.ts');
    assert.match(result.evidence[0].text, /import \{ Handler \} from "\.\/handler"/);
  });
});

test('twin files: an import that really resolves into the audited file still contradicts it', () => {
  fixture({
    'src/adapter/thing/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/test/consumer.ts': 'import { Handler } from "../../../src/adapter/thing/handler";\nconst handler = new Handler();\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/adapter/thing/handler.ts', 'Handler'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.equal(result.evidence[0].file, 'adapters/thing/test/consumer.ts');
    assert.match(result.evidence[0].text, /import \{ Handler \} from "\.\.\/\.\.\/\.\.\/src\/adapter\/thing\/handler"/);
  });
});

test('comment-only mention is ignored and the export is confirmed', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\n',
    'src/b.ts': '// import { foo } from "./a";\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'CONFIRMED');
  });
});

test('markdown-only mention is ignored and the type export is confirmed', () => {
  fixture({
    'src/types.ts': 'export type T = string;\n',
    'docs/notes.md': 'The \`T\` type is documented here.\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-type-export', 'src/types.ts', 'T'));
    assert.equal(result.verdict, 'CONFIRMED');
    assert.match(result.reason, /No code occurrence of `T` outside its declaration/);
  });
});

test('lockfile-only mention is ignored and the export is confirmed', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\n',
    'pnpm-lock.yaml': '  foo:\n    version: 1.0.0\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'CONFIRMED');
    assert.deepEqual(result.evidence, []);
  });
});

test('public entry point from package.json exports is uncertain until a concrete consumer exists', () => {
  fixture({
    'package.json': '{"name":"fixture","exports":{".":{"import":"./src/index.ts"},"./sub":{"import":"./src/sub/index.ts"}}}\n',
    'src/index.ts': 'export const used = 1;\n',
    'src/sub/index.ts': 'export const sub = 2;\n',
    'src/use.ts': 'import { used } from "./index";\n',
  }, (project) => {
    const entry = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/sub/index.ts', 'sub'));
    assert.equal(entry.verdict, 'UNSURE');
    const consumed = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/index.ts', 'used'));
    assert.equal(consumed.verdict, 'CONTRADICTED');
    assert.equal(consumed.evidence[0].file, 'src/use.ts');
  });
});

test('published dist target in package.json exports maps back to the real source entry', () => {
  fixture({
    'package.json': '{"name":"fixture","exports":{".":{"import":"./dist/index.js"},"./sub":{"import":"./dist/sub/index.js"}}}\n',
    'src/index.ts': 'export const used = 1;\n',
    'src/sub/index.ts': 'export const sub = 2;\n',
  }, (project) => {
    const entry = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/sub/index.ts', 'sub'));
    assert.equal(entry.verdict, 'UNSURE');
    assert.equal(entry.evidence[0].file, 'package.json');
  });
});
