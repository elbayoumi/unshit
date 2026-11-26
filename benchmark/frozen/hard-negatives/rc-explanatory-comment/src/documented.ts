function maybeReset(): void {
  try {
    reset();
  } catch {
    // Reset is best-effort during shutdown; nothing to recover.
  }
}
declare function reset(): void;
maybeReset();
