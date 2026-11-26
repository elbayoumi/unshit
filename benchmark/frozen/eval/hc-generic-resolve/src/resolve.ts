type Box<T> = { value?: T; fallback?: T; retries: number };
function resolveConfig<T>(box: Box<T>): T | undefined {
  if (box.value !== undefined) {
    return box.value;
  }
  if (box.fallback !== undefined && box.retries > 0) {
    return box.fallback;
  }
  for (let i = 0; i < box.retries; i++) {
    if (i % 2 === 0 && box.fallback !== undefined) return box.fallback;
  }
  if (!box.retries || box.retries < 0) return undefined;
  return box.fallback;
}
console.log(resolveConfig({ retries: 1 }));
