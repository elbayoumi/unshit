import { errorMessage, getOpt, type CommandContext } from './shared.js';

export async function runHotspotsCommand({ targetDir, scan, rest, format }: CommandContext): Promise<number> {
  const since = getOpt(rest, '--since') ?? '90.days';
  const topRaw = getOpt(rest, '--top');
  const top = topRaw === undefined ? 10 : Number.parseInt(topRaw, 10);
  try {
    const { computeHotspots } = await import('../core/hotspots.js');
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
    console.error(`unshit hotspots: ${errorMessage(err)}`);
    return 2;
  }
}
