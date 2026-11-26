import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mulberry32, pickN, listSourceFiles as rawListSourceFiles, wilson95, injectLinePerFile } from '../recall/lib.mjs';

export { wilson95 } from '../recall/lib.mjs';

function listSourceFiles(work) {
  // Filter dirs excluded by default config that recall/lib.mjs does not skip.
  const excluded = /(^|\/)(fixtures|__fixtures__|\.oss-bench|research|benchmark\/frozen|\.unshit|playwright-report|vendor|storage|__pycache__|venv|\.venv|\.dart_tool|static\/lib)\//;
  return rawListSourceFiles(work).filter((f) => !excluded.test(f));
}

export const RULE_IDS = [
  'ts/no-double-cast',
  'slop/redundant-catch',
  'code/high-complexity',
  'react/god-file',
  'arch/import-cycle',
  'ts/unused-type-export',
  'deps/unlisted-dependency',
];

function appendBlock(filePath, text) {
  const prev = readFileSync(filePath, 'utf8');
  const sep = prev.endsWith('\n') ? '' : '\n';
  writeFileSync(filePath, prev + sep + text + '\n', 'utf8');
  return prev.split('\n').length + (sep ? 1 : 0);
}

function writeFileEnsured(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function tsLikeNonTest(files) {
  return files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f));
}

function tsNonTest(files) {
  return files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f));
}

function hasReactTsx(files) {
  return files.some((f) => /\.(tsx|jsx)$/.test(f));
}

// --- Positive injectors ---

export function injectNoDoubleCast(work, files, n, rand) {
  const candidates = tsNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallDoubleCast_${i}_${Math.floor(rand() * 1e6)}`;
    const line = appendBlock(join(work, file), `export const ${marker} = (0 as unknown as number); void ${marker};`);
    injections.push({ ruleId: 'ts/no-double-cast', file, line, marker, kind: 'no-double-cast' });
  }
  return injections;
}

export function injectRedundantCatch(work, files, n, rand) {
  const candidates = tsLikeNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallRedundantCatch_${i}_${Math.floor(rand() * 1e6)}`;
    const text = [
      `function ${marker}() {`,
      `  try {`,
      `    void 0;`,
      `  } catch (e) {`,
      `    throw e;`,
      `  }`,
      `}`,
    ].join('\n');
    const startLine = appendBlock(join(work, file), text);
    injections.push({ ruleId: 'slop/redundant-catch', file, line: startLine + 1, marker, kind: 'redundant-catch' });
  }
  return injections;
}

function highComplexityBody(name, branches) {
  const lines = [`export function ${name}(v: number) {`, '  let r = v;'];
  for (let i = 0; i < branches; i++) {
    lines.push(`  if (v > ${i}) { r += ${i}; }`);
  }
  lines.push('  return r;', '}');
  return lines.join('\n');
}

