import { getApiBaseUrl } from '@/config/api';
import { isSupabaseDirectMode } from '@/config/supabaseMode';
import {
  fetchManualJournalsSb,
  createManualJournalSb,
  patchManualJournalSb,
  deleteManualJournalSb,
} from '@/lib/supabase/directApiSb';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('prod_system_jwt');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function fetchManualJournalsApi(): Promise<
  import('@/app/context/DataContext').ManualJournalEntry[]
> {
  if (isSupabaseDirectMode()) return fetchManualJournalsSb();
  const r = await fetch(`${getApiBaseUrl()}/api/manual-journals`, { headers: authHeaders() });
  if (!r.ok) throw new Error('fetch manual journals');
  const data = await r.json();
  return Array.isArray(data.journals) ? data.journals : [];
}

export async function createManualJournalApi(
  entry: import('@/app/context/DataContext').ManualJournalEntry
): Promise<import('@/app/context/DataContext').ManualJournalEntry> {
  if (isSupabaseDirectMode()) {
    return createManualJournalSb({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      lines: entry.lines,
    });
  }
  const r = await fetch(`${getApiBaseUrl()}/api/manual-journals`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      lines: entry.lines,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'create journal');
  return data.journal as import('@/app/context/DataContext').ManualJournalEntry;
}

export async function updateManualJournalApi(
  id: string,
  patch: { date: string; description: string; lines: import('@/app/context/DataContext').ManualJournalLine[] },
): Promise<import('@/app/context/DataContext').ManualJournalEntry> {
  if (isSupabaseDirectMode()) {
    return patchManualJournalSb(id, patch);
  }
  const r = await fetch(`${getApiBaseUrl()}/api/manual-journals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'update journal');
  return data.journal as import('@/app/context/DataContext').ManualJournalEntry;
}

export async function deleteManualJournalApi(id: string): Promise<void> {
  if (isSupabaseDirectMode()) return deleteManualJournalSb(id);
  const r = await fetch(`${getApiBaseUrl()}/api/manual-journals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (r.status === 204) return;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'delete journal');
}
