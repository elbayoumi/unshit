import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import type { Severity } from './contracts.js';
import { runFix } from './core/fixer.js';
import { createBaseline, evaluateGuard, loadBaseline } from './core/pinner.js';
import { formatScanOutput, type OutputFormat } from './core/reporters.js';
import { runScan } from './core/scanner.js';
import { computeScore } from './core/scorer.js';
import { runMcpServer } from './mcp/server.js';

const VALID_COMMANDS = new Set(['scan', 'score', 'pin', 'guard', 'fix', 'mcp', 'help', '--help', '-h']);
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
    if (a === '--format' || a === '--runner' || a === '--model' || a === '--fail-on') {
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

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log([
      'unshit <command> [path] [options]',
      '',
      'Commands:',
      '  scan [path]    Read-only AST/CSS/clone/slop scan (--format human|json|sarif|markdown, --fail-on error|warn|info)',
      '  score [path]   Compute 0-100 codebase health score',
      '  pin [path]     Capture unshit.baseline.json characterization snapshot',
      '  guard [path]   Fail CI/pre-commit if new findings or score regression vs baseline',
      '  fix [path]     Dry-run by default; pass --apply for deterministic fixes (+ --ai for OpenCode/Claude)',
      '  mcp            Start stdio MCP server (unshit_scan, unshit_score, unshit_guard)',
    ].join('\n'));
    return 0;
  }

  const rawFormat = getOpt(rest, '--format') ?? 'human';
  if (!VALID_FORMATS.has(rawFormat as OutputFormat)) {
    console.error(`Invalid --format: ${rawFormat}. Expected human|json|sarif|markdown.`);
    return 2;
  }
  const format = rawFormat as OutputFormat;

  const targetDir = getTargetPath(rest);
  const config = await loadConfig(targetDir);
  const scan = await runScan(targetDir, config);
  const score = computeScore(scan.files, scan.findings);

  if (cmd === 'scan') {
    console.log(formatScanOutput(scan.findings, score, format));
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

  if (cmd === 'pin') {
    const snap = await createBaseline(scan);
    console.log(`Pinned baseline: ${snap.score.score}/100 (${snap.fingerprints.length} findings, ${Object.keys(snap.fileHashes).length} files) -> unshit.baseline.json`);
    return 0;
  }

  if (cmd === 'guard') {
    const baseline = await loadBaseline(targetDir);
    if (!baseline) {
      console.error('unshit guard: missing unshit.baseline.json. Run `unshit pin` first.');
      return 2;
    }
    const res = evaluateGuard(scan, baseline);
    console.log(
      `unshit guard: ${res.passed ? 'PASS' : 'FAIL'} | score ${res.baselineScore} -> ${res.currentScore} | new: ${res.newFindings.length} | resolved: ${res.resolvedCount}`,
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

  const summary = await runFix(scan, { apply, ai });
  console.log(
    `unshit fix (${summary.dryRun ? 'dry-run' : 'applied'}): ${summary.deterministicPatches.length} deterministic patches (${summary.appliedCount} applied), AI attempted: ${summary.aiAttempted.length}, reverted: ${summary.aiReverted.length}`,
  );
  return summary.aiReverted.length > 0 ? 1 : 0;
}
