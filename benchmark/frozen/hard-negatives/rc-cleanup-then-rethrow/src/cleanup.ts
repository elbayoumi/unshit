function withMetrics(run: () => void): void {
  try {
    run();
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}
declare function recordFailure(error: unknown): void;
withMetrics(() => {});
