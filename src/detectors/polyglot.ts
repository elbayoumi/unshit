import type { Detector, DetectorContext, FileEntry, Finding } from '../contracts.js';

function isTestPath(relPath: string): boolean {
  if (/(^|\/)build\.rs$/i.test(relPath)) return true;
  if (/(^|\/)(examples|benches|bin|tool)(\/|$)/i.test(relPath)) return true;
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.|_test\.(rs|dart|py)$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/i.test(relPath);
}

function blankKeepNewlines(out: string[], i: number, content: string): void {
  if (content[i] !== '\n') out[i] = ' ';
}

function skipLineComment(content: string, out: string[], i: number): number {
  let j = i;
  while (j < content.length && content[j] !== '\n') { out[j] = ' '; j++; }
  return j;
}

function skipBlockComment(content: string, out: string[], i: number): number {
  out[i] = ' '; out[i + 1] = ' ';
  let j = i + 2;
  let depth = 1;
  while (j < content.length && depth > 0) {
    if (content[j] === '/' && content[j + 1] === '*') { out[j] = ' '; out[j + 1] = ' '; j += 2; depth++; continue; }
    if (content[j] === '*' && content[j + 1] === '/') { out[j] = ' '; out[j + 1] = ' '; j += 2; depth--; continue; }
    blankKeepNewlines(out, j, content);
    j++;
  }
  return j;
}

function skipRustCharLiteral(content: string, out: string[], i: number): number | null {
  if (i + 2 < content.length && content[i + 2] === "'") {
    out[i] = out[i + 1] = out[i + 2] = ' ';
    return i + 3;
  }
  if (i + 3 < content.length && content[i + 1] === '\\' && content[i + 3] === "'") {
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = ' ';
    return i + 4;
  }
  return null;
}

function skipTripleQuotedString(content: string, out: string[], i: number, q: string): number {
  out[i] = out[i + 1] = out[i + 2] = ' ';
  let j = i + 3;
  while (j < content.length) {
    if (content[j] === '\\' && j + 1 < content.length) {
      blankKeepNewlines(out, j, content);
      blankKeepNewlines(out, j + 1, content);
      j += 2;
      continue;
    }
    if (content[j] === q && content[j + 1] === q && content[j + 2] === q) {
      out[j] = out[j + 1] = out[j + 2] = ' ';
      return j + 3;
    }
    blankKeepNewlines(out, j, content);
    j++;
  }
  return j;
}

function skipQuotedString(content: string, out: string[], i: number, q: string): number {
  out[i] = ' ';
  let j = i + 1;
  while (j < content.length) {
    const ch = content[j]!;
    if (ch === '\n') break;
    if (ch === '\\' && j + 1 < content.length) {
      blankKeepNewlines(out, j, content);
      blankKeepNewlines(out, j + 1, content);
      j += 2;
      continue;
    }
    out[j] = ' ';
    j++;
    if (ch === q) break;
  }
  return j;
}

function skipStringLike(lang: 'rust' | 'dart' | 'python', content: string, out: string[], i: number, c: string): number {
  if (lang === 'rust' && c === "'") {
    const next = skipRustCharLiteral(content, out, i);
    return next ?? i + 1;
  }
  if (lang !== 'rust' && content[i + 1] === c && content[i + 2] === c) {
    return skipTripleQuotedString(content, out, i, c);
  }
  return skipQuotedString(content, out, i, c);
}

/**
 * Masks comments and string literals with spaces while preserving line and column offsets.
 */
function maskCommentsAndStrings(lang: 'rust' | 'dart' | 'python', content: string): string {
  const out = content.split('');
  let i = 0;
  while (i < content.length) {
    const c = content[i] ?? '';
    const next = content[i + 1] ?? '';
    if ((lang === 'rust' || lang === 'dart') && c === '/' && next === '/') { i = skipLineComment(content, out, i); continue; }
    if (lang === 'python' && c === '#') { i = skipLineComment(content, out, i); continue; }
    if ((lang === 'rust' || lang === 'dart') && c === '/' && next === '*') { i = skipBlockComment(content, out, i); continue; }
    if (c === '"' || c === "'") { i = skipStringLike(lang, content, out, i, c); continue; }
    i++;
  }
  return out.join('');
}

interface MaskedFile {
  file: FileEntry;
  masked: string[];
}

function maskedLangFiles(ctx: DetectorContext, ext: string, lang: 'rust' | 'dart' | 'python'): MaskedFile[] {
  const out: MaskedFile[] = [];
  for (const file of ctx.files) {
    if (file.ext !== ext || isTestPath(file.relPath)) continue;
    out.push({ file, masked: maskCommentsAndStrings(lang, file.content).split(/\r?\n/) });
  }
  return out;
}

/**
 * Flags `.unwrap()` calls in non-test Rust code, skipping `#[cfg(test)]` blocks by brace depth.
 */
function updateRustTestState(state: { pending: boolean; depth: number }, line: string): boolean {
  if (/^\s*#\[cfg\(test\)\]/.test(line)) state.pending = true;
  const openCount = (line.match(/\{/g) ?? []).length;
  const closeCount = (line.match(/\}/g) ?? []).length;
  if (state.pending && openCount > 0) {
    state.depth += openCount - closeCount;
    state.pending = false;
    if (state.depth <= 0) state.depth = 0;
    return true;
  }
  if (state.depth > 0) {
    state.depth += openCount - closeCount;
    if (state.depth <= 0) state.depth = 0;
    return true;
  }
  if (state.pending && /;\s*$/.test(line)) { state.pending = false; return true; }
  return false;
}

function isAllowedRustUnwrap(prefix: string): boolean {
  return /\b(?:lock|read|write)\(\)\s*$/.test(prefix) || /Regex::new\([^)]*\)\s*$/.test(prefix);
}

