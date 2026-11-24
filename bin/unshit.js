#!/usr/bin/env node
import { main } from '../dist/src/cli.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error('[unshit] fatal:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
