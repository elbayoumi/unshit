// CSS hard negatives for css/design-drift.

import { pushInjection, ruleBlock } from './lib.mjs';

export const CSS_COLOR_NEG = [
  {
    variant: 'var-only',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/cards.css', ruleBlock(`.neg-var-${i}`, ['color: var(--color-text);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'var-only', marker: `neg_var_${i}`,
      });
    },
  },
  {
    variant: 'var-fallback',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/buttons.css', ruleBlock(`.neg-fallback-${i}`, ['color: var(--color-text, #111);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'var-fallback', marker: `neg_fallback_${i}`,
      });
    },
  },
  {
    variant: 'url-fragment',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/avatars.css', ruleBlock(`.neg-url-${i}`, ['background: url(#icon-close);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'url-fragment', marker: `neg_url_${i}`,
      });
    },
  },
  {
    variant: 'url-data',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/tooltips.css', ruleBlock(`.neg-data-${i}`, ['background-image: url("data:image/svg+xml;utf8,#fff");']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'url-data', marker: `neg_data_${i}`,
      });
    },
  },
  {
    variant: 'local-custom-property',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/progress.css', ruleBlock(`.neg-local-${i}`, ['--local-color: #abc;', 'width: 50%;']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'local-custom-property', marker: `neg_local_${i}`,
      });
    },
  },
  {
    variant: 'root-block',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/tokens.css', [':root {', `  --neg-color-${i}: #123456;`, '}'], 0, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'root-block', marker: `neg_root_${i}`,
      });
    },
  },
  {
    variant: 'color-mix',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/dashboard.css', ruleBlock(`.neg-mix-${i}`, ['box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-card), transparent);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'color-mix', marker: `neg_mix_${i}`,
      });
    },
  },
  {
    variant: 'current-color',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/lists.css', ruleBlock(`.neg-current-${i}`, ['border: 1px solid currentColor;']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'current-color', marker: `neg_current_${i}`,
      });
    },
  },
  {
    variant: 'content-string',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/tooltips.css', ruleBlock(`.neg-content-${i}`, ['content: "#fff";']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'content-string', marker: `neg_content_${i}`,
      });
    },
  },
  {
    variant: 'gradient-vars',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/badges.css', ruleBlock(`.neg-gradient-${i}`, ['background: linear-gradient(var(--color-accent), var(--color-surface));']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'gradient-vars', marker: `neg_gradient_${i}`,
      });
    },
  },
  {
    variant: 'rgb-var-channels',
    expectedFalsePositive: true,
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/forms.css', ruleBlock(`.neg-rgb-${i}`, ['color: rgb(var(--color-rgb) / 0.5);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'rgb-var-channels', marker: `neg_rgb_${i}`,
      });
    },
  },
  {
    variant: 'outline-var',
    run(files, injections, i) {
      pushInjection(files, injections, 'styles/auth.css', ruleBlock(`.neg-outline-${i}`, ['outline: 2px solid var(--color-accent);']), 1, {
        ruleId: 'css/design-drift', kind: 'css-design-drift', variant: 'outline-var', marker: `neg_outline_${i}`,
      });
    },
  },
];

