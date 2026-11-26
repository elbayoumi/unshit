function parse(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
console.log(parse(1));
