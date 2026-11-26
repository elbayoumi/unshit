import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface Wilson {
  low: number;
  high: number;
  center: number;
}

type WilsonFn = (successes: number, trials: number) => Wilson;

interface Injection {
  ruleId: string;
  file: string;
  line: number;
  variant: string;
  marker: string;
  missReason?: string;
}

interface Base {
  seed: number;
  files: Map<string, string>;
  cssSelectors: Map<string, string[]>;
}

interface Generate {
  generateBase(seed: number): Base;
  injectPositives(base: Base, seed: number, options?: { perRule?: number }): { files: Map<string, string>; injections: Injection[] };
  injectNegatives(base: Base, seed: number, options?: { perRule?: number }): { files: Map<string, string>; injections: Injection[] };
}

interface Lib {
  RULES: string[];
  isDetectorTestPath(relPath: string): boolean;
  findingMatchesInjection(finding: unknown, injection: Injection): boolean;
  evaluateRecall(injections: Injection[], findings: unknown[], wilson: WilsonFn): Array<{ ruleId: string; injected: number; found: number; misses: unknown[] }>;
  evaluateFalsePositives(negatives: Injection[], findings: unknown[], wilson: WilsonFn): Array<{ ruleId: string; negatives: number; falsePositives: number; fps: unknown[] }>;
}

interface BenchmarkReport {
  seedList: number[];
  seeds: Array<{ seed: number }>;
  base: { totalFindings: number };
  pooled: {
    recall: Array<{ ruleId: string; injected: number; found: number }>;
    falsePositives: Array<{ ruleId: string; negatives: number; falsePositives: number }>;
  };
}

const generate = (await import(new URL('../../benchmark/polyglot/generate.mjs', import.meta.url).href)) as Generate;
const lib = (await import(new URL('../../benchmark/polyglot/lib.mjs', import.meta.url).href)) as Lib;
const reportModule = (await import(new URL('../../benchmark/polyglot/report.mjs', import.meta.url).href)) as {
  buildMarkdown(report: BenchmarkReport): string;
};
const recallLib = (await import(new URL('../../benchmark/recall/lib.mjs', import.meta.url).href)) as { wilson95: WilsonFn };
const wilson95 = recallLib.wilson95;

const DEV = 20261126;
const HOLDOUT = 20261127;

function serialise(files: Map<string, string>): string {
  return [...files.entries()].map(([rel, content]) => `${rel}\u0000${content}`).join('\u0001');
}

function lineAt(files: Map<string, string>, rel: string, line: number): string {
  const content = files.get(rel);
  assert.ok(content !== undefined, `missing file ${rel}`);
  return content.split('\n')[line - 1] ?? '';
}

function countBy<T>(values: T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return counts;
}

test('polyglot base generator is deterministic per seed and differs across seeds', () => {
  const dev = generate.generateBase(DEV);
  const again = generate.generateBase(DEV);
  const holdout = generate.generateBase(HOLDOUT);

  assert.equal(dev.files.size, again.files.size);
  assert.deepEqual(dev.cssSelectors, again.cssSelectors);
  assert.equal(serialise(dev.files), serialise(again.files));
  assert.notEqual(serialise(dev.files), serialise(holdout.files));
});

