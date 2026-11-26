#!/usr/bin/env node
import { enableCompileCache } from 'node:module';

try {
  enableCompileCache();
} catch {
  /* Node < 22.8 or unsupported environment; ignore. */
}

const { main } = await import('../dist/src/cli.js');

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('[unshit] fatal:', err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  },
);
