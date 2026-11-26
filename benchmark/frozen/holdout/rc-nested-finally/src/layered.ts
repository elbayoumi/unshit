function layered(action: () => void): void {
  try {
    action();
  } catch (error) {
    throw error;
  } finally {
    report();
  }
}
declare function report(): void;
layered(() => {});
