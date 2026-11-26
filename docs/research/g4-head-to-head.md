# G4 head-to-head: unshit vs knip, jscpd, dependency-cruiser, oxlint, biome

Measured on 2026-11-26. Raw tool outputs (gzipped) are stored under `docs/research/g4-raw/`. Results data: `benchmark/g4/results.json`.

## Method

For each of the five corpus projects, every tool was run **3 times** in its closest equivalent mode; the reported wall-clock time is the **median** of the 3 runs. Exit codes and raw finding counts are recorded from the final run. No precision/recall claim is made: only raw counts are reported, and overlapping categories are shown side by side. No hand-verified sample was taken for this report.

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
| hono | 646 | 733 | 314 | 273 | 73 | 699 | 1346 | 179 | 38 | 115 | 183 | 2004 |
| execa | 550 | 472 | 214 | 150 | 50 | 6 | 557 | 239 | 40 | 62 | 73 | 276 |
| zod | 897 | 2004 | 308 | 417 | 72 | 251 | 1386 | 690 | 40 | 242 | 28 | 0 |
| commander.js | 218 | 19 | 171 | 57 | 39 | 14 | 266 | 57 | 33 | 65 | 48 | 162 |
| fastify | 467 | 91 | 263 | 75 | 62 | 518 | 462 | 167 | 38 | 1346 | 434 | 5667 |

### Overlapping categories, side by side

| Project | unused exports (unshit / knip) | unused files (unshit / knip) | unused deps (unshit / knip) | unlisted deps (unshit / knip) | duplicate blocks (unshit / jscpd) | import cycles (unshit / depcruise) |
|---|---:|---:|---:|---:|---:|---:|
| hono | 107 / 52 | 31 / 173 | 4 / 15 | 9 / 0 | 23 / 699 | 4 / 7 |
| execa | 8 / 2 | 283 / 129 | 1 / 4 | 0 / 0 | 159 / 6 | 1 / 7 |
| zod | 68 / 14 | 117 / 338 | 15 / 56 | 1 / 1 | 557 / 251 | 1 / 1 |
| commander.js | 0 / 0 | 5 / 51 | 0 / 2 | 3 / 0 | 1 / 14 | 0 / 0 |
| fastify | 0 / 37 | 20 / 17 | 6 / 10 | 0 / 0 | 15 / 518 | 1 / 0 |

## Honest limitations

- The corpus has **no `node_modules`**. knip degrades (it printed config-load errors for vite/vitest/vite-plus on hono and similar) and its file/export counts reflect that. This is recorded honestly, not papered over.
- dependency-cruiser needs a TypeScript transpiler; the approved tools directory did not ship one. A symlink to this repository's own TypeScript (5.9.3) was added to `tools/node_modules/typescript` so depcruise could parse the corpus. No corpus file was modified.
- biome failed on **zod** because zod's `biome.jsonc` targets schema 1.9.4 while the installed biome is 2.6.9 (unknown keys `include`/`ignore`). zod's biome count is therefore 0 with a recorded error; the other four projects ran with their own configs.
- jscpd was restricted to the formats unshit scans (`typescript,tsx,javascript,jsx,css,scss,rust,python,dart`) at `--min-tokens 80`, matching unshit's default `cloneMinTokens`. Other jscpd defaults (e.g. full default format set) give different counts.
- Counts are not comparable one-to-one: the tools differ in scope, entry-point models, and rule sets. unshit does **not** replace a linter; oxlint/biome report style and correctness rules unshit does not attempt. Do not read these numbers as precision/recall.
- Wall-clock times are medians of 3 runs on one machine and include each tool's own caching; they are not rigorous benchmarks.
- No hand-verified sample was taken for this report, so no precision/recall or disagreement verdicts are claimed.

## Raw output files (SHA-256)

All files are stored gzipped under `docs/research/g4-raw/`. Hashes are of the stored (gzipped) files.

