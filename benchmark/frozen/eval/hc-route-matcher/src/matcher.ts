class RouteMatcher {
  match(path: string, method: string): boolean {
    if (path.startsWith('/api')) {
      if (method !== 'GET' && method !== 'HEAD') return false;
      for (const part of path.split('/')) {
        if (part.length > 0 && part.startsWith('_')) return false;
      }
      return true;
    }
    if (path === '/' ? method === 'GET' : method === 'POST') return true;
    if (path.length > 1 && path.endsWith('/')) return false;
    return true;
  }
}
console.log(new RouteMatcher().match('/', 'GET'));
