import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { collectWorkspace } from '../src/walker.js';

async function withFixture(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void> | void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-gitignore-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(dir, relPath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function collectedPaths(dir: string, exclude: string[] = []): Promise<Set<string>> {
  const { files } = await collectWorkspace(dir, {
    ...DEFAULT_CONFIG,
    include: ['.ts', '.log', '.txt'],
    exclude,
  });
  return new Set(files.map((file) => file.relPath));
}

function assertPaths(actual: Set<string>, expected: string[]): void {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

test('root .gitignore honors comments, blank lines, anchoring, directory rules, and negation', async () => {
  await withFixture(
    {
      '.gitignore': '# generated\n\n*.log\n!keep.log\n/root-only.ts\ncache/\n',
      'main.ts': 'export const main = 1;\n',
      'empty.ts': 'export const empty = 1;\n',
      'debug.log': 'debug\n',
      'keep.log': 'keep\n',
      'root-only.ts': 'export const rootOnly = 1;\n',
      'src/root-only.ts': 'export const nestedRootOnly = 1;\n',
      'nested/root-only.ts': 'export const otherRootOnly = 1;\n',
      'cache/a.ts': 'export const cached = 1;\n',
      'nested/cache/b.ts': 'export const nestedCached = 1;\n',
    },
    async (dir) => {
      assertPaths(await collectedPaths(dir), [
        'main.ts',
        'empty.ts',
        'keep.log',
        'src/root-only.ts',
        'nested/root-only.ts',
      ]);
    },
  );
});

test('nested .gitignore rules are scoped to their directory and override parent scopes', async () => {
  await withFixture(
    {
      '.gitignore': '*.skip.ts\n',
      'src/.gitignore': '# local rules\n*.local.ts\n/only-here.ts\n!important.local.ts\n',
      'only-here.ts': 'export const a = 1;\n',
      'src/only-here.ts': 'export const b = 1;\n',
      'src/deep/only-here.ts': 'export const c = 1;\n',
      'component.local.ts': 'export const d = 1;\n',
      'src/component.local.ts': 'export const e = 1;\n',
      'src/deep/component.local.ts': 'export const f = 1;\n',
      'src/important.local.ts': 'export const g = 1;\n',
      'root.skip.ts': 'export const h = 1;\n',
      'src/nested.skip.ts': 'export const i = 1;\n',
    },
    async (dir) => {
      assertPaths(await collectedPaths(dir), [
        'only-here.ts',
        'component.local.ts',
        'src/deep/only-here.ts',
        'src/important.local.ts',
      ]);
    },
  );
});

test('negation uses the last matching rule in a scope and deeper scopes win', async () => {
  await withFixture(
    {
      '.gitignore': '*.ts\n!keep.ts\nkeep.ts\n',
      'keep.ts': 'export const keep = 1;\n',
      'other.ts': 'export const other = 1;\n',
      'pkg/.gitignore': '!rescue.ts\n',
      'pkg/rescue.ts': 'export const rescue = 1;\n',
      'pkg/lost.ts': 'export const lost = 1;\n',
    },
    async (dir) => {
      assertPaths(await collectedPaths(dir), ['pkg/rescue.ts']);
    },
  );
});

test('.gitignore supports * / ** globs and directory-only patterns', async () => {
  await withFixture(
    {
      '.gitignore': '**/*.gen.ts\nsrc/**/tmp/*.ts\ndocs/**/draft/\n/build-root/\n',
      'a.gen.ts': 'export const a = 1;\n',
      'src/deep/b.gen.ts': 'export const b = 1;\n',
      'src/features/tmp/skip.ts': 'export const c = 1;\n',
      'src/tmp/skip.ts': 'export const d = 1;\n',
      'src/features/keep.ts': 'export const e = 1;\n',
      'docs/guide/draft/a.ts': 'export const f = 1;\n',
      'docs/draft/b.ts': 'export const g = 1;\n',
      'docs/keep.ts': 'export const h = 1;\n',
      'build-root/x.ts': 'export const i = 1;\n',
      'src/build-root/y.ts': 'export const j = 1;\n',
    },
    async (dir) => {
      assertPaths(await collectedPaths(dir), [
        'src/features/keep.ts',
        'docs/keep.ts',
        'src/build-root/y.ts',
      ]);
    },
  );
});

test('config.exclude and DEFAULT_CONFIG.exclude still apply with .gitignore present', async () => {
  await withFixture(
    {
      '.gitignore': '!dist/keep.ts\n',
      'dist/keep.ts': 'export const dist = 1;\n',
      'custom-exclude/a.ts': 'export const custom = 1;\n',
      'normal.ts': 'export const normal = 1;\n',
    },
    async (dir) => {
      assertPaths(await collectedPaths(dir, ['custom-exclude']), ['dist/keep.ts', 'normal.ts']);

      const { files } = await collectWorkspace(dir, { ...DEFAULT_CONFIG, include: ['.ts'] });
      assertPaths(new Set(files.map((file) => file.relPath)), ['custom-exclude/a.ts', 'normal.ts']);
    },
  );
});
