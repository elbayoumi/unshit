function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    const wrapped = error;
    throw wrapped;
  }
}
console.log(decode('a'));
