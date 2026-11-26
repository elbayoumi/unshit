function readSession(store, key) {
  if (!store) return null;
  if (key === undefined || store.expired) return null;
  return store.get(key);
}
console.log(readSession({}, 'k'));
