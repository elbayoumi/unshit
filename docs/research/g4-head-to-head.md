# G4 head-to-head: unshit vs knip, jscpd, dependency-cruiser, oxlint, biome

Measured on 2026-11-26. Raw tool outputs (gzipped) are stored under `docs/research/g4-raw/`. Results data: `benchmark/g4/results.json`.

## Method

For each of the five corpus projects, every tool was run **3 times** in its closest equivalent mode; the reported wall-clock time is the **median** of the 3 runs. Exit codes and raw finding counts are recorded from the final run. No precision/recall claim is made: only raw counts are reported, and overlapping categories are shown side by side. A hand-verified precision sample for `ts/unused-export`, `ts/unused-file` and `deps/unused-dependency` is reported separately in `docs/research/g4-precision-sample-3.md`.

Commands:

- unshit: `node <repo>/bin/unshit.js scan <project> --format json` (run from the project directory), after `pnpm run build`.
- knip: `knip --reporter json --no-progress` (run from the project directory).
- jscpd: `jscpd . --reporters json --output <dir> --silent --min-tokens 80 --format typescript,tsx,javascript,jsx,css,scss,rust,python,dart` (run from the project directory).
- dependency-cruiser: `depcruise . -c <tools>/dependency-cruiser/configs/recommended.cjs --output-type json` (run from the project directory).
- oxlint: `oxlint --format json .` (run from the project directory).
- biome: `biome lint . --reporter=json` (run from the project directory).

Counts:

- unshit: total findings plus per-rule counts (see `results.json`).
- knip: total item entries across `files`, `exports`, `types`, `dependencies`, `devDependencies`, `unlisted`, `unresolved`, `binaries`, `duplicates`, `enumMembers`, `namespaceMembers`, `subpaths`, `catalog`, `catalogReferences`, `optionalPeerDependencies`.
- jscpd: `clones` (and `duplicatedLines`).
- dependency-cruiser: total violations, plus `no-circular` and `no-orphans`.
- oxlint: number of diagnostics.
- biome: number of diagnostics.

## Versions

| Tool | Version |
|---|---|
| unshit | 0.7.0 (package version; node entrypoint `bin/unshit.js`) |
| Node.js | v26.7.0 |
| knip | 6.48.0 |
| jscpd | 5.4.3 |
| dependency-cruiser | 18.9.0 |
| oxlint | 1.95.0 |
| biome | 2.6.9 |

## Corpus SHAs

| Project | SHA |
|---|---|
| hono | 9c2f2948498434506f9ebc77a213bf67a2da5603 |
| execa | 6f856d55bd3ea8b3f240a7fc4502d2ac50697eec |
| zod | d40c329910436e528d3c26cb1b9179e05abebf05 |
| commander.js | a5a7dc084d4d2b7932e85ca049c5204e50a2c721 |
| fastify | f5757f12298e95210a3e35d81559961b284ad6f1 |

(Exact SHAs are in `benchmark/g4/results.json`.)

## Results

### Wall-clock (median of 3, ms) and raw finding counts

| Project | unshit ms | unshit findings | knip ms | knip findings | jscpd ms | jscpd clones | depcruise ms | depcruise violations | oxlint ms | oxlint diags | biome ms | biome diags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| hono | 706 | 642 | 340 | 273 | 80 | 699 | 1498 | 179 | 41 | 115 | 198 | 2004 |
| execa | 534 | 35 | 243 | 150 | 56 | 6 | 601 | 239 | 40 | 62 | 77 | 276 |
| zod | 803 | 1482 | 345 | 417 | 78 | 251 | 1530 | 690 | 42 | 242 | 32 | 0 |
| commander.js | 238 | 15 | 181 | 57 | 39 | 14 | 286 | 57 | 35 | 65 | 51 | 162 |
| fastify | 491 | 88 | 274 | 75 | 63 | 518 | 497 | 167 | 41 | 1346 | 467 | 5667 |

### Overlapping categories, side by side

