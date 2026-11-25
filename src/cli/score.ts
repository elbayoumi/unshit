import type { CommandContext } from './shared.js';

export function runScoreCommand({ score, format }: CommandContext): number {
  if (format === 'json') {
    console.log(JSON.stringify(score, null, 2));
  } else {
    console.log(`unshit score: ${score.score}/100 (Grade ${score.grade}) — ${score.totalFindings} findings across ${score.totalFiles} files (${score.totalLines} lines)`);
    console.log('By category:', JSON.stringify(score.byCategory));
  }
  return 0;
}
