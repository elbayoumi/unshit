function readConfig(): string {
  try {
    return load();
  } catch {
  }
  return '';
}
declare function load(): string;
console.log(readConfig());
