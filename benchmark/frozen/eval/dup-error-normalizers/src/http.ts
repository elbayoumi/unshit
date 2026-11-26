function normalizeHttpError(error, fallback) {
  if (!error) return fallback;
  if (error.retryable && error.code < 500) return 'retry';
  return error.message || 'unknown';
}
console.log(normalizeHttpError({}, 'x'));
