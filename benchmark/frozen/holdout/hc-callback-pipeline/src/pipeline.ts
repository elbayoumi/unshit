type Step = (value: string) => string;
function pipe(steps: Step[], input: string): string {
  let current = input;
  for (const step of steps) {
    if (current.length === 0) break;
    if (step.name.startsWith('skip') && current === 'x') continue;
    current = step(current);
  }
  if (current.length > 0 && steps.length > 1) {
    current = current.trim();
  }
  while (steps.length > 3) {
    steps.pop();
  }
  return current;
}
console.log(pipe([(x) => x], 'a'));
