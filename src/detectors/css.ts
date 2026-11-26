import type { Detector, DetectorContext, Finding } from '../contracts.js';
import {
  CSS_EXTS,
  CUSTOM_PROPERTY_DEFINITION_RE,
  HARDCODED_COLOR_RES,
  buildLineOffsets,
  isExemptImportantContext,
  lineAtOffset,
  maskColorExemptFunctions,
  maskCustomPropertyValues,
  maskNestedBlocks,
  maskUrlFunctions,
  normalizeColor,
  stripCommentsAndStringsPreserveLines,
  walkCssScopes,
} from './css-parse.js';
import { maskColorlessColorCalls } from './css-color.js';
import { expandSelectorChain } from './css-nesting.js';

export const cssNoImportantDetector: Detector = {
  id: 'css/no-important',
  category: 'css',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `!important` overrides in stylesheets (exempting [hidden], .sr-only, print, reduced-motion).',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!CSS_EXTS.has(file.ext)) continue;
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);
      const re = /!\s*important\b/gi;

      walkCssScopes(
        clean,
        () => {},
        (blockText, blockStart, scopeStack) => {
          if (isExemptImportantContext(scopeStack)) return;
          re.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = re.exec(blockText)) !== null) {
            const absOffset = blockStart + match.index;
            const lineNum = lineAtOffset(offsets, absOffset);
            const lineStart = offsets[lineNum - 1] ?? 0;
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.99,
              file: file.relPath,
              span: { line: lineNum, column: absOffset - lineStart + 1 },
              message: 'Avoid `!important`; use CSS cascade order or `@layer` instead.',
              evidence: (file.lines[lineNum - 1] ?? '').trim().slice(0, 100),
            });
          }
        },
      );
    }
    return findings;
  },
};


export const cssDesignDriftDetector: Detector = {
  id: 'css/design-drift',
  category: 'css',
  tier: 'structural',
  severity: 'info',
  description: 'Flags hardcoded colors in declarations when design tokens exist (skipping :root, token definitions, url(), and var() fallbacks).',
  detect(ctx: DetectorContext): Finding[] {
    const cssFiles = ctx.files.filter((file) => CSS_EXTS.has(file.ext));
    const tokenByColor = new Map<string, string>();
    let definitionCount = 0;

    for (const file of cssFiles) {
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const re = new RegExp(CUSTOM_PROPERTY_DEFINITION_RE);
      let match: RegExpExecArray | null;
      while ((match = re.exec(clean)) !== null) {
        definitionCount++;
        const normalized = normalizeColor(match[2] ?? '');
        if (normalized && !tokenByColor.has(normalized)) {
          tokenByColor.set(normalized, `--${match[1]}`);
        }
      }
    }
    if (definitionCount === 0) return [];

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const file of cssFiles) {
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);

      walkCssScopes(
        clean,
        () => {},
        (blockText, blockStart, scopeStack) => {
          if (scopeStack.some((entry) => entry.startsWith('RULE:') && /:root\b/i.test(entry.slice(5)))) return;

          const base = maskCustomPropertyValues(maskNestedBlocks(blockText));
          // `keepVars` retains var() contents so rgb()/rgba()/hsl()/hsla() calls
          // built only from var()/env()/calc-with-var channels are not hardcoded.
          const keepVars = maskUrlFunctions(base);
          const scannable = maskColorlessColorCalls(maskColorExemptFunctions(base), keepVars);
          for (const re of HARDCODED_COLOR_RES) {
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(scannable)) !== null) {
              const absOffset = blockStart + match.index;
              const key = `${file.relPath}:${absOffset}`;
              if (seen.has(key)) continue;
              seen.add(key);

              const color = match[0];
              const token = tokenByColor.get(normalizeColor(color));
              const hint = token ? ` (use var(${token}))` : '';
              const lineNum = lineAtOffset(offsets, absOffset);
              const lineStart = offsets[lineNum - 1] ?? 0;
              findings.push({
                ruleId: this.id,
                category: this.category,
                tier: this.tier,
                severity: this.severity,
                fixability: 'ai',
                confidence: 0.9,
                file: file.relPath,
                span: { line: lineNum, column: absOffset - lineStart + 1 },
                message: `Hardcoded color \`${color}\`${hint}.`,
                evidence: (file.lines[lineNum - 1] ?? '').trim().slice(0, 100),
              });
            }
          }
        },
      );
    }
    return findings;
  },
};

export const cssDuplicateSelectorDetector: Detector = {
  id: 'css/duplicate-selector',
  category: 'css',
  tier: 'structural',
  severity: 'info',
  description: 'Flags CSS selectors defined multiple times in the same file and at-rule scope (skipping @keyframes).',
  detect(ctx: DetectorContext): Finding[] {
    const seen = new Map<string, { file: string; line: number; selector: string }[]>();

    for (const file of ctx.files) {
      if (!CSS_EXTS.has(file.ext)) continue;
      const clean = stripCommentsAndStringsPreserveLines(file.content, file.ext === '.scss');
      const offsets = buildLineOffsets(clean);

      walkCssScopes(clean, (header, scopeStack, selectorStart) => {
        const insideKeyframes = scopeStack.some((s) => /^@(-webkit-|-moz-)?keyframes\b/i.test(s));
        if (insideKeyframes) return;
        const atRuleScopeKey = scopeStack
          .filter((s) => !s.startsWith('RULE:'))
          .join(' > ');
        if (/^(:root|:host(\(.*\))?|html|body|\*)$/i.test(header.trim())) return;
        const ancestors = scopeStack.filter((s) => s.startsWith('RULE:')).map((s) => s.slice(5));
        // Expand `&` through the whole ancestor chain; when that is not safe, keep the
        // raw header keyed by the full scope stack so unrelated nested rules never collide.
        const expanded = ancestors.length > 0 ? expandSelectorChain(ancestors, header) : [header];
        const headersToRecord = expanded ?? [`${scopeStack.join(' > ')} > ${header}`];
        const lineNum = lineAtOffset(offsets, selectorStart);
        for (const h of headersToRecord) {
          const mapKey = `${file.relPath}::${atRuleScopeKey}::${h}`;
          const list = seen.get(mapKey) ?? [];
          list.push({ file: file.relPath, line: lineNum, selector: header });
          seen.set(mapKey, list);
        }
      });
    }

    const findings: Finding[] = [];
    for (const occurrences of seen.values()) {
      if (occurrences.length < 2) continue;
      const first = occurrences[0]!;
      for (let i = 1; i < occurrences.length; i++) {
        const dup = occurrences[i]!;
        findings.push({
          ruleId: this.id,
          category: this.category,
          tier: this.tier,
          severity: this.severity,
          fixability: 'ai',
          confidence: 0.88,
          file: dup.file,
          span: { line: dup.line, column: 1 },
          message: `Duplicate CSS selector \`${dup.selector}\` (also defined at ${first.file}:${first.line}).`,
          evidence: dup.selector,
        });
      }
    }
    return findings;
  },
};
