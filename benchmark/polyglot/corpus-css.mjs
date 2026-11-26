// Deterministic, token-driven CSS/SCSS project for the polyglot recall
// benchmark. The base has zero hardcoded colors outside `:root` token
// definitions, no `!important` outside the documented exemptions (print,
// prefers-reduced-motion, [hidden], .sr-only, .visually-hidden) and no
// duplicate selectors inside the same file and at-rule scope.

import { pick } from './lib.mjs';
import { addCss } from './css-util.mjs';
import { cssRest } from './corpus-css-rest.mjs';


export function cssFiles(rng, files, cssSelectors) {
  const accent = pick(rng, ['#2f6fed', '#2563eb', '#1d4ed8']);
  const danger = pick(rng, ['#c0392b', '#b91c1c', '#dc2626']);
  const success = pick(rng, ['#1e8449', '#15803d', '#16a34a']);
  const bg = pick(rng, ['#f7f8fa', '#f8fafc', '#f9fafb']);
  const surface = '#ffffff';
  const text = pick(rng, ['#1b1f24', '#111827', '#1f2937']);
  const muted = pick(rng, ['#5b6470', '#6b7280', '#64748b']);
  const border = pick(rng, ['#d8dee9', '#e5e7eb', '#e2e8f0']);
  const hover = pick(rng, ['#eef2f7', '#f1f5f9', '#f3f4f6']);

  addCss(files, cssSelectors, 'styles/tokens.css', [
    {
      selector: ':root',
      track: false,
      decls: [
        `--color-bg: ${bg};`,
        `--color-surface: ${surface};`,
        `--color-text: ${text};`,
        `--color-muted: ${muted};`,
        `--color-border: ${border};`,
        `--color-hover: ${hover};`,
        `--color-accent: ${accent};`,
        `--color-accent-soft: ${hover};`,
        `--color-danger: ${danger};`,
        `--color-success: ${success};`,
        '--space-1: 0.25rem;',
        '--space-2: 0.5rem;',
        '--space-3: 0.75rem;',
        '--space-4: 1rem;',
        '--radius-sm: 0.375rem;',
        '--radius-md: 0.75rem;',
        '--shadow-card: 0 1px 2px rgba(15, 23, 42, 0.08);',
      ],
    },
  ]);

  addCss(files, cssSelectors, 'styles/base.css', [
    {
      selector: '*, *::before, *::after',
      decls: ['box-sizing: border-box;'],
    },
    {
      selector: 'html',
      decls: ['font-family: system-ui, sans-serif;', 'line-height: 1.5;'],
    },
    {
      selector: 'body',
      decls: ['margin: 0;', 'background: var(--color-bg);', 'color: var(--color-text);'],
    },
    {
      selector: 'img',
      decls: ['max-width: 100%;', 'height: auto;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/layout.css', [
    {
      selector: '.container',
      decls: ['width: min(100% - 2rem, 72rem);', 'margin-inline: auto;'],
    },
    {
      selector: '.stack > * + *',
      decls: ['margin-top: var(--space-3);'],
    },
    {
      selector: '.grid',
      decls: ['display: grid;', 'gap: var(--space-4);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/typography.css', [
    {
      selector: 'h1, h2, h3',
      decls: ['line-height: 1.2;', 'margin: 0 0 var(--space-3);'],
    },
    {
      selector: '.prose p',
      decls: ['margin: 0 0 var(--space-3);'],
    },
    {
      selector: '.muted',
      decls: ['color: var(--color-muted);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/buttons.css', [
    {
      selector: '.btn',
      decls: [
        'display: inline-flex;',
        'align-items: center;',
        'gap: var(--space-2);',
        'border: 1px solid transparent;',
        'border-radius: var(--radius-sm);',
        'padding: var(--space-2) var(--space-3);',
        'cursor: pointer;',
      ],
    },
    {
      selector: '.btn-primary',
      decls: ['background: var(--color-accent);', 'color: var(--color-surface);'],
    },
    {
      selector: '.btn-ghost',
      decls: ['background: transparent;', 'color: var(--color-text);'],
    },
    {
      selector: '.btn[disabled]',
      decls: ['opacity: 0.6;', 'cursor: not-allowed;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/forms.css', [
    {
      selector: '.field',
      decls: ['display: grid;', 'gap: var(--space-1);'],
    },
    {
      selector: '.field label',
      decls: ['font-weight: 600;'],
    },
    {
      selector: '.input, .select, .textarea',
      decls: [
        'border: 1px solid var(--color-border);',
        'border-radius: var(--radius-sm);',
        'padding: var(--space-2);',
        'background: var(--color-surface);',
      ],
    },
  ]);

  addCss(files, cssSelectors, 'styles/cards.css', [
    {
      selector: '.card',
      decls: [
        'background: var(--color-surface);',
        'border-radius: var(--radius-md);',
        'padding: var(--space-4);',
        'box-shadow: var(--shadow-card);',
      ],
    },
    {
      selector: '.card-header',
      decls: ['font-weight: 700;', 'margin-bottom: var(--space-2);'],
    },
    {
      selector: '.card-body',
      decls: ['color: var(--color-muted);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/navigation.css', [
    {
      selector: '.nav',
      decls: ['display: flex;', 'gap: var(--space-3);'],
    },
    {
      selector: '.nav a',
      decls: ['color: inherit;', 'text-decoration: none;'],
    },
    {
      selector: ".nav a[aria-current='page']",
      decls: ['font-weight: 700;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/tables.css', [
    {
      selector: '.table',
      decls: ['width: 100%;', 'border-collapse: collapse;'],
    },
    {
      selector: '.table th, .table td',
      decls: ['padding: var(--space-2);', 'border-bottom: 1px solid var(--color-border);'],
    },
    {
      selector: '.table tbody tr:hover',
      decls: ['background: var(--color-hover);'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/modals.css', [
    {
      selector: '.modal',
      decls: ['position: fixed;', 'inset: 0;', 'display: grid;', 'place-items: center;'],
    },
    {
      selector: '.modal[hidden]',
      decls: ['display: none;'],
    },
    {
      selector: '.modal-panel',
      decls: ['background: var(--color-surface);', 'max-width: 32rem;'],
    },
  ]);

  addCss(files, cssSelectors, 'styles/alerts.css', [
    {
      selector: '.alert',
      decls: ['border-left: 4px solid var(--color-accent);', 'padding: var(--space-3);'],
    },
    {
      selector: '.alert-danger',
      decls: ['border-color: var(--color-danger);'],
    },
    {
      selector: '.alert-success',
      decls: ['border-color: var(--color-success);'],
    },
  ]);
  cssRest(rng, files, cssSelectors);
}
