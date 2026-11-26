/** @param {any} value - legacy JSDoc escaped as text */
function documented(value: unknown): string {
  return String(value);
}
console.log(documented(1));
