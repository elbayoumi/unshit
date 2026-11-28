Every CONTRADICTED finding from the first run was checked by reading both the corpus code and the relevant unshit detector. No detector source was changed in this audit. Six contradictions were found in the first run; each is classified honestly as a real detector false positive (FP), a detector limitation under the rule's literal wording, or an oracle limitation. No finding is contradicted in the current run: #1, #2 and #4–#6 were resolved by later detector fixes, #3 is no longer reported, and the five round-16 mirror artifacts were resolved by the oracle fix described below. The detector fixes were made in response to these cases on these same five corpora, so zero contradictions here is a regression result, not an estimate of precision on unseen code.

### 1. `hono` / `deps/unused-dependency` / `benchmarks/fetch/package.json:4` (`mitata`) — RESOLVED DETECTOR BUG

- Oracle evidence: `benchmarks/fetch/bench.mts:17` — `import { run, bench, measure } from 'mitata'`.
- Code reading: `benchmarks/fetch/package.json` declares `mitata` in `devDependencies`; the sibling `bench.mts` imports it. The dependency is unambiguously used by the package that declares it.
- Root cause: `src/walker.ts` defines `TS_EXTS = { .ts, .tsx, .js, .jsx, .mjs, .cjs }`. `.mts` and `.cts` are never added to `ctx.files`, so `deps.ts` (`unusedInDir` → `collectUsedNames`) cannot see the import. The same gap also hides `.mts`/`.cts` files from `ts/unused-file`, `ts/unused-export` and other import-graph rules.
- Minimal reproducer (expected: no finding; actual: `deps/unused-dependency`):

  ```text
  pkg/package.json  {"devDependencies":{"mitata":"^1"}}
  pkg/bench.mts     import { run } from 'mitata'; run();
  ```

  Scan with `node bin/unshit.js scan pkg --format json`.

- Status: resolved in round 17. `.mts` and `.cts` files are now scanned and resolved, so the import is seen and the finding is gone.

### 2. `hono` / `ts/unused-file` / `runtime-tests/workerd/index.ts` — RESOLVED DETECTOR LIMITATION

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

- Status: resolved. `src/detectors/unused-file.ts` now collects explicit relative path literals passed to calls, so this file and `adapters/cloudflare-workers/test/worker.ts` are no longer reported. Since round 17, `ts/unused-export` and `ts/unused-type-export` also stop claiming that exports of such loader-referenced files are dead. Older `results.json` files that still list these findings are stale.

### 3. `zod` / `deps/unused-dependency` / `package.json:36` (`lint-staged`) — RESOLVED DETECTOR BUG

- Oracle evidence: `package.json:56` — top-level `"lint-staged": { "packages/*/src/**/*.ts": [...], ... }` plus `.husky/pre-commit:8` — `nub exec --node lint-staged --verbose` (a dot-directory the walker skips).
- Code reading: `lint-staged` is configured in the very manifest that declares it. `src/detectors/deps.ts` checks `scriptsReference`, config *filenames* in the package directory, config texts matching `/(config|rc)/`, workflows, and `otherFileTexts` — but `otherFileTexts` explicitly filters out `package.json`, and top-level config keys are never inspected. Hence a self-contained config key is invisible.
- Minimal reproducer (expected: no finding; actual: `deps/unused-dependency` for `foo-lint`):

  ```json
  { "devDependencies": { "foo-lint": "^1" }, "foo-lint": { "files": ["*.ts"] } }
  ```

- Status: resolved. The current scan no longer reports this dependency.

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
3. `src/detectors/unused-file.ts` originally considered only the import graph, so files referenced by npm scripts, third-party loaders and tool configs were reported as unused (#2, #4–#6). Later fixes cover script/config references and explicit relative call arguments; the historical reproducer is kept above.

## Follow-up (round 14)

- Bug 2 is fixed: `deps/unused-dependency` now honours matching top-level `package.json` config keys (#3 resolved).
- Bug 3 is fixed for script, `*.config.*` and explicit relative call-argument references (#2, #4, #5 and #6 resolved, plus two fastify webpack entries that were not contradicted). A literal merely assigned to a variable is still data, not a reference.
- Bug 1 (`.mts`/`.cts` not walked) is still open, so #1 remains.
- The current rerun reports C=205, D=1, U=59 of 265 findings (see `docs/research/oracle-audit.md`). The drop from 267 is the two `ts/unused-file` findings listed as resolved above, not a change made by this audit.

## Follow-up (round 17)

- The round-16 "mirror" assumption was false. In hono, `adapters/aws-lambda/src/handler.ts` has 684 lines, `src/adapter/aws-lambda/handler.ts` has 728 lines and is marked `@deprecated`, and their imports differ (`hono/types` vs `../../types`). All imports in `adapters/aws-lambda/test/*` resolve to `../src/handler`, i.e. to the adapters copy. Imports are now attributed only to the file they resolve to; the five round-16 contradictions on `src/adapter/aws-lambda/handler.ts` returned to UNSURE. They are not counted as detector FPs. No `src/` code was changed for this fix; real detector contradictions stay contradicted.
- The other round-16 evidence changes were checked on the corpora. The `./dist/...` -> `./src/...` package-target mapping applies only to hono: `tsconfig.build.json` sets `rootDir: ./src/` and `outDir: ./dist/types/`, and all mapped source files correspond to real `exports` subpaths (for example `./dist/adapter/aws-lambda/index.js` -> `src/adapter/aws-lambda/index.ts`). zod, execa, fastify and commander.js have no such mapping; their existing direct entries are unchanged.
- The only round-16 UNSURE -> CONFIRMED move was `hono` `src/context.ts:78` `Renderer`. Its sole old evidence was `docs/MIGRATION.md:53`, the prose phrase "JSX Renderer Middleware", not code. Documentation and lockfile mentions are not executable usage, so the move stands; CONFIRMED still means "no code occurrence inside this corpus", not "safe to delete".

## Limitations of this oracle

- UNSURE is common for exported symbols that have a same-named twin in a different directory (e.g. hono has both `adapters/aws-lambda/src/*` and `src/adapter/aws-lambda/*`, but they are different files). The oracle never attributes an import from one twin to the other: only imports that resolve to the audited file (or its re-export chain) contradict it. The remaining UNSUREs include same-name collisions and symbols whose only consumers live outside the corpus (public entry points or external packages). The lower bound counts them all as false positives; the upper bound counts them all as true positives. The truth is between the two, and the bounds are conservative, not a point estimate of precision.
- `default` exports are not matched by the generic symbol search (the word "default" is too common); they are only contradicted by a resolved default import. A default export consumed solely from outside the corpus remains UNSURE.
- Text search cannot prove runtime reflection, bundler conventions, or external consumers. A CONFIRMED verdict means "no mechanical evidence inside this corpus", not "safe to delete".
- The corpora were scanned at the revisions present in `/Volumes/data/projects/unshit-bench/corpus` with default config; other revisions, configs or include/exclude settings can change both findings and verdicts.
- The oracle measures precision of emitted findings only. It says nothing about missed dead code (recall).
