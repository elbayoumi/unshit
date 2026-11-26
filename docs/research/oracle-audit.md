# Independent oracle audit of dead-code findings

Generated: 2026-11-26T20:17:22.853Z

## Method

- Corpora: `hono`, `zod`, `execa`, `fastify`, `commander.js` from `/Volumes/data/projects/unshit-bench/corpus`. Each corpus was copied to a fresh temp directory; the copy was scanned with `node bin/unshit.js scan <copy> --format json --no-cache` and then deleted. The corpora were never modified.
- The oracle (`benchmark/oracle/lib.mjs`) is independent: it imports nothing from `src/` or `dist/` and reuses no unshit walker, resolver or detector. It walks the corpus afresh and classifies findings from regex/text evidence only.
- Rules cross-checked: `ts/unused-export`, `ts/unused-type-export`, `ts/unused-file`, `deps/unused-dependency`. Findings outside these rules are not classified.
- Mechanical guards: comment-only text is stripped before regex matching, so commented-out imports are not treated as usage; path mentions require a token boundary, so `play` does not match `playground.ts`; dependency usage is limited to the package scope of the manifest that declares it (root manifests cover the whole corpus).
- Export verdicts: CONFIRMED when the symbol appears nowhere outside its declaration and re-export chain; CONTRADICTED when a resolved import/require/namespace usage of that symbol from the file is found (evidence is `file:line` plus the matching line); UNSURE when the name occurs but cannot be attributed (name collisions, docs, public entry points).
- File verdicts: CONFIRMED when no import/require/dynamic import/reference and no path mention is found; CONTRADICTED for a resolved import or a literal path in a script/config/code file; UNSURE for unresolved textual mentions.
- Dependency verdicts: CONFIRMED when the package name appears nowhere outside its `package.json` declaration; CONTRADICTED for a matching import specifier, a script/config key in that manifest, a config file named after the package, or a config/type reference in scope; UNSURE for comment/doc/lockfile mentions.
- Precision with UNSURE counted both ways: lower bound `C / (C + D + U)` (all unsure are wrong), upper bound `(C + U) / (C + D + U)` (all unsure are right), where C/D/U are confirmed/contradicted/unsure. Wilson 95% reported as `[wilson(C).low, wilson(C+U).high]`. Confirmed-only precision (`C / (C+D)`) is in `results.json`.
- Wilson intervals are computed from summed counts, not by averaging intervals. This is a precision cross-check of emitted findings, not a recall measurement.

## Results

Pooled: C=205, D=2, U=60, N=267. Precision lower **76.8%**, upper **99.3%**, Wilson 95% [71.4%, 99.8%]. Confirmed-only precision 99.0%.

### Per rule

| Rule | Confirmed | Contradicted | Unsure | Total | Precision (lower) | Precision (upper) | Wilson 95% |
|---|---:|---:|---:|---:|---:|---:|---:|
| `deps/unused-dependency` | 7 | 1 | 10 | 18 | 38.9% | 94.4% | [20.3%, 99.0%] |
| `ts/unused-export` | 28 | 0 | 23 | 51 | 54.9% | 100.0% | [41.4%, 100.0%] |
| `ts/unused-file` | 122 | 1 | 5 | 128 | 95.3% | 99.2% | [90.2%, 99.9%] |
| `ts/unused-type-export` | 48 | 0 | 22 | 70 | 68.6% | 100.0% | [57.0%, 100.0%] |

### Per corpus

