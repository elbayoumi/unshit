import type { Detector, DetectorContext, Finding } from '../contracts.js';

function isTestPath(relPath: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.|_test\.(rs|dart|py)$|^test_.*\.py$/i.test(relPath);
}

/**
 * Flags `.unwrap()` calls in non-test Rust code (ignoring `#[cfg(test)]` blocks).
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
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i] ?? '';
        if (/^\s*#\[cfg\(test\)\]/.test(line)) break;
        if (/^\s*\/\//.test(line)) continue;
        const idx = line.indexOf('.unwrap()');
        if (idx !== -1) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'ai',
            confidence: 0.94,
            file: file.relPath,
            span: { line: i + 1, column: idx + 1 },
            message: 'Avoid `.unwrap()` in production Rust code; use `?`, `ok_or`, or `unwrap_or_default()`.',
            evidence: line.trim().slice(0, 100),
          });
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
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i] ?? '';
        if (/^\s*\/\//.test(line)) continue;
        const dynMatch = /(?::\s*dynamic\b|\bdynamic\s+[a-zA-Z_]\w*|<dynamic>)/.exec(line);
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
            evidence: line.trim().slice(0, 100),
          });
        }
        const printMatch = /\bprint\s*\(/.exec(line);
        if (printMatch) {
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
            evidence: line.trim().slice(0, 100),
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
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i] ?? '';
        const match = /^\s*except\s*:/.exec(line);
        if (match) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: 'ai',
            confidence: 0.98,
            file: file.relPath,
            span: { line: i + 1, column: match.index + 1 },
            message: 'Bare `except:` catches SystemExit/KeyboardInterrupt; catch a specific Exception.',
            evidence: line.trim().slice(0, 100),
          });
        }
      }
    }
    return findings;
  },
};
