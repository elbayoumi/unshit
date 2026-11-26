// CSS hard negatives for css/duplicate-selector.

import { appendLines, pushInjection, ruleBlock } from './lib.mjs';

export const CSS_DUP_NEG = [
  {
    variant: 'different-files',
    run(files, injections, i) {
      const first = 'styles/alerts.css';
      const second = 'styles/badges.css';
      // The first occurrence is setup only; the measured near miss is the
      // second file, which must not be reported as a duplicate.
      appendLines(files, first, ruleBlock(`.neg-shared-${i}`, ['color: inherit;']));
      pushInjection(files, injections, second, ruleBlock(`.neg-shared-${i}`, ['color: inherit;']), 0, {
        ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'different-files', marker: `neg_shared_${i}`,
      });
    },
  },
  {
    variant: 'different-media-widths',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/responsive.css', [
        '@media (min-width: 40rem) {',
        `  .neg-media-${i} { color: inherit; }`,
        '}',
        '@media (min-width: 60rem) {',
        `  .neg-media-${i} { color: inherit; }`,
        '}',
      ], 4, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'different-media-widths', marker: `neg_media_${i}` });
    },
  },
  {
    variant: 'keyframes',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/motion.css', [
        `@keyframes neg-pulse-${i} {`,
        '  from { opacity: 0.2; }',
        '  to { opacity: 1; }',
        '}',
        `@keyframes neg-pulse-${i} {`,
        '  from { opacity: 0.4; }',
        '  to { opacity: 0.9; }',
        '}',
      ], 5, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'keyframes', marker: `neg_pulse_${i}` });
    },
  },
  {
    variant: 'root-twice',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/dark.css', [
        ':root {',
        `  --neg-a-${i}: 1;`,
        '}',
        ':root {',
        `  --neg-b-${i}: 2;`,
        '}',
      ], 3, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'root-twice', marker: `neg_rootdup_${i}` });
    },
  },
  {
    variant: 'html-body-star',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/base.css', [
        'html { color: inherit; }',
        'body { color: inherit; }',
        '* { color: inherit; }',
      ], 2, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'html-body-star', marker: `neg_special_${i}` });
    },
  },
  {
    variant: 'font-face-twice',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/typography.css', [
        `@font-face { font-family: "Neg${i}"; src: url("/neg.woff2"); }`,
        `@font-face { font-family: "Neg${i}"; src: url("/neg.woff2"); }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'font-face-twice', marker: `neg_face_${i}` });
    },
  },
  {
    variant: 'hover-vs-focus',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/buttons.css', [
        `.neg-pseudo-${i}:hover { color: inherit; }`,
        `.neg-pseudo-${i}:focus { color: inherit; }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'hover-vs-focus', marker: `neg_pseudo_${i}` });
    },
  },
  {
    variant: 'combinator-spacing',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/layout.css', [
        `.neg-combo-${i} .child { color: inherit; }`,
        `.neg-combo-${i} > .child { color: inherit; }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'combinator-spacing', marker: `neg_combo_${i}` });
    },
  },
  {
    variant: 'different-layers',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/utilities.css', [
        `@layer base { .neg-layer-${i} { color: inherit; } }`,
        `@layer components { .neg-layer-${i} { color: inherit; } }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'different-layers', marker: `neg_layer_${i}` });
    },
  },
  {
    variant: 'different-supports',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/grid.css', [
        `@supports (display: grid) { .neg-supports-${i} { color: inherit; } }`,
        `@supports (display: flex) { .neg-supports-${i} { color: inherit; } }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'different-supports', marker: `neg_supports_${i}` });
    },
  },
  {
    variant: 'print-vs-screen',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/print.css', [
        `@media print { .neg-screen-${i} { color: inherit; } }`,
        `@media screen { .neg-screen-${i} { color: inherit; } }`,
      ], 1, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'print-vs-screen', marker: `neg_screen_${i}` });
    },
  },
  {
    variant: 'nested-different-parents',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/theme.scss', [
        `.neg-a-${i} {`,
        '  &:hover { color: inherit; }',
        '}',
        `.neg-b-${i} {`,
        '  &:hover { color: inherit; }',
        '}',
      ], 4, { ruleId: 'css/duplicate-selector', kind: 'css-duplicate-selector', variant: 'nested-different-parents', marker: `neg_nested_${i}` });
    },
  },
];

