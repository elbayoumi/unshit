function classify(n: number): string {
  if (n < 0) return 'negative';
  if (n === 0) return 'zero';
  if (n > 100 && n < 200) return 'range';
  for (let i = 0; i < 2; i++) {
    if (i === n) return 'found';
  }
  return 'other';
}
console.log(classify(3));
