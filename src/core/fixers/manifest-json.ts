import type { TextEdit } from '../../contracts.js';

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LineRemoval {
  name: string;
  start: number;
  end: number;
  hasComma: boolean;
}

/** Locates the dependency key lines and the edits that remove them without breaking JSON. */
export function removalEdits(content: string, names: string[]): Map<string, TextEdit[]> | null {
  const removals: LineRemoval[] = [];
  for (const name of names) {
    const re = new RegExp(`^[ \\t]*"${escapeRegExp(name)}"[ \\t]*:`, 'm');
    const match = re.exec(content);
    if (!match) return null;
    const start = match.index;
    let end = content.indexOf('\n', start);
    if (end === -1) end = content.length;
    if (removals.some((r) => start < r.end && r.start < end)) return null;
    removals.push({ name, start, end, hasComma: content.slice(start, end).trimEnd().endsWith(',') });
  }
  removals.sort((a, b) => a.start - b.start);

  const removed = new Set(removals.map((r) => r.start));
  const editsByName = new Map<string, TextEdit[]>(
    removals.map(({ name, start, end }) => [name, [{
      startOffset: start,
      endOffset: end < content.length ? end + 1 : end,
      replacement: '',
    }]]),
  );
  const commaEdits = new Set<number>();
  for (const removal of removals) {
    if (removal.hasComma) continue;
    // Last property of its object: drop the trailing comma of the previous
    // surviving property line, if it is another property (not a closing brace).
    let searchEnd = removal.start - 1;
    while (searchEnd >= 0) {
      const searchStart = content.lastIndexOf('\n', searchEnd - 1) + 1;
      if (!removed.has(searchStart)) {
        const prev = content.slice(searchStart, searchEnd);
        const comma = prev.lastIndexOf(',');
        if (comma >= 0
          && prev.slice(comma + 1).trim() === ''
          && /^\s*"[^"]+"\s*:/.test(prev)
          && !commaEdits.has(searchStart + comma)) {
          commaEdits.add(searchStart + comma);
          editsByName.get(removal.name)!.push({
            startOffset: searchStart + comma,
            endOffset: searchStart + comma + 1,
            replacement: '',
          });
        }
        break;
      }
      searchEnd = searchStart - 1;
    }
  }
  for (const edits of editsByName.values()) edits.sort((a, b) => a.startOffset - b.startOffset);
  return editsByName;
}

export function applyEdits(content: string, edits: TextEdit[]): string {
  let next = content;
  for (const edit of [...edits].sort((a, b) => b.startOffset - a.startOffset)) {
    next = next.slice(0, edit.startOffset) + edit.replacement + next.slice(edit.endOffset);
  }
  return next;
}

export function expectedManifest(raw: string, names: string[]): unknown {
  const parsed: unknown = JSON.parse(raw);
  const copy: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const value = copy[section];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const deps = { ...(value as Record<string, unknown>) };
    for (const name of names) delete deps[name];
    copy[section] = deps;
  }
  return copy;
}
