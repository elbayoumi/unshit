// Positive injectors: 15 realistic true-positive mutations per tracked rule
// and seed. Every injected defect is placed in a file the detector is supposed
// to scan (never in `tests/`, `benches/`, `examples/`, `build.rs`, `test/`).
//
// Two variants are intentionally *known misses* and carry a `missReason`:
//   - Rust `.unwrap ()` (valid Rust; the detector matches only `.unwrap()`).
//   - SCSS `.theme-card:hover` duplicating a nested `&:hover` (the detector
//     compares raw header text, not expanded selectors).

import { mulberry32, pick, pushInjection, shuffle, isDetectorTestPath } from './lib.mjs';

function candidates(files, ext, rng, count, filter = () => true) {
  const list = [...files.keys()]
    .filter((rel) => rel.endsWith(ext) && !isDetectorTestPath(rel) && filter(rel))
    .sort();
  return shuffle(rng, list).slice(0, count);
}

const RUST_POS = [
  (i) => ({ variant: 'file-open', lines: [`fn inj_${i}() {`, '    let handle = std::fs::File::open("data/input.txt").unwrap();', '    let _ = handle;', '}'], offset: 1 }),
  (i) => ({ variant: 'read-to-string', lines: [`fn inj_${i}() {`, '    let body = std::fs::read_to_string("data/input.txt").unwrap();', '    let _ = body;', '}'], offset: 1 }),
  (i) => ({ variant: 'env-var', lines: [`fn inj_${i}() {`, '    let port = std::env::var("PORT").unwrap();', '    let _ = port;', '}'], offset: 1 }),
  (i) => ({ variant: 'json-from-str', lines: [`fn inj_${i}() {`, '    let value = serde_json::from_str::<serde_json::Value>("{}").unwrap();', '    let _ = value;', '}'], offset: 1 }),
  (i) => ({ variant: 'config-load', lines: [`fn inj_${i}() {`, '    let config = crate::config::Config::from_env().unwrap();', '    let _ = config;', '}'], offset: 1 }),
  (i) => ({ variant: 'strip-suffix', lines: [`fn inj_${i}() {`, '    let trimmed = "a,b,".strip_suffix(\',\').unwrap();', '    let _ = trimmed;', '}'], offset: 1 }),
  (i) => ({ variant: 'iterator-next', lines: [`fn inj_${i}() {`, '    let mut parts = "a,b".split(\',\');', '    let first = parts.next().unwrap();', '    let _ = first;', '}'], offset: 2 }),
  (i) => ({ variant: 'parse-literal', lines: [`fn inj_${i}() {`, '    let parsed = "42".parse::<u32>().unwrap();', '    let _ = parsed;', '}'], offset: 1 }),
  (i) => ({ variant: 'chain-map', lines: [`fn inj_${i}() {`, '    let values = vec!["1", "2", "3"];', '    let total = values', '        .iter()', '        .map(|value| value.parse::<i64>().unwrap())', '        .sum::<i64>();', '    let _ = total;', '}'], offset: 4 }),
  (i) => ({ variant: 'slice-get', lines: [`fn inj_${i}() {`, '    let items = vec![1, 2, 3];', '    let item = items.get(1).unwrap();', '    let _ = item;', '}'], offset: 2 }),
  (i) => ({ variant: 'from-utf8', lines: [`fn inj_${i}() {`, '    let bytes = vec![104, 105];', '    let text = String::from_utf8(bytes).unwrap();', '    let _ = text;', '}'], offset: 2 }),
  (i) => ({ variant: 'checked-sub', lines: [`fn inj_${i}() {`, '    let values = vec![1, 2, 3];', '    let n = values.len().checked_sub(1).unwrap();', '    let _ = n;', '}'], offset: 2 }),
  (i) => ({ variant: 'header-get', lines: [`fn inj_${i}() {`, '    let headers = std::collections::HashMap::from([("authorization", "Bearer x")]);', '    let header = headers.get("authorization").unwrap();', '    let _ = header;', '}'], offset: 2 }),
  (i) => ({ variant: 'id-parse', lines: [`fn inj_${i}() {`, '    let raw = "1234";', '    let id = raw.parse::<u64>().unwrap();', '    let _ = id;', '}'], offset: 2 }),
  (i) => ({
    variant: 'spaced-call',
    missReason: 'the detector matches the literal `.unwrap()`; Rust allows whitespace before the argument list',
    lines: [`fn inj_${i}() {`, '    let values = std::collections::HashMap::from([("k", "v")]);', '    let value = values.get("k").unwrap ();', '    let _ = value;', '}'],
    offset: 2,
  }),
];

