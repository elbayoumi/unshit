// Python hard negatives for python/no-bare-except.

import { pushInjection } from './lib.mjs';

export const PYTHON_NEG = [
  {
    variant: 'except-exception-handled',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/service.py', [
        `def neg_handler_${i}():`,
        '    try:',
        '        return _load()',
        '    except Exception as exc:',
        '        _log(exc)',
        '        return None',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-exception-handled', marker: `neg_handler_${i}` });
    },
  },
  {
    variant: 'except-tuple',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/repository.py', [
        `def neg_tuple_${i}():`,
        '    try:',
        '        return _load()',
        '    except (ValueError, TypeError) as exc:',
        '        _log(exc)',
        '        return None',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-tuple', marker: `neg_tuple_${i}` });
    },
  },
  {
    variant: 'except-value-error',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/validators.py', [
        `def neg_value_${i}():`,
        '    try:',
        '        return _load()',
        '    except ValueError:',
        '        return None',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-value-error', marker: `neg_value_${i}` });
    },
  },
  {
    variant: 'except-base-exception',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/api.py', [
        `def neg_base_${i}():`,
        '    try:',
        '        return _load()',
        '    except BaseException as exc:',
        '        raise',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-base-exception', marker: `neg_base_${i}` });
    },
  },
  {
    variant: 'except-star-group',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/worker.py', [
        `def neg_group_${i}():`,
        '    try:',
        '        return _load()',
        '    except* ValueError as group:',
        '        _log(group)',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-star-group', marker: `neg_group_${i}` });
    },
  },
  {
    variant: 'docstring',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/utils.py', [
        `def neg_doc_${i}():`,
        '    """Historical note: the old code used',
        '    except:',
        '        pass',
        '    before the refactor."""',
        '    return None',
      ], 2, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'docstring', marker: `neg_docstring_${i}` });
    },
  },
  {
    variant: 'comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/text.py', [
        `# legacy: except: pass (neg ${i})`,
      ], 0, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'comment', marker: `neg_pycomment_${i}` });
    },
  },
  {
    variant: 'tests-dir',
    run(files, injections, i) {
      pushInjection(files, injections, 'tests/test_service.py', [
        `def neg_test_${i}():`,
        '    try:',
        '        return _load()',
        '    except:',
        '        return None',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'tests-dir', marker: `neg_test_${i}` });
    },
  },
  {
    variant: 'conftest',
    run(files, injections, i) {
      pushInjection(files, injections, 'tests/conftest.py', [
        `def neg_conftest_${i}():`,
        '    try:',
        '        return _load()',
        '    except:',
        '        return None',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'conftest', marker: `neg_conftest_${i}` });
    },
  },
  {
    variant: 'except-logger',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/http_client.py', [
        `def neg_logger_${i}():`,
        '    try:',
        '        return _load()',
        '    except Exception as exc:',
        '        _log.warning("load failed", exc_info=exc)',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-logger', marker: `neg_logger_${i}` });
    },
  },
  {
    variant: 'except-keyboard',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/cli.py', [
        `def neg_keyboard_${i}():`,
        '    try:',
        '        return _load()',
        '    except (KeyboardInterrupt, SystemExit):',
        '        raise',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-keyboard', marker: `neg_keyboard_${i}` });
    },
  },
  {
    variant: 'except-runtime-reraise',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/retry.py', [
        `def neg_runtime_${i}():`,
        '    try:',
        '        return _load()',
        '    except RuntimeError as exc:',
        '        raise RuntimeError("wrapped") from exc',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-runtime-reraise', marker: `neg_runtime_${i}` });
    },
  },
  {
    variant: 'string-literal',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/files.py', [
        `NEG_MESSAGE_${i} = "except: handled upstream"`,
      ], 0, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'string-literal', marker: `neg_pystring_${i}` });
    },
  },
  {
    variant: 'except-os-error',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/cache.py', [
        `def neg_os_${i}():`,
        '    try:',
        '        return _load()',
        '    except OSError as exc:',
        '        raise',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-os-error', marker: `neg_os_${i}` });
    },
  },
  {
    variant: 'except-exception-pass',
    run(files, injections, i) {
      pushInjection(files, injections, 'src/ledger/scheduler.py', [
        `def neg_pass_${i}():`,
        '    try:',
        '        return _load()',
        '    except Exception:',
        '        pass',
      ], 3, { ruleId: 'python/no-bare-except', kind: 'python-bare-except', variant: 'except-exception-pass', marker: `neg_pass_${i}` });
    },
  },
];

