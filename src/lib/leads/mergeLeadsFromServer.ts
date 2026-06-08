import type { Lead } from '@/app/context/DataContext';

export const OPTIMISTIC_LEAD_ID_PREFIX = 't-';

export function isOptimisticLeadId(id: string): boolean {
  return String(id).startsWith(OPTIMISTIC_LEAD_ID_PREFIX);
}

/** دمج ليدز السيرفر مع إنشاءات محلية مؤقتة (قبل رد API) — يمنع اختفاء الليد بعد المزامنة */
export function mergeLeadsFromServer(prev: Lead[], server: Lead[]): Lead[] {
  const serverById = new Map(server.map((l) => [l.id, l]));
  const pending = prev.filter((l) => isOptimisticLeadId(l.id) && !serverById.has(l.id));
  const merged = [...server, ...pending];
  merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return merged;
}

export function upsertLeadInList(prev: Lead[], lead: Lead): Lead[] {
  const withoutTempDupes = prev.filter(
    (l) => l.id !== lead.id && !(isOptimisticLeadId(l.id) && l.phone === lead.phone),
  );
  const idx = withoutTempDupes.findIndex((l) => l.id === lead.id);
  if (idx >= 0) {
    const next = [...withoutTempDupes];
    next[idx] = lead;
    next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return next;
  }
  return [lead, ...withoutTempDupes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function removeLeadFromList(prev: Lead[], id: string): Lead[] {
  return prev.filter((l) => l.id !== id);
}
