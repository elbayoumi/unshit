function normalizeOrders(rows, options) {
  if (rows === undefined) return 'none';
  if (options.limit && rows.length > 20) return 'many';
  return rows.slice(0, 3).join(',');
}
console.log(normalizeOrders([], {}));
