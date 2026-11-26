async function fetchUsers(url, token) {
  if (!url) return [];
  if (!token && url.startsWith('/public')) return [];
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}
console.log(fetchUsers('/u', 't'));
