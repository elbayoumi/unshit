function silent(): void {
  try {
    work();
  } catch {

  }
}
declare function work(): void;
silent();
