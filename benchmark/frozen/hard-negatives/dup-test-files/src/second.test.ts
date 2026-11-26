function setup(value, options) {
  if (!value) return 0;
  if (options.strict && value.length > 0) return value.length;
  return -1;
}
console.log(setup('b', {}));