export const rustNoUnwrapDetector: Detector = {
  id: 'rust/no-unwrap',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `.unwrap()` in non-test Rust code; propagate errors with `?` or `unwrap_or*`.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const { file, masked: maskedLines } of maskedLangFiles(ctx, '.rs', 'rust')) {
      const state = { pending: false, depth: 0 };
      for (let i = 0; i < maskedLines.length; i++) {
        const line = maskedLines[i] ?? '';
        if (updateRustTestState(state, line)) continue;
        let pos = 0;
        while ((pos = line.indexOf('.unwrap()', pos)) !== -1) {
          if (!isAllowedRustUnwrap(line.slice(0, pos))) {
            findings.push({
              ruleId: this.id, category: this.category, tier: this.tier, severity: this.severity,
              fixability: 'ai', confidence: 0.94, file: file.relPath,
              span: { line: i + 1, column: pos + 1 },
              message: 'Avoid `.unwrap()` in production Rust code; use `?`, `ok_or`, or `unwrap_or_default()`.',
              evidence: (file.lines[i] ?? line).trim().slice(0, 100),
            });
          }
          pos += '.unwrap()'.length;
        }
      }
    }
    return findings;
  },
};

/**
 * Flags `dynamic` types and debug `print(` calls in non-test Dart/Flutter code.
 */
export const dartHygieneDetector: Detector = {
  id: 'dart/no-dynamic-or-print',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `dynamic` type escapes and `print()` calls in non-test Dart/Flutter files.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const { file, masked: maskedLines } of maskedLangFiles(ctx, '.dart', 'dart')) {
      for (let i = 0; i < maskedLines.length; i++) {
        const line = maskedLines[i] ?? '';
        const origLine = file.lines[i] ?? '';
        const prevOrig = file.lines[i - 1] ?? '';
        const dynamicIdx = /(?::\s*dynamic\b|\bdynamic\s+[a-zA-Z_]\w*|<dynamic>)/.exec(
          line.replace(/\bMap\s*<\s*String\s*,\s*dynamic\s*>/g, 'Map<String, Object?>'),
        )?.index;
        if (dynamicIdx !== undefined) {
          findings.push({
            ruleId: this.id, category: this.category, tier: this.tier, severity: this.severity,
            fixability: 'ai', confidence: 0.9, file: file.relPath, span: { line: i + 1, column: dynamicIdx + 1 },
            message: 'Avoid `dynamic` in Dart; use `Object?` or a concrete type.',
            evidence: origLine.trim().slice(0, 100),
          });
        }
        const ignorePrint = /\/\/\s*ignore:\s*avoid_print\b/.test(origLine) || /\/\/\s*ignore:\s*avoid_print\b/.test(prevOrig);
        const printIdx = ignorePrint ? undefined : /(?<![.\w])print\s*\(/.exec(line)?.index;
        if (printIdx !== undefined) {
          findings.push({
            ruleId: this.id, category: this.category, tier: this.tier, severity: 'info',
            fixability: 'ai', confidence: 0.92, file: file.relPath, span: { line: i + 1, column: printIdx + 1 },
            message: 'Avoid `print()` in production Dart/Flutter code; use structured logging or `debugPrint`.',
            evidence: origLine.trim().slice(0, 100),
          });
        }
      }
    }
    return findings;
  },
};

function bareExceptEndsWithRaise(maskedLines: string[], start: number, indent: number): boolean {
  let endsWithRaise = false;
  for (let j = start; j < maskedLines.length; j++) {
    const nextLine = maskedLines[j] ?? '';
    if (!nextLine.trim()) continue;
    if ((nextLine.match(/^(\s*)/)?.[1]?.length ?? 0) <= indent) break;
    if (/^\s*raise\b/.test(nextLine)) endsWithRaise = true;
  }
  return endsWithRaise;
}

/**
 * Flags bare `except:` clauses in Python that swallow KeyboardInterrupt/SystemExit.
 */
export const pythonBareExceptDetector: Detector = {
  id: 'python/no-bare-except',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags bare `except:` clauses in Python; catch specific exceptions instead.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const { file, masked: maskedLines } of maskedLangFiles(ctx, '.py', 'python')) {
      for (let i = 0; i < maskedLines.length; i++) {
        const match = /^(\s*)except\s*:/.exec(maskedLines[i] ?? '');
        if (!match) continue;
        const endsWithRaise = bareExceptEndsWithRaise(maskedLines, i + 1, (match[1] ?? '').length);
        findings.push({
          ruleId: this.id, category: this.category, tier: this.tier, severity: this.severity,
          fixability: 'ai', confidence: endsWithRaise ? 0.75 : 0.98, file: file.relPath,
          span: { line: i + 1, column: match.index + 1 },
          message: 'Bare `except:` catches SystemExit/KeyboardInterrupt; catch a specific Exception.',
          evidence: (file.lines[i] ?? '').trim().slice(0, 100),
        });
      }
    }
    return findings;
  },
};