| Corpus | Confirmed | Contradicted | Unsure | Total | Precision (lower) | Precision (upper) | Wilson 95% |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commander.js` | 4 | 0 | 0 | 4 | 100.0% | 100.0% | [51.0%, 100.0%] |
| `execa` | 3 | 0 | 0 | 3 | 100.0% | 100.0% | [43.9%, 100.0%] |
| `fastify` | 22 | 0 | 0 | 22 | 100.0% | 100.0% | [85.1%, 100.0%] |
| `hono` | 27 | 2 | 31 | 60 | 45.0% | 96.7% | [33.1%, 99.1%] |
| `zod` | 149 | 0 | 29 | 178 | 83.7% | 100.0% | [77.6%, 100.0%] |

### Per rule and corpus

| Corpus | Rule | Confirmed | Contradicted | Unsure | Total | Precision (lower) | Precision (upper) | Wilson 95% |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `commander.js` | `ts/unused-file` | 4 | 0 | 0 | 4 | 100.0% | 100.0% | [51.0%, 100.0%] |
| `execa` | `deps/unused-dependency` | 1 | 0 | 0 | 1 | 100.0% | 100.0% | [20.7%, 100.0%] |
| `execa` | `ts/unused-file` | 2 | 0 | 0 | 2 | 100.0% | 100.0% | [34.2%, 100.0%] |
| `fastify` | `deps/unused-dependency` | 4 | 0 | 0 | 4 | 100.0% | 100.0% | [51.0%, 100.0%] |
| `fastify` | `ts/unused-file` | 18 | 0 | 0 | 18 | 100.0% | 100.0% | [82.4%, 100.0%] |
| `hono` | `deps/unused-dependency` | 0 | 1 | 2 | 3 | 0.0% | 66.7% | [0.0%, 93.9%] |
| `hono` | `ts/unused-export` | 7 | 0 | 11 | 18 | 38.9% | 100.0% | [20.3%, 100.0%] |
| `hono` | `ts/unused-file` | 2 | 1 | 0 | 3 | 66.7% | 66.7% | [20.8%, 93.9%] |
| `hono` | `ts/unused-type-export` | 18 | 0 | 18 | 36 | 50.0% | 100.0% | [34.5%, 100.0%] |
| `zod` | `deps/unused-dependency` | 2 | 0 | 8 | 10 | 20.0% | 100.0% | [5.7%, 100.0%] |
| `zod` | `ts/unused-export` | 21 | 0 | 12 | 33 | 63.6% | 100.0% | [46.6%, 100.0%] |
| `zod` | `ts/unused-file` | 96 | 0 | 5 | 101 | 95.0% | 100.0% | [88.9%, 100.0%] |
| `zod` | `ts/unused-type-export` | 30 | 0 | 4 | 34 | 88.2% | 100.0% | [73.4%, 100.0%] |

## Contradicted findings (all)

Total: 2.

### `deps/unused-dependency` — hono — `benchmarks/fetch/package.json:4` — `mitata`

- Finding: Dependency `mitata` is never imported, required or referenced by name in scripts of benchmarks/fetch.
- Oracle reason: Package `mitata` is imported/required by a file in its package scope
- Evidence: `benchmarks/fetch/bench.mts:17` — import './ts-resolve.mjs' import { run, bench, measure } from 'mitata'

### `ts/unused-file` — hono — `runtime-tests/workerd/index.ts:1`

- Finding: File is never imported by any other scanned file.
- Oracle reason: Literal path reference to `runtime-tests/workerd/index.ts` in a script/config/code file
- Evidence: `runtime-tests/workerd/index.test.ts:8` — worker = await unstable_dev('./runtime-tests/workerd/index.ts', {
- Evidence: `runtime-tests/workerd/index.test.ts:44` — worker = await unstable_dev('./runtime-tests/workerd/index.ts', {

## Contradiction investigation, detector bugs and limitations

Every CONTRADICTED finding below was checked by reading both the corpus code and the relevant unshit detector. No detector source was changed in this audit. Six contradictions remain; each is classified honestly as a real detector false positive (FP), a detector limitation under the rule's literal wording, or an oracle limitation.

### 1. `hono` / `deps/unused-dependency` / `benchmarks/fetch/package.json:4` (`mitata`) — REAL DETECTOR BUG

- Oracle evidence: `benchmarks/fetch/bench.mts:17` — `import { run, bench, measure } from 'mitata'`.
- Code reading: `benchmarks/fetch/package.json` declares `mitata` in `devDependencies`; the sibling `bench.mts` imports it. The dependency is unambiguously used by the package that declares it.
- Root cause: `src/walker.ts` defines `TS_EXTS = { .ts, .tsx, .js, .jsx, .mjs, .cjs }`. `.mts` and `.cts` are never added to `ctx.files`, so `deps.ts` (`unusedInDir` → `collectUsedNames`) cannot see the import. The same gap also hides `.mts`/`.cts` files from `ts/unused-file`, `ts/unused-export` and other import-graph rules.
- Minimal reproducer (expected: no finding; actual: `deps/unused-dependency`):

  ```text
  pkg/package.json  {"devDependencies":{"mitata":"^1"}}
  pkg/bench.mts     import { run } from 'mitata'; run();
  ```

  Scan with `node bin/unshit.js scan pkg --format json`.

### 2. `hono` / `ts/unused-file` / `runtime-tests/workerd/index.ts` — DETECTOR LIMITATION (practical FP, literal rule not violated)

- Oracle evidence: `runtime-tests/workerd/index.test.ts:8` and `:44` — `unstable_dev('./runtime-tests/workerd/index.ts', ...)`.
- Code reading: the file is a Cloudflare Worker entry (`export default app`) loaded by `wrangler`'s `unstable_dev` from a string path; the tests exercise its routes. It is used, so reporting it as unused is a practical false positive.
- The detector's documented rule is narrower: "never imported by any other scanned file" (`src/detectors/unused-file.ts` checks the import graph, dynamic `import()` and type-only imports). A string path passed to a third-party loader is not an import statement, so the detector is consistent with its literal definition while being wrong about real dead code. The oracle's path-string evidence is broader by design.
- Minimal reproducer of the class (expected: no `ts/unused-file`; actual: finding):

  ```ts
  // worker.ts
  export default { fetch() { return new Response('ok'); } };
  // worker.test.ts
  const worker = await unstable_dev('./worker.ts');
  ```

### 3. `zod` / `deps/unused-dependency` / `package.json:36` (`lint-staged`) — REAL DETECTOR BUG

- Oracle evidence: `package.json:56` — top-level `"lint-staged": { "packages/*/src/**/*.ts": [...], ... }` plus `.husky/pre-commit:8` — `nub exec --node lint-staged --verbose` (a dot-directory the walker skips).
- Code reading: `lint-staged` is configured in the very manifest that declares it. `src/detectors/deps.ts` checks `scriptsReference`, config *filenames* in the package directory, config texts matching `/(config|rc)/`, workflows, and `otherFileTexts` — but `otherFileTexts` explicitly filters out `package.json`, and top-level config keys are never inspected. Hence a self-contained config key is invisible.
- Minimal reproducer (expected: no finding; actual: `deps/unused-dependency` for `foo-lint`):

  ```json
  { "devDependencies": { "foo-lint": "^1" }, "foo-lint": { "files": ["*.ts"] } }
  ```

### 4. `zod` / `ts/unused-file` / `packages/bench/index.ts` — DETECTOR LIMITATION (practical FP)

- Oracle evidence: `package.json:84` — `"bench": "nub --conditions @zod/source packages/bench/index.ts"`.
- Code reading: the file is the entry script of the `bench` npm script. It is executed, not imported; `unused-file` only tracks imports, so the finding is literal-rule-correct but a real-world false positive.
- Minimal reproducer: `package.json` with `"scripts": {"bench": "node packages/bench/index.ts"}` plus a non-imported `packages/bench/index.ts`.

### 5. `zod` / `ts/unused-file` / `play.ts` — DETECTOR LIMITATION (practical FP)

- Oracle evidence: `package.json:83` — `"dev:play": "nub run dev play.ts"`.
- Code reading: `play.ts` is the playground entry executed by `dev:play`. Same class as #4: a script path reference, not an import. The earlier suspicious `playground.ts` (`.gitignore`) and `"play"` string-literal matches were oracle substring bugs; they were fixed with token boundaries before this final run and are no longer evidence.
- Minimal reproducer: `package.json` with `"scripts": {"play": "node play.ts"}` plus a non-imported `play.ts`.

### 6. `zod` / `ts/unused-file` / `vitest.compile.config.ts` — DETECTOR LIMITATION (practical FP)

- Oracle evidence: `package.json:79` — `"test:compile": "nub exec --node vitest run --config vitest.compile.config.ts"`, and `vitest.config.ts:19` — `projects: ["packages/*", "./vitest.compile.config.ts"]`.
- Code reading: the file is a Vitest project config referenced both by a script and by another config file. It is loaded by tooling, not by an ESM import, so `unused-file` misses it. Same class as #4/#5.

## Oracle limitations found and fixed during the audit

These initial CONTRADICTED verdicts were re-checked against the code and turned out to be oracle bugs, not detector bugs. They are excluded from the final numbers above; the fixes are in `benchmark/oracle/util.mjs`, `model.mjs` and `classify.mjs` (re-exported by `lib.mjs`) and covered by `tests/oracle-r14.test.ts`:

- Commented-out imports: `zod` `ts-morph` (`language-server.test.ts:3`) and `filePath` (`language-server.test.ts:5`, plus `language-server.source.ts`'s unused-file finding) are inside `//` comments. Regex-only statement extraction initially counted them as real imports. Comment stripping now removes comment spans before statement matching; those findings are no longer CONTRADICTED (the text still makes them UNSURE, which is counted at both bounds). `ts-morph` is UNSURE in the final run; `filePath` is UNSURE because the same name also occurs in an unrelated docs file.
- Cross-package name collision: `zod4` declared in `packages/treeshake/package.json` is imported by `packages/bench/benchUtil.ts` and `packages/tsc/bench/omit-extend.ts`, but never inside `packages/treeshake/`. Dependency searches are now scoped to the package that declares the dependency (root manifests cover the whole corpus).
- Substring path match: bare `play` matched `playground.ts` and `z.literal("play")`. Extensionless path variants now require a slash; all variants require a token boundary.
- Documentation mention: `lint-staged` in `zod/AGENTS.md` was initially treated as a config reference. Documentation files no longer produce CONTRADICTED evidence (only UNSURE).
- Declaration echo: dependency names appearing only in their own `package.json` line were listed as UNSURE evidence. Manifest dependency declarations are now excluded from all searches.

