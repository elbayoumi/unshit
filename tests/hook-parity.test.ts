import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const BIN = join(ROOT, 'bin', 'unshit.js');

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-hook-parity-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const abs = join(dir, name);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runHook(stdin: string, cwd = ROOT): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, 'hook', '--stdin'], {
    input: stdin,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('hook parity: clean Write payload exits 0', async () => {
  await withTempProject({ 'src/clean.css': '.btn { color: red; }\n' }, async (dir) => {
    const payload = JSON.stringify({
      session_id: 'parity-clean',
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: 'src/clean.css', content: '.btn { color: blue; }\n' },
    });
    const r = runHook(payload, dir);
    assert.equal(r.status, 0, r.stderr);
  });
});

test('hook parity: Write payload introducing slop exits 2 with rule id', async () => {
  await withTempProject({ 'src/bad.css': '.btn { color: red; }\n' }, async (dir) => {
    const payload = JSON.stringify({
      session_id: 'parity-slop',
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: 'src/bad.css', content: '.btn { color: red !important; }\n' },
    });
    const r = runHook(payload, dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /css\/no-important/);
    assert.match(r.stderr, /Blocked 1 slop finding/);
  });
});

test('hook parity: Edit payload introducing slop exits 2', async () => {
  await withTempProject({ 'src/edit.ts': 'export function f(x: string) { return x; }\n' }, async (dir) => {
    const payload = JSON.stringify({
      session_id: 'parity-edit',
      cwd: dir,
      tool_name: 'Edit',
      tool_input: {
        file_path: 'src/edit.ts',
        old_string: 'x: string',
        new_string: 'x: any',
      },
    });
    const r = runHook(payload, dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ts\/no-explicit-any/);
  });
});

test('hook parity: existing slop in file does not block when not newly introduced', async () => {
  await withTempProject({ 'src/old.css': '.btn { color: red !important; }\n' }, async (dir) => {
    const payload = JSON.stringify({
      session_id: 'parity-existing',
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: 'src/old.css', content: '.btn { color: red !important; }\n' },
    });
    const r = runHook(payload, dir);
    assert.equal(r.status, 0, r.stderr);
  });
});

test('hook parity: scanner.ts Write payload exits 0 on clean content', async () => {
  const content = await readFile(join(ROOT, 'src', 'core', 'scanner.ts'), 'utf8');
  const payload = JSON.stringify({
    session_id: 'parity-scanner',
    cwd: ROOT,
    tool_name: 'Write',
    tool_input: { file_path: 'src/core/scanner.ts', content },
  });
  const r = runHook(payload, ROOT);
  assert.equal(r.status, 0, r.stderr);
});

test('hook parity: malformed stdin is ignored with exit 0', () => {
  const r = runHook('not json', ROOT);
  assert.equal(r.status, 0);
});

test('cli parity: --help, scan, fix still work', async () => {
  await withTempProject({ 'src/ok.ts': 'export const ok = 1;\n' }, async (dir) => {
    const help = spawnSync(process.execPath, [BIN, '--help'], { cwd: dir, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /unshit <command>/);
    assert.match(help.stdout, /hook \[file\]/);

    const scan = spawnSync(process.execPath, [BIN, 'scan', dir, '--format', 'json', '--no-cache'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(scan.status, 0, scan.stderr);
    const parsed = JSON.parse(scan.stdout) as { findings?: unknown[] };
    assert.ok(Array.isArray(parsed.findings));

    const fix = spawnSync(process.execPath, [BIN, 'fix', dir, '--no-cache'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(fix.status, 0, fix.stderr);
    assert.match(fix.stdout, /unshit fix \(dry-run\)/);
  });
});
