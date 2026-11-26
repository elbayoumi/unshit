function run(): void {
  try {
    work();
  } catch (error: any) {
    console.warn(error.message);
  }
}
declare function work(): void;
run();
