export const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
export const COMPONENT_EXTS = new Set(['.vue', '.svelte']);
export const TS_SUFFIXES = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs',
  '/index.vue', '/index.svelte',
];
export const JS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
export const NON_GRAPHABLE_RE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|json|html|md|txt|css|scss|less)$/i;
export const VITE_SOURCE_ROOTS = ['src', 'resources/js', 'resources/ts', 'app/javascript'];
export const RUST_SUFFIXES = ['', '.rs', '/mod.rs'];
export const RUST_USE_PREFIXES = new Set(['crate', 'super', 'self']);
export const RUST_MOD_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/;
export const RUST_USE_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?use\s+(.+)$/;

