function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch (error: unknown) {
    throw error;
  }
}
console.log(decode('a'));
