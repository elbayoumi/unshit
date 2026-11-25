import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { runFix } from '../src/core/fixer.js';
import { runScan } from '../src/core/scanner.js';

async function withTempProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-dep-fix-'));
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

async function fix(dir: string, apply: boolean) {
  const scan = await runScan(dir, DEFAULT_CONFIG);
  return runFix(scan, { apply, ai: false });
}

const formattedPkg = [
  '{',
  '  "name": "demo",',
  '  "dependencies": {',
  '    "unused-pkg": "^1.0.0",',
  '    "lodash": "^4.0.0"',
  '  },',
  '  "devDependencies": {',
  '    "unused-dev": "^1.0.0"',
  '  }',
  '}',
  '',
].join('\n');

const sourceFixture = {
  'package.json': formattedPkg,
  'src/index.ts': "import { some } from 'lodash';\nexport const x = some;\n",
};

test('unused-dependency fixes are dry-run by default: diff printed, disk untouched', async () => {
  await withTempProject(sourceFixture, async (dir) => {
    const before = await readFile(join(dir, 'package.json'), 'utf8');
    const summary = await fix(dir, false);

    assert.equal(summary.dryRun, true);
    assert.equal(summary.appliedCount, 0);
    assert.equal(summary.deterministicPatches.length, 2);
    assert.match(summary.diff, /--- a\/package\.json/);
    assert.match(summary.diff, /-    "unused-pkg": "\^1\.0\.0",/);
    assert.match(summary.diff, /-    "unused-dev": "\^1\.0\.0"/);
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), before);
  });
});

test('--apply removes only the flagged keys, preserving formatting and trailing newline', async () => {
  await withTempProject(sourceFixture, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.dryRun, false);
    assert.equal(summary.appliedCount, 2);

    const after = await readFile(join(dir, 'package.json'), 'utf8');
    assert.equal(after, [
      '{',
      '  "name": "demo",',
      '  "dependencies": {',
      '    "lodash": "^4.0.0"',
      '  },',
      '  "devDependencies": {',
      '  }',
      '}',
      '',
    ].join('\n'));
    assert.deepEqual(JSON.parse(after), {
      name: 'demo',
      dependencies: { lodash: '^4.0.0' },
      devDependencies: {},
    });
    assert.equal(after.endsWith('\n'), true);
    // The diff is computed from the pre-apply scan, even after writing.
    assert.match(summary.diff, /-    "unused-pkg"/);
  });
});

test('removing the last of several dependencies drops only the preceding comma', async () => {
  await withTempProject({
    'package.json': '{\n  "dependencies": {\n    "kept": "^1",\n    "dead": "^2"\n  }\n}\n',
    'src/index.ts': "import k from 'kept';\nexport default k;\n",
  }, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.appliedCount, 1);
    const after = await readFile(join(dir, 'package.json'), 'utf8');
    assert.equal(after, '{\n  "dependencies": {\n    "kept": "^1"\n  }\n}\n');
    assert.deepEqual(JSON.parse(after), { dependencies: { kept: '^1' } });
  });
});

test('removing every dependency in an object leaves valid JSON', async () => {
  await withTempProject({
    'package.json': '{\n  "dependencies": {\n    "dead-a": "^1",\n    "dead-b": "^2"\n  },\n  "name": "demo"\n}\n',
    'src/index.ts': 'export const x = 1;\n',
  }, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.appliedCount, 2);
    const after = await readFile(join(dir, 'package.json'), 'utf8');
    assert.equal(after, '{\n  "dependencies": {\n  },\n  "name": "demo"\n}\n');
    assert.deepEqual(JSON.parse(after), { dependencies: {}, name: 'demo' });
  });
});

test('a second fix pass is a no-op', async () => {
  await withTempProject(sourceFixture, async (dir) => {
    const first = await fix(dir, true);
    assert.equal(first.appliedCount, 2);
    const afterFirst = await readFile(join(dir, 'package.json'), 'utf8');

    const second = await fix(dir, true);
    assert.equal(second.deterministicPatches.length, 0);
    assert.equal(second.appliedCount, 0);
    assert.equal(second.diff, '');
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), afterFirst);
  });
});

test('fixes target each workspace package.json independently', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }, null, 2),
    'apps/web/package.json': '{\n  "dependencies": {\n    "react": "1",\n    "left-pad": "1"\n  }\n}\n',
    'apps/web/src/a.ts': "import React from 'react';\nexport default React;\n",
  }, async (dir) => {
    const summary = await fix(dir, true);
    assert.equal(summary.appliedCount, 1);
    assert.ok(summary.deterministicPatches.every((p) => p.file === 'apps/web/package.json'));
    assert.equal(
      await readFile(join(dir, 'apps/web/package.json'), 'utf8'),
      '{\n  "dependencies": {\n    "react": "1"\n  }\n}\n',
    );
  });
});

test('a dependency imported by another workspace is skipped even though its owner was flagged', async () => {
  await withTempProject({
    'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }, null, 2),
    'apps/a/package.json': JSON.stringify({ name: 'a', dependencies: { 'left-pad': '1' } }, null, 2),
    'apps/a/src/a.ts': 'export const a = 1;\n',
    'apps/b/package.json': JSON.stringify({ name: 'b' }, null, 2),
    'apps/b/src/b.ts': "import pad from 'left-pad';\nexport default pad;\n",
  }, async (dir) => {
    const scan = await runScan(dir, DEFAULT_CONFIG);
    const flagged = scan.findings.filter(
      (f) => f.ruleId === 'deps/unused-dependency' && f.file === 'apps/a/package.json',
    );
    assert.deepEqual(flagged.map((f) => f.evidence), ['left-pad']);

    const summary = await runFix({ ...scan, findings: flagged }, { apply: true, ai: false });
    assert.equal(summary.deterministicPatches.length, 0);
    assert.equal(summary.appliedCount, 0);
    assert.ok(summary.skipped.some((s) => /still imported/.test(s.reason)));
    assert.match(await readFile(join(dir, 'apps/a/package.json'), 'utf8'), /left-pad/);
  });
});

test('a dependency referenced by a script added after the scan is skipped', async () => {
  await withTempProject(sourceFixture, async (dir) => {
    const stale = await runScan(dir, DEFAULT_CONFIG);
    const flagged = stale.findings.filter((f) => f.ruleId === 'deps/unused-dependency');
    assert.deepEqual(flagged.map((f) => f.evidence).sort(), ['unused-dev', 'unused-pkg']);

    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'demo',
      scripts: { start: 'unused-pkg --serve' },
      dependencies: { 'unused-pkg': '^1.0.0', lodash: '^4.0.0' },
      devDependencies: { 'unused-dev': '^1.0.0' },
    }, null, 2), 'utf8');

    const summary = await runFix({ ...stale, findings: flagged }, { apply: true, ai: false });
    assert.equal(summary.appliedCount, 1, 'only the dependency without a script reference is removed');
    assert.ok(summary.skipped.some((s) => s.reason.includes('scripts') && s.reason.includes('unused-pkg')));
    const after = await readFile(join(dir, 'package.json'), 'utf8');
    assert.match(after, /unused-pkg/);
    assert.doesNotMatch(after, /unused-dev/);
  });
});
