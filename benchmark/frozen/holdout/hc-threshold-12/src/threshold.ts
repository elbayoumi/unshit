function route(region: string, tier: number, beta: boolean): string {
  if (region === 'eu') {
    if (tier > 2) {
      if (beta && tier > 4) return 'eu-beta-vip';
      return 'eu-vip';
    }
    return 'eu';
  }
  if (region === 'us') {
    if (tier > 1) return 'us-plus';
    return 'us';
  }
  for (const part of region.split('-')) {
    if (part.length === 0 || part === 'x') continue;
    return part;
  }
  if (beta || tier < 0) return 'fallback';
  return 'other';
}
console.log(route('eu', 5, true));