test('polyglot base has ~30 files per language and is clean for the rule shapes', () => {
  const base = generate.generateBase(DEV);
  const byExt = countBy([...base.files.keys()], (rel) => {
    if (rel.endsWith('.rs')) return 'rust';
    if (rel.endsWith('.py')) return 'python';
    if (rel.endsWith('.dart')) return 'dart';
    if (rel.endsWith('.css') || rel.endsWith('.scss')) return 'css';
    return 'other';
  });

  assert.ok((byExt.get('rust') ?? 0) >= 30, `rust files: ${byExt.get('rust')}`);
  assert.ok((byExt.get('python') ?? 0) >= 30, `python files: ${byExt.get('python')}`);
  assert.ok((byExt.get('dart') ?? 0) >= 30, `dart files: ${byExt.get('dart')}`);
  assert.ok((byExt.get('css') ?? 0) >= 30, `css files: ${byExt.get('css')}`);

  for (const [rel, content] of base.files) {
    if (rel.endsWith('.rs') && !lib.isDetectorTestPath(rel)) {
      assert.ok(!content.includes('.unwrap()'), `clean Rust file has unwrap: ${rel}`);
    }
    if (rel.endsWith('.py') && !lib.isDetectorTestPath(rel)) {
      assert.ok(!/^\s*except\s*:/m.test(content), `clean Python file has bare except: ${rel}`);
    }
    if (rel.endsWith('.dart') && !lib.isDetectorTestPath(rel)) {
      assert.ok(!/(?<![.\w])print\s*\(/.test(content), `clean Dart file calls print(): ${rel}`);
      assert.ok(!/\bdynamic\b/.test(content), `clean Dart file uses dynamic: ${rel}`);
    }
  }
});

test('positive injector emits 15 per rule and every line carries the defect shape', () => {
  const base = generate.generateBase(DEV);
  const { files, injections } = generate.injectPositives(base, DEV, { perRule: 15 });

  assert.equal(injections.length, 90);
  const counts = countBy(injections, (injection) => injection.ruleId);
  for (const ruleId of lib.RULES) assert.equal(counts.get(ruleId), 15, `${ruleId} positives`);

  for (const injection of injections) {
    const line = lineAt(files, injection.file, injection.line);
    assert.ok(line.trim().length > 0, `empty injection line ${injection.file}:${injection.line}`);

    switch (injection.ruleId) {
      case 'rust/no-unwrap':
        assert.match(line, /\.unwrap\s*\(/);
        assert.ok(injection.file.endsWith('.rs'));
        assert.ok(!lib.isDetectorTestPath(injection.file), `positive in test path: ${injection.file}`);
        break;
      case 'python/no-bare-except':
        assert.match(line, /^\s*except\s*:/);
        assert.ok(injection.file.endsWith('.py'));
        assert.ok(!lib.isDetectorTestPath(injection.file), `positive in test path: ${injection.file}`);
        break;
      case 'dart/no-dynamic-or-print':
        assert.match(line, /\bdynamic\b|(?<![.\w])print\s*\(/);
        assert.ok(injection.file.endsWith('.dart'));
        assert.ok(!lib.isDetectorTestPath(injection.file), `positive in test path: ${injection.file}`);
        break;
      case 'css/no-important':
        assert.match(line, /!\s*important/i);
        assert.match(injection.file, /\.(css|scss)$/);
        break;
      case 'css/design-drift':
        assert.match(line, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
        assert.match(injection.file, /\.(css|scss)$/);
        break;
      case 'css/duplicate-selector':
        assert.ok(line.includes(injection.marker), `duplicate line lacks marker ${injection.marker}`);
        assert.match(injection.file, /\.(css|scss)$/);
        break;
      default:
        assert.fail(`unexpected rule ${injection.ruleId}`);
    }
  }

  // Known-miss variants stay in the injector so the gaps are measured, not hidden.
  assert.ok(injections.some((injection) => injection.variant === 'spaced-call' && injection.missReason));
  assert.ok(injections.some((injection) => injection.variant === 'nested-expansion' && injection.missReason));
});

test('positive injector does not mutate the base and is deterministic per seed', () => {
  const base = generate.generateBase(DEV);
  const before = serialise(base.files);
  const first = generate.injectPositives(base, DEV, { perRule: 15 });
  const second = generate.injectPositives(base, DEV, { perRule: 15 });

  assert.equal(serialise(base.files), before);
  assert.equal(serialise(first.files), serialise(second.files));
  assert.deepEqual(first.injections, second.injections);
});

test('negative injector emits 10 per rule, all outside their own false-positive shape', () => {
  const base = generate.generateBase(DEV);
  const { files, injections } = generate.injectNegatives(base, DEV, { perRule: 10 });

  assert.equal(injections.length, 60);
  const counts = countBy(injections, (injection) => injection.ruleId);
  for (const ruleId of lib.RULES) assert.equal(counts.get(ruleId), 10, `${ruleId} negatives`);

  for (const injection of injections) {
    const line = lineAt(files, injection.file, injection.line);
    assert.ok(line.trim().length > 0, `empty negative line ${injection.file}:${injection.line}`);
    if (injection.ruleId === 'python/no-bare-except' && /^\s*except\s*:/.test(line)) {
      // Bare `except:` hard negatives are either inside a detector test path or
      // inside a masked comment/string/docstring.
      const masked = ['docstring', 'comment', 'string-literal'].includes(injection.variant);
      assert.ok(masked || lib.isDetectorTestPath(injection.file), `bare except leaked into negative: ${injection.file}:${injection.line}`);
    }
    if (injection.ruleId === 'rust/no-unwrap' && line.includes('.unwrap()')) {
      const allowedReceiver = /\.(?:lock|read|write)\(\)\.unwrap\(\)|Regex::new\([^)]*\)\.unwrap\(\)/.test(line);
      const insideCfgTest = injection.variant === 'cfg-test-module';
      const inTestPath = lib.isDetectorTestPath(injection.file);
      const masked = ['line-comment', 'string-literal', 'block-comment', 'doc-comment'].includes(injection.variant);
      assert.ok(allowedReceiver || insideCfgTest || inTestPath || masked, `unwrap leaked into negative: ${injection.file}:${injection.line} ${line}`);
    }
  }

  // The token-only color FP is measured in every seed, not sampled away.
  assert.ok(injections.some((injection) => injection.variant === 'rgb-var-channels'));
});

test('line-exact matcher requires ruleId, file and line to agree', () => {
  const injection: Injection = {
    ruleId: 'rust/no-unwrap',
    file: 'src/a.rs',
    line: 12,
    variant: 'file-open',
    marker: 'inj_0',
  };
  const finding = (overrides: Record<string, unknown> = {}) => ({
    ruleId: 'rust/no-unwrap',
    file: 'src/a.rs',
    span: { line: 12 },
    ...overrides,
  });

  assert.equal(lib.findingMatchesInjection(finding(), injection), true);
  assert.equal(lib.findingMatchesInjection(finding({ ruleId: 'rust/other' }), injection), false);
  assert.equal(lib.findingMatchesInjection(finding({ file: 'src/b.rs' }), injection), false);
  assert.equal(lib.findingMatchesInjection(finding({ span: { line: 11 } }), injection), false);
  assert.equal(lib.findingMatchesInjection(finding({ span: { line: 13 } }), injection), false);
  assert.equal(lib.findingMatchesInjection(finding({ span: undefined }), injection), false);
});

test('recall and FP evaluators bucket hits, misses and false positives by rule', () => {
  const injections: Injection[] = [
    { ruleId: 'css/no-important', file: 'a.css', line: 2, variant: 'plain', marker: 'a' },
    { ruleId: 'css/no-important', file: 'b.css', line: 5, variant: 'plain', marker: 'b' },
  ];
  const findings = [{ ruleId: 'css/no-important', file: 'a.css', span: { line: 2 }, message: 'x' }];
  const recall = lib.evaluateRecall(injections, findings, wilson95);
  assert.equal(recall.length, 1);
  assert.equal(recall[0]?.injected, 2);
  assert.equal(recall[0]?.found, 1);
  assert.equal(recall[0]?.misses.length, 1);

  const negatives: Injection[] = [
    { ruleId: 'css/no-important', file: 'c.css', line: 3, variant: 'comment', marker: 'c' },
  ];
  const fps = lib.evaluateFalsePositives(negatives, [], wilson95);
  assert.equal(fps[0]?.negatives, 1);
  assert.equal(fps[0]?.falsePositives, 0);
});

test('test-path mirror agrees with the detector scope on representative paths', () => {
  for (const rel of ['tests/store_test.rs', 'benches/parse.rs', 'examples/demo.rs', 'build.rs', 'test/widget_test.dart', 'tests/test_api.py', 'tests/conftest.py']) {
    assert.equal(lib.isDetectorTestPath(rel), true, rel);
  }
  for (const rel of ['src/store.rs', 'lib/main.dart', 'src/ledger/service.py', 'styles/base.css', 'src/bin/helper.rs']) {
    const expected = rel === 'src/bin/helper.rs';
    assert.equal(lib.isDetectorTestPath(rel), expected, rel);
  }
});

test('markdown renderer uses the committed results with real pooled rows and seed list', () => {
  const raw = readFileSync(new URL('../../benchmark/polyglot/results.json', import.meta.url), 'utf8');
  const results = JSON.parse(raw) as BenchmarkReport;
  const md = reportModule.buildMarkdown(results);

  assert.match(md, /Seeds: 20261126 \(dev\), 20261127 \(holdout\)/);
  assert.match(md, /### Pooled/);
  for (const row of results.pooled.recall) {
    assert.ok(md.includes(`| ${row.ruleId} | ${row.injected} | ${row.found} |`), `recall row for ${row.ruleId}`);
  }
  for (const row of results.pooled.falsePositives) {
    assert.ok(md.includes(`| ${row.ruleId} | ${row.negatives} | ${row.falsePositives} |`), `FP row for ${row.ruleId}`);
  }
  assert.match(md, /## Detector bugs found/);
  assert.match(md, /## Limitations/);
  assert.ok(!md.includes('[object Object]'));
  assert.ok(!md.includes('undefined'));
});
