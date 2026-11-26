function unwrap<T>(compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    throw error;
  }
}
console.log(unwrap(() => 1));
