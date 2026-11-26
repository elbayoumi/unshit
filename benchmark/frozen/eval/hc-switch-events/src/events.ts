function classify(event: string, retries: number): string {
  switch (event) {
    case 'click':
      if (retries > 2) return 'retry';
      return 'ok';
    case 'hover':
      return 'hover';
    default:
      if (event.length > 0 && retries > 0) return 'other';
      return 'unknown';
  }
}
console.log(classify('click', 3));
