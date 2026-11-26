function process(input: string): string {
  try {
    try {
      return parse(input);
    } catch (inner) {
      console.warn(inner);
      return '';
    }
  } catch (error) {
    console.error(error);
    return 'failed';
  }
}
declare function parse(input: string): string;
console.log(process('{}'));
