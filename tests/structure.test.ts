import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import inferShape from '../src/core/project-shape.js';
import { runScan } from '../src/core/scanner.js';
import { computeStructureVerdict } from '../src/core/structure-verdict.js';

async function withTempRepo(files: Record<string, string>, fn: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'unshit-struct-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('structure rules detect cross-package, deep-import, shared->feature, feature-cycle, and junk-drawer with tsconfig @/ paths', async () => {
  await withTempRepo(
    {
      'package.json': '{"name":"root","private":true}',
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
      }),
      'packages/pkg-a/package.json': '{"name":"pkg-a"}',
      'packages/pkg-a/src/a.ts': "import { b } from '../../pkg-b/src/internal.js';\nexport const a = b;\n",
      'packages/pkg-b/package.json': '{"name":"pkg-b"}',
      'packages/pkg-b/src/internal.ts': 'export const b = 1;\n',
      'src/features/cart/index.ts': "export { cart } from './api.js';\n",
      'src/features/cart/api.ts': "import { chk } from '@/features/checkout/internal';\nexport const cart = chk;\n",
      'src/features/checkout/index.ts': 'export const checkout = 1;\n',
      'src/features/checkout/internal.ts': "import { cart } from '@/features/cart';\nexport const chk = cart;\n",
      'src/shared/format.ts': "import { cart } from '@/features/cart';\nexport const f = cart;\n",
      'src/utils/a.ts': 'export const u = 1;\n',
      'src/helpers/b.ts': 'export const h = 1;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const rules = new Set(scan.findings.map((f) => f.ruleId));
      assert.ok(rules.has('structure/cross-package-import'));
      assert.ok(rules.has('structure/feature-deep-import'));
      assert.ok(rules.has('structure/shared-imports-feature'));
      assert.ok(rules.has('structure/feature-cycle'));
      assert.ok(rules.has('structure/junk-drawer'));

      const verdict = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.ok(verdict.verdict === 'TANGLED' || verdict.verdict === 'NEEDS ATTENTION');
      assert.ok(verdict.graph.resolvedRatio >= 0.8);
    },
  );
});

test('structure rules produce ZERO false positives on negative fixtures (layer-first, Angular, NestJS, shadcn, Flutter, Python)', async () => {
  // 1. Layer-first React
  await withTempRepo(
    {
      'package.json': '{"name":"layer-react","dependencies":{"react":"^19.0.0"}}',
      'src/components/Button.tsx': "import { fmt } from '../utils/fmt.js';\nexport const Button = () => fmt('ok');\n",
      'src/pages/Home.tsx': "import { Button } from '../components/Button.js';\nexport const Home = () => Button();\n",
      'src/utils/fmt.ts': 'export const fmt = (s: string) => s;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
    },
  );

  // 2. Angular & shadcn ui/ (50+ flat files)
  const shadcnFiles: Record<string, string> = {
    'package.json': '{"name":"shadcn-app","dependencies":{"next":"^15.0.0"}}',
    'angular.json': '{}',
  };
  for (let i = 0; i < 35; i += 1) {
    shadcnFiles[`src/components/ui/comp-${i}.tsx`] = `export const C${i} = () => null;\n`;
  }
  shadcnFiles['src/app/page.tsx'] = "import { C0 } from '../components/ui/comp-0.js';\nexport default C0;\n";
  await withTempRepo(shadcnFiles, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
    const sv = computeStructureVerdict(
      { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
      scan.findings,
    );
    assert.equal(sv.verdict, 'HEALTHY');
    assert.ok(sv.metrics.largestFlatDir >= 35);
  });

  // 3. Flutter lib/ feature-first (no cross-feature deep leaks).
  // The entry point may reach features; lib/ is otherwise a shared bucket.
  await withTempRepo(
    {
      'pubspec.yaml': 'name: my_flutter_app\n',
      'lib/main.dart': "import 'features/auth/auth.dart';\nclass Main { final auth = Auth(); }\n",
      'lib/features/auth/auth.dart': 'class Auth {}\n',
      'lib/features/home/home.dart': "import 'package:my_flutter_app/features/auth/auth.dart';\nclass Home { final a = Auth(); }\n",
    },
    async (dir) => {
      const scan = await runScan(dir, {
        ...DEFAULT_CONFIG,
        structure: { allow: ['lib/main.dart -> lib/features/**'] },
      });
      assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.equal(sv.archetype, 'flutter');
      assert.equal(sv.verdict, 'HEALTHY');
    },
  );

  // 4. Python src/ layout
  await withTempRepo(
    {
      'pyproject.toml': '[project]\nname = "pyapp"\n',
      'src/pyapp/__init__.py': '',
      'src/pyapp/core.py': 'def run():\n    return 1\n',
      'src/pyapp/cli.py': 'from pyapp.core import run\n\nrun()\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
    },
  );

  // 5. NestJS-style modules without barrels (index.ts files)
  await withTempRepo(
    {
      'package.json': '{"name":"nest-app","dependencies":{"@nestjs/common":"^10.0.0"}}',
      'src/app.module.ts': "import { UsersModule } from './users/users.module.js';\nexport class AppModule {}\n",
      'src/users/users.module.ts': "import { UsersService } from './users.service.js';\nexport class UsersModule {}\n",
      'src/users/users.service.ts': 'export class UsersService {}\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.equal(sv.verdict, 'HEALTHY');
    },
  );
});

