import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import type { Severity } from './contracts.js';
import { abortSwarmFix, runSwarmFix } from './core/swarm-fixer.js';
import { runFix } from './core/fixer.js';
import { runHook } from './core/hook.js';
import { addFeedback, isFeedbackKind, readFeedback, summarizeFeedback, FEEDBACK_KINDS } from './core/feedback.js';
import { runInit } from './core/init.js';
import { computeHotspots } from './core/hotspots.js';
import { createBaseline, evaluateGuard, getChangedFiles, getChangedLineRanges, loadBaseline, type LineRange } from './core/pinner.js';
import { formatScanOutput, type OutputFormat } from './core/reporters.js';
import { runScan } from './core/scanner.js';
import { computeScore } from './core/scorer.js';
import { computeStructureVerdict } from './core/structure-verdict.js';
import { runMcpServer } from './mcp/server.js';

const VALID_COMMANDS = new Set(['scan', 'score', 'hotspots', 'structure', 'pin', 'guard', 'fix', 'init', 'hook', 'mcp', 'note', 'notes', 'help', '--help', '-h']);
const VALID_FORMATS = new Set<OutputFormat>(['human', 'json', 'sarif', 'markdown']);
const SEV_RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };

function getFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function getOpt(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function getTargetPath(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--format' || a === '--runner' || a === '--model' || a === '--fail-on' || a === '--base' || a === '--since' || a === '--top' || a === '--concurrency' || a === '--max-files' || a === '--max-diff-lines' || a === '--kind' || a === '--file') {
      i += 1;
      continue;
    }
    if (!a.startsWith('-')) return resolve(a);
  }
  return process.cwd();
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? 'help';
  const rest = argv.slice(1);

  if (!VALID_COMMANDS.has(cmd)) {
    console.error(`Unknown command: ${cmd}. Run \`unshit help\`.`);
    return 2;
  }

  if (cmd === 'mcp') {
    return runMcpServer();
  }

  if (cmd === 'hook') {
    return runHook(rest);
  }

  if (cmd === 'init') {
    return runInit(getTargetPath(rest), { force: getFlag(rest, '--force') });
  }

  if (cmd === 'note') {
    const positional = rest.filter((a, i) => !a.startsWith('-') && !['--kind', '--file'].includes(rest[i - 1] ?? ''));
    const [rule, ...noteParts] = positional;
    const kind = getOpt(rest, '--kind') ?? 'false-positive';
    if (!rule || noteParts.length === 0 || !isFeedbackKind(kind)) {
      console.error(`Usage: unshit note <rule-id|general> "<what is wrong or missing>" [--kind ${FEEDBACK_KINDS.join('|')}] [--file <path>]`);
      return 2;
    }
    await addFeedback(process.cwd(), { kind, rule, file: getOpt(rest, '--file'), note: noteParts.join(' ') });
    console.log(`Recorded ${kind} for ${rule} in .unshit/feedback.jsonl`);
    return 0;
  }

  if (cmd === 'notes') {
    const entries = await readFeedback(getTargetPath(rest));
    console.log(getFlag(rest, '--json') ? JSON.stringify(entries, null, 2) : summarizeFeedback(entries));
    return 0;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log([
      'unshit <command> [path] [options]',
      '',
      'Commands:',
      '  scan [path]    Read-only AST/CSS/clone/slop scan (--format human|json|sarif|markdown, --fail-on error|warn|info)',
      '  score [path]   Compute 0-100 codebase health score',
      '  hotspots [path] Rank files by churn and finding density (--since 90.days, --top 10, --json)',
      '  structure [path] Diagnose project directory/module health (archetype, layout, cycles, boundary leaks, verdict, --fail-on error|warn|info)',
      '  pin [path]     Capture unshit.baseline.json characterization snapshot',
      '  guard [path]   Fail CI/pre-commit on regressions (--changed [baseRef] for diff-only PRs, --lines for changed-line scope)',
      '  fix [path]     Dry-run by default; pass --apply for deterministic fixes (+ --ai for OpenCode/Claude; --swarm for parallel worktree AI fixer; --abort to clean stale worktrees)',
      '  init [path]    Bootstrap config, baseline, and Claude Code PreToolUse hook (--force to overwrite)',
      '  hook [file]    Live AI Guardrail Hook (--stdin for Claude Code PreToolUse/PostToolUse, exits 2 on slop)',
      '  note <rule> "text"  Record a local false-positive / improvement / scope-gap note (--kind, --file) in .unshit/feedback.jsonl',
      '  notes [path]   Summarize recorded notes as a markdown backlog grouped by rule (--json)',
      '  mcp            Start stdio MCP server (unshit_scan, unshit_score, unshit_guard)',
    ].join('\n'));
    return 0;
  }

  const rawFormat = getOpt(rest, '--format') ?? (getFlag(rest, '--json') ? 'json' : 'human');
  if (!VALID_FORMATS.has(rawFormat as OutputFormat)) {
    console.error(`Invalid --format: ${rawFormat}. Expected human|json|sarif|markdown.`);
    return 2;
  }
  const format = rawFormat as OutputFormat;

  const targetDir = getTargetPath(rest);
  const config = await loadConfig(targetDir);

  if (getFlag(rest, '--abort')) {
    try {
      const removed = await abortSwarmFix(targetDir);
      console.log(`unshit fix --abort: removed ${removed} stale worktree(s), pruned, lock cleared.`);
      return 0;
    } catch (err) {
      console.error(`unshit fix --abort: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  const scan = await runScan(targetDir, config);
  const score = computeScore(scan.files, scan.findings);

  if (cmd === 'scan') {
    console.log(formatScanOutput(scan.findings, score, format));
    if (format === 'human') {
      const sv = computeStructureVerdict(
        { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
        scan.findings,
      );
      console.log(`Structure: ${sv.verdict} (${sv.archetype} · ${sv.layout} · ${Math.round(sv.graph.resolvedRatio * 100)}% imports resolved)`);
    }
    const failOn = getOpt(rest, '--fail-on') as Severity | undefined;
    if (failOn && SEV_RANK[failOn]) {
      const minRank = SEV_RANK[failOn];
      if (scan.findings.some((f) => SEV_RANK[f.severity] >= minRank)) {
        return 1;
      }
    }
    return 0;
  }

  if (cmd === 'score') {
    if (format === 'json') {
      console.log(JSON.stringify(score, null, 2));
    } else {
      console.log(`unshit score: ${score.score}/100 (Grade ${score.grade}) — ${score.totalFindings} findings across ${score.totalFiles} files (${score.totalLines} lines)`);
      console.log('By category:', JSON.stringify(score.byCategory));
    }
    return 0;
  }

  if (cmd === 'hotspots') {
    const since = getOpt(rest, '--since') ?? '90.days';
    const topRaw = getOpt(rest, '--top');
    const top = topRaw === undefined ? 10 : Number.parseInt(topRaw, 10);
    try {
      const hotspots = await computeHotspots(targetDir, scan, {
        since,
        top: Number.isFinite(top) ? top : 10,
      });
      if (format === 'json') {
        console.log(JSON.stringify(hotspots, null, 2));
      } else {
        console.log(`unshit hotspots (since ${since}): top ${hotspots.length}`);
        hotspots.forEach((h, idx) => {
          console.log(
            `  ${String(idx + 1).padStart(2)}. ${h.score.toFixed(2).padStart(8)}  ${h.file} — churn: ${h.churnCommits} commits / ${h.churnLines} lines, findings: ${h.findings}`,
          );
        });
      }
      return 0;
    } catch (err) {
      console.error(`unshit hotspots: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  if (cmd === 'structure') {
    const failOnRaw = getOpt(rest, '--fail-on');
    if (failOnRaw !== undefined && !SEV_RANK[failOnRaw as Severity]) {
      console.error(`Invalid --fail-on: ${failOnRaw}. Expected error|warn|info.`);
      return 2;
    }
    const failOn = failOnRaw as Severity | undefined;
    const sv = computeStructureVerdict(
      { rootDir: scan.rootDir, config: scan.config, files: scan.files, manifests: scan.manifests },
      scan.findings,
    );
    if (format === 'json') {
      console.log(JSON.stringify(sv, null, 2));
    } else {
      console.log(`Archetype  ${sv.archetype} · ${sv.layout}`);
      console.log(`Graph      ${sv.graph.graphedFiles}/${sv.graph.totalCodeFiles} code files graphed (${Math.round(sv.graph.resolvedRatio * 100)}% internal imports resolved)`);
      console.log(`Verdict    ${sv.verdict}${sv.reason ? ` — ${sv.reason}` : ''}`);
      console.log(`  Cycles          ${sv.metrics.cycles} (largest: ${sv.metrics.largestCycle} files)`);
      console.log(`  Boundary leaks  ${sv.metrics.boundaryLeaks}`);
      console.log(`  Largest flat    ${sv.metrics.largestFlatDir} files [metric only]`);
      if (sv.topFixes.length > 0) {
        console.log('Top fixes');
        sv.topFixes.slice(0, 3).forEach((fix, idx) => console.log(`  ${idx + 1}. ${fix}`));
      }
    }
    if (failOn) {
      const minRank = SEV_RANK[failOn];
      if (scan.findings.some(
        (f) => f.ruleId.startsWith('structure/') && SEV_RANK[f.severity] >= minRank,
      )) {
        return 1;
      }
    }
    return 0;
  }

  if (cmd === 'pin') {
    const snap = await createBaseline(scan);
    console.log(`Pinned baseline: ${snap.score.score}/100 (${snap.fingerprints.length} findings, ${Object.keys(snap.fileHashes).length} files) -> unshit.baseline.json`);
    return 0;
  }

  if (cmd === 'guard') {
    const changed = getFlag(rest, '--changed');
    const lines = getFlag(rest, '--lines');
    const baseRef = getOpt(rest, '--base') ?? 'HEAD';
    let baseline;
    try {
      baseline = await loadBaseline(targetDir);
    } catch (err) {
      console.error(`unshit guard: ${err instanceof Error ? err.message : String(err)}`);
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
        console.error(err instanceof Error ? err.message : String(err));
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

  const apply = getFlag(rest, '--apply');
  const ai = getFlag(rest, '--ai');
  const runner = getOpt(rest, '--runner');
  if (runner === 'claude' || runner === 'opencode') config.aiRunner = runner;
  const model = getOpt(rest, '--model');
  if (model) config.aiModel = model;

  if (getFlag(rest, '--swarm')) {
    try {
      const concurrencyRaw = getOpt(rest, '--concurrency');
      const maxFilesRaw = getOpt(rest, '--max-files');
      const maxDiffLinesRaw = getOpt(rest, '--max-diff-lines');
      const concurrency = concurrencyRaw ? Number.parseInt(concurrencyRaw, 10) : undefined;
      const maxFiles = maxFilesRaw ? Number.parseInt(maxFilesRaw, 10) : undefined;
      const maxDiffLines = maxDiffLinesRaw ? Number.parseInt(maxDiffLinesRaw, 10) : undefined;
      const summary = await runSwarmFix(scan, {
        apply,
        concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
        maxFiles: Number.isFinite(maxFiles) ? maxFiles : undefined,
        maxDiffLines: Number.isFinite(maxDiffLines) ? maxDiffLines : undefined,
      });
      console.log(
        `unshit fix --swarm (${summary.dryRun ? 'dry-run' : 'applied'}): ${summary.workers.length} workers, ${summary.appliedCount} applied`,
      );
      const failed = summary.workers.some((w) => !w.ok);
      return failed ? 1 : 0;
    } catch (err) {
      console.error(`unshit fix --swarm: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  const summary = await runFix(scan, { apply, ai });
  if (summary.dryRun && summary.diff) process.stdout.write(summary.diff);
  for (const skip of summary.skipped) {
    console.log(`  SKIP [${skip.ruleId}] ${skip.file}:${skip.line} — ${skip.reason}`);
  }
  console.log(
    `unshit fix (${summary.dryRun ? 'dry-run' : 'applied'}): ${summary.deterministicPatches.length} deterministic patches (${summary.appliedCount} applied), skipped: ${summary.skipped.length}, AI attempted: ${summary.aiAttempted.length}, reverted: ${summary.aiReverted.length}`,
  );
  return summary.aiReverted.length > 0 ? 1 : 0;
}
