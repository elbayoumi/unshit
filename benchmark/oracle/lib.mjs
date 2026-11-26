#!/usr/bin/env node
// Public facade for the independent, text-only oracle.
//
// Deliberately imports NOTHING from src/ or dist/. The implementation is
// split into small modules so no single file trips unshit's own size and
// complexity gates when the repository scans itself.
//
// Verdicts:
//   CONFIRMED    - name/path occurs nowhere outside its declaration/chain.
//   CONTRADICTED - a resolved import/require/reference was found (evidence
//                  carries file:line and the matching text).
//   UNSURE       - the text occurs but cannot be attributed to this finding.

export { RULES } from './rules.mjs';
export { wilson95, aggregate } from './stats.mjs';
export { buildProject, resolveSpec, reexportClosure } from './model.mjs';
export { classifyFinding } from './classify.mjs';
export { packageName } from './util.mjs';
