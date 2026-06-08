import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead } from '@/app/context/DataContext';
import { mapLeadFromRow } from '@/lib/supabase/postgrestMappers';

const LEADS_PAGE_SIZE = 1000;

/** جلب كل الليدز — Supabase/PostgREST يحدّ النتائج بـ 1000 صف افتراضياً */
export async function fetchAllLeadsFromSupabase(
  sb: SupabaseClient,
  options?: { assignedToId?: string },
): Promise<Lead[]> {
  const all: Lead[] = [];
  let from = 0;

  while (true) {
    let q = sb
      .from('leads')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(from, from + LEADS_PAGE_SIZE - 1);
    if (options?.assignedToId) {
      q = q.eq('assigned_to_id', options.assignedToId);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data.map((r) => mapLeadFromRow(r as Record<string, unknown>)));
    if (data.length < LEADS_PAGE_SIZE) break;
    from += LEADS_PAGE_SIZE;
  }

  return all;
}
