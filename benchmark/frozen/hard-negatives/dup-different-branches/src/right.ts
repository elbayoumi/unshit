function right(value, opts) {
  if (opts.strict && value.length === 0) return null;
  if (!value) return null;
  return value.trim();
}
console.log(right('a', {}));
