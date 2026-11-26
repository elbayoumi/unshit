import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function loadLib(): Promise<any> {
  return import(new URL('../../benchmark/oracle/lib.mjs', import.meta.url).href);
}

function fixture(files: Record<string, string>, run: (project: any) => void): void {
  const base = mkdtempSync(join(tmpdir(), 'oracle-r14-'));
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

test('unused-export: real named import is contradicted with file:line evidence', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\n',
    'src/b.ts': 'import { foo } from "./a";\nconsole.log(foo);\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.equal(result.evidence[0].file, 'src/b.ts');
    assert.equal(result.evidence[0].line, 1);
    assert.match(result.evidence[0].text, /import \{ foo \} from "\.\/a"/);
  });
});

test('unused-export: no external occurrence is confirmed', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\nconsole.log(foo);\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'CONFIRMED');
    assert.deepEqual(result.evidence, []);
  });
});

test('unused-export: same name in an unrelated module is unsure, not contradicted', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\n',
    'src/other.ts': 'export const foo = 2;\n',
    'src/use.ts': 'import { foo } from "./other";\nconsole.log(foo);\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'UNSURE');
    assert.ok(result.evidence.some((e: any) => e.file === 'src/use.ts'));
  });
});

test('unused-export: commented-out import is not evidence', () => {
  fixture({
    'src/a.ts': 'export const foo = 1;\n',
    'src/b.ts': '// import { foo } from "./a";\n',
  }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-export', 'src/a.ts', 'foo'));
    assert.equal(result.verdict, 'CONFIRMED');
  });
});

test('unused-type-export: re-export chain alone is confirmed, consumer through the chain is contradicted', () => {
  const files = {
    'src/types.ts': 'export type T = string;\n',
    'src/index.ts': 'export type { T } from "./types";\n',
  };
  fixture(files, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-type-export', 'src/types.ts', 'T'));
    assert.equal(result.verdict, 'CONFIRMED');
  });
  fixture({ ...files, 'src/use.ts': 'import type { T } from "./index";\nlet x: T;\n' }, (project) => {
    const result = lib.classifyFinding(project, exportFinding('ts/unused-type-export', 'src/types.ts', 'T'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.equal(result.evidence[0].file, 'src/use.ts');
  });
});

test('unused-file: require without extension and index resolution are contradicted', () => {
  fixture({
    'src/lib/thing.ts': 'export const x = 1;\n',
    'src/lib/index.ts': 'export * from "./thing";\n',
    'src/main.ts': 'const thing = require("./lib/thing");\nconst lib = require("./lib");\n',
  }, (project) => {
    const thing = lib.classifyFinding(project, finding('ts/unused-file', 'src/lib/thing.ts'));
    assert.equal(thing.verdict, 'CONTRADICTED');
    assert.ok(thing.evidence.some((e: any) => e.file === 'src/main.ts'));
    const index = lib.classifyFinding(project, finding('ts/unused-file', 'src/lib/index.ts'));
    assert.equal(index.verdict, 'CONTRADICTED');
  });
});

test('unused-file: package.json script path is contradicted, bare substring is not', () => {
  fixture({
    'package.json': '{"scripts":{"dev":"node play.ts"}}\n',
    'play.ts': 'console.log("playground");\n',
    'docs/notes.md': 'mentions play.ts and play in text\n',
  }, (project) => {
    const result = lib.classifyFinding(project, finding('ts/unused-file', 'play.ts'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.ok(result.evidence.some((e: any) => e.file === 'package.json' && e.line === 1));
    const bare = lib.classifyFinding(project, finding('ts/unused-file', 'docs/notes.md'));
    // docs file is present but never referenced; its own content must be ignored
    assert.equal(bare.verdict, 'CONFIRMED');
  });
});

test('unused-file: bare basename substrings are not path references', () => {
  fixture({
    'src/play.ts': 'export const play = 1;\n',
    'docs/notes.md': 'playground.ts and z.literal("play") are unrelated.\n',
  }, (project) => {
    const result = lib.classifyFinding(project, finding('ts/unused-file', 'src/play.ts'));
    assert.equal(result.verdict, 'CONFIRMED');
  });
});

test('unused-file: commented-out import is confirmed', () => {
  fixture({
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': '// import "./a";\n',
  }, (project) => {
    const result = lib.classifyFinding(project, finding('ts/unused-file', 'src/a.ts'));
    assert.equal(result.verdict, 'CONFIRMED');
  });
});

test('unused-dependency: scoped import is contradicted, import in a sibling package is confirmed', () => {
  const files = {
    'package.json': '{"devDependencies":{"root-dep":"^1"}}\n',
    'packages/a/package.json': '{"devDependencies":{"a-dep":"^1"}}\n',
    'packages/a/use.ts': 'import { x } from "a-dep";\nconsole.log(x);\n',
    'packages/b/package.json': '{"devDependencies":{"b-dep":"^1"}}\n',
    'packages/b/use.ts': 'import "a-dep";\n',
  };
  fixture(files, (project) => {
    const a = lib.classifyFinding(project, finding('deps/unused-dependency', 'packages/a/package.json', '', 'a-dep'));
    assert.equal(a.verdict, 'CONTRADICTED');
    assert.equal(a.evidence[0].file, 'packages/a/use.ts');
    const b = lib.classifyFinding(project, finding('deps/unused-dependency', 'packages/b/package.json', '', 'b-dep'));
    assert.equal(b.verdict, 'CONFIRMED');
  });
});

test('unused-dependency: config key in the declaring manifest is contradicted', () => {
  fixture({
    'package.json': '{"devDependencies":{"foo-lint":"^1"},"foo-lint":{"files":["*.ts"]}}\n',
  }, (project) => {
    const result = lib.classifyFinding(project, finding('deps/unused-dependency', 'package.json', '', 'foo-lint'));
    assert.equal(result.verdict, 'CONTRADICTED');
    assert.match(result.evidence[0].text, /foo-lint/);
  });
});

test('unused-dependency: commented import is unsure but not contradicted, doc mention is unsure', () => {
  fixture({
    'package.json': '{"devDependencies":{"ghost":"^1","documented":"^1"}}\n',
    'src/use.ts': '// import "ghost";\n',
    'README.md': '`documented` is mentioned here.\n',
  }, (project) => {
    const ghost = lib.classifyFinding(project, finding('deps/unused-dependency', 'package.json', '', 'ghost'));
    assert.equal(ghost.verdict, 'UNSURE');
    assert.equal(ghost.evidence[0].file, 'src/use.ts');
    const documented = lib.classifyFinding(project, finding('deps/unused-dependency', 'package.json', '', 'documented'));
    assert.equal(documented.verdict, 'UNSURE');
    assert.equal(documented.evidence[0].file, 'README.md');
  });
});

test('aggregate: unsure is counted both ways in precision and Wilson bounds', () => {
  const rows = [
    { verdict: 'CONFIRMED' }, { verdict: 'CONFIRMED' },
    { verdict: 'CONTRADICTED' }, { verdict: 'UNSURE' },
  ];
  const stats = lib.aggregate(rows);
  assert.equal(stats.total, 4);
  assert.equal(stats.precisionLower, 0.5);
  assert.equal(stats.precisionUpper, 0.75);
  assert.equal(stats.precisionConfirmedOnly, 2 / 3);
  assert.ok(stats.wilson95.lowerBoundLow < 0.5);
  assert.ok(stats.wilson95.upperBoundHigh > 0.75);
});
