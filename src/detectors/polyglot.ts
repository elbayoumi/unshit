import type { Detector, DetectorContext, Finding } from '../contracts.js';

export function isTestPath(relPath: string): boolean {
  if (/(^|\/)build\.rs$/i.test(relPath)) return true;
  if (/(^|\/)(examples|benches|bin|tool)(\/|$)/i.test(relPath)) return true;
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.|_test\.(rs|dart|py)$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/i.test(relPath);
}

/**
 * Masks comments and string literals with spaces while preserving line and column offsets.
 */
export function maskCommentsAndStrings(lang: 'rust' | 'dart' | 'python', content: string): string {
  const n = content.length;
  const out = content.split('');
  let i = 0;

  while (i < n) {
    const c = content[i] ?? '';
    const next = content[i + 1] ?? '';

    if ((lang === 'rust' || lang === 'dart') && c === '/' && next === '/') {
      while (i < n && content[i] !== '\n') {
        out[i++] = ' ';
      }
      continue;
    }
    if (lang === 'python' && c === '#') {
      while (i < n && content[i] !== '\n') {
        out[i++] = ' ';
      }
      continue;
    }
    if ((lang === 'rust' || lang === 'dart') && c === '/' && next === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      let depth = 1;
      while (i < n && depth > 0) {
        if (content[i] === '/' && content[i + 1] === '*') {
          out[i++] = ' ';
          out[i++] = ' ';
          depth++;
        } else if (content[i] === '*' && content[i + 1] === '/') {
          out[i++] = ' ';
          out[i++] = ' ';
          depth--;
        } else {
          if (content[i] !== '\n') out[i] = ' ';
          i++;
        }
      }
      continue;
    }

    if (c === '"' || c === "'") {
      if (lang === 'rust' && c === "'") {
        if (i + 2 < n && content[i + 2] === "'") {
          out[i] = out[i + 1] = out[i + 2] = ' ';
          i += 3;
          continue;
        }
        if (i + 3 < n && content[i + 1] === '\\' && content[i + 3] === "'") {
          out[i] = out[i + 1] = out[i + 2] = out[i + 3] = ' ';
          i += 4;
          continue;
        }
        i++;
        continue;
      }

      const triple = lang !== 'rust' && content[i + 1] === c && content[i + 2] === c;
      if (triple) {
        out[i] = out[i + 1] = out[i + 2] = ' ';
        i += 3;
        while (i < n) {
          if (content[i] === '\\' && i + 1 < n) {
            if (content[i] !== '\n') out[i] = ' ';
            if (content[i + 1] !== '\n') out[i + 1] = ' ';
            i += 2;
            continue;
          }
          if (content[i] === c && content[i + 1] === c && content[i + 2] === c) {
            out[i] = out[i + 1] = out[i + 2] = ' ';
            i += 3;
            break;
          }
          if (content[i] !== '\n') out[i] = ' ';
          i++;
        }
        continue;
      }

      out[i++] = ' ';
      while (i < n && content[i] !== '\n') {
        if (content[i] === '\\' && i + 1 < n) {
          out[i] = ' ';
          if (content[i + 1] !== '\n') out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (content[i] === c) {
          out[i++] = ' ';
          break;
        }
        out[i++] = ' ';
      }
      continue;
    }
    i++;
  }

  return out.join('');
}

/**
 * Flags `.unwrap()` calls in non-test Rust code, skipping `#[cfg(test)]` blocks by brace depth.
 */
export const rustNoUnwrapDetector: Detector = {
  id: 'rust/no-unwrap',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `.unwrap()` in non-test Rust code; propagate errors with `?` or `unwrap_or*`.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (file.ext !== '.rs' || isTestPath(file.relPath)) continue;
      const maskedLines = maskCommentsAndStrings('rust', file.content).split(/\r?\n/);
      let pendingCfgTest = false;
      let testDepth = 0;

      for (let i = 0; i < maskedLines.length; i++) {
        const line = maskedLines[i] ?? '';
        if (/^\s*#\[cfg\(test\)\]/.test(line)) {
          pendingCfgTest = true;
        }

        const openCount = (line.match(/\{/g) ?? []).length;
        const closeCount = (line.match(/\}/g) ?? []).length;

        if (pendingCfgTest && openCount > 0) {
          testDepth += openCount - closeCount;
          pendingCfgTest = false;
          if (testDepth <= 0) testDepth = 0;
          continue;
        }

        if (testDepth > 0) {
          testDepth += openCount - closeCount;
          if (testDepth <= 0) testDepth = 0;
          continue;
        }

        if (pendingCfgTest && /;\s*$/.test(line)) {
          pendingCfgTest = false;
          continue;
        }

        let pos = 0;
        while ((pos = line.indexOf('.unwrap()', pos)) !== -1) {
          const prefix = line.slice(0, pos);
          const allowLock = /\b(?:lock|read|write)\(\)\s*$/.test(prefix);
          const allowRegex = /Regex::new\([^)]*\)\s*$/.test(prefix);
          if (!allowLock && !allowRegex) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.94,
              file: file.relPath,
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
    for (const file of ctx.files) {
      if (file.ext !== '.dart' || isTestPath(file.relPath)) continue;
      const maskedLines = maskCommentsAndStrings('dart', file.content).split(/\r?\n/);

      for (let i = 0; i < maskedLines.length; i++) {
        const line = maskedLines[i] ?? '';
        const origLine = file.lines[i] ?? '';
        const prevOrig = i > 0 ? (file.lines[i - 1] ?? '') : '';

        const withoutJsonMap = line.replace(/\bMap\s*<\s*String\s*,\s*dynamic\s*>/g, 'Map<String, Object?>');
        const dynMatch = /(?::\s*dynamic\b|\bdynamic\s+[a-zA-Z_]\w*|<dynamic>)/.exec(withoutJsonMap);
        if (dynMatch) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'ai',
            confidence: 0.9,
            file: file.relPath,
            span: { line: i + 1, column: dynMatch.index + 1 },
            message: 'Avoid `dynamic` in Dart; use `Object?` or a concrete type.',
            evidence: origLine.trim().slice(0, 100),
          });
        }

        const ignorePrint = /\/\/\s*ignore:\s*avoid_print\b/.test(origLine) || /\/\/\s*ignore:\s*avoid_print\b/.test(prevOrig);
        const printMatch = /(?<![.\w])print\s*\(/.exec(line);
        if (printMatch && !ignorePrint) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: 'info',
            fixability: 'ai',
            confidence: 0.92,
            file: file.relPath,
            span: { line: i + 1, column: printMatch.index + 1 },
            message: 'Avoid `print()` in production Dart/Flutter code; use structured logging or `debugPrint`.',
            evidence: origLine.trim().slice(0, 100),
          });
        }
      }
    }
    return findings;
  },
};

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
    for (const file of ctx.files) {
      if (file.ext !== '.py' || isTestPath(file.relPath)) continue;
      const maskedLines = maskCommentsAndStrings('python', file.content).split(/\r?\n/);

      for (let i = 0; i < maskedLines.length; i++) {
        const line = maskedLines[i] ?? '';
        const match = /^(\s*)except\s*:/.exec(line);
        if (match) {
          const indent = match[1]?.length ?? 0;
          let endsWithRaise = false;
          for (let j = i + 1; j < maskedLines.length; j++) {
            const nextLine = maskedLines[j] ?? '';
            if (!nextLine.trim()) continue;
            const nextIndent = nextLine.match(/^(\s*)/)?.[1]?.length ?? 0;
            if (nextIndent <= indent) break;
            if (/^\s*raise\b/.test(nextLine)) endsWithRaise = true;
          }
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'ai',
            confidence: endsWithRaise ? 0.75 : 0.98,
            file: file.relPath,
            span: { line: i + 1, column: match.index + 1 },
            message: 'Bare `except:` catches SystemExit/KeyboardInterrupt; catch a specific Exception.',
            evidence: (file.lines[i] ?? line).trim().slice(0, 100),
          });
        }
      }
    }
    return findings;
  },
};
