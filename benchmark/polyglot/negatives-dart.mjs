// Dart hard negatives for dart/no-dynamic-or-print.

import { pushInjection } from './lib.mjs';

export const DART_NEG = [
  {
    variant: 'map-string-dynamic',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/models/json.dart', [
        `Map<String, dynamic> negJson${i}() {`,
        "  return <String, dynamic>{'id': '1'};",
        '}',
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'map-string-dynamic', marker: `negJson${i}` });
    },
  },
  {
    variant: 'typedef-map-dynamic',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/models/user.dart', [
        `typedef NegLegacyJson${i} = Map<String, dynamic>;`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'typedef-map-dynamic', marker: `NegLegacyJson${i}` });
    },
  },
  {
    variant: 'ignore-before-print',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/services/logger.dart', [
        `void negPrint${i}() {`,
        '  // ignore: avoid_print',
        `  print('neg ${i}');`,
        '}',
      ], 2, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'ignore-before-print', marker: `negPrint${i}` });
    },
  },
  {
    variant: 'ignore-same-line',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/services/storage.dart', [
        `void negPrint${i}() {`,
        `  print('neg ${i}'); // ignore: avoid_print`,
        '}',
      ], 1, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'ignore-same-line', marker: `negPrint${i}` });
    },
  },
  {
    variant: 'debug-print',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/services/api_client.dart', [
        `void negDebug${i}() {`,
        `  debugPrint('neg ${i}');`,
        '}',
      ], 1, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'debug-print', marker: `negDebug${i}` });
    },
  },
  {
    variant: 'print-in-string',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/utils/formatters.dart', [
        `const String negHint${i} = 'print(value)';`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'print-in-string', marker: `negHint${i}` });
    },
  },
  {
    variant: 'print-in-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/utils/validators.dart', [
        `// never call print() here (neg ${i})`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'print-in-comment', marker: `negDartComment${i}` });
    },
  },
  {
    variant: 'dynamic-in-string',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/config.dart', [
        `const String negKind${i} = 'dynamic';`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'dynamic-in-string', marker: `negKind${i}` });
    },
  },
  {
    variant: 'dynamic-in-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/state/app_state.dart', [
        `// dynamic was removed in v2 (neg ${i})`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'dynamic-in-comment', marker: `negDartDynComment${i}` });
    },
  },
  {
    variant: 'test-dir',
    run(files, injections, i) {
      pushInjection(files, injections, 'test/widget_test.dart', [
        `void negTestPrint${i}() {`,
        "  print('test output');",
        '}',
      ], 1, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'test-dir', marker: `negTestPrint${i}` });
    },
  },
  {
    variant: 'object-nullable',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/models/product.dart', [
        `Object? negValue${i};`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'object-nullable', marker: `negValue${i}` });
    },
  },
  {
    variant: 'dynamic-identifier',
    run(files, injections, i) {
      pushInjection(files, injections, 'lib/state/cart_state.dart', [
        `final int dynamicValue${i} = 3;`,
      ], 0, { ruleId: 'dart/no-dynamic-or-print', kind: 'dart-dynamic-print', variant: 'dynamic-identifier', marker: `dynamicValue${i}` });
    },
  },
];

