import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';

type Gen = { generateProject(dir: string, count: number, seed: number): number };
type Inject = { injectUnusedTypeExport(work: string, files: string[], n: number, rand: () => number, o?: { skipFiles?: Set<string> }): Array<{ file: string }> };

const synth = (await import(new URL('../../benchmark/recall-extra/synthetic-react.mjs', import.meta.url).href)) as Gen;
const inject = (await import(new URL('../../benchmark/recall-extra/inject.mjs', import.meta.url).href)) as Inject;

function generate(seed: number): Map<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-synth-'));
  try {
    synth.generateProject(dir, 12, seed);
    const comp = join(dir, 'src', 'components');
    return new Map(readdirSync(comp).map((f) => [f, readFileSync(join(comp, f), 'utf8')]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('synthetic React corpus is deterministic per seed', () => {
  assert.deepEqual(generate(20261126), generate(20261126));
  assert.notDeepEqual(generate(20261126), generate(20261127));
});

test('synthetic React components stay below god-file thresholds', () => {
  for (const [name, content] of generate(20261126)) {
    assert.ok(name.endsWith('.tsx'));
    assert.ok(content.split('\n').length < DEFAULT_CONFIG.godFileMaxLines, `${name} too long`);
    const hooks = content.match(/\buse[A-Z]\w*\(/g) ?? [];
    assert.ok(hooks.length < DEFAULT_CONFIG.godFileMaxHooks, `${name} has too many hooks`);
  }
});

test('unused-type-export injector skips STAR-consumed files', () => {
  const files = ['src/a.ts', 'src/b.ts', 'src/index.ts'];
  const dir = mkdtempSync(join(tmpdir(), 'unshit-skip-'));
  try {
    mkdirSync(join(dir, 'src'));
    for (const f of files) writeFileSync(join(dir, f), 'export const x = 1;\n');
    const out = inject.injectUnusedTypeExport(dir, files, 3, () => 0.5, { skipFiles: new Set(['src/index.ts']) });
    assert.ok(out.length > 0);
    assert.ok(out.every((i) => i.file !== 'src/index.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
