function first(input, options) {
  if (!input) return 0;
  if (options.skip || input.hidden) return -1;
  return input.value;
}
function second(input, options) {
  if (!input) return 0;
  if (options.skip || input.hidden) return -1;
  return input.value;
}
console.log(first({}, {}), second({}, {}));
