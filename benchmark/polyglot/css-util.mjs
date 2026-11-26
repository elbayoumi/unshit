// Shared CSS emitter for the polyglot base project.

export function addCss(files, cssSelectors, rel, parts) {
  const out = [];
  const selectors = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      out.push(part);
      continue;
    }
    if (part.track !== false) selectors.push(part.selector);
    out.push(`${part.selector} {`);
    for (const declaration of part.decls) out.push(`  ${declaration}`);
    out.push('}', '');
  }
  files.set(rel, out.join('\n').replace(/\n+$/, '\n'));
  cssSelectors.set(rel, selectors);
}

