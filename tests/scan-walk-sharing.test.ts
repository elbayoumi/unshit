import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Detector, DetectorContext, FileEntry, Finding } from '../src/contracts.js';
import { collectModuleSpecs } from '../src/detectors/deps-shared.js';
import { entryPointFileSet } from '../src/detectors/dead-exports.js';
import {
  magicTimerDetector,
  noDoubleCastDetector,
  noExplicitAnyDetector,
  noInlineI18nTernaryDetector,
  redundantCatchDetector,
} from '../src/detectors/ts-ast.js';

function makeFile(relPath: string, content: string): FileEntry {
  return {
    absPath: `/tmp/${relPath}`,
    relPath,
    ext: '.ts',
    content,
    lines: content.split(/\r?\n/),
    sourceFile: ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

function normalize(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    a.file.localeCompare(b.file)
    || a.span.line - b.span.line
    || a.span.column - b.span.column
    || a.ruleId.localeCompare(b.ruleId));
}

const A = makeFile('a.ts', [
  'export function a(x: any): unknown {',
  '  const raw = ({} as unknown as { id: string }).id;',
  '  const label = true ? "ar" : "en";',
  '  setTimeout(() => console.log(raw, label), 250);',
  '  return x;',
  '}',
].join('\n'));

const B = makeFile('b.ts', [
  'export function b(value: any): number {',
  '  try { return value as number; } catch (err: any) { throw err; }',
  '}',
].join('\n'));

const DETECTORS: Detector[] = [
  noExplicitAnyDetector,
  noDoubleCastDetector,
  noInlineI18nTernaryDetector,
  magicTimerDetector,
  redundantCatchDetector,
];

function ctx(files: FileEntry[]): DetectorContext {
  return { rootDir: '/tmp', config: { ...DEFAULT_CONFIG }, files };
}

test('shared AST walk yields the same findings as one detector call per file', () => {
  const whole = ctx([A, B]);
  for (const detector of DETECTORS) {
    const grouped = normalize(detector.detect(whole));
    const separate = normalize([A, B].flatMap((file) => detector.detect(ctx([file]))));
    assert.deepEqual(grouped, separate, `${detector.id} must not depend on ctx grouping`);
  }
  assert.ok(normalize(noExplicitAnyDetector.detect(whole)).length > 0);
  assert.ok(normalize(magicTimerDetector.detect(whole)).length > 0);
});

test('module specs are memoized and dynamic imports are tagged', () => {
  const file = makeFile('c.ts', [
    'import { x } from "./a";',
    'const lazy = () => import("./b");',
    'const req = require("node:fs");',
    'export { x };',
  ].join('\n'));
  const first = collectModuleSpecs(file);
  assert.equal(collectModuleSpecs(file), first, 'memoized result should be reused');
  const dynamic = first.filter((spec) => spec.kind === 'dynamic-import');
  assert.deepEqual(dynamic.map((spec) => spec.text), ['./b']);
  assert.ok(first.some((spec) => spec.text === './a' && spec.kind === undefined));
});

test('entry points are memoized per detector context', () => {
  const index = makeFile('index.ts', 'export {};\n');
  const files = [A, B, index];
  const context = ctx(files);
  assert.equal(entryPointFileSet(context, files), entryPointFileSet(context, files));
  assert.ok(entryPointFileSet(context, files).has('index.ts'));
  assert.ok(!entryPointFileSet(context, files).has('a.ts'));
});