test('pure Rust repo returns NOT ASSESSED instead of falsely claiming HEALTHY', async () => {
  await withTempRepo(
    {
      'Cargo.toml': '[package]\nname = "rustapp"\n',
      'src/main.rs': 'mod a;\nfn main() {}\n',
      'src/a.rs': 'pub fn hi() {}\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.equal(sv.verdict, 'NOT ASSESSED');
    },
  );
});

test('CLI `unshit structure --json` returns valid verdict JSON', async () => {
  await withTempRepo(
    {
      'package.json': '{"name":"cli-test"}',
      'src/index.ts': "import { x } from './helper.js';\nexport const main = x;\n",
      'src/helper.ts': 'export const x = 42;\n',
    },
    (dir) => {
      const cliPath = resolve(import.meta.dirname, '../../bin/unshit.js');
      const out = execFileSync(process.execPath, [cliPath, 'structure', dir, '--json'], { encoding: 'utf8' });
      const parsed = JSON.parse(out) as { verdict: string; graph: { resolvedRatio: number } };
      assert.equal(parsed.verdict, 'HEALTHY');
      assert.equal(parsed.graph.resolvedRatio, 1);
    },
  );
});

test('structure.allow exempts configured shared-to-feature edges', async () => {
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    }),
    'src/features/cart/index.ts': 'export const cart = 1;\n',
    'src/shared/format.ts': "import { cart } from '@/features/cart';\nexport const f = cart;\n",
  };
  await withTempRepo(files, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.ok(scan.findings.some((f) => f.ruleId === 'structure/shared-imports-feature'));
  });
  await withTempRepo(files, async (dir) => {
    const scan = await runScan(dir, {
      ...DEFAULT_CONFIG,
      structure: { allow: ['src/shared/** -> src/features/**'] },
    });
    assert.equal(
      scan.findings.filter((f) => f.ruleId === 'structure/shared-imports-feature').length,
      0,
    );
  });
});

test('structure.featureContainers controls which directories count as features', async () => {
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    }),
    'src/areas/cart/index.ts': 'export const cart = 1;\n',
    'src/areas/cart/internal.ts': 'export const secret = 2;\n',
    'src/areas/orders/place.ts': "import { secret } from '@/areas/cart/internal';\nexport const place = secret;\n",
  };
  await withTempRepo(files, async (dir) => {
    const scan = await runScan(dir, { ...DEFAULT_CONFIG });
    assert.equal(scan.findings.filter((f) => f.ruleId === 'structure/feature-deep-import').length, 0);
  });
  await withTempRepo(files, async (dir) => {
    const scan = await runScan(dir, {
      ...DEFAULT_CONFIG,
      structure: { featureContainers: ['areas'] },
    });
    assert.ok(scan.findings.some((f) => f.ruleId === 'structure/feature-deep-import'));
  });
});