export function injectHighComplexity(work, files, n, rand, threshold = 25) {
  const candidates = tsLikeNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallComplex_${i}_${Math.floor(rand() * 1e6)}`;
    // threshold default 25; 26 simple ifs => score 26
    const text = highComplexityBody(marker, threshold + 1);
    const startLine = appendBlock(join(work, file), text);
    injections.push({ ruleId: 'code/high-complexity', file, line: startLine, marker, kind: 'high-complexity', score: threshold + 1 });
  }
  return injections;
}

function godFileContent(marker, mode, negative) {
  if (mode === 'hooks') {
    const nHooks = negative ? 15 : 16;
    const hookLines = Array.from({ length: nHooks }, (_, k) => `  const [s${k}, setS${k}] = useState(${k}); void s${k}; void setS${k};`).join('\n');
    return `import { useState } from 'react';\nexport function ${marker}() {\n${hookLines}\n  return <div>${marker}</div>;\n}\n`;
  }
  const nLines = negative ? 350 : 360;
  const filler = Array.from({ length: nLines }, (_, k) => `export const ${marker}_l${k} = ${k};`).join('\n');
  return negative ? filler : `${filler}\n`;
}

function injectGodFileImpl(work, n, rand, negative) {
  const dir = existsSync(join(work, 'src')) ? 'src' : '';
  const out = [];
  for (let i = 0; i < n; i++) {
    const tag = negative ? 'Neg' : '';
    const marker = `__unshitRecallGodFile${tag}_${i}_${Math.floor(rand() * 1e6)}`;
    const rel = dir ? `${dir}/${marker}.tsx` : `${marker}.tsx`;
    const mode = i % 2 === 0 ? 'hooks' : 'lines';
    writeFileEnsured(join(work, rel), godFileContent(marker, mode, negative));
    const item = { ruleId: 'react/god-file', file: rel, line: 1, marker, kind: negative ? 'react/god-file-neg' : 'react/god-file', mode };
    if (negative) item.expect = 'negative';
    out.push(item);
  }
  return out;
}

export function injectGodFile(work, files, n, rand) { return injectGodFileImpl(work, n, rand, false); }

export function injectImportCycle(work, files, n, rand) {
  const dir = existsSync(join(work, 'src')) ? 'src' : '';
  const anchorCandidates = tsLikeNonTest(files).filter((f) => !f.includes('__unshit_recall_'));
  const injections = [];
  for (let i = 0; i < n; i++) {
    const id = `${i}_${Math.floor(rand() * 1e6)}`;
    const aRel = dir ? `${dir}/__unshit_recall_cycle_a_${id}.ts` : `__unshit_recall_cycle_a_${id}.ts`;
    const bRel = dir ? `${dir}/__unshit_recall_cycle_b_${id}.ts` : `__unshit_recall_cycle_b_${id}.ts`;
    const aAbs = join(work, aRel);
    const bAbs = join(work, bRel);
    writeFileEnsured(aAbs, `import { b } from './__unshit_recall_cycle_b_${id}.js';\nexport const a = b + 1;\n`);
    writeFileEnsured(bAbs, `import { a } from './__unshit_recall_cycle_a_${id}.js';\nexport const b = a + 1;\n`);
    // Make reachable from an existing file so unused-file doesn't dominate reasoning; cycle detector doesn't need this,
    // but it's a realistic shape and keeps files "live".
    if (anchorCandidates.length > 0) {
      const anchor = anchorCandidates[i % anchorCandidates.length];
      const importLine = `import './${dir ? '' : ''}${aRel.replace(/^src\//, '')}';`;
      // Use relative path from anchor's dir.
      const anchorDir = dirname(anchor);
      const relImport = relativeImport(anchorDir, aRel);
      appendBlock(join(work, anchor), `import '${relImport}';`);
    }
    injections.push({ ruleId: 'arch/import-cycle', file: aRel, otherFile: bRel, line: 1, marker: `__unshit_recall_cycle_${id}`, kind: 'import-cycle' });
  }
  return injections;
}

function relativeImport(fromDir, toRel) {
  const fromParts = fromDir === '.' ? [] : fromDir.split('/');
  const toParts = toRel.split('/');
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const prefix = ups === 0 ? './' : '../'.repeat(ups);
  return prefix + downs.join('/');
}

export function injectUnusedTypeExport(work, files, n, rand, options = {}) {
  const skipFiles = options.skipFiles ?? null;
  const candidates = tsNonTest(files).filter((f) => !(skipFiles && skipFiles.has(f)));
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallUnusedType_${i}_${Math.floor(rand() * 1e6)}`;
    const line = appendBlock(join(work, file), `export type ${marker} = { __marker: '${marker}' };`);
    injections.push({ ruleId: 'ts/unused-type-export', file, line, marker, kind: 'unused-type-export' });
  }
  return injections;
}

