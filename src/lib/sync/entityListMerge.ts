/** دمج قوائم الكيانات حسب id — للتحديث اللحظي بدون refresh */
export function upsertById<T extends { id: string }>(
  prev: T[],
  item: T,
  sort?: (a: T, b: T) => number,
): T[] {
  const next = prev.filter((x) => x.id !== item.id);
  const merged = [item, ...next];
  if (sort) merged.sort(sort);
  return merged;
}

export function removeById<T extends { id: string }>(prev: T[], id: string): T[] {
  return prev.filter((x) => x.id !== id);
}

export function prependUniqueAudit<T extends { id: string }>(prev: T[], item: T, max = 500): T[] {
  const next = [item, ...prev.filter((x) => x.id !== item.id)];
  return next.length > max ? next.slice(0, max) : next;
}
