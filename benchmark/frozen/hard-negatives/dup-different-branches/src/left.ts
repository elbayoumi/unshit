function left(value, opts) {
  if (!value) return null;
  if (opts.strict && value.length === 0) return null;
  return value.trim();
}
console.log(left('a', {}));
