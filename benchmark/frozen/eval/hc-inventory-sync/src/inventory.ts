declare function fetchRow(id: number): Promise<{ active: boolean }>;
async function syncInventory(ids: number[], offline: boolean): Promise<number> {
  let synced = 0;
  for (const id of ids) {
    if (id <= 0) continue;
    try {
      const row = await fetchRow(id);
      if (row && row.active) synced++;
    } catch (err) {
      if (offline) continue;
      console.log(err);
    }
  }
  return synced;
}
console.log(syncInventory([1], true));
