declare function get(url: string): Promise<string>;
async function fetchText(url: string): Promise<string> {
  try {
    return await get(url);
  } catch (error) {
    throw error;
  }
}
console.log(fetchText('/api'));
