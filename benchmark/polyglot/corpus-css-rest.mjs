// Second half of the CSS/SCSS base project (see corpus-css.mjs).

import { addCss } from './css-util.mjs';

export function cssRest(rng, files, cssSelectors) {
  addCss(files, cssSelectors, 'styles/badges.css', [
    {
      selector: '.badge',
      decls: [
        'display: inline-block;',
        'border-radius: 999px;',
        'padding: 0 var(--space-2);',
        'font-size: 0.75rem;',
      ],
    },
    {
      selector: '.badge-accent',
      decls: ['background: var(--color-accent-soft);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/tooltips.css', [
    {
      selector: '.tooltip',
      decls: ['position: relative;'],
    },
    {
      selector: '.tooltip:hover::after',
      decls: [
        'content: attr(data-tip);',
        'position: absolute;',
        'background: var(--color-text);',
        'color: var(--color-surface);',
        'padding: var(--space-1) var(--space-2);',
      ],
    },
  ]);

  addCss(files, cssSelectors, 'styles/grid.css', [
    {
      selector: '.grid-2',
      decls: ['display: grid;', 'grid-template-columns: repeat(2, minmax(0, 1fr));', 'gap: var(--space-4);'],
    },
    {
      selector: '.grid-3',
      decls: ['display: grid;', 'grid-template-columns: repeat(3, minmax(0, 1fr));', 'gap: var(--space-4);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/header.css', [
    {
      selector: '.site-header',
      decls: ['display: flex;', 'justify-content: space-between;', 'padding: var(--space-3);'],
    },
    {
      selector: '.site-header nav',
      decls: ['display: flex;', 'gap: var(--space-2);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/footer.css', [
    {
      selector: '.site-footer',
      decls: ['padding: var(--space-4);', 'color: var(--color-muted);'],
    },
    {
      selector: '.site-footer a',
      decls: ['color: inherit;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/sidebar.css', [
    {
      selector: '.sidebar',
      decls: ['width: 16rem;', 'border-right: 1px solid var(--color-border);'],
    },
    {
      selector: '.sidebar a',
      decls: ['display: block;', 'padding: var(--space-2);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/dashboard.css', [
    {
      selector: '.dashboard',
      decls: ['display: grid;', 'gap: var(--space-4);'],
    },
    {
      selector: '.stat',
      decls: ['background: var(--color-surface);', 'padding: var(--space-4);'],
    },
    {
      selector: '.stat-value',
      decls: ['font-size: 1.75rem;', 'font-weight: 700;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/auth.css', [
    {
      selector: '.auth',
      decls: ['display: grid;', 'place-items: center;', 'min-height: 100vh;'],
    },
    {
      selector: '.auth-card',
      decls: ['background: var(--color-surface);', 'padding: var(--space-4);'],
    },
    {
      selector: '.auth-card input',
      decls: ['border: 1px solid var(--color-border);', 'padding: var(--space-2);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/settings.css', [
    {
      selector: '.settings',
      decls: ['display: grid;', 'gap: var(--space-2);'],
    },
    {
      selector: '.settings-row',
      decls: ['display: flex;', 'justify-content: space-between;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/lists.css', [
    {
      selector: '.list',
      decls: ['margin: 0;', 'padding: 0;', 'list-style: none;'],
    },
    {
      selector: '.list-item',
      decls: ['padding: var(--space-2) 0;', 'border-bottom: 1px solid var(--color-border);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/avatars.css', [
    {
      selector: '.avatar',
      decls: ['width: 2.5rem;', 'height: 2.5rem;', 'border-radius: 50%;'],
    },
    {
      selector: '.avatar-sm',
      decls: ['width: 1.75rem;', 'height: 1.75rem;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/progress.css', [
    {
      selector: '.progress',
      decls: ['height: 0.5rem;', 'background: var(--color-hover);', 'border-radius: 999px;'],
    },
    {
      selector: '.progress-bar',
      decls: ['height: 100%;', 'background: var(--color-accent);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/utilities.css', [
    { selector: '.mt-0', decls: ['margin-top: 0;'] },
    { selector: '.mt-2', decls: ['margin-top: var(--space-2);'] },
    { selector: '.text-center', decls: ['text-align: center;'] },
  ]);

  addCss(files, cssSelectors, 'styles/responsive.css', [
    `@media (max-width: 48rem) {
  .container {
    padding-inline: var(--space-2);
  }
  .grid-2 {
    grid-template-columns: 1fr;
  }
}`,
    `@media (min-width: 64rem) {
  .container {
    max-width: 80rem;
  }
}`,
  ]);

  addCss(files, cssSelectors, 'styles/print.css', [
    `@media print {
  .no-print {
    display: none !important;
  }
  .page-break {
    break-after: page !important;
  }
}`,
  ]);

  addCss(files, cssSelectors, 'styles/accessibility.css', [
    {
      selector: '.sr-only',
      decls: [
        'position: absolute;',
        'width: 1px;',
        'height: 1px;',
        'overflow: hidden;',
        'clip: rect(0, 0, 0, 0);',
        'white-space: nowrap;',
        'border: 0 !important;',
      ],
    },
    {
      selector: '.visually-hidden',
      decls: ['clip-path: inset(50%) !important;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/motion.css', [
    `@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}`,
  ]);

  addCss(files, cssSelectors, 'styles/dark.css', [
    {
      selector: "[data-theme='dark']",
      decls: [
        '--color-bg: #0f1216;',
        '--color-surface: #171b21;',
        '--color-text: #e8eaed;',
        '--color-border: #2a313b;',
        '--color-hover: #1f252d;',
      ],
    },
  ]);

  addCss(files, cssSelectors, 'styles/theme.scss', [
    `$radius: 0.5rem;`,
    {
      selector: '.theme-card',
      decls: [
        'border-radius: $radius;',
        'background: var(--color-surface);',
        '&:hover {',
        '  background: var(--color-hover);',
        '}',
      ],
    },
    {
      selector: '.theme-badge',
      decls: [
        'border-radius: $radius;',
        '&:hover {',
        '  background: var(--color-hover);',
        '}',
      ],
    },
  ]);
}
