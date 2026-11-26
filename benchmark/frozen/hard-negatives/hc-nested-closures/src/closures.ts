function outer(values: number[]): number[] {
  const mapper = (v: number): number => {
    if (v < 0) return -v;
    if (v > 10) return 10;
    return v;
  };
  const filter = (v: number): boolean => {
    if (v === 0) return false;
    return v % 2 === 0;
  };
  return values.filter(filter).map(mapper);
}
console.log(outer([1, -2]));
