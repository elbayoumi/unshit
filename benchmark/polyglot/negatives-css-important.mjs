// CSS hard negatives for css/no-important.

import { pushInjection, ruleBlock } from './lib.mjs';

export const CSS_IMPORTANT_NEG = [
  {
    variant: 'block-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/base.css', [
        `/* use !important sparingly (neg ${i}) */`,
      ], 0, { ruleId: 'css/no-important', kind: 'css-important', variant: 'block-comment', marker: `neg_css_comment_${i}` });
    },
  },
  {
    variant: 'string-value',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/tooltips.css', ruleBlock(`.neg-string-${i}`, ['content: "!important";']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'string-value', marker: `neg_string_${i}`,
      });
    },
  },
  {
    variant: 'media-print',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/print.css', [
        '@media print {',
        `  .neg-print-${i} {`,
        '    display: none !important;',
        '  }',
        '}',
      ], 2, { ruleId: 'css/no-important', kind: 'css-important', variant: 'media-print', marker: `neg_print_${i}` });
    },
  },
  {
    variant: 'reduced-motion',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/motion.css', [
        '@media (prefers-reduced-motion: reduce) {',
        `  .neg-motion-${i} {`,
        '    animation: none !important;',
        '  }',
        '}',
      ], 2, { ruleId: 'css/no-important', kind: 'css-important', variant: 'reduced-motion', marker: `neg_motion_${i}` });
    },
  },
  {
    variant: 'hidden-attribute',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/modals.css', ruleBlock('[hidden]', ['display: none !important;']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'hidden-attribute', marker: `neg_hidden_${i}`,
      });
    },
  },
  {
    variant: 'sr-only',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/accessibility.css', ruleBlock('.sr-only', ['width: 1px !important;']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'sr-only', marker: `neg_sr_${i}`,
      });
    },
  },
  {
    variant: 'visually-hidden',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/accessibility.css', ruleBlock('.visually-hidden', ['clip-path: inset(50%) !important;']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'visually-hidden', marker: `neg_vh_${i}`,
      });
    },
  },
  {
    variant: 'scss-line-comment',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/theme.scss', [
        `// legacy: !important removed (neg ${i})`,
      ], 0, { ruleId: 'css/no-important', kind: 'css-important', variant: 'scss-line-comment', marker: `neg_scss_comment_${i}` });
    },
  },
  {
    variant: 'no-bang',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/utilities.css', ruleBlock(`.neg-important-word-${i}`, ['font-weight: important;']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'no-bang', marker: `neg_word_${i}`,
      });
    },
  },
  {
    variant: 'string-not-important',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/tooltips.css', ruleBlock(`.neg-not-${i}`, ['content: "not !important";']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'string-not-important', marker: `neg_not_${i}`,
      });
    },
  },
  {
    variant: 'sr-only-focusable',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/accessibility.css', ruleBlock('.sr-only-focusable', ['width: 1px !important;']), 1, {
        ruleId: 'css/no-important', kind: 'css-important', variant: 'sr-only-focusable', marker: `neg_srf_${i}`,
      });
    },
  },
];

