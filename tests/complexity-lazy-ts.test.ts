import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

test('complexity detector module does not load typescript at import time', () => {
  const mod = fileURLToPath(new URL('../src/detectors/complexity.js', import.meta.url));
  const script = `
    const Module = require('node:module');
    import(${JSON.stringify('file://' + mod)}).then(() => {
      const loaded = Object.keys(Module._cache).some((k) => /[\\\\/]node_modules[\\\\/]typescript[\\\\/]/.test(k));
      process.stdout.write(loaded ? 'loaded' : 'lazy');
    });
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'lazy');
});

function body(cond: string): string {
  let out = 'export function f(a: number, b: number, c: number): number {\n  let n = 0;\n';
  for (let i = 0; i < 6; i++) out += `  for (const x of [a, b]) {\n    if (${cond}) {\n      while (n < x) { if (n % 2) { n++; } else { n += 2; } }\n    }\n  }\n`;
  return out + '  return n;\n}\n';
}

test('logical operators still raise cognitive complexity after the lazy-loading change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-cx-lazy-'));
  try {
    await writeFile(join(dir, 'plain.ts'), body('a > 0'), 'utf8');
    await writeFile(join(dir, 'logical.ts'), body('a > 0 && b > 0 || c > 0 && (a ?? 1) > 0'), 'utf8');
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const score = (file: string): number => {
      const f = scan.findings.find((x) => x.ruleId === 'code/high-complexity' && x.file === file);
      assert.ok(f, `expected ${file} to be flagged`);
      return Number(/Cognitive complexity (\d+)/.exec(f.message)?.[1]);
    };
    assert.ok(score('logical.ts') > score('plain.ts'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
