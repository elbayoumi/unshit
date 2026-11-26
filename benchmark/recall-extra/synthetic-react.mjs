// Deterministic seeded synthetic React/TSX corpus generator for recall-extra.
// All generated components stay below godFileMaxLines/godFileMaxHooks thresholds
// (src/config.ts: 350 lines / 15 hooks) so they are NOT god files by themselves.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

function nextInt(rng, max) { return Math.floor(rng() * max); }

export function generateProject(dir, count = 30, seed = 1) {
  const rng = makeRng(seed);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'src', 'components'), { recursive: true });

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'synthetic-react-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { react: '^18.2.0' },
  }, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { jsx: 'react-jsx', strict: true, module: 'ESNext', target: 'ES2022', moduleResolution: 'bundler', skipLibCheck: true },
  }, null, 2) + '\n', 'utf8');

  const names = [];
  for (let i = 0; i < count; i++) {
    const name = `Component${String(i).padStart(3, '0')}`;
    names.push(name);
    const targetLines = 20 + nextInt(rng, 300); // <= 319 + overhead
    const hookCount = nextInt(rng, 13); // 0..12
    const hookLines = [];
    for (let h = 0; h < hookCount; h++) {
      hookLines.push(`  const [state${h}, setState${h}] = useState(${h});`);
    }
    const effectLine = hookCount > 0 ? '  useEffect(() => { /* keep in sync */ }, []);' : '';
    const fillerCount = Math.max(0, targetLines - 12 - hookCount);
    const filler = Array.from({ length: fillerCount }, (_, k) => `  const value${k} = ${k} + props.seed;`).join('\n');
    const content = [
      "import { useState, useEffect } from 'react';",
      '',
      `export interface ${name}Props { seed: number; }`,
      '',
      `export function ${name}({ seed: propsSeed }: ${name}Props) {`,
      '  const props = { seed: propsSeed };',
      ...hookLines,
      effectLine,
      filler,
      '  return (',
      `    <div data-component="${name}">{state0 ?? props.seed}</div>`,
      '  );',
      '}',
      '',
    ].filter((l) => l !== undefined).join('\n');
    writeFileSync(join(dir, 'src', 'components', `${name}.tsx`), content, 'utf8');
  }

  const indexContent = names.map((n) => `export { ${n} } from './components/${n}.js';`).join('\n') + '\n';
  writeFileSync(join(dir, 'src', 'index.ts'), indexContent, 'utf8');

  return count;
}

