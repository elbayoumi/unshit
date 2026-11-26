import { createRequire } from 'node:module';
import type * as TS from 'typescript';
const _require = createRequire(import.meta.url);
let _ts: typeof TS | undefined;
const ts: typeof TS = new Proxy({} as typeof TS, { get(_, p) { const mod = _ts ??= _require('typescript') as typeof TS; return (mod as Record<PropertyKey, unknown>)[p]; } });
import type { Detector, DetectorContext, FileEntry, Finding, Patch, Span } from '../contracts.js';

type AstRule = 'ts/no-explicit-any' | 'ts/no-double-cast' | 'i18n/no-inline-ternary' | 'slop/magic-timer' | 'slop/redundant-catch';
type AstBuckets = Record<AstRule, Finding[]>;

function emptyBuckets(): AstBuckets {
  return {
    'ts/no-explicit-any': [],
    'ts/no-double-cast': [],
    'i18n/no-inline-ternary': [],
    'slop/magic-timer': [],
    'slop/redundant-catch': [],
  };
}

function spanOf(sf: TS.SourceFile, node: TS.Node): Span {
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

function snippet(sf: TS.SourceFile, node: TS.Node): string {
  return node.getText(sf).replace(/\s+/g, ' ').slice(0, 100);
}

export function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.|__tests__|\/tests?\//i.test(relPath);
}

function isDictionaryFile(relPath: string): boolean {
  return /(^|\/)(i18n|dictionary|translations|text-direction)(\.[cm]?[jt]sx?)?$|(^|\/)locales?\//i.test(relPath);
}

