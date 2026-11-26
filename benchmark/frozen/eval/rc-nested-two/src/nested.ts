function outer(value: number): number {
  try {
    if (value < 0) {
      try {
        return value;
      } catch (inner) {
        throw inner;
      }
    }
    return value;
  } catch {
  }
}
console.log(outer(1));