| Project | unused exports (unshit / knip) | unused files (unshit / knip) | unused deps (unshit / knip) | unlisted deps (unshit / knip) | duplicate blocks (unshit / jscpd) | import cycles (unshit / depcruise) |
|---|---:|---:|---:|---:|---:|---:|
| hono | 54 / 52 | 3 / 173 | 3 / 15 | 0 / 0 | 23 / 699 | 4 / 7 |
| execa | 0 / 2 | 2 / 129 | 1 / 4 | 0 / 0 | 11 / 6 | 1 / 7 |
| zod | 68 / 14 | 111 / 338 | 11 / 56 | 1 / 1 | 45 / 251 | 1 / 1 |
| commander.js | 0 / 0 | 4 / 51 | 0 / 2 | 0 / 0 | 1 / 14 | 0 / 0 |
| fastify | 0 / 37 | 20 / 17 | 4 / 10 | 0 / 0 | 15 / 518 | 0 / 0 |

## Honest limitations

- The corpus has **no `node_modules`**. knip degrades (it printed config-load errors for vite/vitest/vite-plus on hono and similar) and its file/export counts reflect that. This is recorded honestly, not papered over.
- dependency-cruiser needs a TypeScript transpiler; the approved tools directory did not ship one. A symlink to this repository's own TypeScript (5.9.3) was added to `tools/node_modules/typescript` so depcruise could parse the corpus. No corpus file was modified.
- biome failed on **zod** because zod's `biome.jsonc` targets schema 1.9.4 while the installed biome is 2.6.9 (unknown keys `include`/`ignore`). zod's biome count is therefore 0 with a recorded error; the other four projects ran with their own configs.
- jscpd was restricted to the formats unshit scans (`typescript,tsx,javascript,jsx,css,scss,rust,python,dart`) at `--min-tokens 80`, matching unshit's default `cloneMinTokens`. Other jscpd defaults (e.g. full default format set) give different counts.
- Counts are not comparable one-to-one: the tools differ in scope, entry-point models, and rule sets. unshit does **not** replace a linter; oxlint/biome report style and correctness rules unshit does not attempt. Do not read these numbers as precision/recall.
- Wall-clock times are medians of 3 runs on one machine and include each tool's own caching; they are not rigorous benchmarks.
- A hand-verified precision sample (50 `ts/unused-export`, 50 `ts/unused-file`, 19 of the available 30 requested `deps/unused-dependency` findings) is reported in `docs/research/g4-precision-sample-3.md`. Only 19 `deps/unused-dependency` findings existed across the corpus, so all were verified (a census of that category). No recall claim is made.

## Raw output files (SHA-256)

All files are stored gzipped under `docs/research/g4-raw/`. Hashes are of the stored (gzipped) files.