function isTimerCall(expr: TS.LeftHandSideExpression): string | null {
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

function checkAny(file: FileEntry, sf: TS.SourceFile, node: TS.Node, out: Finding[]): void {
  if (node.kind !== ts.SyntaxKind.AnyKeyword) return;
  const parent = node.parent;
  const isCatch = Boolean(parent && ts.isVariableDeclaration(parent) && parent.parent && ts.isCatchClause(parent.parent));
  out.push({
    ruleId: 'ts/no-explicit-any',
    category: 'types',
    tier: 'structural',
    severity: 'warn',
    fixability: isCatch ? 'safe' : 'ai',
    confidence: 0.98,
    file: file.relPath,
    span: spanOf(sf, node),
    message: 'Avoid explicit `any`; use `unknown` or a concrete type.',
    evidence: parent ? snippet(sf, parent) : 'any',
  });
}

function checkDoubleCast(file: FileEntry, sf: TS.SourceFile, node: TS.Node, out: Finding[]): void {
  if (!ts.isAsExpression(node) || !ts.isAsExpression(node.expression)) return;
  if (node.expression.type.kind !== ts.SyntaxKind.UnknownKeyword) return;
  out.push({
    ruleId: 'ts/no-double-cast',
    category: 'types',
    tier: 'structural',
    severity: 'warn',
    fixability: 'ai',
    confidence: 0.96,
    file: file.relPath,
    span: spanOf(sf, node),
    message: 'Double cast `as unknown as` bypasses TypeScript type safety.',
    evidence: snippet(sf, node),
  });
}

const I18N_COND_RE = /^(?:!?\s*(?:isAr|isArabic|isEn|isEnglish|isRtl)|(?:[a-zA-Z_$][\w$.]*\.)?(?:language|lang|locale)\s*(?:===|!==)\s*['"](?:ar|en)['"])$/;

function isUiLayoutOrToggleTernary(node: TS.ConditionalExpression, sf: TS.SourceFile): boolean {
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

function checkI18n(file: FileEntry, sf: TS.SourceFile, node: TS.Node, out: Finding[]): void {
  if (!ts.isConditionalExpression(node)) return;
  const condText = node.condition.getText(sf).trim();
  if (!I18N_COND_RE.test(condText) || isUiLayoutOrToggleTernary(node, sf)) return;
  out.push({
    ruleId: 'i18n/no-inline-ternary',
    category: 'i18n',
    tier: 'structural',
    severity: 'error',
    fixability: 'ai',
    confidence: 0.95,
    file: file.relPath,
    span: spanOf(sf, node),
    message: 'Inline locale ternary violates centralized dictionary invariant; use translate() or directionFor().',
    evidence: snippet(sf, node),
  });
}

function checkTimer(file: FileEntry, sf: TS.SourceFile, node: TS.Node, out: Finding[]): void {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) return;
  const fn = isTimerCall(node.expression);
  if (!fn) return;
  const delayArg = node.arguments[1];
  if (!ts.isNumericLiteral(delayArg) || !(Number(delayArg.text) > 0)) return;
  out.push({
    ruleId: 'slop/magic-timer',
    category: 'slop',
    tier: 'structural',
    severity: 'info',
    fixability: 'safe',
    confidence: 0.85,
    file: file.relPath,
    span: spanOf(sf, delayArg),
    message: `Magic timer delay (${delayArg.text}ms) in ${fn}; extract a named constant with rationale.`,
    evidence: snippet(sf, node),
  });
}

function checkCatch(file: FileEntry, sf: TS.SourceFile, node: TS.Node, out: Finding[]): void {
  if (!ts.isCatchClause(node)) return;
  const stmts = node.block.statements;
  const hasComment = /\/\/|\/\*/.test(node.block.getText(sf));
  if (stmts.length === 0 && !hasComment) {
    out.push({
      ruleId: 'slop/redundant-catch',
      category: 'slop',
      tier: 'structural',
      severity: 'warn',
      fixability: 'ai',
      confidence: 0.9,
      file: file.relPath,
      span: spanOf(sf, node),
      message: 'Empty catch block silently swallows errors without explanation.',
      evidence: snippet(sf, node),
    });
    return;
  }
  if (
    stmts.length !== 1
    || !ts.isThrowStatement(stmts[0])
    || !node.variableDeclaration
    || !ts.isIdentifier(node.variableDeclaration.name)
    || !stmts[0].expression
    || !ts.isIdentifier(stmts[0].expression)
    || stmts[0].expression.text !== node.variableDeclaration.name.text
  ) {
    return;
  }
  const tryStmt = node.parent;
  const canUnwrap = Boolean(tryStmt && ts.isTryStatement(tryStmt) && !tryStmt.finallyBlock);
  out.push({
    ruleId: 'slop/redundant-catch',
    category: 'slop',
    tier: 'structural',
    severity: 'warn',
    fixability: canUnwrap ? 'safe' : 'ai',
    confidence: 0.97,
    file: file.relPath,
    span: canUnwrap && tryStmt ? spanOf(sf, tryStmt) : spanOf(sf, node),
    message: 'Redundant catch block immediately rethrows the caught error.',
    evidence: snippet(sf, node),
  });
}

const astCache = new WeakMap<TS.SourceFile, AstBuckets>();

function bucketsFor(file: FileEntry, sf: TS.SourceFile): AstBuckets {
  const cached = astCache.get(sf);
  if (cached) return cached;
  const out = emptyBuckets();
  if (!isTestFile(file.relPath)) {
    const visit = (node: TS.Node): void => {
      checkAny(file, sf, node, out['ts/no-explicit-any']);
      checkDoubleCast(file, sf, node, out['ts/no-double-cast']);
      checkI18n(file, sf, node, out['i18n/no-inline-ternary']);
      checkTimer(file, sf, node, out['slop/magic-timer']);
      checkCatch(file, sf, node, out['slop/redundant-catch']);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (/\.d\.ts$/.test(file.relPath)) out['ts/no-explicit-any'] = [];
    if (isDictionaryFile(file.relPath)) out['i18n/no-inline-ternary'] = [];
  }
  astCache.set(sf, out);
  return out;
}

function findingsFor(ctx: DetectorContext, rule: AstRule): Finding[] {
  const out: Finding[] = [];
  for (const file of ctx.files) {
    if (!file.sourceFile) continue;
    out.push(...bucketsFor(file, file.sourceFile)[rule]);
  }
  return out;
}

export const noExplicitAnyDetector: Detector = {
  id: 'ts/no-explicit-any',
  category: 'types',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags explicit `any` type annotations and casts.',
  detect(ctx: DetectorContext): Finding[] {
    return findingsFor(ctx, 'ts/no-explicit-any');
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
    return findingsFor(ctx, 'ts/no-double-cast');
  },
};

export const noInlineI18nTernaryDetector: Detector = {
  id: 'i18n/no-inline-ternary',
  category: 'i18n',
  tier: 'structural',
  severity: 'error',
  description: 'Flags inline locale/language ternaries instead of centralized i18n dictionary calls.',
  detect(ctx: DetectorContext): Finding[] {
    return findingsFor(ctx, 'i18n/no-inline-ternary');
  },
};

export const magicTimerDetector: Detector = {
  id: 'slop/magic-timer',
  category: 'slop',
  tier: 'structural',
  severity: 'info',
  description: 'Flags raw numeric delays in setTimeout/setInterval instead of named constants.',
  detect(ctx: DetectorContext): Finding[] {
    return findingsFor(ctx, 'slop/magic-timer');
  },
};

export const redundantCatchDetector: Detector = {
  id: 'slop/redundant-catch',
  category: 'slop',
  tier: 'structural',
  severity: 'warn',
  description: 'Flags AI-slop empty catch blocks or catch blocks that immediately rethrow.',
  detect(ctx: DetectorContext): Finding[] {
    return findingsFor(ctx, 'slop/redundant-catch');
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
