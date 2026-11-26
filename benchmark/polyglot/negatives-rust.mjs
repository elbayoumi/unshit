// Rust hard negatives for rust/no-unwrap.

import { pushInjection } from './lib.mjs';

export const RUST_NEG = [
  {
    variant: 'cfg-test-module',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/state.rs', [
        '#[cfg(test)]',
        `mod neg_tests_${i} {`,
        '    #[test]',
        '    fn parses() {',
        '        let value = "1".parse::<u32>().unwrap();',
        '        assert_eq!(value, 1);',
        '    }',
        '}',
      ], 4, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'cfg-test-module', marker: `neg_tests_${i}` });
    },
  },
  {
    variant: 'tests-dir',
    run(files, injections, i) {
      pushInjection(files, injections, 'tests/store_test.rs', [
        '#[test]',
        `fn neg_dir_${i}() {`,
        '    let value = "1".parse::<u32>().unwrap();',
        '    assert_eq!(value, 1);',
        '}',
      ], 2, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'tests-dir', marker: `neg_dir_${i}` });
    },
  },
  {
    variant: 'benches-dir',
    run(files, injections, i) {
      pushInjection(files, injections, 'benches/parse.rs', [
        `fn neg_bench_${i}() {`,
        '    let value = "1".parse::<u32>().unwrap();',
        '    assert_eq!(value, 1);',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'benches-dir', marker: `neg_bench_${i}` });
    },
  },
  {
    variant: 'examples-dir',
    run(files, injections, i) {
      pushInjection(files, injections, 'examples/demo.rs', [
        `fn neg_example_${i}() {`,
        '    let value = "1".parse::<u32>().unwrap();',
        '    assert_eq!(value, 1);',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'examples-dir', marker: `neg_example_${i}` });
    },
  },
  {
    variant: 'build-script',
    run(files, injections, i) {
      pushInjection(files, injections, 'build.rs', [
        `fn neg_build_${i}() {`,
        '    let value = "1".parse::<u32>().unwrap();',
        '    assert_eq!(value, 1);',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'build-script', marker: `neg_build_${i}` });
    },
  },
  {
    variant: 'read-lock-allowed',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/cache.rs', [
        `fn neg_read_${i}(cache: &Cache) {`,
        '    let guard = cache.read().unwrap();',
        '    let _ = guard;',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'read-lock-allowed', marker: `neg_read_${i}` });
    },
  },
  {
    variant: 'write-lock-allowed',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/cache.rs', [
        `fn neg_write_${i}(cache: &Cache) {`,
        '    let guard = cache.write().unwrap();',
        '    let _ = guard;',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'write-lock-allowed', marker: `neg_write_${i}` });
    },
  },
  {
    variant: 'mutex-lock-allowed',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/queue.rs', [
        `fn neg_lock_${i}(queue: &Queue) {`,
        '    let guard = queue.lock().unwrap();',
        '    let _ = guard;',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'mutex-lock-allowed', marker: `neg_lock_${i}` });
    },
  },
  {
    variant: 'regex-new-allowed',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/parser.rs', [
        `fn neg_regex_${i}() {`,
        '    let re = Regex::new(r"^[a-z]+$").unwrap();',
        '    let _ = re;',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'regex-new-allowed', marker: `neg_regex_${i}` });
    },
  },
  {
    variant: 'line-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/service.rs', [
        `// historical: value.unwrap() was removed in neg ${i}`,
      ], 0, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'line-comment', marker: `neg_comment_${i}` });
    },
  },
  {
    variant: 'string-literal',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/util.rs', [
        `pub fn neg_hint_${i}() -> &'static str {`,
        '    "do not call .unwrap() in handlers"',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'string-literal', marker: `neg_hint_${i}` });
    },
  },
  {
    variant: 'block-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/report.rs', [
        '/*',
        ` * The old code used value.unwrap() here (neg ${i}).`,
        ' */',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'block-comment', marker: `neg_block_${i}` });
    },
  },
  {
    variant: 'expect-not-unwrap',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/config.rs', [
        `fn neg_expect_${i}(map: &std::collections::HashMap<&str, u32>) -> u32 {`,
        '    *map.get("port").expect("missing port")',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'expect-not-unwrap', marker: `neg_expect_${i}` });
    },
  },
  {
    variant: 'unwrap-or-default',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/env.rs', [
        `fn neg_default_${i}(map: &std::collections::HashMap<&str, u32>) -> u32 {`,
        '    map.get("port").copied().unwrap_or_default()',
        '}',
      ], 1, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'unwrap-or-default', marker: `neg_default_${i}` });
    },
  },
  {
    variant: 'doc-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/api.rs', [
        `/// Prefer ? over .unwrap() in handlers (neg ${i}).`,
      ], 0, { ruleId: 'rust/no-unwrap', kind: 'rust-unwrap', variant: 'doc-comment', marker: `neg_doc_${i}` });
    },
  },
];

