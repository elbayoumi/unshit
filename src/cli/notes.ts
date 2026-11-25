import { getFlag, getOpt, getTargetPath } from './shared.js';

export async function runNoteCommand(rest: string[]): Promise<number> {
  const { addFeedback, isFeedbackKind, FEEDBACK_KINDS } = await import('../core/feedback.js');
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

export async function runNotesCommand(rest: string[]): Promise<number> {
  const { readFeedback, summarizeFeedback } = await import('../core/feedback.js');
  const entries = await readFeedback(getTargetPath(rest));
  console.log(getFlag(rest, '--json') ? JSON.stringify(entries, null, 2) : summarizeFeedback(entries));
  return 0;
}
