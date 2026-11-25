import ts from 'typescript';
import type { Detector, DetectorContext, FileEntry, Finding, Patch, Span } from '../contracts.js';

function spanOf(sf: ts.SourceFile, node: ts.Node): Span {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    startOffset: node.getStart(sf),
    endOffset: node.getEnd(),
  };
}

function snippet(sf: ts.SourceFile, node: ts.Node): string {
  return node.getText(sf).replace(/\s+/g, ' ').slice(0, 100);
}

export function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.|__tests__|\/tests?\//i.test(relPath);
}

function isDictionaryFile(relPath: string): boolean {
  return /(^|\/)(i18n|dictionary|translations|text-direction)(\.[cm]?[jt]sx?)?$|(^|\/)locales?\//i.test(relPath);
}

function isTimerCall(expr: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expr) && (expr.text === 'setTimeout' || expr.text === 'setInterval')) {
    return expr.text;
  }
  if (
    ts.isPropertyAccessExpression(expr)
    && ts.isIdentifier(expr.expression)
    && (expr.expression.text === 'window' || expr.expression.text === 'globalThis')
    && (expr.name.text === 'setTimeout' || expr.name.text === 'setInterval')
  ) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  return null;
}

export const noExplicitAnyDetector: Detector = {
  id: 'ts/no-explicit-any',
  category: 'types',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags explicit `any` type annotations and casts.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.sourceFile || /\.d\.ts$/.test(file.relPath) || isTestFile(file.relPath)) continue;
      const sf = file.sourceFile;
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const parent = node.parent;
          const isCatch = Boolean(
            parent && ts.isVariableDeclaration(parent) && parent.parent && ts.isCatchClause(parent.parent),
          );
          findings.push({
            ruleId: this.id,
            category: this.category,
            tier: this.tier,
            severity: this.severity,
            fixability: isCatch ? 'safe' : 'ai',
            confidence: 0.98,
            file: file.relPath,
            span: spanOf(sf, node),
            message: 'Avoid explicit `any`; use `unknown` or a concrete type.',
            evidence: parent ? snippet(sf, parent) : 'any',
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return findings;
  },
  fix(file: FileEntry, finding: Finding): Patch | null {
    if (finding.fixability !== 'safe' || finding.span.startOffset === undefined || finding.span.endOffset === undefined) {
      return null;
    }
    return {
      file: file.relPath,
      ruleId: this.id,
      description: 'Replace `any` with `unknown`',
      edits: [{ startOffset: finding.span.startOffset, endOffset: finding.span.endOffset, replacement: 'unknown' }],
    };
  },
};

export const noDoubleCastDetector: Detector = {
  id: 'ts/no-double-cast',
  category: 'types',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags `as unknown as T` double type assertions.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.sourceFile || isTestFile(file.relPath)) continue;
      const sf = file.sourceFile;
      const visit = (node: ts.Node): void => {
        if (ts.isAsExpression(node) && ts.isAsExpression(node.expression)) {
          if (node.expression.type.kind === ts.SyntaxKind.UnknownKeyword) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.96,
              file: file.relPath,
              span: spanOf(sf, node),
              message: 'Double cast `as unknown as` bypasses TypeScript type safety.',
              evidence: snippet(sf, node),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return findings;
  },
};

