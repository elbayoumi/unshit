import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';
import { runScan } from '../src/core/scanner.js';

// A custom property definition must exist for css/design-drift to activate.
const TOKENS = ':root { --color-rgb: 47 111 237; --c: 47 111 237; --h: 210; --s: 50%; --l: 50%; --r: 1; }\n';

async function driftFindings(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-css-rgb-var-r15-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, 'utf8');
    }
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    return scan.findings.filter((f) => f.ruleId === 'css/design-drift');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('reproducer: rgb(var(--color-rgb) / 0.5) built only from custom properties is not hardcoded', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.button { color: rgb(var(--color-rgb) / 0.5); }\n`,
  });
  assert.equal(drift.length, 0);
});

test('rgba(var(--c), 0.4) with alpha after a var channel is not hardcoded', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: rgba(var(--c), 0.4); }\n`,
  });
  assert.equal(drift.length, 0);
});

test('hsl(var(--h) var(--s) var(--l) / .2) with all channels from custom properties is not hardcoded', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: hsl(var(--h) var(--s) var(--l) / .2); }\n`,
  });
  assert.equal(drift.length, 0);
});

test('rgb(var(--r) 0 0) stays flagged when a literal color channel exists', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: rgb(var(--r) 0 0); }\n`,
  });
  assert.equal(drift.length, 1);
  assert.match(drift[0]!.message, /rgb\(/i);
});

test('rgb(255 var(--g) 0) stays flagged when a literal color channel exists', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: rgb(255 var(--g) 0); }\n`,
  });
  assert.equal(drift.length, 1);
});

test('plain rgb(47 111 237) stays flagged', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: rgb(47 111 237); }\n`,
  });
  assert.equal(drift.length, 1);
});

test('rgb(47 111 237 / 0.5) stays flagged; literal alpha does not change hardcoded channels', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: rgb(47 111 237 / 0.5); }\n`,
  });
  assert.equal(drift.length, 1);
});

test('.scss file with the same reproducer produces no css/design-drift findings', async () => {
  const drift = await driftFindings({
    'styles.scss': `${TOKENS}.button { color: rgb(var(--color-rgb) / 0.5); }\n`,
  });
  assert.equal(drift.length, 0);
});

test(':root token definitions stay exempt', async () => {
  const drift = await driftFindings({
    'styles.css': ':root { --accent: #ff0000; --rgb: 47 111 237; }\n',
  });
  assert.equal(drift.length, 0);
});

test('env()-only channels and calc-with-var channels are not hardcoded', async () => {
  const drift = await driftFindings({
    'styles.css':
      `${TOKENS}` +
      '.a { color: rgb(env(--r) env(--g) env(--b)); }\n' +
      '.b { color: rgb(calc(var(--r) * 1) calc(var(--g, 0) * 1) calc(var(--b, 0) * 1)); }\n',
  });
  assert.equal(drift.length, 0);
});

test('#fff hex colors stay flagged', async () => {
  const drift = await driftFindings({
    'styles.css': `${TOKENS}.a { color: #fff; }\n`,
  });
  assert.equal(drift.length, 1);
});
