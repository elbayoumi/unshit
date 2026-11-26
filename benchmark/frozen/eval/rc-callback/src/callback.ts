function runTask(task: () => void): void {
  Promise.resolve().then(() => {
    try {
      task();
    } catch {
    }
  });
}
runTask(() => {});
