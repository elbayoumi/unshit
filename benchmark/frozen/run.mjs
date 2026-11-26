#!/usr/bin/env node
// Frozen precision/recall suite for unshit's unused-code and remaining
// structural/heuristic rules.
//
//   pnpm build && node benchmark/frozen/run.mjs
//
// Each case is a directory containing a small project plus `expected.json`.
// The runner executes `bin/unshit.js scan <case> --format json` for every case
// and compares the findings of the tracked rules exactly by
// ruleId + file + symbol. See README.md for the labelling rules and the
// frozen-case policy. Known failing cases are excluded from the gate only
// through explicit entries in known-gaps.json (documented in KNOWN-GAPS.md).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'unshit.js');
const DIST_ENTRY = join(REPO_ROOT, 'dist', 'src', 'cli.js');

const SUITES = ['eval', 'holdout', 'hard-negatives'];
const LEGACY_RULES = [
  'ts/unused-export',
  'ts/unused-type-export',
  'ts/unused-file',
  'deps/unused-dependency',
  'deps/unlisted-dependency',
];
const ADDED_RULES = [
  'code/high-complexity',
  'arch/import-cycle',
  'code/duplicate-block',
  'react/god-file',
  'slop/redundant-catch',
  'ts/no-explicit-any',
];
const RULES = [...LEGACY_RULES, ...ADDED_RULES];
const TRACKED = new Set(RULES);
const ADDED = new Set(ADDED_RULES);
const GAPS_PATH = join(HERE, 'known-gaps.json');
const RECALL_MIN = 0.90;
const FPR_MAX = 0.02;

function die(message) {
  console.error(`frozen-bench: ${message}`);
  process.exit(2);
}

if (!existsSync(BIN)) die(`missing CLI entry ${BIN}`);
if (!existsSync(DIST_ENTRY)) {
  die(`missing ${DIST_ENTRY}; run \`pnpm build\` before the frozen suite`);
}

/** Package name a module specifier refers to: `@s/pkg/sub` -> `@s/pkg`, `x/y` -> `x`. */
function packageName(spec) {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] || null;
}

/**
 * Symbol used in the finding key. File-level rules have no symbol; dependency
 * rules use the package name, matching the `symbol` field in expected.json.
 * Line-based rules use `line:column` of the finding span, complexity uses the
 * function name, cycles/clones use the canonical source -> target pair from
 * the evidence. See README.md ("Label format").
 */
function findingSymbol(finding) {
  switch (finding.ruleId) {
    case 'ts/unused-export':
    case 'ts/unused-type-export': {
      const match = /`([^`]+)`/.exec(finding.message ?? '');
      return match ? match[1] : '';
    }
    case 'ts/unused-file':
    case 'react/god-file':
      return null;
    case 'deps/unused-dependency':
      return (finding.evidence ?? '').trim();
    case 'deps/unlisted-dependency': {
      const evidence = (finding.evidence ?? '').trim();
      const match = /^import '(.+)'$/.exec(evidence);
      return packageName(match ? match[1] : evidence);
    }
    case 'code/high-complexity': {
      const match = /in "([^"]+)";/.exec(finding.message ?? '');
      return match ? match[1] : '';
    }
    case 'arch/import-cycle':
      return (finding.evidence ?? '').trim();
    case 'code/duplicate-block': {
      const match = /^(.+?):\d+-\d+ <-> (.+?):\d+-\d+$/.exec((finding.evidence ?? '').trim());
      return match ? `${match[2]} -> ${match[1]}` : (finding.evidence ?? '').trim();
    }
    case 'slop/redundant-catch':
    case 'ts/no-explicit-any':
      return `${finding.span?.line}:${finding.span?.column}`;
    default:
      return null;
  }
}

/** Optional `rules` in expected.json narrows the rules a case asserts. */
function caseRules(meta) {
  if (!Array.isArray(meta.rules)) return RULES;
  for (const rule of meta.rules) {
    if (!TRACKED.has(rule)) die(`untracked rule ${JSON.stringify(rule)} in case "rules"`);
  }
  return meta.rules;
}

function loadKnownGaps() {
  if (!existsSync(GAPS_PATH)) die(`missing ${GAPS_PATH}; see README.md`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(GAPS_PATH, 'utf8'));
  } catch (error) {
    die(`invalid JSON in ${GAPS_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) die(`${GAPS_PATH} must contain an "entries" array`);
  return parsed.entries.map((entry, index) => {
    const where = `${GAPS_PATH} entry ${index}`;
    for (const field of ['suite', 'case', 'ruleId', 'file', 'reason']) {
      if (!entry || typeof entry[field] !== 'string' || entry[field].trim() === '') {
        die(`${where}: missing string field "${field}"`);
      }
    }
    if (entry.suite !== 'holdout' && entry.suite !== 'hard-negatives') {
      die(`${where}: suite must be holdout or hard-negatives`);
    }
    if (!ADDED.has(entry.ruleId)) die(`${where}: knowledge gaps may only cover newly added rules`);
    return { ...entry, symbol: entry.symbol ?? null };
  });
}

