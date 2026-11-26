import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';
import { isTestFile } from '../src/detectors/ts-ast.js';

test('isTestFile matches a test directory at the start of the path', () => {
  assert.equal(isTestFile('test/io/max-buffer.js'), true);
  assert.equal(isTestFile('tests/unit.ts'), true);
  assert.equal(isTestFile('packages/a/test/x.ts'), true);
  assert.equal(isTestFile('src/a.test.ts'), true);
  assert.equal(isTestFile('src/latest/x.ts'), false);
  assert.equal(isTestFile('src/contest/x.ts'), false);
  assert.equal(isTestFile('testing/x.ts'), false);
});

test('slop/magic-timer does not report files under a root test/ directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-test-path-'));
  try {
    const timer = 'export function wait(fn: () => void): void {\n  setTimeout(fn, 5000);\n}\n';
    for (const name of ['test/io/max-buffer.ts', 'src/poll.ts']) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), timer, 'utf8');
    }
    const result = await runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
    const files = result.findings.filter((f) => f.ruleId === 'slop/magic-timer').map((f) => f.file);
    assert.deepEqual(files, ['src/poll.ts']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