export function injectUnlistedDependency(work, files, n, rand) {
  const candidates = tsLikeNonTest(files).filter((f) => !/(^|\/)(docs|fixtures|__fixtures__|examples)\//.test(f));
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `@unshit-recall/unlisted-${i}-${Math.floor(rand() * 1e6)}`;
    const line = appendBlock(join(work, file), `import '${marker}';`);
    injections.push({ ruleId: 'deps/unlisted-dependency', file, line, marker, kind: 'unlisted-dependency' });
  }
  return injections;
}

// --- Hard-negative injectors (must NOT be reported) ---

export function injectNoDoubleCastNegatives(work, files, n, rand) {
  const candidates = tsNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallDoubleCastNeg_${i}_${Math.floor(rand() * 1e6)}`;
    const variants = [
      `export const ${marker} = (0 as unknown); void ${marker};`,
      `export const ${marker} = (0 as any as number); void ${marker};`,
      `export const ${marker} = ("x" as string as unknown); void ${marker};`,
      `export const ${marker}: unknown = 0; void ${marker};`,
    ];
    const text = variants[i % variants.length];
    const line = appendBlock(join(work, file), text);
    injections.push({ ruleId: 'ts/no-double-cast', file, line, marker, kind: 'no-double-cast-neg', expect: 'negative' });
  }
  return injections;
}

export function injectRedundantCatchNegatives(work, files, n, rand) {
  const candidates = tsLikeNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallRedundantCatchNeg_${i}_${Math.floor(rand() * 1e6)}`;
    const variants = [
      [
        `function ${marker}(e: unknown) {`,
        `  try { void 0; } catch (err) {`,
        `    throw new Error(String(err));`,
        `  }`,
        `}`,
      ].join('\n'),
      [
        `function ${marker}() {`,
        `  try { void 0; } catch (e) {`,
        `    // intentionally ignored: ${marker}`,
        `  }`,
        `}`,
      ].join('\n'),
      [
        `function ${marker}() {`,
        `  try { void 0; } catch (e) {`,
        `    console.error(e);`,
        `    throw e;`,
        `  }`,
        `}`,
      ].join('\n'),
      [
        `function ${marker}() {`,
        `  try { void 0; } catch (e) {`,
        `    throw e instanceof Error ? e : new Error(String(e));`,
        `  }`,
        `}`,
      ].join('\n'),
    ];
    const text = variants[i % variants.length];
    const startLine = appendBlock(join(work, file), text);
    injections.push({ ruleId: 'slop/redundant-catch', file, line: startLine, marker, kind: 'redundant-catch-neg', expect: 'negative' });
  }
  return injections;
}

export function injectHighComplexityNegatives(work, files, n, rand, threshold = 25) {
  const candidates = tsLikeNonTest(files);
  const picked = pickN(candidates, n, rand);
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `__unshitRecallComplexNeg_${i}_${Math.floor(rand() * 1e6)}`;
    // Exactly at threshold: should not be flagged.
    const text = highComplexityBody(marker, threshold);
    const startLine = appendBlock(join(work, file), text);
    injections.push({ ruleId: 'code/high-complexity', file, line: startLine, marker, kind: 'high-complexity-neg', score: threshold, expect: 'negative' });
  }
  return injections;
}

export function injectGodFileNegatives(work, files, n, rand) { return injectGodFileImpl(work, n, rand, true); }

