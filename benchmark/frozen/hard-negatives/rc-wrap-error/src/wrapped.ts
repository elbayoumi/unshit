function wrap(raw: string): string {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('invalid payload', { cause: error });
  }
}
console.log(wrap('{}'));
