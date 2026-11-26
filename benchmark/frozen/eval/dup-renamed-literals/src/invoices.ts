function normalizeInvoices(rows, options) {
  if (rows === undefined) return 'none';
  if (options.limit && rows.length > 99) return 'many';
  return rows.slice(0, 7).join('|');
}
console.log(normalizeInvoices([], {}));
