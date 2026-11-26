function parse(input: string): string {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw error;
  }
}
console.log(parse('{}'));
