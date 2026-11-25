import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { generateContextBlock, writeContextBlock } from '../src/core/context.js';
import { runScan } from '../src/core/scanner.js';

const START = '<!-- unshit:context:start -->';
const END = '<!-- unshit:context:end -->';

async function withTempRepo(files: Record<string, string>, fn: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-context-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), content, 'utf8');
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FIXTURE_FILES = {
  'package.json': JSON.stringify({
    name: 'ctx-fixture',
    scripts: {
      typecheck: 'tsc --noEmit',
      test: 'node --test',
      build: 'tsc -p tsconfig.json',
      lint: 'eslint .',
    },
  }),
  'src/components/Button.tsx': 'export const Button = () => null;\n',
};

test('generateContextBlock is deterministic and carries archetype, layout and verify commands for a fixture project', async () => {
  await withTempRepo(FIXTURE_FILES, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const block = generateContextBlock(scan);
    assert.ok(block.startsWith(START));
    assert.ok(block.trimEnd().endsWith(END));
    assert.ok(block.includes('# Project rules'));
    assert.ok(block.includes('- Archetype: node-lib'));
    assert.ok(block.includes('- Layout: layer-first'));
    assert.ok(block.includes('- Source roots: src'));
    const verify = block.split('\n').find((line) => line.startsWith('- Verify: '));
    assert.ok(verify);
    for (const script of ['tsc --noEmit', 'node --test', 'tsc -p tsconfig.json', 'eslint .']) {
      assert.ok(verify?.includes(script), `missing script ${script} in ${verify}`);
    }
    assert.equal(generateContextBlock(scan), block);
  });
});

test('writeContextBlock creates AGENTS.md with the block when the file is missing', async () => {
  await withTempRepo(FIXTURE_FILES, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const block = generateContextBlock(scan);
    const written = await writeContextBlock(dir, block);
    assert.equal(written.fileName, 'AGENTS.md');
    assert.equal(written.created, true);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), block);
  });
});

test('writeContextBlock is idempotent when run twice', async () => {
  await withTempRepo(FIXTURE_FILES, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const block = generateContextBlock(scan);
    await writeContextBlock(dir, block);
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const second = await writeContextBlock(dir, block);
    assert.equal(second.created, false);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), first);
  });
});

test('writeContextBlock preserves user text outside the markers byte-identically', async () => {
  await withTempRepo(FIXTURE_FILES, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const block = generateContextBlock(scan);
    const existing = `USER NOTES BEFORE\n\n${START}\nSTALE BLOCK\n${END}\nUSER NOTES AFTER\n`;
    writeFileSync(join(dir, 'AGENTS.md'), existing, 'utf8');
    const expected = `${existing.slice(0, existing.indexOf(START))}${block}${existing.slice(existing.indexOf(END) + END.length)}`;
    const first = await writeContextBlock(dir, block);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), expected);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8').includes('STALE BLOCK'), false);
    const second = await writeContextBlock(dir, block);
    assert.equal(second.created, false);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), expected);
  });
});

test('a path with no package.json still works', async () => {
  await withTempRepo({ 'src/foo.ts': 'export const foo = 1;\n' }, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    const block = generateContextBlock(scan);
    assert.ok(block.includes('# Project rules'));
    assert.ok(block.includes('- Archetype:'));
    assert.ok(!block.includes('Verify:'));
    const written = await writeContextBlock(dir, block);
    assert.equal(written.created, true);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), block);
  });
});
