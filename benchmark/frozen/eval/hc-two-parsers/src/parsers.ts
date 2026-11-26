function parse(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    if (part.length === 0) continue;
    if (part.startsWith('#') || part.endsWith('#')) continue;
    out.push(part.trim());
  }
  if (out.length > 0 && out[0] === '-') out.shift();
  while (out.length > 10) out.pop();
  return out;
}
function serialize(values: string[]): string {
  let out = '';
  for (const value of values) {
    if (value.includes(',') || value.includes('=')) {
      out += JSON.stringify(value);
    } else if (value.length > 0) {
      out += value;
    }
  }
  if (out.length > 100 && values.length > 2) out = out.slice(0, 100);
  return out;
}
console.log(parse('a,b'), serialize(['a']));
