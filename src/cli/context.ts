import { getFlag, getTargetPath, type CommandContext } from './shared.js';

export async function runContextCommand({ rest, scan }: CommandContext): Promise<number> {
  const { generateContextBlock, writeContextBlock } = await import('../core/context.js');
  if (!getFlag(rest, '--write')) {
    process.stdout.write(`${generateContextBlock(scan)}\n`);
    return 0;
  }
  await writeContextBlock(getTargetPath(rest), generateContextBlock(scan));
  return 0;
}