test('structure.tangleMinFiles decides whether a small cycle is a tangle', async () => {
  const files: Record<string, string> = {
    'src/plain/a.ts': "import { b } from './b.js';\nexport const a = () => b;\n",
    'src/plain/b.ts': "import { a } from './a.js';\nexport const b = () => a;\n",
  };
  for (let i = 0; i < 18; i += 1) {
    files[`src/plain/f${String(i).padStart(2, '0')}.ts`] = `export const f${i} = ${i};\n`;
  }
  const check = async (structure: { tangleMinFiles?: number } | undefined, expected: string) => {
    await withTempRepo(files, async (dir) => {
      const scan = await runScan(dir, structure ? { ...DEFAULT_CONFIG, structure } : { ...DEFAULT_CONFIG });
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.equal(sv.graph.resolvedRatio, 1);
      assert.equal(sv.metrics.cycles, 1);
      assert.equal(sv.verdict, expected);
    });
  };
  // 2/20 files in a cycle: below the default 10-file tangle threshold.
  await check(undefined, 'HEALTHY');
  await check({ tangleMinFiles: 2 }, 'TANGLED');
});

test('loadConfig rejects invalid structure config with clear errors', async () => {
  const invalid: Array<{ value: unknown; pattern: RegExp }> = [
    { value: { structure: { featureContainers: 'features' } }, pattern: /featureContainers/ },
    { value: { structure: { featureContainers: ['features', '  '] } }, pattern: /featureContainers\[1\]/ },
    { value: { structure: { allow: 'src/shared -> src/features' } }, pattern: /allow/ },
    { value: { structure: { allow: ['src/shared/**'] } }, pattern: /allow\[0\]/ },
    { value: { structure: { tangleMinFiles: 0 } }, pattern: /tangleMinFiles/ },
    { value: { structure: { tangleMinFiles: -3 } }, pattern: /tangleMinFiles/ },
  ];
  for (const { value, pattern } of invalid) {
    await withTempRepo({ 'unshit.config.json': JSON.stringify(value) }, async (dir) => {
      await assert.rejects(() => loadConfig(dir), pattern);
    });
  }
  await withTempRepo(
    {
      'unshit.config.json': JSON.stringify({
        structure: {
          featureContainers: ['areas'],
          allow: ['src/shared/** -> src/features/**'],
          tangleMinFiles: 2,
        },
      }),
    },
    async (dir) => {
      const config = await loadConfig(dir);
      assert.deepEqual(config.structure, {
        featureContainers: ['areas'],
        allow: ['src/shared/** -> src/features/**'],
        tangleMinFiles: 2,
      });
    },
  );
});

test('structure verdict is NOT ASSESSED when fewer than 80% of imports resolve', async () => {
  await withTempRepo(
    {
      'src/entry.ts': "import { ok } from './ok.js';\nimport { missing } from './missing.js';\nexport const value = ok + String(missing);\n",
      'src/ok.ts': 'export const ok = 1;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      assert.ok(sv.graph.resolvedRatio < 0.8);
      assert.equal(sv.verdict, 'NOT ASSESSED');
      assert.match(sv.reason ?? '', /resolved/);
    },
  );
});

test('CLI `unshit structure --fail-on` gates on structure findings only', async () => {
  const cliPath = resolve(import.meta.dirname, '../../bin/unshit.js');
  const run = (dir: string, args: string[]) => {
    const res = spawnSync(process.execPath, [cliPath, 'structure', dir, ...args], { encoding: 'utf8' });
    return res.status;
  };

  // Warn- and info-level structure findings.
  await withTempRepo(
    {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
      }),
      'src/features/cart/index.ts': 'export const cart = 1;\n',
      'src/features/cart/internal.ts': 'export const secret = 2;\n',
      'src/features/orders/place.ts': "import { secret } from '@/features/cart/internal';\nexport const place = secret;\n",
      'src/utils/a.ts': 'export const u = 1;\n',
      'src/helpers/b.ts': 'export const h = 1;\n',
    },
    (dir) => {
      assert.equal(run(dir, []), 0);
      assert.equal(run(dir, ['--fail-on', 'error']), 0);
      assert.equal(run(dir, ['--fail-on', 'warn']), 1);
      assert.equal(run(dir, ['--fail-on', 'info']), 1);
      assert.equal(run(dir, ['--fail-on', 'bogus']), 2);
    },
  );

  // Error-level structure finding.
  await withTempRepo(
    {
      'packages/a/package.json': '{"name":"pkg-a"}',
      'packages/a/src/a.ts': "import { b } from '../../b/src/b.js';\nexport const a = b;\n",
      'packages/b/package.json': '{"name":"pkg-b"}',
      'packages/b/src/b.ts': 'export const b = 1;\n',
    },
    (dir) => {
      assert.equal(run(dir, ['--fail-on', 'error']), 1);
    },
  );

  // A non-structure error must not fail the structure command.
  await withTempRepo(
    {
      'src/locale.ts': "export const label = lang === 'en' ? 'Hello' : 'Bye';\n",
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.ok(scan.findings.some((f) => f.ruleId === 'i18n/no-inline-ternary' && f.severity === 'error'));
      assert.equal(run(dir, ['--fail-on', 'error']), 0);
    },
  );
});