const I18N_COND_RE = /^(?:!?\s*(?:isAr|isArabic|isEn|isEnglish|isRtl)|(?:[a-zA-Z_$][\w$.]*\.)?(?:language|lang|locale)\s*(?:===|!==)\s*['"](?:ar|en)['"])$/;

function isUiLayoutOrToggleTernary(node: ts.ConditionalExpression, sf: ts.SourceFile): boolean {
  const whenTrue = node.whenTrue.getText(sf).trim();
  const whenFalse = node.whenFalse.getText(sf).trim();
  if (/^<Chevron|^<Arrow/.test(whenTrue) || /^<Chevron|^<Arrow/.test(whenFalse)) return true;
  if (/^['"](is-active|active|ar|en)['"]$/.test(whenTrue) && /^['"](|is-active|active|ar|en)['"]$/.test(whenFalse)) return true;
  if (/^['"][a-z]{2,3}(?:-[A-Za-z0-9]{1,8})+['"]$/.test(whenTrue) && /^['"][a-z]{2,3}(?:-[A-Za-z0-9]{1,8})+['"]$/.test(whenFalse)) return true;
  if (
    ts.isIdentifier(node.whenTrue)
    && ts.isIdentifier(node.whenFalse)
    && (
      (/(?:Ar|AR|Arabic)$/.test(whenTrue) && /(?:En|EN|English)$/.test(whenFalse))
      || (/(?:En|EN|English)$/.test(whenTrue) && /(?:Ar|AR|Arabic)$/.test(whenFalse))
    )
  ) {
    return true;
  }
  if (whenTrue === "'auto'" || whenFalse === "'auto'") return true;
  if (ts.isBinaryExpression(node.whenTrue) && ts.isBinaryExpression(node.whenFalse)) return true;
  if (
    (ts.isPropertyAccessExpression(node.whenTrue) || ts.isBinaryExpression(node.whenTrue) || ts.isCallExpression(node.whenTrue))
    && (ts.isPropertyAccessExpression(node.whenFalse) || ts.isBinaryExpression(node.whenFalse) || ts.isCallExpression(node.whenFalse))
    && /\b(left|right|top|bottom|width|height|Margin|innerWidth|rect)\b/i.test(`${whenTrue} ${whenFalse}`)
  ) {
    return true;
  }
  return false;
}

export const noInlineI18nTernaryDetector: Detector = {
  id: 'i18n/no-inline-ternary',
  category: 'i18n',
  tier: 'structural',
  severity: 'error',
  description: 'Flags inline locale/language ternaries instead of centralized i18n dictionary calls.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.sourceFile || isTestFile(file.relPath) || isDictionaryFile(file.relPath)) continue;
      const sf = file.sourceFile;
      const visit = (node: ts.Node): void => {
        if (ts.isConditionalExpression(node)) {
          const condText = node.condition.getText(sf).trim();
          if (I18N_COND_RE.test(condText) && !isUiLayoutOrToggleTernary(node, sf)) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.95,
              file: file.relPath,
              span: spanOf(sf, node),
              message: 'Inline locale ternary violates centralized dictionary invariant; use translate() or directionFor().',
              evidence: snippet(sf, node),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return findings;
  },
};

export const magicTimerDetector: Detector = {
  id: 'slop/magic-timer',
  category: 'slop',
  tier: 'structural',
  severity: 'info',
  description: 'Flags raw numeric delays in setTimeout/setInterval instead of named constants.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.sourceFile || isTestFile(file.relPath)) continue;
      const sf = file.sourceFile;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.arguments.length >= 2) {
          const fn = isTimerCall(node.expression);
          if (fn) {
            const delayArg = node.arguments[1];
            if (ts.isNumericLiteral(delayArg) && Number(delayArg.text) > 0) {
              findings.push({
                ruleId: this.id,
                category: this.category,
                tier: this.tier,
                severity: this.severity,
                fixability: 'ai',
                confidence: 0.85,
                file: file.relPath,
                span: spanOf(sf, delayArg),
                message: `Magic timer delay (${delayArg.text}ms) in ${fn}; extract a named constant with rationale.`,
                evidence: snippet(sf, node),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return findings;
  },
};

export const redundantCatchDetector: Detector = {
  id: 'slop/redundant-catch',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags AI-slop empty catch blocks or catch blocks that immediately rethrow.',
  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      if (!file.sourceFile || isTestFile(file.relPath)) continue;
      const sf = file.sourceFile;
      const visit = (node: ts.Node): void => {
        if (ts.isCatchClause(node)) {
          const stmts = node.block.statements;
          const blockText = node.block.getText(sf);
          const hasComment = /\/\/|\/\*/.test(blockText);
          if (stmts.length === 0 && !hasComment) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: 'ai',
              confidence: 0.9,
              file: file.relPath,
              span: spanOf(sf, node),
              message: 'Empty catch block silently swallows errors without explanation.',
              evidence: snippet(sf, node),
            });
          } else if (
            stmts.length === 1 &&
            ts.isThrowStatement(stmts[0]) &&
            node.variableDeclaration &&
            ts.isIdentifier(node.variableDeclaration.name) &&
            stmts[0].expression &&
            ts.isIdentifier(stmts[0].expression) &&
            stmts[0].expression.text === node.variableDeclaration.name.text
          ) {
            const tryStmt = node.parent;
            const canUnwrap = Boolean(tryStmt && ts.isTryStatement(tryStmt) && !tryStmt.finallyBlock);
            findings.push({
              ruleId: this.id,
              category: this.category,
              tier: this.tier,
              severity: this.severity,
              fixability: canUnwrap ? 'safe' : 'ai',
              confidence: 0.97,
              file: file.relPath,
              span: canUnwrap && tryStmt ? spanOf(sf, tryStmt) : spanOf(sf, node),
              message: 'Redundant catch block immediately rethrows the caught error.',
              evidence: snippet(sf, node),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return findings;
  },
  fix(file: FileEntry, finding: Finding): Patch | null {
    if (
      finding.fixability !== 'safe'
      || !file.sourceFile
      || finding.span.startOffset === undefined
      || finding.span.endOffset === undefined
    ) {
      return null;
    }
    const snippetText = file.content.slice(finding.span.startOffset, finding.span.endOffset);
    const openBrace = snippetText.indexOf('{');
    const catchIdx = snippetText.lastIndexOf('catch');
    if (openBrace === -1 || catchIdx === -1) return null;
    const closeBrace = snippetText.lastIndexOf('}', catchIdx);
    if (closeBrace <= openBrace) return null;
    const inner = snippetText.slice(openBrace + 1, closeBrace).trim();
    return {
      file: file.relPath,
      ruleId: this.id,
      description: 'Unwrap try/catch that only rethrows the caught error',
      edits: [{ startOffset: finding.span.startOffset, endOffset: finding.span.endOffset, replacement: inner }],
    };
  },
};
