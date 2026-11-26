function mapGeneric(items, fn, fallback) {
  if (!items) return fallback;
  if (fn === undefined || items.length === 0) return fallback;
  return items.map(fn);
}
console.log(mapGeneric([], (x) => x, 0));
