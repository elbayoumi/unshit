export interface FileDiff {
  file: string;
  before: string;
  after: string;
}

interface Op {
  kind: 'equal' | 'remove' | 'add';
  text: string;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Minimal line diff: strip the common prefix/suffix, then LCS the remainder. */
function diffOps(before: string[], after: string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i += 1) ops.push({ kind: 'equal', text: before[i]! });

  const a = before.slice(start, beforeEnd);
  const b = after.slice(start, afterEnd);
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: 'remove', text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ kind: 'remove', text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ kind: 'add', text: b[j]! });
    j += 1;
  }
  for (let k = afterEnd; k < after.length; k += 1) ops.push({ kind: 'equal', text: after[k]! });
  return ops;
}

function groupHunks(ops: Op[], context: number): Array<{ start: number; end: number }> {
  const changes: number[] = [];
  ops.forEach((op, idx) => {
    if (op.kind !== 'equal') changes.push(idx);
  });
  if (changes.length === 0) return [];

  const hunks: Array<{ start: number; end: number }> = [];
  let start = Math.max(0, changes[0]! - context);
  let end = Math.min(ops.length, changes[0]! + context + 1);
  for (const idx of changes.slice(1)) {
    if (idx - context <= end) {
      end = Math.min(ops.length, Math.max(end, idx + context + 1));
    } else {
      hunks.push({ start, end });
      start = Math.max(0, idx - context);
      end = Math.min(ops.length, idx + context + 1);
    }
  }
  hunks.push({ start, end });
  return hunks;
}

interface LineOffsets {
  oldLine: number[];
  newLine: number[];
}

function lineOffsets(ops: Op[]): LineOffsets {
  const oldLine = [1];
  const newLine = [1];
  for (const op of ops) {
    oldLine.push(oldLine[oldLine.length - 1]! + (op.kind === 'add' ? 0 : 1));
    newLine.push(newLine[newLine.length - 1]! + (op.kind === 'remove' ? 0 : 1));
  }
  return { oldLine, newLine };
}

function renderHunks(
  out: string[],
  ops: Op[],
  hunks: Array<{ start: number; end: number }>,
  offsets: LineOffsets,
): void {
  for (const hunk of hunks) {
    let oldStart = offsets.oldLine[hunk.start]!;
    let newStart = offsets.newLine[hunk.start]!;
    const oldCount = offsets.oldLine[hunk.end]! - offsets.oldLine[hunk.start]!;
    const newCount = offsets.newLine[hunk.end]! - offsets.newLine[hunk.start]!;
    if (oldCount === 0) oldStart -= 1;
    if (newCount === 0) newStart -= 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of ops.slice(hunk.start, hunk.end)) {
      out.push(`${op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' '}${op.text}`);
    }
  }
}

/** Dependency-free unified diff (three lines of context by default). */
export function formatUnifiedDiff(files: FileDiff[], context = 3): string {
  const out: string[] = [];
  for (const { file, before, after } of files) {
    const ops = diffOps(splitLines(before), splitLines(after));
    const hunks = groupHunks(ops, context);
    if (hunks.length === 0) continue;

    out.push(`--- a/${file}`, `+++ b/${file}`);
    renderHunks(out, ops, hunks, lineOffsets(ops));
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}
