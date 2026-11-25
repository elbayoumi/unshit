import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Finding, Patch } from '../contracts.js';
import type { ScanResult } from './scanner.js';

const execFileAsync = promisify(execFile);

interface FixOptions {
  apply: boolean;
  ai: boolean;
  maxAiFiles?: number;
}

interface FixSummary {
  deterministicPatches: Patch[];
  appliedCount: number;
  aiAttempted: string[];
  aiReverted: string[];
  dryRun: boolean;
}

function applyEdits(content: string, patches: Patch[]): string {
  const edits = patches.flatMap((p) => p.edits).sort((a, b) => b.startOffset - a.startOffset);
  let next = content;
  for (const e of edits) {
    next = next.slice(0, e.startOffset) + e.replacement + next.slice(e.endOffset);
  }
  return next;
}

async function runVerify(rootDir: string, verifyCommand?: string): Promise<boolean> {
  if (!verifyCommand) return true;
  try {
    await execFileAsync('sh', ['-c', verifyCommand], { cwd: rootDir, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

async function runAiFixForFile(
  rootDir: string,
  relPath: string,
  findings: Finding[],
  runner: 'opencode' | 'claude',
  model?: string,
): Promise<boolean> {
  const summary = findings
    .slice(0, 12)
    .map((f) => `- [${f.ruleId}] line ${f.span.line}: ${f.message}`)
    .join('\n');
  const prompt = [
    `Fix ONLY the following unshit findings in ${relPath}. Keep behavior identical and do not add 'any', '@ts-ignore', or inline i18n ternaries.`,
    summary,
  ].join('\n');

  try {
    if (runner === 'claude') {
      await execFileAsync('claude', ['-p', prompt, '--allowedTools', 'Edit', 'Read'], { cwd: rootDir, timeout: 180_000 });
    } else {
      const args = ['run'];
      if (model) args.push('-m', model);
      args.push('--auto', prompt);
      await execFileAsync('opencode', args, { cwd: rootDir, timeout: 180_000 });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies deterministic safe patches first, then optionally runs gated AI fixes per file.
 */
export async function runFix(scan: ScanResult, opts: FixOptions): Promise<FixSummary> {
  const detectorMap = new Map(scan.detectors.map((d) => [d.id, d]));
  const fileMap = new Map(scan.files.map((f) => [f.relPath, f]));

  const deterministicPatches: Patch[] = [];
  for (const finding of scan.findings) {
    const detector = detectorMap.get(finding.ruleId);
    const file = fileMap.get(finding.file);
    if (!detector?.fix || !file) continue;
    const patch = detector.fix(file, finding);
    if (patch && patch.edits.length > 0) {
      deterministicPatches.push(patch);
    }
  }

  let appliedCount = 0;
  if (opts.apply && deterministicPatches.length > 0) {
    const byFile = new Map<string, Patch[]>();
    for (const p of deterministicPatches) {
      const list = byFile.get(p.file) ?? [];
      list.push(p);
      byFile.set(p.file, list);
    }
    for (const [relPath, patches] of byFile) {
      const file = fileMap.get(relPath);
      if (!file) continue;
      const updated = applyEdits(file.content, patches);
      if (updated !== file.content) {
        await writeFile(file.absPath, updated, 'utf8');
        appliedCount += patches.length;
      }
    }
  }

  const aiAttempted: string[] = [];
  const aiReverted: string[] = [];
  if (opts.apply && opts.ai) {
    const aiByFile = new Map<string, Finding[]>();
    for (const f of scan.findings) {
      if (f.fixability !== 'ai') continue;
      const list = aiByFile.get(f.file) ?? [];
      list.push(f);
      aiByFile.set(f.file, list);
    }
    const maxFiles = opts.maxAiFiles ?? 5;
    for (const [relPath, fileFindings] of [...aiByFile.entries()].slice(0, maxFiles)) {
      const target = fileMap.get(relPath);
      if (!target) continue;
      const snapshot = await readFile(target.absPath, 'utf8');
      aiAttempted.push(relPath);
      const ok = await runAiFixForFile(
        scan.rootDir,
        relPath,
        fileFindings,
        scan.config.aiRunner,
        scan.config.aiModel,
      );
      const verified = ok && (await runVerify(scan.rootDir, scan.config.verifyCommand));
      if (!verified) {
        aiReverted.push(relPath);
        await writeFile(target.absPath, snapshot, 'utf8');
      }
    }
  }

  return {
    deterministicPatches,
    appliedCount,
    aiAttempted,
    aiReverted,
    dryRun: !opts.apply,
  };
}
