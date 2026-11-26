// Deterministic synthetic TypeScript project generator for the scale benchmark.
// Always call with a directory under the OS temp dir — never inside the repo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULES_PER_FEATURE = 20;

const STATEMENT_TEMPLATES = [
  'const v@i = input + @n; total += v@i;',
  'if (input > @n) { total += @n; } else { total -= @n; }',
  'for (let k@i = 0; k@i < @n; k@i++) { total += k@i; }',
  'const list@i = [@n, @n + 1]; total += list@i.length;',
  'try { throw new Error("e@i"); } catch (err) { total += @n; }',
  'switch (input % @n) { case 0: total += @n; break; default: total -= @n; }',
  'total += input && @n;',
  'while (total < @n) { total += 1; }',
];

/** Mulberry32: small, fast, fully seeded PRNG. */
export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function nextInt(rng, max) {
  return Math.floor(rng() * max);
}

function pick(rng, items) {
  return items[nextInt(rng, items.length)];
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function moduleName(index) {
  return `module${String(index).padStart(4, '0')}`;
}

function featureName(index) {
  return `feature${pad(index)}`;
}

function fill(template, index, rng) {
  return template.replaceAll('@i', String(index)).replaceAll('@n', String(1 + nextInt(rng, 19)));
}

function renderBody(rng) {
  const lines = [];
  const count = 4 + nextInt(rng, 5);
  for (let i = 0; i < count; i += 1) {
    lines.push(`  ${fill(pick(rng, STATEMENT_TEMPLATES), i, rng)}`);
  }
  return lines.join('\n');
}

function renderModule(index, rng) {
  const name = moduleName(index);
  const feature = Math.floor(index / MODULES_PER_FEATURE);
  const previous = index > 0 ? moduleName(index - 1) : '';
  const priorFeature = feature > 0 ? moduleName((feature - 1) * MODULES_PER_FEATURE) : '';
  const lines = [];
  if (previous) lines.push(`import { helper${previous} } from './${previous}';`);
  if (priorFeature) lines.push(`import { helper${priorFeature} } from '../${featureName(feature - 1)}/index';`);
  lines.push(`export interface ${name}Options { id: number; label: string; }`);
  lines.push(`export function helper${name}(input: number): number {`);
  lines.push('  let total = input;');
  if (previous) lines.push(`  total += helper${previous}(input);`);
  if (priorFeature) lines.push(`  total += helper${priorFeature}(input);`);
  lines.push(renderBody(rng));
  lines.push('  return total;');
  lines.push('}');
  lines.push(`export class ${name}Service {`);
  lines.push(`  private readonly id = ${1 + nextInt(rng, 99)};`);
  lines.push(`  run(input: number): number { return helper${name}(input + this.id); }`);
  lines.push('}');
  lines.push(`export const ${name}Default = new ${name}Service();`);
  return `${lines.join('\n')}\n`;
}

function renderBarrel(first, last, rng) {
  const lines = [];
  for (let i = first; i <= last; i += 1) {
    const name = moduleName(i);
    lines.push(`export { helper${name}, ${name}Service, ${name}Default } from './${name}';`);
    if (rng() < 0.5) lines.push(`export type { ${name}Options } from './${name}';`);
  }
  return `${lines.join('\n')}\n`;
}

function renderIndex(features) {
  const lines = [];
  for (let i = 0; i < features; i += 1) {
    lines.push(`export * from './features/${featureName(i)}/index';`);
  }
  return `${lines.join('\n')}\n`;
}

function writeJson(dir, name, value) {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Writes a self-contained TS project with exactly `count` scanned TS files.
 * Returns the number of TS files written.
 */
export function generateProject(dir, count, seed) {
  if (!Number.isInteger(count) || count < 12) throw new Error('count must be an integer >= 12');
  const rng = makeRng(seed);
  const features = Math.ceil((count - 1) / (MODULES_PER_FEATURE + 1));
  const modules = count - 1 - features;
  if (modules > features * MODULES_PER_FEATURE) throw new Error('count cannot be represented by feature layout');

  mkdirSync(dir, { recursive: true });
  writeJson(dir, 'package.json', {
    name: 'scale-fixture',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { build: 'tsc -p tsconfig.json' },
    devDependencies: { typescript: '^5.8.0' },
  });
  writeJson(dir, 'tsconfig.json', {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
    },
    include: ['src'],
  });
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'index.ts'), renderIndex(features));

  let written = 1;
  for (let feature = 0; feature < features; feature += 1) {
    const first = feature * MODULES_PER_FEATURE;
    const last = Math.min(first + MODULES_PER_FEATURE - 1, modules - 1);
    if (last < first) break;
    const featureDir = join(dir, 'src', 'features', featureName(feature));
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'index.ts'), renderBarrel(first, last, rng));
    written += 1;
    for (let i = first; i <= last; i += 1) {
      writeFileSync(join(featureDir, `${moduleName(i)}.ts`), renderModule(i, rng));
      written += 1;
    }
  }
  return written;
}