export function injectImportCycleNegatives(work, files, n, rand) {
  const dir = existsSync(join(work, 'src')) ? 'src' : '';
  const anchorCandidates = tsLikeNonTest(files).filter((f) => !f.includes('__unshit_recall_'));
  const injections = [];
  for (let i = 0; i < n; i++) {
    const id = `${i}_${Math.floor(rand() * 1e6)}`;
    const aRel = dir ? `${dir}/__unshit_recall_typecycle_a_${id}.ts` : `__unshit_recall_typecycle_a_${id}.ts`;
    const bRel = dir ? `${dir}/__unshit_recall_typecycle_b_${id}.ts` : `__unshit_recall_typecycle_b_${id}.ts`;
    writeFileEnsured(join(work, aRel), `import type { B } from './__unshit_recall_typecycle_b_${id}.js';\nexport type A = { b?: B };\n`);
    writeFileEnsured(join(work, bRel), `import type { A } from './__unshit_recall_typecycle_a_${id}.js';\nexport type B = { a?: A };\n`);
    if (anchorCandidates.length > 0) {
      const anchor = anchorCandidates[i % anchorCandidates.length];
      const anchorDir = dirname(anchor);
      const relImport = relativeImport(anchorDir, aRel);
      // Keep file reachable without creating a runtime cycle.
      appendBlock(join(work, anchor), `import type { A as _A${i} } from '${relImport}'; export type __unshitRecallTypeCycleKeep_${i} = _A${i};`);
    }
    injections.push({ ruleId: 'arch/import-cycle', file: aRel, otherFile: bRel, line: 1, marker: `__unshit_recall_typecycle_${id}`, kind: 'import-cycle-neg', expect: 'negative' });
  }
  return injections;
}

export function injectUnusedTypeExportNegatives(work, files, n, rand, options = {}) {
  const skipFiles = options.skipFiles ?? null;
  const candidates = tsNonTest(files).filter((f) => !(skipFiles && skipFiles.has(f)));
  const picked = pickN(candidates, Math.min(n, candidates.length), rand);
  const dir = existsSync(join(work, 'src')) ? 'src' : '';
  const injections = [];
  for (let i = 0; i < picked.length; i++) {
    const exporter = picked[i];
    const marker = `__unshitRecallUsedType_${i}_${Math.floor(rand() * 1e6)}`;
    const exportLine = appendBlock(join(work, exporter), `export type ${marker} = { __marker: '${marker}' };`);
    // Create a consumer that imports the type, so it's not unused.
    const consumerRel = dir ? `${dir}/__unshit_recall_type_consumer_${i}_${Math.floor(rand() * 1e6)}.ts` : `__unshit_recall_type_consumer_${i}_${Math.floor(rand() * 1e6)}.ts`;
    const consumerAbs = join(work, consumerRel);
    const relImport = relativeImport(dirname(consumerRel), exporter).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '.js');
    writeFileEnsured(consumerAbs, `import type { ${marker} } from '${relImport}';\nexport const use_${marker} = (x: ${marker}) => x;\n`);
    injections.push({ ruleId: 'ts/unused-type-export', file: exporter, line: exportLine, marker, kind: 'unused-type-export-neg', consumer: consumerRel, expect: 'negative' });
  }
  return injections;
}

export function injectUnlistedDependencyNegatives(work, files, n, rand) {
  const candidates = tsLikeNonTest(files).filter((f) => !/(^|\/)(docs|fixtures|__fixtures__|examples)\//.test(f));
  const picked = pickN(candidates, n, rand);
  const injections = [];
  // Add a declared fake dep so imports to it are not unlisted.
  const pkgPath = join(work, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  if (pkg) {
    pkg.devDependencies = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {};
  }
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const marker = `@unshit-recall/listed-${i}-${Math.floor(rand() * 1e6)}`;
    if (pkg) pkg.devDependencies[marker] = '1.0.0';
    const line = appendBlock(join(work, file), `import '${marker}';`);
    injections.push({ ruleId: 'deps/unlisted-dependency', file, line, marker, kind: 'unlisted-dependency-neg', expect: 'negative' });
  }
  if (pkg) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return injections;
}


export function injectEntryPointTypeExports(work, files, n, rand) {
  return injectLinePerFile(work, files, n, rand, /\.(ts|tsx|js|jsx|mjs|cjs)$/, (i, r) => {
    const marker = `__unshitRecallEntryTypeExport_${i}_${Math.floor(r() * 1e6)}`;
    return {
      text: `export type ${marker} = { __marker: '${marker}' };`,
      meta: {
        ruleId: 'ts/unused-type-export',
        reportRuleId: 'ts/unused-type-export [entry-point, out of scope]',
        marker,
        kind: 'entry-point-unused-type-export',
        outOfScope: true,
      },
    };
  });
}