| File | SHA-256 |
|---|---|
| `commander.js/biome.json.gz` | `a0bed932ac15375241f0d4aeef257b01b4ce28e88304c6a7654e76e3e0e4729d` |
| `commander.js/biome.stderr.txt.gz` | `299177ebe409acbe49df91605578d6a0998993846eb64bb11b38b6a31e29f10c` |
| `commander.js/depcruise.json.gz` | `8527c1d7e9d7c1c37697de3e6fbb984e21cebd7146b7ef664c9bec8d347f7937` |
| `commander.js/depcruise.stderr.txt.gz` | `4399d2b989116ec1a3f48729efcc2938349e0867e58de1cab7c6f4c14bdcc659` |
| `commander.js/jscpd-report.json.gz` | `d27cbf7c1b1c98fd45a95bc77bf1af49d68010e7b66d43ad12dd86f6d6b25dec` |
| `commander.js/jscpd.stderr.txt.gz` | `2adc1e664f13d1b9f0dad67081867576fb967d87cf59b128acc32dbc2b6e8fa4` |
| `commander.js/jscpd.stdout.txt.gz` | `26b15e2a1f1bef4ea875e72347f87d34edc52eee663a2d1cf1c965cb15405acf` |
| `commander.js/knip.json.gz` | `531d5cadaaaf334f17e75aef956b66e010dc49d5e9af144eba7072e5685fef6d` |
| `commander.js/knip.stderr.txt.gz` | `43a0281f009f07d8fb7039d47a3253fac2a0a02c605c8e1a8aff7dc0fb1595cf` |
| `commander.js/oxlint.json.gz` | `3035c937ed34cc1965899feef9462fbec3fde5cf42a099f4a976bc7b4c1de44b` |
| `commander.js/oxlint.stderr.txt.gz` | `35e437469658d0ac939d535b9c2385118675587968e80524cf6c59a93a919f64` |
| `commander.js/unshit.json.gz` | `70108adaa2a032803d1cd010fe8a8cbe8fe622017d44f5be23e87495d452023f` |
| `commander.js/unshit.stderr.txt.gz` | `c03bca1a76dcdeed442cc87f756fd9a974e6eb7f32df074ec79bd2f87626f6af` |
| `execa/biome.json.gz` | `fdb2c18527142a46bac074930394dfbbb20872452fd64e0d0e617b3ddbdd53a7` |
| `execa/biome.stderr.txt.gz` | `d2b543ab1127eca7cb7824f32438cea83b373f9961169f0ec95969b4026cc19b` |
| `execa/depcruise.json.gz` | `40ba7e88df848e2870295b0130245fd52258be2e451771c3d434459d91e24dc3` |
| `execa/depcruise.stderr.txt.gz` | `dd22a55aa40536e4c0d043e264d36f4166ccec37df154a18afb026f474a21367` |
| `execa/jscpd-report.json.gz` | `3736189cef68a19487e8abc5819224f4f2517567c70091ce847d43bfa876bbd9` |
| `execa/jscpd.stderr.txt.gz` | `2d3f0b4e91e8cf3c0b45cb065427c9e1580c6c434e7604b6c0f8aac6f49b2969` |
| `execa/jscpd.stdout.txt.gz` | `b86c3913bd7d36cc8b9854644f1227c2c5e1b20c298dd8450833ff63bb4682b7` |
| `execa/knip.json.gz` | `b35b40f1edc2164b3b4d28258d1cd08824f19ce22ef3efde57a6ecb492ead83e` |
| `execa/knip.stderr.txt.gz` | `f78f51e7f23a76f3e85087c62341721181dec5b3144c988603e61bce35d4a8a9` |
| `execa/oxlint.json.gz` | `e104942f5a340e4ca02ef1ec5c643ee7976b5b57fdeae91442d420a318b78244` |
| `execa/oxlint.stderr.txt.gz` | `86af9691c83ee8bd49fb4cf9303ca728a719d931c55a588500e739976bf0459f` |
| `execa/unshit.json.gz` | `c8993255c31c21011e217fcbef7011c07a4ffa9df07cbf2d09cea5fed1f2d36b` |
| `execa/unshit.stderr.txt.gz` | `0caa6773a92cb54f549dca1875a8a21f40811a551f1322b407c3cb1eec0aab51` |
| `fastify/biome.json.gz` | `67c9097027f5c704b42d88fa18afd55afac64dbd18a2012b18d3d99b1512a547` |
| `fastify/biome.stderr.txt.gz` | `92331f1999d9a50af02bc738b6890e540339821deaac31f9034a2361ca846985` |
| `fastify/depcruise.json.gz` | `0fb23dd006222116a6cc11ab9e5b0ecd9b1f0f62482db48e60dd143d0d56c66d` |
| `fastify/depcruise.stderr.txt.gz` | `c5f5323c6dc7bbe8ba3b83499291166654fc744efb521813a1de8e53f11e40f7` |
| `fastify/jscpd-report.json.gz` | `6150e7c65964accab2c43c1bdb6eeda1f3dadabb8b0b0cd3166f73b21fadac85` |
| `fastify/jscpd.stderr.txt.gz` | `4fbb02733db1950f23b513de9ccd5b4dd0117dd3fc505e3b913d9de5df77fc1e` |
| `fastify/jscpd.stdout.txt.gz` | `67a0037e5f02eb77a8e8afd0f7f0ee371628b29ae7bce98ccb5ea2d5e5058285` |
| `fastify/knip.json.gz` | `6c95dd9faf1e9bbeecc830757daa1286c87058a1431f1de4cb5c6386ad92b490` |
| `fastify/knip.stderr.txt.gz` | `33dbab53426b298dd93abb8279bd2b95d661075402301b79a416bada0856271c` |
| `fastify/oxlint.json.gz` | `94ac0436dd650e19b0fce2a67f834ced10ee2aadce013df85719eb06cc4e1c2a` |
| `fastify/oxlint.stderr.txt.gz` | `6dcee375340f62420fd685cefa7ca9fbaeeeb9db7815ef4bd07d4d5fe16e63e6` |
| `fastify/unshit.json.gz` | `8d9c877ad1915f3389417ee54fd311dc2d26afba03de43925f2813e63e48f0c4` |
| `fastify/unshit.stderr.txt.gz` | `4f14941d242c01706ef8c514810721efd6a21cdb0e9906f097c247700ea790bb` |
| `hono/biome.json.gz` | `e0c174c6558ce3ae5c8d09ec50b9fe4623421756b6f2c5b699f55ff3a711428a` |
| `hono/biome.stderr.txt.gz` | `b6a8098815f0169a84759befd9d098a2a248cab5b79de1016b37a0bd8aa3a7ae` |
| `hono/depcruise.json.gz` | `55f5ba60b11d94534575af1e69415799bed962e0da3dbb35ee408d3b9b54c156` |
| `hono/depcruise.stderr.txt.gz` | `8cd09f05e6b9a01b143149220d7a92e5a96106f0ffb79d787715bfe264ca017b` |
| `hono/jscpd-report.json.gz` | `fbb6024f63b61a235681e78d1c6dc6b26946fc5b72c1a79a51514bb02998b2b5` |
| `hono/jscpd.stderr.txt.gz` | `e3110285cba08d47f528cc32da442596575228095b7226412ac47ae672e71fee` |
| `hono/jscpd.stdout.txt.gz` | `47d9f6352aff461765574927a8a37c0286d6fad826b20c75d20eba7ce1b63677` |
| `hono/knip.json.gz` | `f129e356972c970c61a2798df46d879ea144c239aab44858985f8541923568a7` |
| `hono/knip.stderr.txt.gz` | `2d26bc1e0c6425ee54e962e993efedd9e4c08d8cde6497f0c41c77c67505e451` |
| `hono/oxlint.json.gz` | `99ff65c5414fb09f22571d805e181992b2db18275cf70e6751aee9adf2113bea` |
| `hono/oxlint.stderr.txt.gz` | `6513017bfc9993aaf8477e86eba6856d2d7c8944496c0564dc13c4599a79d2d9` |
| `hono/unshit.json.gz` | `b05de5c551a33ad94c89f493ed8818435d41cb9d55fc5f04d8eb22a4c912683a` |
| `hono/unshit.stderr.txt.gz` | `dde2249d7648a57867b99e286d96e89f59b9ab48bc99d96b1ab716283fd59f88` |
| `zod/biome.json.gz` | `fe8b7d006ed1631864e3da49244c98ec6841a828d28de34b91a87aacd011a91a` |
| `zod/biome.stderr.txt.gz` | `8e0dbcae59a0c3438b257ca8645b796d5a84d844dc67c94f6f4f802e397d6c5a` |
| `zod/depcruise.json.gz` | `84ab26996e8fa020e6f71b0453afe4740d2648407d03121188a608801234e1ac` |
| `zod/depcruise.stderr.txt.gz` | `4a70d60cbb8df07a77cd7fb57f212150169c8bff31073e56187f8ad9194292cc` |
| `zod/jscpd-report.json.gz` | `5e1d2c5ba0cce454385a4f6288d483f5f0add53ad9dcc0281fe7e74b9042c030` |
| `zod/jscpd.stderr.txt.gz` | `3e8b13b4531ca46cfcb3e01467472395650089ce45cc0b33a0b3177251803d6d` |
| `zod/jscpd.stdout.txt.gz` | `69e7ab5bffbcf952019d81141eecc23b7ff0ae5f46b1c8adbab3573d64b950d6` |
| `zod/knip.json.gz` | `421b15b7f6be146c4e4f5213aa7f6141431c03c607d2d249491c5cab35d4a278` |
| `zod/knip.stderr.txt.gz` | `0c4cbb7e60459989bf58af431c383df5a69396144f38d89f00de741837637bb7` |
| `zod/oxlint.json.gz` | `92171de577441cd0ee5c2d0adca6b41fcf8e1dd3ed89beba6214768389623c4b` |
| `zod/oxlint.stderr.txt.gz` | `af5d296c080b2564c5a8417a4b9d4330c2364c39980a8d51129fd9eeef3cf8bb` |
| `zod/unshit.json.gz` | `50a643fb98209f4f7d6c3fb61ad193c99c10d80fa5245f6fa1dbf852461e0d9e` |
| `zod/unshit.stderr.txt.gz` | `7ae68cf4eac4e6015f3598bc0732c36e1d2199f243b10ef007c2727b2de06188` |

## Self-score

After adding `benchmark/g4/run.mjs` and this report, `node bin/unshit.js scan . --format json` reports score 100/100 with 0 findings. `pnpm run typecheck`, `pnpm test` (210 tests), `pnpm run build`, and `node benchmark/frozen/run.mjs` (`RESULT: PASS`) all pass.