import { errorMessage, getOpt, type CommandContext } from './shared.js';

export async function runPrCommand({ targetDir, scan, rest }: CommandContext): Promise<number> {
  const { reviewPullRequest, isGitWorkTree, resolvePrBaseRef, formatPrHuman, formatPrMarkdown, formatPrJson } = await import('../core/pr-review.js');
  const format = getOpt(rest, '--format') ?? 'human';
  if (!['human', 'markdown', 'json'].includes(format)) {
    console.error(`Invalid --format: ${format}. Expected human|markdown|json.`);
    return 2;
  }
  if (!(await isGitWorkTree(targetDir))) {
    console.error(`unshit pr: not a git work tree at ${targetDir}`);
    return 2;
  }
  const baseRef = await resolvePrBaseRef(targetDir, getOpt(rest, '--base'));
  let report: Awaited<ReturnType<typeof reviewPullRequest>>;
  try {
    report = await reviewPullRequest(targetDir, scan, { baseRef });
  } catch (err) {
    console.error(`unshit pr: ${errorMessage(err)}`);
    return 2;
  }
  if (format === 'json') console.log(formatPrJson(report));
  else if (format === 'markdown') console.log(formatPrMarkdown(report));
  else console.log(formatPrHuman(report));
  return report.errorCount > 0 ? 1 : 0;
}
