import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';
import type { ScanResult } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-complexity-test-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function complexityHits(scan: ScanResult, file: string) {
  return scan.findings.filter((f) => f.ruleId === 'code/high-complexity' && f.file === file);
}

function scoreFromMessage(message: string): number {
  const m = /Cognitive complexity (\d+)/.exec(message);
  assert.ok(m, `expected a cognitive complexity score in message: ${message}`);
  return Number(m[1]);
}

test('code/high-complexity: simple function is not flagged', async () => {
  await withTempProject(
    {
      'simple.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(complexityHits(scan, 'simple.ts').length, 0);
    },
  );
});

test('code/high-complexity: deeply nested function is flagged, span at the function name', async () => {
  const code = [
    'export function deep(x: number): number {', // name line: line 1
    '  if (x > 0) {', // +1 (nesting 0)
    '    if (x > 10) {', // +2
    '      if (x > 20) {', // +3
    '        for (let i = 0; i < x; i++) {', // +4
    '          while (x > 30) {', // +5
    '            if (x > 40) {', // +6
    '              if (x > 50) {', // +7
    '                return x;',
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  await withTempProject({ 'deep.ts': code }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const hits = complexityHits(scan, 'deep.ts');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].span.line, 1, 'span should be at the function name');
    const score = scoreFromMessage(hits[0].message);
    assert.ok(score > 25, `expected score above the default threshold, got ${score}`);
    assert.match(hits[0].message, /exceeds threshold 25/);
  });
});

test('code/high-complexity: complexityMax config threshold is respected', async () => {
  const code = [
    'export function tally(n: number): number {',
    '  let total = 0;',
    '  if (n > 0) total += 1;', // +1
    '  if (n > 10) total += 2;', // +1
    '  return total;',
    '}',
    '',
  ].join('\n');
  await withTempProject({ 'tally.ts': code }, async (dir) => {
    const base = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(complexityHits(base, 'tally.ts').length, 0, 'score 2 must stay under the default threshold 25');

    const strict = await runScan(dir, { ...DEFAULT_CONFIG, complexityMax: 1 });
    const hits = complexityHits(strict, 'tally.ts');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /exceeds threshold 1/);
  });
});

test('code/high-complexity: nested closure is scored separately from its parent', async () => {
  const code = [
    'export function outer(flag: boolean): number {',
    '  const inner = (): number => {',
    '    if (flag) {', // +1
    '      if (flag) {', // +2
    '        if (flag) {', // +3
    '          if (flag) {', // +4
    '            if (flag) {', // +5
    '              if (flag) {', // +6
    '                if (flag) {', // +7
    '                  return 1;',
    '                }',
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '    return 0;',
    '  };',
    '  return inner();',
    '}',
    '',
  ].join('\n');
  await withTempProject({ 'outer.ts': code }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const hits = complexityHits(scan, 'outer.ts');
    assert.equal(hits.length, 1, 'only the inner arrow is flagged');
    assert.match(hits[0].message, /"inner"/, 'the finding should name the flagged closure');
    const score = scoreFromMessage(hits[0].message);
    assert.ok(score > 25);
  });
});
