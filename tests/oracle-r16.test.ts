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

test('mirrored directory: import resolving into the mirror of the audited file is attributed to it', () => {
  fixture({
    'src/adapter/thing/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/consumer.ts': 'import { Handler } from "./handler";\nconst handler = new Handler();\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/adapter/thing/handler.ts', 'Handler'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.equal(result.evidence[0].file, 'adapters/thing/src/consumer.ts');
    assert.match(result.evidence[0].text, /import \{ Handler \} from "\.\/handler"/);
  });
});

test('mirrored directory: same-named symbol in a sibling module is not attributed across mirrors', () => {
  fixture({
    'src/adapter/thing/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/handler.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/other.ts': 'export class Handler { constructor() {} }\n',
    'adapters/thing/src/use.ts': 'import { Handler } from "./other";\nconst handler = new Handler();\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/adapter/thing/handler.ts', 'Handler'));
    // The import resolves to ./other, not to the audited module, so it cannot
    // contradict it; the name collision keeps the verdict UNSURE.
    assert.equal(result.verdict, 'UNSURE');
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
