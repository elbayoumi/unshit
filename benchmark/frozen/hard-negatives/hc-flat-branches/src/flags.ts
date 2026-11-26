function flags(n: number): string {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  if (n === 3) return 'three';
  if (n === 4) return 'four';
  if (n === 5) return 'five';
  if (n === 6) return 'six';
  if (n === 7) return 'seven';
  return 'many';
}
console.log(flags(9));
