function pick<T extends any>(value: T): T {
  return value;
}
console.log(pick(1));