test('walker skips vendor trees, minified files, and sourcemap/minified public CSS', async () => {
  const compiledCss = `${'a{color:red}'.repeat(1800)}\n/*# sourceMappingURL=app.css.map */\n`;
  await withTempRepo(
    {
      'package.json': '{"name":"rumuze","private":true}',
      'src/main.ts': 'export const main = 1;\n',
      'vendor/jquery.min.js': 'window.jQuery = 1;\n',
      'vendor/legacy.js': 'export const legacy = 1;\n',
      'public/vendor/chart.js': 'export const chart = 1;\n',
      'a.min.css': 'a{color:red}\n',
      'public/css/app.css': compiledCss,
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.deepEqual(scan.files.map((file) => file.relPath), ['src/main.ts']);
      assert.equal(scan.findings.filter((f) => f.ruleId.startsWith('structure/')).length, 0);
    },
  );
});

test('jsconfig @/ alias resolves into resources/js and asset specifiers are not unresolved internalSpecs', async () => {
  await withTempRepo(
    {
      'package.json': '{"name":"rumuze","private":true}',
      'jsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['resources/js/*'] } },
      }),
      'resources/js/app.js': [
        "import { label } from '@/pages/label';",
        "import Foo from './Foo.vue';",
        "import logo from './logo.svg?url';",
        'export const view = { label, Foo, logo };\n',
      ].join('\n'),
      'resources/js/pages/label.js': 'export const label = "label";\n',
      'resources/js/Foo.vue': '<template><div /></template>\n',
      'resources/js/logo.svg': '<svg />\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const ctx = {
        rootDir: scan.rootDir,
        config: scan.config,
        files: scan.files,
        manifests: scan.manifests,
      };
      const graph = buildImportGraph(ctx);
      assert.deepEqual(graph.outgoingOf('resources/js/app.js'), ['resources/js/pages/label.js']);
      assert.equal(graph.stats.internalSpecs, 1);
      assert.equal(graph.stats.resolved, 1);
      assert.equal(computeStructureVerdict(ctx, scan.findings).graph.resolvedRatio, 1);
    },
  );
});

test('project shape recognizes resources/js, resources/ts, and app/javascript as source roots', async () => {
  await withTempRepo(
    {
      'resources/js/a.js': 'export const a = 1;\n',
      'resources/ts/b.ts': 'export const b = 1;\n',
      'app/javascript/c.js': 'export const c = 1;\n',
      'src/d.ts': 'export const d = 1;\n',
      'lib/e.ts': 'export const e = 1;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      const shape = inferShape({
        rootDir: scan.rootDir,
        config: scan.config,
        files: scan.files,
        manifests: scan.manifests,
      });
      assert.deepEqual(shape.sourceRoots, [
        'app/javascript',
        'lib',
        'resources/js',
        'resources/ts',
        'src',
      ]);
    },
  );
});

test('nested resources/js folders are not shared buckets, but src/components -> src/pages still leaks', async () => {
  await withTempRepo(
    {
      'package.json': '{"name":"rumuze","private":true}',
      'resources/js/Layouts/Components/a.js': "export { b } from '../../Pages/b.js';\n",
      'resources/js/Pages/b.js': 'export const b = 1;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.equal(
        scan.findings.filter((f) => f.ruleId === 'structure/shared-imports-feature').length,
        0,
      );
    },
  );

  await withTempRepo(
    {
      'package.json': '{"name":"rumuze","private":true}',
      'src/components/a.ts': "import { b } from '../pages/b.js';\nexport const a = b;\n",
      'src/pages/b.ts': 'export const b = 1;\n',
    },
    async (dir) => {
      const scan = await runScan(dir, { ...DEFAULT_CONFIG });
      assert.ok(scan.findings.some((f) =>
        f.ruleId === 'structure/shared-imports-feature' && f.file === 'src/components/a.ts'));
    },
  );
});
