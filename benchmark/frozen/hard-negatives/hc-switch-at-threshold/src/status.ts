function status(code: number): string {
  switch (code) {
    case 200: return 'ok';
    case 201: return 'created';
    case 204: return 'empty';
    case 400: return 'bad';
    default: return 'unknown';
  }
}
console.log(status(200));
