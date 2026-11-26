function readNumber(raw: string): number {
  try {
    return Number(raw);
  } catch {
    return 0;
  }
}
console.log(readNumber('1'));
