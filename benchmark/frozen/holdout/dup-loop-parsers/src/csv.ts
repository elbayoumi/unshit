function parseCsv(text, options) {
  const rows = [];
  for (const line of text.split('
')) {
    if (!line || line.startsWith('#')) continue;
    if (options.trim && line.length > 0) rows.push(line.trim());
  }
  return rows;
}
console.log(parseCsv('a', {}));
