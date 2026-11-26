import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { DetectorContext, FileEntry, Finding } from '../src/contracts.js';
import { rustNoUnwrapDetector } from '../src/detectors/polyglot.js';

function detect(content: string): Finding[] {
  const relPath = 'src/lib.rs';
  const file: FileEntry = {
    absPath: `/tmp/${relPath}`,
    relPath,
    ext: '.rs',
    content,
    lines: content.split('\n'),
  };
  const ctx: DetectorContext = { rootDir: '/tmp', config: { ...DEFAULT_CONFIG }, files: [file] };
  return rustNoUnwrapDetector.detect(ctx);
}

function dotColumn(line: string): number {
  return line.lastIndexOf('.', line.indexOf('unwrap')) + 1;
}

test('rust/no-unwrap flags whitespace variants of `.unwrap()`', () => {
  const variants = [
    'let v = values.get("k").unwrap ();',
    'let v = values.get("k").unwrap( );',
    'let v = values.get("k"). unwrap();',
    'let v = values.get("k") . unwrap ( );',
  ];
  for (const line of variants) {
    const content = `pub fn read(values: &Map) -> i32 {\n  ${line}\n}\n`;
    const findings = detect(content);
    assert.equal(findings.length, 1, `expected one finding for ${line}`);
    assert.equal(findings[0]?.ruleId, 'rust/no-unwrap');
    assert.deepEqual(findings[0]?.span, { line: 2, column: dotColumn(line) + 2 }, line);
  }
});

test('rust/no-unwrap keeps reporting a chain spread over lines', () => {
  const content = [
    'pub fn read(values: &Map) -> i32 {',
    '  values',
    '    .get("k")',
    '    .unwrap()',
    '}',
    '',
  ].join('\n');
  const findings = detect(content);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0]?.span, { line: 4, column: 5 });
});

test('rust/no-unwrap ignores unwrap-like names and allowed receivers', () => {
  const content = [
    'pub fn read(values: &Map, mutex: &Mutex<i32>) {',
    '  let a = values.get("k").unwrap_or(0);',
    '  let b = values.get("k").unwrap_or_default();',
    '  let c = values.get("k").unwrap_err();',
    '  let d = values.get("k").unwrapped();',
    '  let e = my_unwrap();',
    '  let f = values.get("k").unwrap_or_else(|| 0);',
    '  let g = mutex.lock().unwrap ();',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(detect(content), []);
});

test('rust/no-unwrap still skips #[cfg(test)] modules', () => {
  const content = [
    '#[cfg(test)]',
    'mod tests {',
    '  fn it_works() {',
    '    let v = values.get("k").unwrap ();',
    '  }',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(detect(content), []);
});

test('rust/no-unwrap still ignores comments and string literals', () => {
  const content = [
    'pub fn read(values: &Map) {',
    '  // .unwrap ()',
    '  let s = ". unwrap()";',
    '  let v = values.get("k").unwrap ();',
    '}',
    '',
  ].join('\n');
  const findings = detect(content);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0]?.span, { line: 4, column: dotColumn(content.split('\n')[3] ?? '') });
});

test('rust/no-unwrap reports one finding per spaced call on the same line', () => {
  const line = 'let pair = (values.get("a").unwrap (), values.get("b").unwrap( ));';
  const content = `pub fn read(values: &Map) {\n  ${line}\n}\n`;
  const findings = detect(content);
  const columns = [...line.matchAll(/\.\s*unwrap/g)].map((match) => (match.index ?? 0) + 3);
  assert.equal(columns.length, 2);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.span.line), [2, 2]);
  assert.deepEqual(findings.map((finding) => finding.span.column), columns);
});
