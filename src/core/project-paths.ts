export function normalizeRelPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function toSegments(value: string): string[] {
  return normalizeRelPath(value).split('/').filter((segment) => segment.length > 0);
}

export function basenameOf(normalized: string): string {
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

export function directoryOf(normalized: string): string {
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? '' : normalized.slice(0, slash);
}
