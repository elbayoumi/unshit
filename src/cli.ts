import type { OutputFormat } from './core/reporters.js';
import { getFlag, getOpt, getTargetPath, type CommandContext } from './cli/shared.js';

type EarlyHandler = (rest: string[]) => Promise<number> | number;
type ScanHandler = (ctx: CommandContext) => Promise<number> | number;

// Dispatch tables: a new command is one entry here plus its handler module.
// Each handler is loaded lazily, so `hook` pulls in no scan/fix code.
const EARLY_HANDLERS: Record<string, EarlyHandler> = {
  mcp: async () => (await import('./mcp/server.js')).runMcpServer(),
  hook: async (rest) => (await import('./core/hook.js')).runHook(rest),
  init: async (rest) => (await import('./core/init.js')).runInit(getTargetPath(rest), { force: getFlag(rest, '--force') }),
  note: async (rest) => (await import('./cli/notes.js')).runNoteCommand(rest),
  notes: async (rest) => (await import('./cli/notes.js')).runNotesCommand(rest),
  help: () => printHelp(),
  '--help': () => printHelp(),
  '-h': () => printHelp(),
};

const SCAN_HANDLERS: Record<string, ScanHandler> = {
  context: async (ctx) => (await import('./cli/context.js')).runContextCommand(ctx),
  scan: async (ctx) => (await import('./cli/scan.js')).runScanCommand(ctx),
  score: async (ctx) => (await import('./cli/score.js')).runScoreCommand(ctx),
  hotspots: async (ctx) => (await import('./cli/hotspots.js')).runHotspotsCommand(ctx),
  structure: async (ctx) => (await import('./cli/structure.js')).runStructureCommand(ctx),
  pin: async (ctx) => (await import('./cli/guard.js')).runPinCommand(ctx),
  guard: async (ctx) => (await import('./cli/guard.js')).runGuardCommand(ctx),
  fix: async (ctx) => (await import('./cli/fix.js')).runFixDispatch(ctx),
  pr: async (ctx) => (await import('./cli/pr.js')).runPrCommand(ctx),
};

const VALID_COMMANDS = new Set([...Object.keys(EARLY_HANDLERS), ...Object.keys(SCAN_HANDLERS)]);
const VALID_FORMATS = new Set<OutputFormat>(['human', 'json', 'sarif', 'markdown']);

function printHelp(): number {
  console.log([
    'unshit <command> [path] [options]',
    '',
    'Commands:',
    '  scan [path]    Read-only AST/CSS/clone/slop scan (--format human|json|sarif|markdown, --fail-on error|warn|info, --deep, --no-cache)',
    '  score [path]   Compute 0-100 codebase health score (--no-cache)',
    '  hotspots [path] Rank files by churn and finding density (--since 90.days, --top 10, --json, --no-cache)',
    '  structure [path] Diagnose project directory/module health (archetype, layout, cycles, boundary leaks, verdict, --fail-on error|warn|info, --no-cache)',
    '  pin [path]     Capture unshit.baseline.json characterization snapshot (--no-cache)',
    '  guard [path]   Fail CI/pre-commit on regressions (--changed [baseRef] for diff-only PRs, --lines for changed-line scope, --no-cache)',
    '  pr [path]      PR review: report findings introduced on branch changes vs base (--base <ref>, --format human|markdown|json)',
    '  fix [path]     Dry-run by default; pass --apply for deterministic fixes (+ --ai for OpenCode/Claude; --swarm for parallel worktree AI fixer; --abort to clean stale worktrees, --no-cache)',
    '  init [path]    Bootstrap config, baseline, and Claude Code PreToolUse hook (--force to overwrite)',
    '  hook [file]    Live AI Guardrail Hook (--stdin for Claude Code PreToolUse/PostToolUse, exits 2 on slop, --no-cache)',
    '  note <rule> "text"  Record a local false-positive / improvement / scope-gap note (--kind, --file) in .unshit/feedback.jsonl',
    '  notes [path]   Summarize recorded notes as a markdown backlog grouped by rule (--json)',
    '  mcp            Start stdio MCP server (unshit_scan, unshit_score, unshit_guard)',
  ].join('\n'));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0] ?? 'help';
  const rest = argv.slice(1);

  if (!VALID_COMMANDS.has(cmd)) {
    console.error(`Unknown command: ${cmd}. Run \`unshit help\`.`);
    return 2;
  }
  const early = EARLY_HANDLERS[cmd];
  if (early) return early(rest);

  const rawFormat = getOpt(rest, '--format') ?? (getFlag(rest, '--json') ? 'json' : 'human');
  if (!VALID_FORMATS.has(rawFormat as OutputFormat)) {
    console.error(`Invalid --format: ${rawFormat}. Expected human|json|sarif|markdown.`);
    return 2;
  }
  const format = rawFormat as OutputFormat;
  const noCache = getFlag(rest, '--no-cache');
  const targetDir = getTargetPath(rest);
  const { loadConfig } = await import('./config.js');
  const config = await loadConfig(targetDir);

  if (getFlag(rest, '--abort')) return (await import('./cli/fix.js')).runAbortCommand(targetDir);

  const deep = cmd === 'scan' && getFlag(rest, '--deep');
  const { runScan } = await import('./core/scanner.js');
  const scan = await runScan(targetDir, config, [], { noCache, deep });
  const { computeScore } = await import('./core/scorer.js');
  const score = computeScore(scan.files, scan.findings);

  const handler = SCAN_HANDLERS[cmd]!;
  return handler({ rest, targetDir, config, scan, score, format });
}
