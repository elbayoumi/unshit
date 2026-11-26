import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

interface ScaleGenerator {
  makeRng(seed: number): () => number;
  generateProject(dir: string, count: number, seed: number): number;
}

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const gen: ScaleGenerator = await import(join(ROOT, 'benchmark', 'scale-project.mjs'));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'unshit-scale-test-'));
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else out.set(rel, readFileSync(full, 'utf8'));
    }
  };
  walk(dir, '');
  return out;
}

test('seeded PRNG is reproducible and bounded', () => {
  const first = gen.makeRng(7);
  const second = gen.makeRng(7);
  const other = gen.makeRng(8);
  const sequenceA = Array.from({ length: 8 }, () => first());
  const sequenceB = Array.from({ length: 8 }, () => second());
  const sequenceC = Array.from({ length: 8 }, () => other());
  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, sequenceC);
  assert.ok(sequenceA.every((value) => value >= 0 && value < 1));
});

test('generator emits identical bytes for the same seed and count', () => {
  const dirA = tempDir();
  const dirB = tempDir();
  const dirC = tempDir();
  try {
    assert.equal(gen.generateProject(join(dirA, 'p'), 24, 42), 24);
    assert.equal(gen.generateProject(join(dirB, 'p'), 24, 42), 24);
    assert.equal(gen.generateProject(join(dirC, 'p'), 24, 43), 24);
    const first = snapshot(dirA);
    const second = snapshot(dirB);
    const other = snapshot(dirC);
    assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
    for (const [name, content] of first) assert.equal(second.get(name), content, name);
    assert.notDeepEqual([...first.values()], [...other.values()]);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
    rmSync(dirC, { recursive: true, force: true });
  }
});

test('generated project has manifests, barrels and connected modules', () => {
  const dir = tempDir();
  try {
    const project = join(dir, 'p');
    assert.equal(gen.generateProject(project, 30, 11), 30);
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { name: string };
    assert.equal(pkg.name, 'scale-fixture');
    assert.ok(existsSync(join(project, 'tsconfig.json')));
    const index = readFileSync(join(project, 'src', 'index.ts'), 'utf8');
    assert.match(index, /features\/feature00\/index/);
    const module = readFileSync(join(project, 'src', 'features', 'feature00', 'module0000.ts'), 'utf8');
    assert.match(module, /export function helpermodule0000/);
    assert.match(module, /export class module0000Service/);
    const next = readFileSync(join(project, 'src', 'features', 'feature00', 'module0001.ts'), 'utf8');
    assert.match(next, /import \{ helpermodule0000 \} from '\.\/module0000'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('small generated project scans successfully', () => {
  const dir = tempDir();
  try {
    const project = join(dir, 'p');
    gen.generateProject(project, 12, 99);
    const raw = execFileSync(
      process.execPath,
      [join(ROOT, 'bin', 'unshit.js'), 'scan', project, '--no-cache', '--format', 'json'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(raw) as { score: { totalFiles: number; score: number }; findings: unknown[] };
    assert.equal(parsed.score.totalFiles, 12);
    assert.ok(parsed.score.score >= 0 && parsed.score.score <= 100);
    assert.ok(Array.isArray(parsed.findings));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