| File | SHA-256 |
|---|---|
| `commander.js/biome.json.gz` | `86c2b599ea44aa4796d25b8918ac9d9f818a472059fddb3127929e1ba992c5c0` |
| `commander.js/biome.stderr.txt.gz` | `5f047514f884ad60e26f0f1dea8d0ed2a9e61599b4b990d670586d13f459f95a` |
| `commander.js/depcruise.json.gz` | `b93a545c2b1db4eb3535e638ab3b4878741de5d37f9182ce3235f056805622c1` |
| `commander.js/depcruise.stderr.txt.gz` | `653004dfc64fb022655d5906c26fd7002b986a3c2e7db30977dad9f8e5830e88` |
| `commander.js/jscpd-report.json.gz` | `07bcbbf416ec46615256c1d5bed180208ddf2305bd3ff0c85b541940b1271f2f` |
| `commander.js/jscpd.stderr.txt.gz` | `bd97f9934fa05e32e3d9b87a6e5084828474beec05d8971fb726c3a6c28b0685` |
| `commander.js/jscpd.stdout.txt.gz` | `c349a70977757895bcdac1cbb9368bed1866f59e2cd4f416d12b2d0e361e0071` |
| `commander.js/knip.json.gz` | `cac840c7ed29c8953714ab0673296e57cdf911586ef40f26467b53932590bf7f` |
| `commander.js/knip.stderr.txt.gz` | `e862449f422cb593f2e587da72be29b70a371c914a3e91b389aa5ae4f257bdd7` |
| `commander.js/oxlint.json.gz` | `a791824e4c5ff962e23ee6f7810824e92e9df7886512ec67eeb0c6abefec92dd` |
| `commander.js/oxlint.stderr.txt.gz` | `01f2a94d415459aeff4a1b5456e4105cf90af0c49c9996baab97725c5f0fcb77` |
| `commander.js/unshit.json.gz` | `4210bbf67d9e16048462721dfff797a85ba0b77e2307bbc304eb07d1c4a556af` |
| `commander.js/unshit.stderr.txt.gz` | `2222dc2eab084936d70d0abf7303d0fb07d13e48a9a9500ffc2e974bc2bed123` |
| `execa/biome.json.gz` | `bc32de3edf7656a7535722f49c8064f84d04dab087330e7b8d761d72eea453ff` |
| `execa/biome.stderr.txt.gz` | `924ef393c8e96866473159cfb83f3bd72139c1f2d0fb66b7448f5e0b1237cdd5` |
| `execa/depcruise.json.gz` | `00681b76be0ed9270a342a62ad49e6842dde8fb5bb56c09cd2e729ee49f8afd0` |
| `execa/depcruise.stderr.txt.gz` | `7294fd9c19f05fcf950f0b722621c06a431fb9e2cf83619f61c82ae4d6d9650e` |
| `execa/jscpd-report.json.gz` | `6de81cde7224f3a0aea77b2c6cc92a8fa96e9d895889549aab529603eaf0c2b6` |
| `execa/jscpd.stderr.txt.gz` | `0ea212f948d9172a97d1a64c3464109bfe928e310fc4d4e079dd39d15a12fa10` |
| `execa/jscpd.stdout.txt.gz` | `f9fef96d2ab28933526f74f993aa8ec61e0021dcb37bdef9aff964da9d261153` |
| `execa/knip.json.gz` | `831bc695514a6eb97bea87c22054da973d4e9d1d11859efa6a70ea0ebaeea672` |
| `execa/knip.stderr.txt.gz` | `e0ceaec8b81946eb70078d2ed971cedf7fee6aa27d32255522a8b97975f32970` |
| `execa/oxlint.json.gz` | `958ce6c01fc9f4dfa1d307b751ae45816169c122fdf3f21ece103b770b4ee953` |
| `execa/oxlint.stderr.txt.gz` | `87824104bf0f6e01d5463be8d0ead59c069b9f146254de17bbc0f7d22c24d634` |
| `execa/unshit.json.gz` | `0d1fc071a07b1750268014e99a9c1f769aa74c5c5deb58b6f7c0833d3a53e340` |
| `execa/unshit.stderr.txt.gz` | `b38fb9f26c378a3495fdd57058ef4caa1a1161480c66430d266ac8d9cf58dbb8` |
| `fastify/biome.json.gz` | `5033b934e5f81f51cbdd0bc7570808eb9ff0ed60661ffb805e9dd3647573f7da` |
| `fastify/biome.stderr.txt.gz` | `c85f51b02f5c5862680b045ebbdecac55d5728cb7de8775c48879e672a254ce2` |
| `fastify/depcruise.json.gz` | `294f411d18f214b03eded0532fe771400aef4be2f6190df729d5fe8029f19b5d` |
| `fastify/depcruise.stderr.txt.gz` | `6bae5ce04ed3f6996641d875ca8ed18e7df8e157ada33705c3729e9b9e1b5dcc` |
| `fastify/jscpd-report.json.gz` | `0e8e1f3940f652a66dc1883485369884bcbb040d7397c70b8ab113fa19242049` |
| `fastify/jscpd.stderr.txt.gz` | `dc86c1a1bf1c41b005c545567d76140c7fb1a510df27686c8b9dbd2d1880a82c` |
| `fastify/jscpd.stdout.txt.gz` | `d7746a814789afd932e1fb51ac18818a068dcc885b9cfcb8a0aeb55eebe2900b` |
| `fastify/knip.json.gz` | `ac24a81219cfdc4d3312c278c0946e066cb79cc7815b2098c9d3b413ac2a985f` |
| `fastify/knip.stderr.txt.gz` | `6931d939b43f82df2ddf5a7bfbd42b9b42e2e2f8685a822c18b7209593910f4a` |
| `fastify/oxlint.json.gz` | `e3f4b857db30e9a38d7c1334095f0c768288b5ecba1441d660c04fc06c30848c` |
| `fastify/oxlint.stderr.txt.gz` | `1be5c137b7299a85cff5882b88bf1a274bcf0831f0e1893f223eb8dbc1e87d5c` |
| `fastify/unshit.json.gz` | `f3b33d37ce73060762bd1be3ab47d15dab16397d30d736f255150b32731666af` |
| `fastify/unshit.stderr.txt.gz` | `d49ff8108e63d40fef65e494fb4bb5f4ea4fce48278ff56b83a4a98686a26c3b` |
| `hono/biome.json.gz` | `2a20489bd1bf4f48927c66da909a7a333acf75f21bcada2ec7986c8f1e4a8ace` |
| `hono/biome.stderr.txt.gz` | `43cd0059817764444e38d9e67d2a986c780587bc2231103b1a4d843a29cd12e7` |
| `hono/depcruise.json.gz` | `1554c8e63413c993d9f20b35c6387ee0506b1f8dc6ff1f4e3bd044d62262417a` |
| `hono/depcruise.stderr.txt.gz` | `04dc265c8f11138580df5bc25f3bee047e5e0d116a31bc765f3232048ba17247` |
| `hono/jscpd-report.json.gz` | `648f5619a16b2d45f3ccbf9470ce68dc29a78150d5ce261c7d9efb3f6258df85` |
| `hono/jscpd.stderr.txt.gz` | `ef0abbde852d025c9c5227db2f314da97c8fd81b48755b013edff03716743b87` |
| `hono/jscpd.stdout.txt.gz` | `b8bfe8ac646a651061ea5cbd27ad65bbf1238b405c8b68b99d192ea2307505ec` |
| `hono/knip.json.gz` | `06074b332c39f19cf05f41d6c7d3a1d0c7f624a022912a2ef1ebc1fb38c7ef3f` |
| `hono/knip.stderr.txt.gz` | `7fc79bd9db0dcdf64ab1081b83aad11a3a9e237cbc50aee19bcc0007d5fc7e0e` |
| `hono/oxlint.json.gz` | `826889fa591a3f1b4d97de2631c00f389805373facc8ee51ed8475b6a583a52e` |
| `hono/oxlint.stderr.txt.gz` | `ba296a3a383b74099208ade4783cd59a497189948cb515b3bde7bf4652b55721` |
| `hono/unshit.json.gz` | `867a250f49481abd7535fa99ee805b1d4e84ae3a9f8081d9c83eded34a576fe0` |
| `hono/unshit.stderr.txt.gz` | `e75423e927b0c4bde60fcd1368acaf4986acd4421d385d27106336ee5a091add` |
| `zod/biome.json.gz` | `9750eeae6a694f7702e8d90f80d314cdce753dfa73454aa0e8fa619148de4845` |
| `zod/biome.stderr.txt.gz` | `4470fd62e8d7af5d3bee414b5834d1e83ec52971b92024dc8e07b55506684f1b` |
| `zod/depcruise.json.gz` | `5f8117d611a82e37a5e75e2301ed6d17768432c1c626688bffe74799fc19efca` |
| `zod/depcruise.stderr.txt.gz` | `f13643a4e568cab387c8490f24e53591e8e7f51f3ffccf3dc938432a6a0baf12` |
| `zod/jscpd-report.json.gz` | `f6711da546826429199a620a68629b2d27bae551c7844c2b64aa186e8d6a7497` |
| `zod/jscpd.stderr.txt.gz` | `bc78d1f141498709008365c73feb7fdba1e71eabb7837325c3ea352d912f3b2d` |
| `zod/jscpd.stdout.txt.gz` | `865ba77b18ef2171cd953fa3f22b0439a603e95661edf8375717eb0349ee914b` |
| `zod/knip.json.gz` | `8e7528f3a0838fac3a3c12ed67896c1abfecb700fcc64d32ccdc3af14b4930a5` |
| `zod/knip.stderr.txt.gz` | `2a7238adfee03cf8d0cd610fa0d3c600fdee8c8d05716eef3b991704f051ef07` |
| `zod/oxlint.json.gz` | `3b4a4c20244eb86e8c41269a05476cc70f3758f84f076b8131529b5b83a7e7b4` |
| `zod/oxlint.stderr.txt.gz` | `6ffcf295727a61921ecf12f9f98c344735f1c6fe516f584329e4d323ce558ebd` |
| `zod/unshit.json.gz` | `9a8bc2563321f03e29dbad22471211d5f434f4ac4108a5f352e9f4a6562bcf1c` |
| `zod/unshit.stderr.txt.gz` | `7db14feb44e4c794b4a16b89f2805cefef077b05a4adc7b3fe8bc92db033155e` |

## Self-score

After adding `benchmark/g4/run.mjs` and this report, `node bin/unshit.js scan . --format json` reports score 100/100 with 0 findings. `pnpm run typecheck`, `pnpm test` (189 tests), `pnpm run build`, and `node benchmark/frozen/run.mjs` (`RESULT: PASS`) all pass.