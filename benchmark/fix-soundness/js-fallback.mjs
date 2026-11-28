import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export function walkJsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsFiles(abs));
    else if (e.isFile() && /\.(?:js|cjs|mjs)$/i.test(e.name)) out.push(abs);
  }
  return out;
}

export function syntacticJsDiagnostics(dir) {
  const rootNames = walkJsFiles(dir);
  const options = { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
  const program = ts.createProgram({ rootNames, options });
  const rootSet = new Set(rootNames);
  const diags = [];
  for (const sf of program.getSourceFiles()) {
    if (!rootSet.has(sf.fileName)) continue;
    for (const d of program.getSyntacticDiagnostics(sf)) {
      const rel = sf.fileName.startsWith(dir) ? sf.fileName.slice(dir.length + 1) : sf.fileName;
      const pos = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start) : { line: -1, character: -1 };
      diags.push({ file: rel, line: pos.line + 1, column: pos.character + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
    }
  }
  return { ok: true, mode: 'syntactic-js-fallback', diagnostics: diags, count: diags.length, fileNames: rootNames.length };
}