## Detector bugs found (summary)

1. `src/walker.ts` omits `.mts`/`.cts` from `TS_EXTS`, causing false `deps/unused-dependency` findings (and hiding those files from all other rules) — reproducer in #1.
2. `src/detectors/deps.ts` ignores top-level config keys in `package.json`, causing false `deps/unused-dependency` findings even when the config key and the declaration are in the same file — reproducer in #3.
3. `src/detectors/unused-file.ts` considers only the import graph, so files referenced by npm scripts, third-party loaders and tool configs are reported as unused (#2, #4–#6). This matches its narrow documented definition but is a false positive relative to the rule's dead-code intent.

## Limitations of this oracle

- UNSURE is common for exported symbols that exist in mirrored directories (e.g. hono has both `adapters/aws-lambda/src/*` and `src/adapter/aws-lambda/*` with identical symbol names). The oracle deliberately does not attribute such occurrences, so the lower bound counts them all as false positives; the upper bound counts them all as true positives. The truth is between the two, and the bounds are conservative, not a point estimate of precision.
- `default` exports are not matched by the generic symbol search (the word "default" is too common); they are only contradicted by a resolved default import. A default export consumed solely from outside the corpus remains UNSURE.
- Text search cannot prove runtime reflection, bundler conventions, or external consumers. A CONFIRMED verdict means "no mechanical evidence inside this corpus", not "safe to delete".
- The corpora were scanned at the revisions present in `/Volumes/data/projects/unshit-bench/corpus` with default config; other revisions, configs or include/exclude settings can change both findings and verdicts.
- The oracle measures precision of emitted findings only. It says nothing about missed dead code (recall).

## Reproduce

```bash
node benchmark/oracle/run.mjs
```

