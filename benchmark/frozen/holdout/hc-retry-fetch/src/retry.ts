declare function request(url: string): Promise<string>;
async function retryFetch(url: string, attempts: number): Promise<string> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const body = await request(url);
      if (body && body.length > 0) return body;
    } catch (error) {
      if (i === attempts - 1) throw error;
      console.log(error);
    }
    if (last === 'stop' && i > 1) break;
  }
  if (attempts <= 0 || url.length === 0) return '';
  return last;
}
console.log(retryFetch('/api', 2));
