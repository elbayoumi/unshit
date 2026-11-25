import type { LineRange } from '../core/pinner.js';
import { errorMessage, getFlag, getOpt, type CommandContext } from './shared.js';

export async function runPinCommand({ scan }: CommandContext): Promise<number> {
  const { createBaseline } = await import('../core/pinner.js');
  const snap = await createBaseline(scan);
  console.log(`Pinned baseline: ${snap.score.score}/100 (${snap.fingerprints.length} findings, ${Object.keys(snap.fileHashes).length} files) -> unshit.baseline.json`);
  return 0;
}

export async function runGuardCommand({ targetDir, scan, rest }: CommandContext): Promise<number> {
  const changed = getFlag(rest, '--changed');
  const lines = getFlag(rest, '--lines');
  const baseRef = getOpt(rest, '--base') ?? 'HEAD';
  const { loadBaseline, getChangedFiles, getChangedLineRanges, evaluateGuard } = await import('../core/pinner.js');
  let baseline: Awaited<ReturnType<typeof loadBaseline>>;
  try {
    baseline = await loadBaseline(targetDir);
  } catch (err) {
    console.error(`unshit guard: ${errorMessage(err)}`);
    return 2;
  }
  if (!baseline && !changed) {
    console.error('unshit guard: missing unshit.baseline.json. Run `unshit pin` first (or pass --changed).');
    return 2;
  }
  let changedFiles: Set<string> | undefined;
  let changedLineRanges: Map<string, LineRange[]> | undefined;
  if (changed) {
    try {
      changedFiles = await getChangedFiles(targetDir, baseRef);
      if (lines) changedLineRanges = await getChangedLineRanges(targetDir, baseRef);
    } catch (err) {
      console.error(errorMessage(err));
      return 3;
    }
  }
  const res = evaluateGuard(scan, baseline, changedFiles, changedLineRanges);
  const lineCount = changedLineRanges
    ? [...changedLineRanges.values()].reduce((sum, ranges) => sum + ranges.length, 0)
    : 0;
  const scopeLabel = changed
    ? ` (changed: ${changedFiles?.size ?? 0} files${changedLineRanges ? `, ${lineCount} line ranges` : ''})`
    : '';
  console.log(
    `unshit guard${scopeLabel}: ${res.passed ? 'PASS' : 'FAIL'} | score ${res.baselineScore} -> ${res.currentScore} | new: ${res.newFindings.length} | resolved: ${res.resolvedCount}`,
  );
  if (!res.passed) {
    for (const f of res.newFindings.slice(0, 20)) {
      console.error(`  NEW [${f.ruleId}] ${f.file}:${f.span.line} — ${f.message}`);
    }
    return 1;
  }
  return 0;
}
