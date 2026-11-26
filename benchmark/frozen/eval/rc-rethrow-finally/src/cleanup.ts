function withCleanup(run: () => void): void {
  try {
    run();
  } catch (error) {
    throw error;
  } finally {
    close();
  }
}
declare function close(): void;
withCleanup(() => {});
