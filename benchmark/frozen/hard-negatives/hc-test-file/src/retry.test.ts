function tangled(value: number): number {
  if (value < 0) {
    if (value < -10) return -1;
    return -2;
  }
  for (let i = 0; i < value; i++) {
    if (i % 2 === 0 && i > 4) return i;
  }
  if (value > 3 || value === 7) return value;
  return 0;
}
console.log(tangled(8));
