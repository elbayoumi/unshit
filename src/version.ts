import { readFileSync } from 'node:fs';

// package.json is the single source of truth. This file compiles to dist/src/version.js.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

export const VERSION: string = pkg.version;
