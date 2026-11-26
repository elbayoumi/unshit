import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(files: Record<string, string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-timer-fix-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function scan(dir: string) {
  return runScan(dir, DEFAULT_CONFIG, [], { noCache: true });
}

async function fix(dir: string, apply: boolean) {
  return runFix(await scan(dir), { apply, ai: false });
}

function timerFindings(result: Awaited<ReturnType<typeof scan>>) {
  return result.findings.filter((f) => f.ruleId === 'slop/magic-timer');
}

test('magic-timer fix is dry-run by default: unified diff, no write, fixability safe', async () => {
  const before = 'export function retry(cb: () => void) {\n  setTimeout(cb, 250);\n}\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const hits = timerFindings(await scan(dir));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.fixability, 'safe');

    const dry = await fix(dir, false);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.appliedCount, 0);
    assert.equal(dry.deterministicPatches.length, 1);
    assert.match(dry.diff, /--- a\/src\/index\.ts/);
    assert.match(dry.diff, /\+const RETRY_DELAY_MS = 250;/);
    assert.match(dry.diff, /-  setTimeout\(cb, 250\);/);
    assert.match(dry.diff, /\+  setTimeout\(cb, RETRY_DELAY_MS\);/);
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), before);
  });
});

test('--apply extracts a named const from context; re-scan is clean and a second pass is a no-op', async () => {
  await withTempProject({
    'src/index.ts': 'export function retry(cb: () => void) {\n  setTimeout(cb, 250);\n}\n',
  }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.appliedCount, 1);
    assert.deepEqual(applied.skipped, []);

    const updated = 'const RETRY_DELAY_MS = 250;\nexport function retry(cb: () => void) {\n  setTimeout(cb, RETRY_DELAY_MS);\n}\n';
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), updated);
    assert.equal(timerFindings(await scan(dir)).length, 0);

    const again = await fix(dir, true);
    assert.equal(again.deterministicPatches.length, 0);
    assert.equal(again.appliedCount, 0);
    assert.equal(again.diff, '');
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), updated);
  });
});

test('setInterval inside an arrow variable uses the variable name and keeps imports/blank lines', async () => {
  const before = 'import { tick } from \'./tick.js\';\n\nexport const poll = () => setInterval(tick, 1000);\n';
  await withTempProject({
    'src/index.ts': before,
    'src/tick.ts': 'export function tick(): void {}\n',
  }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.skipped.length, 0);
    assert.equal(
      await readFile(join(dir, 'src/index.ts'), 'utf8'),
      'import { tick } from \'./tick.js\';\n\nconst POLL_INTERVAL_MS = 1000;\nexport const poll = () => setInterval(tick, POLL_INTERVAL_MS);\n',
    );
  });
});

test('an existing name is skipped with a reason and the file is untouched', async () => {
  const before = 'const RETRY_DELAY_MS = 1;\nexport function retry(cb: () => void) {\n  setTimeout(cb, 250);\n}\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.deterministicPatches.length, 0);
    assert.equal(applied.appliedCount, 0);
    assert.equal(applied.skipped.length, 1);
    assert.match(applied.skipped[0]!.reason, /RETRY_DELAY_MS.*already exists/);
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), before);
  });
});

test('non-plain numeric literals are skipped with reasons and left unchanged', async () => {
  const before = 'export function retry(cb: () => void) {\n  setTimeout(cb, 1e3);\n  setInterval(cb, 0x10);\n}\n';
  await withTempProject({ 'src/index.ts': before }, async (dir) => {
    assert.equal(timerFindings(await scan(dir)).length, 2);
    const applied = await fix(dir, true);
    assert.equal(applied.deterministicPatches.length, 0);
    assert.equal(applied.appliedCount, 0);
    assert.equal(applied.skipped.length, 2);
    assert.ok(applied.skipped.every((s) => /not a plain decimal number/.test(s.reason)));
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), before);
  });
});

test('a second timer deriving the same name is skipped, leaving its literal for the next scan', async () => {
  await withTempProject({
    'src/index.ts': 'export function retry(cb: () => void) {\n  setTimeout(cb, 250);\n  setTimeout(cb, 500);\n}\n',
  }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.skipped.length, 1);
    assert.match(applied.skipped[0]!.reason, /RETRY_DELAY_MS.*already used by another timer fix/);
    assert.equal(
      await readFile(join(dir, 'src/index.ts'), 'utf8'),
      'const RETRY_DELAY_MS = 250;\nexport function retry(cb: () => void) {\n  setTimeout(cb, RETRY_DELAY_MS);\n  setTimeout(cb, 500);\n}\n',
    );
    assert.equal(timerFindings(await scan(dir)).length, 1);
  });
});

test('distinct contexts get distinct constants inserted after directive prologues', async () => {
  await withTempProject({
    'src/index.ts': "'use strict';\nexport function retry(cb: () => void) { setTimeout(cb, 250); }\nexport function poll(cb: () => void) { setInterval(cb, 1000); }\n",
  }, async (dir) => {
    const applied = await fix(dir, true);
    assert.equal(applied.skipped.length, 0);
    assert.equal(
      await readFile(join(dir, 'src/index.ts'), 'utf8'),
      "'use strict';\nconst POLL_INTERVAL_MS = 1000;\nconst RETRY_DELAY_MS = 250;\nexport function retry(cb: () => void) { setTimeout(cb, RETRY_DELAY_MS); }\nexport function poll(cb: () => void) { setInterval(cb, POLL_INTERVAL_MS); }\n",
    );
    assert.equal(timerFindings(await scan(dir)).length, 0);
  });
});
