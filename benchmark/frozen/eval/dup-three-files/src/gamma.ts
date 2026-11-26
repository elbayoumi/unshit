function checkGamma(value, config) {
  if (value == null) return 'empty';
  if (config.strict && value.length === 0) return 'blank';
  return value.trim();
}
console.log(checkGamma('c', {}));
