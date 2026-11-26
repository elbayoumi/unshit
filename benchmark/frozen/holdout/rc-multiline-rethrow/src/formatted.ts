function compute(n: number): number {
  try {
    return n * 2;
  } catch (
    error
  ) {
    throw error;
  }
}
console.log(compute(2));
