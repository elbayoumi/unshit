function mapConcrete(items, fallback) {
  if (items === null) return fallback;
  if (items.length === 0) return fallback;
  return items.map((x) => x * 2);
}
console.log(mapConcrete([], 0));