function gapKey(entry) {
  return findingKey(entry.ruleId, entry.file, entry.symbol);
}

function findingKey(ruleId, file, symbol) {
  return `${ruleId}\u0000${file}\u0000${symbol === null || symbol === undefined ? '' : symbol}`;
}

function loadCases(suite) {
  const suiteDir = join(HERE, suite);
  if (!existsSync(suiteDir)) die(`missing suite directory ${suiteDir}`);
  return readdirSync(suiteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(suiteDir, entry.name);
      const expectedPath = join(dir, 'expected.json');
      if (!existsSync(expectedPath)) die(`missing ${expectedPath}`);
      let meta;
      try {
        meta = JSON.parse(readFileSync(expectedPath, 'utf8'));
      } catch (error) {
        die(`invalid JSON in ${expectedPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!meta || !Array.isArray(meta.expected)) {
        die(`${expectedPath} must contain an "expected" array`);
      }
      return { suite, name: entry.name, dir, meta };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanCase(caseDir) {
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [BIN, 'scan', caseDir, '--format', 'json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    die(`scan failed for ${caseDir}${stderr ? `:\n${stderr}` : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    die(`scan output for ${caseDir} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || !Array.isArray(parsed.findings)) {
    die(`scan output for ${caseDir} has no findings array`);
  }
  return parsed.findings;
}

function evaluate(testCase) {
  const scope = new Set(caseRules(testCase.meta));
  const expected = new Map();
  for (const item of testCase.meta.expected) {
    if (!item || !TRACKED.has(item.ruleId)) {
      die(`${testCase.suite}/${testCase.name}: expected entry has untracked ruleId ${JSON.stringify(item?.ruleId)}`);
    }
    if (!scope.has(item.ruleId)) {
      die(`${testCase.suite}/${testCase.name}: expected entry ${item.ruleId} is outside its "rules" scope`);
    }
    const key = findingKey(item.ruleId, item.file, item.symbol ?? null);
    if (expected.has(key)) {
      die(`${testCase.suite}/${testCase.name}: duplicate expected finding ${key.replaceAll('\u0000', ' | ')}`);
    }
    expected.set(key, {
      ruleId: item.ruleId,
      file: item.file,
      symbol: item.symbol ?? null,
      reason: item.reason ?? '',
    });
  }

  if (testCase.suite === 'hard-negatives' && expected.size > 0) {
    die(`${testCase.suite}/${testCase.name}: hard-negative cases must have an empty expected array`);
  }
  if (testCase.suite !== 'hard-negatives' && expected.size === 0) {
    die(`${testCase.suite}/${testCase.name}: labelled cases need at least one expected finding`);
  }

  const actual = new Map();
  for (const finding of scanCase(testCase.dir)) {
    if (!scope.has(finding.ruleId)) continue;
    const symbol = findingSymbol(finding);
    const key = findingKey(finding.ruleId, finding.file, symbol);
    if (!actual.has(key)) {
      actual.set(key, {
        ruleId: finding.ruleId,
        file: finding.file,
        symbol,
        message: finding.message ?? '',
      });
    }
  }

  const matched = [...expected.keys()].filter((key) => actual.has(key));
  const missing = [...expected.keys()].filter((key) => !actual.has(key)).map((key) => expected.get(key));
  const unexpected = [...actual.keys()].filter((key) => !expected.has(key)).map((key) => actual.get(key));

  return {
    ...testCase,
    scope,
    expected,
    actual,
    matched,
    missing,
    unexpected,
  };
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

const results = [];
for (const suite of SUITES) {
  for (const testCase of loadCases(suite)) {
    results.push(evaluate(testCase));
  }
}

const knownGaps = loadKnownGaps();
const byName = new Map(results.map((result) => [`${result.suite}/${result.name}`, result]));
const excludedMisses = new Set();
const excludedFps = new Set();
for (const gap of knownGaps) {
  const key = `${gap.suite}/${gap.case}`;
  const result = byName.get(key);
  if (!result) die(`${GAPS_PATH}: ${key} is not a case`);
  if (!result.scope.has(gap.ruleId)) die(`${GAPS_PATH}: ${key} does not track ${gap.ruleId}`);
  const fingerprint = `${key}\u0000${gapKey(gap)}`;
  if (gap.suite === 'holdout') {
    if (!result.expected.has(gapKey(gap)) || result.actual.has(gapKey(gap))) {
      die(`${GAPS_PATH}: ${key} ${gap.ruleId} ${gap.file} is not a current holdout miss`);
    }
    excludedMisses.add(fingerprint);
  } else {
    if (!result.actual.has(gapKey(gap))) {
      die(`${GAPS_PATH}: ${key} ${gap.ruleId} ${gap.file} is not a current false positive`);
    }
    excludedFps.add(fingerprint);
  }
}

const holdout = results.filter((result) => result.suite === 'holdout');
const hardNegatives = results.filter((result) => result.suite === 'hard-negatives');
const evalCases = results.filter((result) => result.suite === 'eval');

const perRule = new Map(RULES.map((rule) => [rule, { expected: 0, matched: 0, missing: [] }]));
for (const result of holdout) {
  for (const item of result.expected.values()) {
    const key = findingKey(item.ruleId, item.file, item.symbol);
    if (excludedMisses.has(`${result.suite}/${result.name}\u0000${key}`)) continue;
    const row = perRule.get(item.ruleId);
    row.expected += 1;
    if (result.actual.has(key)) row.matched += 1;
    else row.missing.push({ case: result.name, ...item });
  }
}

function unexpectedFor(result) {
  return result.unexpected.filter((item) =>
    !excludedFps.has(`${result.suite}/${result.name}\u0000${findingKey(item.ruleId, item.file, item.symbol)}`));
}

const hardNegativeFailures = hardNegatives.filter((result) => unexpectedFor(result).length > 0);
const fpr = hardNegatives.length > 0 ? hardNegativeFailures.length / hardNegatives.length : 0;
const hardNegativeFindings = hardNegatives.reduce((sum, result) => sum + unexpectedFor(result).length, 0);

const fprByRule = RULES.map((rule) => {
  const scoped = hardNegatives.filter((result) => result.scope.has(rule));
  const failed = scoped.filter((result) => unexpectedFor(result).some((item) => item.ruleId === rule));
  return { rule, cases: scoped.length, failed: failed.length, rate: scoped.length > 0 ? failed.length / scoped.length : 0 };
});

const evalExpected = evalCases.reduce((sum, result) => sum + result.expected.size, 0);
const evalMatched = evalCases.reduce((sum, result) => sum + result.matched.length, 0);
const evalRecall = evalExpected > 0 ? evalMatched / evalExpected : 1;
const evalUnexpected = evalCases.reduce((sum, result) => sum + result.unexpected.length, 0);

console.log('unshit frozen rule suite');
console.log(`cases: ${results.length} (eval ${evalCases.length}, holdout ${holdout.length}, hard-negatives ${hardNegatives.length})`);
console.log('');

console.log(`HOLDOUT RECALL (gate: per-rule recall >= ${pct(RECALL_MIN)})`);
console.log(`${pad('rule', 26)} ${pad('expected', 9)} ${pad('matched', 8)} ${pad('recall', 8)} missing`);
for (const rule of RULES) {
  const row = perRule.get(rule);
  const recall = row.expected > 0 ? row.matched / row.expected : null;
  console.log(
    `${pad(rule, 26)} ${pad(row.expected, 9)} ${pad(row.matched, 8)} ${pad(recall === null ? 'n/a' : pct(recall), 8)} ${row.missing.length}`,
  );
}
const missingRows = [...perRule.entries()].flatMap(([rule, row]) =>
  row.missing.map((item) => ({ rule, ...item })),
);
if (missingRows.length > 0) {
  console.log('');
  console.log('Holdout misses:');
  for (const item of missingRows) {
    console.log(`  - ${item.case}: ${item.ruleId} ${item.file} ${item.symbol ?? '(file)'} — ${item.reason}`);
  }
}
console.log('');

console.log(`HARD-NEGATIVE FALSE POSITIVE RATE (gate: FPR <= ${pct(FPR_MAX)})`);
console.log(`cases: ${hardNegatives.length}  cases with >=1 false positive: ${hardNegativeFailures.length}  FPR: ${pct(fpr)}  unexpected findings: ${hardNegativeFindings}`);
console.log('');
console.log(`${pad('rule', 26)} ${pad('scoped cases', 13)} ${pad('with FP', 8)} ${pad('FPR', 8)}`);
for (const row of fprByRule) {
  console.log(`${pad(row.rule, 26)} ${pad(row.cases, 13)} ${pad(row.failed, 8)} ${pad(pct(row.rate), 8)}`);
}
console.log('');
console.log(`${pad('hard-negative case', 34)} ${pad('status', 8)} unexpected`);
for (const result of hardNegatives) {
  const count = unexpectedFor(result).length;
  console.log(`${pad(result.name, 34)} ${pad(count === 0 ? 'PASS' : 'FAIL', 8)} ${count}`);
}
if (hardNegativeFailures.length > 0) {
  console.log('');
  console.log('False-positive details:');
  for (const result of hardNegativeFailures) {
    for (const item of unexpectedFor(result)) {
      console.log(`  - ${result.name}: ${item.ruleId} ${item.file} ${item.symbol ?? '(file)'} — ${item.message}`);
    }
  }
}
console.log('');

console.log(`EVAL (informational, not gated)  recall: ${pct(evalRecall)} (${evalMatched}/${evalExpected})  unexpected findings: ${evalUnexpected}`);
const evalMisses = evalCases.flatMap((result) =>
  result.missing.map((item) => ({ case: result.name, ...item })),
);
if (evalMisses.length > 0) {
  console.log('Eval misses:');
  for (const item of evalMisses) {
    console.log(`  - ${item.case}: ${item.ruleId} ${item.file} ${item.symbol ?? '(file)'}`);
  }
}
const evalFalsePositives = evalCases.flatMap((result) =>
  result.unexpected.map((item) => ({ case: result.name, ...item })),
);
if (evalFalsePositives.length > 0) {
  console.log('Eval unexpected findings:');
  for (const item of evalFalsePositives) {
    console.log(`  - ${item.case}: ${item.ruleId} ${item.file} ${item.symbol ?? '(file)'}`);
  }
}
console.log('');

console.log(`KNOWN GAPS (excluded from the gate only via ${GAPS_PATH}; details in KNOWN-GAPS.md): ${knownGaps.length}`);
for (const gap of knownGaps) {
  console.log(`  - ${gap.suite}/${gap.case}: ${gap.ruleId} ${gap.file} ${gap.symbol ?? '(file)'} — ${gap.reason}`);
}
console.log('');

const recallFailures = RULES
  .map((rule) => ({ rule, row: perRule.get(rule) }))
  .filter(({ row }) => row.expected > 0 && row.matched / row.expected < RECALL_MIN);
const fprFails = fpr > FPR_MAX;
const ruleFprFailures = fprByRule.filter((row) => row.rate > FPR_MAX);
const ok = recallFailures.length === 0 && !fprFails && ruleFprFailures.length === 0;

if (ok) {
  console.log('RESULT: PASS');
  process.exit(0);
}
console.log('RESULT: FAIL');
for (const { rule, row } of recallFailures) {
  console.log(`  recall ${rule}: ${pct(row.matched / row.expected)} < ${pct(RECALL_MIN)}`);
}
if (fprFails) {
  console.log(`  false-positive rate: ${pct(fpr)} > ${pct(FPR_MAX)}`);
}
for (const row of ruleFprFailures) {
  console.log(`  false-positive rate ${row.rule}: ${pct(row.rate)} > ${pct(FPR_MAX)}`);
}
process.exit(1);
