import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Patch } from '../contracts.js';
import { runFix } from '../core/fixer.js';
import { formatUnifiedDiff } from '../core/fixers/diff.js';
import { applyEdits } from '../core/fixers/manifest-json.js';
import { isUnusedFileRule } from '../core/fixers/unused-file.js';
import type { ScanResult } from '../core/scanner.js';
import { mcpRelativePath } from './rel-path.js';

interface PreviewedFix {
  ruleId: string;
  file: string;
  description: string;
  diff: string;
}

interface SkippedFix {
  ruleId: string;
  line: number;
  reason: string;
}

type FixPreviewOutput =
  | { error: string }
  | {
      path: string;
      dryRun: true;
      fixes: PreviewedFix[];
      skipped: SkippedFix[];
    };

function byRule(patches: Patch[]): Map<string, Patch[]> {
  const groups = new Map<string, Patch[]>();
  for (const patch of patches) {
    const list = groups.get(patch.ruleId) ?? [];
    list.push(patch);
    groups.set(patch.ruleId, list);
  }
  return groups;
}

function diffFor(file: string, before: string, after: string): string {
  return formatUnifiedDiff([{ file, before, after }]);
}

async function originalContent(scan: ScanResult, path: string): Promise<string | null> {
  const scanned = scan.files.find((file) => file.relPath === path);
  if (scanned) return scanned.content;
  if (!(scan.manifests ?? []).includes(path)) return null;
  return readFile(join(scan.rootDir, path), 'utf8').catch(() => null);
}

/** Runs the deterministic fixers in dry-run mode and returns only proposed diffs for one file. */
export async function previewFixes(scan: ScanResult, rawPath: string, ruleId?: string): Promise<FixPreviewOutput> {
  const path = mcpRelativePath(scan.rootDir, rawPath);
  const before = await originalContent(scan, path);
  if (before === null) return { error: `Not a scanned file: ${rawPath}.` };

  const summary = await runFix(scan, { apply: false, ai: false });
  const selected = summary.deterministicPatches.filter((patch) =>
    patch.file === path && (!ruleId || patch.ruleId === ruleId));

  const fixes: PreviewedFix[] = [];
  for (const [id, patches] of byRule(selected)) {
    const after = applyEdits(before, patches.flatMap((patch) => patch.edits));
    const diff = diffFor(path, before, after);
    if (!diff) continue;
    fixes.push({ ruleId: id, file: path, description: patches[0]?.description ?? '', diff });
  }

  const deletionRule = scan.findings.find((finding) =>
    finding.file === path && isUnusedFileRule(finding.ruleId))?.ruleId;
  if (deletionRule && (!ruleId || ruleId === deletionRule) && summary.deletions.includes(path)) {
    const diff = diffFor(path, before, '');
    if (diff) fixes.push({ ruleId: deletionRule, file: path, description: 'Delete provably unused file', diff });
  }

  fixes.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return {
    path,
    dryRun: true,
    fixes,
    skipped: summary.skipped
      .filter((item) => item.file === path && (!ruleId || item.ruleId === ruleId))
      .map((item) => ({ ruleId: item.ruleId, line: item.line, reason: item.reason })),
  };
}
