import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const BIN = join(ROOT, 'bin', 'unshit.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('cli dispatch: help exits 0 and prints usage', () => {
  const r = run(['help']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^unshit <command> \[path\] \[options\]/);
  assert.match(r.stdout, /hook \[file\]/);
});

test('cli dispatch: unknown command exits 2 with guidance', () => {
  const r = run(['definitely-not-a-command']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^Unknown command: definitely-not-a-command\. Run `unshit help`\.\n$/);
});
