import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { BaselineSnapshot, FileEntry, Finding } from '../src/contracts.js';
import { computeHotspots } from '../src/core/hotspots.js';
import { evaluateGuard, getChangedLineRanges } from '../src/core/pinner.js';
import type { ScanResult } from '../src/core/scanner.js';

const execFileAsync = promisify(execFile);

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'unshit-lines-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return dir;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

function fileEntry(dir: string, relPath: string, content: string): FileEntry {
  return {
    absPath: join(dir, relPath),
    relPath,
    ext: '.ts',
    content,
    lines: content.split('\n').filter((line, i, all) => i < all.length - 1 || line.length > 0),
  };
}

function finding(file: string, line: number, endLine: number | undefined, severity: Finding['severity'], evidence: string): Finding {
  return {
    ruleId: 'ts/no-explicit-any',
    category: 'types',
    tier: 'structural',
    severity,
    fixability: 'safe',
    confidence: 1,
    file,
    span: { line, column: 1, ...(endLine === undefined ? {} : { endLine }) },
    message: 'Explicit any',
    evidence,
  };
}

const EMPTY_BASELINE: BaselineSnapshot = {
  version: 1,
  createdAt: new Date().toISOString(),
  rootDir: '/tmp',
  score: {
    score: 100,
    grade: 'A',
    totalFiles: 0,
    totalLines: 0,
    totalFindings: 0,
    byCategory: {
      css: 0, types: 0, i18n: 0, architecture: 0, slop: 0, duplication: 0, 'dead-code': 0,
    },
    bySeverity: { error: 0, warn: 0, info: 0 },
  },
  fingerprints: [],
  fileHashes: {},
};

test('getChangedLineRanges parses zero-context hunks, skips deletions, and marks untracked files', async () => {
  await withTempDir(async (dir) => {
    await git(dir, ['init', '-q']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    await writeFile(join(dir, 'a.ts'), 'one\ntwo\nthree\nfour\n', 'utf8');
    await writeFile(join(dir, 'gone.ts'), 'delete me\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);

    await writeFile(join(dir, 'a.ts'), 'one\nTWO\nthree\nfour\ninserted\n', 'utf8');
    await rm(join(dir, 'gone.ts'));
    await writeFile(join(dir, 'new.ts'), 'untracked\n', 'utf8');

    const ranges = await getChangedLineRanges(dir);
    assert.deepStrictEqual(ranges.get('a.ts'), [{ start: 2, end: 2 }, { start: 5, end: 5 }]);
    assert.deepStrictEqual(ranges.get('new.ts'), [{ start: 1, end: Number.MAX_SAFE_INTEGER }]);
    assert.equal(ranges.has('gone.ts'), false);
  });
});

test('evaluateGuard filters findings by inclusive overlap with changed line ranges', () => {
  const scan: ScanResult = {
    rootDir: '/tmp',
    config: DEFAULT_CONFIG,
    files: [],
    findings: [
      finding('a.ts', 9, 10, 'warn', 'nine-ten'),
      finding('a.ts', 12, undefined, 'error', 'twelve'),
      finding('a.ts', 13, 14, 'warn', 'thirteen-fourteen'),
      finding('b.ts', 11, 11, 'error', 'other-file'),
    ],
    detectors: [],
  };
  const ranges = new Map([['a.ts', [{ start: 10, end: 12 }]]]);
  const res = evaluateGuard(scan, EMPTY_BASELINE, new Set(['a.ts', 'b.ts']), ranges);
  assert.deepStrictEqual(res.newFindings.map((f) => f.evidence), ['nine-ten', 'twelve']);
  assert.equal(res.passed, false);
});

test('computeHotspots ranks by churn-weighted density and warns on shallow clones', async () => {
  await withTempDir(async (dir) => {
    await git(dir, ['init', '-q']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    const hotContent = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
    const coldContent = 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n';
    await writeFile(join(dir, 'hot.ts'), hotContent, 'utf8');
    await writeFile(join(dir, 'cold.ts'), coldContent, 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);
    await writeFile(join(dir, 'hot.ts'), hotContent + 'export const d = 4;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'hot-1']);
    await writeFile(join(dir, 'hot.ts'), hotContent + 'export const d = 4;\nexport const e = 5;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'hot-2']);

    const scan: ScanResult = {
      rootDir: dir,
      config: DEFAULT_CONFIG,
      files: [fileEntry(dir, 'hot.ts', hotContent), fileEntry(dir, 'cold.ts', coldContent)],
      findings: [
        finding('hot.ts', 2, undefined, 'error', 'hot'),
        finding('cold.ts', 2, undefined, 'info', 'cold'),
      ],
      detectors: [],
    };

    const hotspots = await computeHotspots(dir, scan, { top: 2 });
    assert.deepStrictEqual(hotspots.map((h) => h.file), ['hot.ts', 'cold.ts']);
    assert.equal(hotspots[0]!.churnCommits, 3);
    assert.ok(hotspots[0]!.score > hotspots[1]!.score);
    const hot = hotspots[0]!;
    assert.equal(
      hot.score,
      Math.log1p(hot.churnCommits + hot.churnLines * 0.1) * ((hot.weightedFindings / Math.max(20, hot.lines)) * 100),
    );

    await writeFile(join(dir, '.git', 'shallow'), '', 'utf8');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      await computeHotspots(dir, scan, { top: 1 });
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((w) => /shallow/i.test(w)));
  });
});