const PYTHON_POS = [
  (i) => ({ variant: 'except-pass', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        pass'], offset: 3 }),
  (i) => ({ variant: 'except-return-none', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        return None'], offset: 3 }),
  (i) => ({ variant: 'except-continue', lines: [`def inj_${i}(values):`, '    for value in values:', '        try:', '            _handle(value)', '        except:', '            continue'], offset: 4 }),
  (i) => ({ variant: 'spaced-colon', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except :', '        return None'], offset: 3 }),
  (i) => ({ variant: 'noqa', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:  # noqa: E722', '        return None'], offset: 3 }),
  (i) => ({ variant: 'print-traceback', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        traceback.print_exc()'], offset: 3 }),
  (i) => ({ variant: 're-raise', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        raise'], offset: 3 }),
  (i) => ({ variant: 'log-warning', lines: [`def inj_${i}(logger):`, '    try:', '        return _load()', '    except:', '        logger.warning("load failed")'], offset: 3 }),
  (i) => ({ variant: 'return-list', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        return []'], offset: 3 }),
  (i) => ({ variant: 'append-failure', lines: [`def inj_${i}(failures):`, '    try:', '        return _load()', '    except:', '        failures.append(None)'], offset: 3 }),
  (i) => ({ variant: 'class-method', lines: [`class Inj${i}:`, '    def load(self):', '        try:', '            return _load()', '        except:', '            return None'], offset: 4 }),
  (i) => ({ variant: 'async-function', lines: [`async def inj_${i}():`, '    try:', '        return await _load()', '    except:', '        return None'], offset: 3 }),
  (i) => ({ variant: 'raise-wrapped', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        raise RuntimeError("load failed")'], offset: 3 }),
  (i) => ({ variant: 'sys-exit', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        sys.exit(1)'], offset: 3 }),
  (i) => ({ variant: 'except-return-dict', lines: [`def inj_${i}():`, '    try:', '        return _load()', '    except:', '        return {}'], offset: 3 }),
];

const DART_POS = [
  (i) => ({ variant: 'dynamic-var', lines: [`dynamic injPayload${i} = <String, Object?>{};`] }),
  (i) => ({ variant: 'list-dynamic', lines: [`final List<dynamic> injRows${i} = const [];`] }),
  (i) => ({ variant: 'future-dynamic', lines: [`Future<dynamic> injLoad${i}() async {`, '  return null;', '}'] }),
  (i) => ({ variant: 'dynamic-param', lines: [`void injLog${i}(dynamic value) {`, "  debugPrint('value');", '}'] }),
  (i) => ({ variant: 'dynamic-function', lines: [`typedef InjCallback${i} = dynamic Function(Map<String, Object?> value);`] }),
  (i) => ({ variant: 'dynamic-return', lines: [`dynamic injParse${i}(Object? input) => input;`] }),
  (i) => ({ variant: 'print-literal', lines: [`void injPrint${i}() {`, `  print('inj ${i}');`, '}'], offset: 1 }),
  (i) => ({ variant: 'print-value', lines: [`void injPrint${i}(Object? value) {`, '  print(value);', '}'], offset: 1 }),
  (i) => ({ variant: 'print-encode', lines: [`void injPrint${i}(Map<String, Object?> payload) {`, '  print(payload);', '}'], offset: 1 }),
  (i) => ({ variant: 'print-in-if', lines: [`void injPrint${i}(bool debug) {`, "  if (debug) { print('debug'); }", '}'], offset: 1 }),
  (i) => ({ variant: 'print-in-method', lines: [`class Inj${i} {`, '  void load() {', "    print('fetching');", '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'print-in-callback', lines: [`void injPrint${i}(List<String> rows) {`, '  rows.forEach((row) {', "    print('ready');", '  });', '}'], offset: 2 }),
  (i) => ({ variant: 'dynamic-await', lines: [`Future<void> injFetch${i}(Object client) async {`, '  final dynamic result = client;', '  debugPrint(result.toString());', '}'], offset: 1 }),
  (i) => ({ variant: 'dynamic-cache', lines: [`dynamic injCached${i}(Map<String, Object?> store, String key) {`, '  return store[key];', '}'] }),
  (i) => ({ variant: 'print-warn', lines: [`void injPrint${i}(String message) {`, "  print('warn: ' + message);", '}'], offset: 1 }),
];

function cssBlock(selector, decls) {
  return [`${selector} {`, ...decls.map((decl) => `  ${decl}`), '}'];
}

const CSS_IMPORTANT = [
  (i) => ({ variant: 'plain', lines: cssBlock(`.inj-important-${i}`, ['padding: 0 !important;']), offset: 1 }),
  (i) => ({ variant: 'spaced-bang', lines: cssBlock(`.inj-important-${i}`, ['margin: 0 ! important;']), offset: 1 }),
  (i) => ({ variant: 'uppercase', lines: cssBlock(`.inj-important-${i}`, ['border: 0 !IMPORTANT;']), offset: 1 }),
  (i) => ({ variant: 'in-media', lines: ['@media (min-width: 40rem) {', `  .inj-important-${i} {`, '    display: block !important;', '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'in-supports', lines: ['@supports (display: grid) {', `  .inj-important-${i} {`, '    gap: 0 !important;', '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'in-layer', lines: ['@layer utilities {', `  .inj-important-${i} {`, '    z-index: 10 !important;', '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'two-on-one-line', lines: cssBlock(`.inj-important-${i}`, ['padding: 0 !important; margin: 0 !important;']), offset: 1 }),
  (i) => ({ variant: 'hardcoded-color', lines: cssBlock(`.inj-important-${i}`, ['color: var(--color-text) !important;']), offset: 1 }),
  (i) => ({ variant: 'grid', lines: cssBlock(`.inj-important-${i}`, ['grid-template-columns: 1fr !important;']), offset: 1 }),
  (i) => ({ variant: 'transition', lines: cssBlock(`.inj-important-${i}`, ['transition: none !important;']), offset: 1 }),
  (i) => ({ variant: 'display', lines: cssBlock(`.inj-important-${i}`, ['display: block !important;']), offset: 1 }),
  (i) => ({ variant: 'font-size', lines: cssBlock(`.inj-important-${i}`, ['font-size: 1rem !important;']), offset: 1 }),
  (i) => ({ variant: 'scss-nested', lines: [`.inj-parent-${i} {`, '  &:hover {', '    color: var(--color-text) !important;', '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'scss-amp', lines: [`.inj-parent-${i} {`, '  .child {', '    margin: 0 !important;', '  }', '}'], offset: 2 }),
  (i) => ({ variant: 'visibility', lines: cssBlock(`.inj-important-${i}`, ['visibility: hidden !important;']), offset: 1 }),
];

const CSS_COLOR = [
  (i) => ({ variant: 'hex-6', lines: cssBlock(`.inj-color-${i}`, ['color: #1a2b3c;']), offset: 1 }),
  (i) => ({ variant: 'hex-3', lines: cssBlock(`.inj-color-${i}`, ['background: #fff;']), offset: 1 }),
  (i) => ({ variant: 'hex-8', lines: cssBlock(`.inj-color-${i}`, ['border-color: #0a0b0c0d;']), offset: 1 }),
  (i) => ({ variant: 'rgba', lines: cssBlock(`.inj-color-${i}`, ['box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);']), offset: 1 }),
  (i) => ({ variant: 'rgb', lines: cssBlock(`.inj-color-${i}`, ['background: rgb(20, 30, 40);']), offset: 1 }),
  (i) => ({ variant: 'hsl', lines: cssBlock(`.inj-color-${i}`, ['outline-color: hsl(210, 40%, 50%);']), offset: 1 }),
  (i) => ({ variant: 'hsla', lines: cssBlock(`.inj-color-${i}`, ['background: hsla(210, 40%, 50%, 0.8);']), offset: 1 }),
  (i) => ({ variant: 'gradient', lines: cssBlock(`.inj-color-${i}`, ['background: linear-gradient(#fff, #000);']), offset: 1 }),
  (i) => ({ variant: 'border', lines: cssBlock(`.inj-color-${i}`, ['border: 1px solid #ccc;']), offset: 1 }),
  (i) => ({ variant: 'fill', lines: cssBlock(`.inj-color-${i}`, ['fill: #333;']), offset: 1 }),
  (i) => ({ variant: 'rgba-white', lines: cssBlock(`.inj-color-${i}`, ['background-color: rgba(255, 255, 255, 0.9);']), offset: 1 }),
  (i) => ({ variant: 'hex-uppercase', lines: cssBlock(`.inj-color-${i}`, ['color: #ABCDEF;']), offset: 1 }),
  (i) => ({ variant: 'hex-short-magenta', lines: cssBlock(`.inj-color-${i}`, ['text-decoration-color: #f0f;']), offset: 1 }),
  (i) => ({ variant: 'caret', lines: cssBlock(`.inj-color-${i}`, ['caret-color: #00ff00;']), offset: 1 }),
  (i) => ({ variant: 'hex-black', lines: cssBlock(`.inj-color-${i}`, ['background: #000000;']), offset: 1 }),
];

function injectRust(files, injections, rng, count) {
  const targets = candidates(files, '.rs', rng, count, (rel) => rel.startsWith('src/'));
  targets.forEach((rel, index) => {
    const spec = RUST_POS[index % RUST_POS.length](index);
    pushInjection(files, injections, rel, spec.lines, spec.offset ?? 0, {
      ruleId: 'rust/no-unwrap',
      kind: 'rust-unwrap',
      variant: spec.variant,
      marker: `inj_${index}`,
      missReason: spec.missReason,
    });
  });
}

function injectPython(files, injections, rng, count) {
  const targets = candidates(files, '.py', rng, count, (rel) => rel.startsWith('src/'));
  targets.forEach((rel, index) => {
    const spec = PYTHON_POS[index % PYTHON_POS.length](index);
    pushInjection(files, injections, rel, spec.lines, spec.offset ?? 0, {
      ruleId: 'python/no-bare-except',
      kind: 'python-bare-except',
      variant: spec.variant,
      marker: `inj_${index}`,
    });
  });
}

function injectDart(files, injections, rng, count) {
  const targets = candidates(files, '.dart', rng, count, (rel) => rel.startsWith('lib/'));
  targets.forEach((rel, index) => {
    const spec = DART_POS[index % DART_POS.length](index);
    pushInjection(files, injections, rel, spec.lines, spec.offset ?? 0, {
      ruleId: 'dart/no-dynamic-or-print',
      kind: 'dart-dynamic-print',
      variant: spec.variant,
      marker: `inj_${index}`,
    });
  });
}

function injectCssImportant(files, injections, rng, count) {
  const targets = candidates(files, '.css', rng, count + 5).concat(candidates(files, '.scss', rng, 2));
  const picked = shuffle(rng, targets).slice(0, count);
  picked.forEach((rel, index) => {
    const spec = CSS_IMPORTANT[index % CSS_IMPORTANT.length](index);
    pushInjection(files, injections, rel, spec.lines, spec.offset ?? 0, {
      ruleId: 'css/no-important',
      kind: 'css-important',
      variant: spec.variant,
      marker: `.inj-important-${index}`,
    });
  });
}

function injectCssColors(files, injections, rng, count) {
  const targets = candidates(files, '.css', rng, count + 5).concat(candidates(files, '.scss', rng, 2));
  const picked = shuffle(rng, targets).slice(0, count);
  picked.forEach((rel, index) => {
    const spec = CSS_COLOR[index % CSS_COLOR.length](index);
    pushInjection(files, injections, rel, spec.lines, spec.offset ?? 0, {
      ruleId: 'css/design-drift',
      kind: 'css-design-drift',
      variant: spec.variant,
      marker: `.inj-color-${index}`,
    });
  });
}

function injectCssDuplicates(files, cssSelectors, injections, rng, count) {
  const withSelectors = [...cssSelectors.entries()]
    .filter(([rel, selectors]) => selectors.length > 0 && !isDetectorTestPath(rel))
    .sort(([a], [b]) => a.localeCompare(b));
  const picked = shuffle(rng, withSelectors).slice(0, count);
  picked.forEach(([rel, selectors], index) => {
    if (index === count - 1) {
      // Known miss: `&:hover` nested under `.theme-card` and a top-level
      // `.theme-card:hover` are the same selector, but the detector compares
      // raw header text + scope stack.
      pushInjection(files, injections, 'styles/theme.scss', ['.theme-card:hover {', '  color: var(--color-text);', '}'], 0, {
        ruleId: 'css/duplicate-selector',
        kind: 'css-duplicate-selector',
        variant: 'nested-expansion',
        marker: '.theme-card:hover',
        missReason: 'the detector compares raw selector text; it does not expand nested `&:hover`',
      });
      return;
    }
    const selector = selectors[index % selectors.length];
    pushInjection(files, injections, rel, cssBlock(selector, ['color: inherit;']), 0, {
      ruleId: 'css/duplicate-selector',
      kind: 'css-duplicate-selector',
      variant: 'repeat-top-level',
      marker: selector,
    });
  });
}

/**
 * Applies all positive injections to a copy of the generated base.
 * Returns `{ files, injections }`; the base object is never mutated.
 */
export function injectPositives(base, seed, options = {}) {
  const perRule = options.perRule ?? 15;
  const files = new Map(base.files);
  const injections = [];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  injectRust(files, injections, rng, perRule);
  injectPython(files, injections, rng, perRule);
  injectDart(files, injections, rng, perRule);
  injectCssImportant(files, injections, rng, perRule);
  injectCssColors(files, injections, rng, perRule);
  injectCssDuplicates(files, base.cssSelectors, injections, rng, perRule);
  return { files, injections };
}

export { candidates, cssBlock };
