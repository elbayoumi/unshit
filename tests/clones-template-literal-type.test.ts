import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';
import { tokenize } from '../src/detectors/clones-tokenize.js';
import type { FileEntry } from '../src/contracts.js';

function makeFile(content: string): FileEntry {
  return {
    absPath: '/tmp/a.ts',
    relPath: 'a.ts',
    ext: '.ts',
    content,
    lines: content.split('\n'),
  };
}

test('tokens after a template literal type are produced', () => {
  const content = "type T = `${string}-${number}`;\nexport function foo(x: number) { return x + 1; }\n";
  const tokens = tokenize(makeFile(content));
  assert.ok(tokens.some((t) => t.line >= 2), 'expected tokens on the line after the template literal type');
});

test('code/duplicate-block is detected after a template literal type', async () => {
  const body = '  if (!values || values.length === 0) return [];\n  const kept = values.filter((v) => v > 0 && v < 100);\n  if (kept.length === 0) return [];\n  return kept.map((v) => v * 2 + 1);\n';
  const content =
    "type T = `${string}-${number}`;\n" +
    'export function one(values: number[]) {\n' + body + '}\n' +
    'export function two(values: number[]) {\n' + body + '}\n';
  const dir = await mkdtemp(join(tmpdir(), 'unshit-test-'));
  try {
    await writeFile(join(dir, 'a.ts'), content, 'utf8');
    const scan = await runScan(dir, { ...DEFAULT_CONFIG, cloneMinTokens: 25 });
    const clones = scan.findings.filter((f) => f.ruleId === 'code/duplicate-block');
    assert.ok(clones.length >= 1, 'expected a duplicate-block finding, got ' + clones.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});