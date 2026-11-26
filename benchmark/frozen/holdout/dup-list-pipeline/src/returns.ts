function activeReturns(items, filter) {
  if (!items) return [];
  if (filter.skipArchived && items.length > 0) return items.filter((x) => x.active);
  return items.map((x) => x.id);
}
console.log(activeReturns([], {}));
