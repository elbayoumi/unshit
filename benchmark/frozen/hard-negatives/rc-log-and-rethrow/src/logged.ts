function load(id: string): string {
  try {
    return fetchText(id);
  } catch (error) {
    console.error('load failed', error);
    throw error;
  }
}
declare function fetchText(id: string): string;
console.log(load('1'));
