import { getSupabase } from '@/lib/supabase/client';
import type {
  Lead,
  User,
  ManualCustomer,
  Expense,
  PriceQuote,
  ManualJournalEntry,
  MonthlyTarget,
  AuditEvent,
  ShootBooking,
  EquipmentBooking,
  MeetingBooking,
  AttendanceRecord,
} from '@/app/context/DataContext';
import { fetchAllLeadsFromSupabase } from '@/lib/supabase/fetchAllLeads';
import {
  mapLeadFromRow,
  mapUserFromRow,
  mapManualCustomerFromRow,
  mapExpenseFromRow,
  mapPriceQuoteFromRow,
  mapManualJournalFromRow,
  mapAccountingPolicyFromRow,
  mapClosedMonthFromRow,
  mapMonthlyTargetFromRow,
  mapCustodySettingsMap,
  mapAuditFromRow,
  mapDocJsonRow,
  mapAttendanceFromRow,
  mapInvoiceRowRaw,
} from '@/lib/supabase/postgrestMappers';

export type SupabaseWorkspaceSnapshot = {
  leadsList: Lead[];
  rawUsers: User[];
  customers: ManualCustomer[];
  invsRaw: Record<string, unknown>[];
  exps: Expense[];
  quotes: PriceQuote[];
  pol: ReturnType<typeof mapAccountingPolicyFromRow>;
  journals: ManualJournalEntry[];
  closedM: string[];
  targets: MonthlyTarget[];
  custodyMap: Record<string, string> | null;
  auditList: AuditEvent[];
  custodyList: unknown[];
  shootList: ShootBooking[];
  equipList: EquipmentBooking[];
  meetList: MeetingBooking[];
  workspaceDoc: Record<string, unknown>;
  attendanceRec: AttendanceRecord[];
};

type SbRead = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function rows<T>(
  promise: SbRead,
  map: (r: Record<string, unknown>) => T,
): Promise<T[]> {
  try {
    const { data, error } = await Promise.resolve(promise);
    if (error) {
      console.warn('[supabase workspace]', error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data.map((x) => map(x as Record<string, unknown>));
  } catch (e) {
    console.warn('[supabase workspace]', e);
    return [];
  }
}

async function singleDocRows<T>(
  promise: SbRead,
): Promise<T[]> {
  try {
    const { data, error } = await Promise.resolve(promise);
    if (error) {
      console.warn('[supabase workspace]', error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    const out: T[] = [];
    for (const row of data) {
      const doc = mapDocJsonRow<T>(row as Record<string, unknown>);
      if (doc) out.push(doc);
    }
    return out;
  } catch (e) {
    console.warn('[supabase workspace]', e);
    return [];
  }
}

export async function fetchSupabaseWorkspaceSnapshot(): Promise<SupabaseWorkspaceSnapshot> {
  const sb = getSupabase();

  const [
    leadsList,
    rawUsers,
    customers,
    invsRaw,
    exps,
    quotes,
    polRow,
    journals,
    closedRows,
    targets,
    custodyRow,
    auditList,
    custodyDocs,
    shootRows,
    equipRows,
    meetRows,
    wsRow,
    attendanceRec,
  ] = await Promise.all([
    (async () => {
      try {
        return await fetchAllLeadsFromSupabase(sb);
      } catch (e) {
        console.warn('[supabase workspace] leads fetch failed', e);
        return [];
      }
    })(),
    rows(
      sb
        .from('users')
        .select('id,email,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at')
        .order('name', { ascending: true }),
      mapUserFromRow,
    ),
    rows(sb.from('manual_customers').select('*').order('created_at', { ascending: false }), mapManualCustomerFromRow),
    (async () => {
      const { data, error } = await sb.from('invoices').select('*').order('date', { ascending: false });
      if (error) {
        console.warn('[supabase workspace]', error.message);
        return [];
      }
      return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    })(),
    rows(sb.from('expenses').select('*').order('date', { ascending: false }), mapExpenseFromRow),
    rows(sb.from('price_quotes').select('*').order('created_at', { ascending: false }), mapPriceQuoteFromRow),
    (async () => {
      const { data, error } = await sb.from('accounting_policy').select('*').eq('id', 'default').maybeSingle();
      if (error) {
        console.warn('[supabase workspace]', error.message);
        return null;
      }
      return data ? mapAccountingPolicyFromRow(data as Record<string, unknown>) : null;
    })(),
    rows(sb.from('manual_journal_entries').select('*').order('date', { ascending: false }).limit(500), mapManualJournalFromRow),
    rows(sb.from('closed_months').select('*'), mapClosedMonthFromRow),
    rows(sb.from('monthly_targets').select('*'), mapMonthlyTargetFromRow),
    (async () => {
      const { data, error } = await sb.from('custody_settings').select('*').limit(1).maybeSingle();
      if (error) {
        console.warn('[supabase workspace]', error.message);
        return null;
      }
      return data ? mapCustodySettingsMap(data as Record<string, unknown>) : null;
    })(),
    rows(sb.from('audit_events').select('*').order('created_at', { ascending: false }).limit(500), mapAuditFromRow),
    singleDocRows<Record<string, unknown>>(sb.from('custody_funds').select('id,doc_json,updated_at').order('updated_at', { ascending: false })),
    singleDocRows<ShootBooking>(sb.from('shoot_bookings').select('id,doc_json,updated_at').order('updated_at', { ascending: false })),
    singleDocRows<EquipmentBooking>(sb.from('equipment_bookings').select('id,doc_json,updated_at').order('updated_at', { ascending: false })),
    singleDocRows<MeetingBooking>(sb.from('meeting_bookings').select('id,doc_json,updated_at').order('updated_at', { ascending: false })),
    (async () => {
      const { data, error } = await sb.from('workspace_state').select('*').eq('id', 'default').maybeSingle();
      if (error) {
        console.warn('[supabase workspace]', error.message);
        return {};
      }
      const doc = (data as { doc_json?: unknown } | null)?.doc_json;
      return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
    })(),
    rows(
      sb.from('attendance_records').select('*').order('created_at', { ascending: false }).limit(2000),
      mapAttendanceFromRow,
    ),
  ]);

  const closedMonthsClean = closedRows.filter((k) => {
    if (typeof k !== 'string' || !/^\d{4}-\d{2}$/.test(k)) return false;
    const m = Number(k.slice(5, 7));
    return m >= 1 && m <= 12;
  });

  return {
    leadsList,
    rawUsers,
    customers,
    invsRaw,
    exps,
    quotes,
    pol: polRow,
    journals,
    closedM: closedMonthsClean,
    targets,
    custodyMap: custodyRow,
    auditList,
    custodyList: custodyDocs,
    shootList: shootRows,
    equipList: equipRows,
    meetList: meetRows,
    workspaceDoc: wsRow,
    attendanceRec,
  };
}

/** تصفية البيانات المحمّلة حسب الدور — يقلّل تسريب CRM في وضع Supabase المباشر */
export function filterWorkspaceSnapshotForViewer(
  snap: SupabaseWorkspaceSnapshot,
  viewer: { id: string; role: User['role'] },
): SupabaseWorkspaceSnapshot {
  const uid = String(viewer.id).trim();
  if (viewer.role === 'مندوب') {
    const myLeadIds = new Set(
      snap.leadsList.filter((l) => String(l.assignedTo || '').trim() === uid).map((l) => l.id),
    );
    return {
      ...snap,
      leadsList: snap.leadsList.filter((l) => String(l.assignedTo || '').trim() === uid),
      quotes: snap.quotes.filter((q) => String(q.createdById || '').trim() === uid),
      invsRaw: snap.invsRaw.filter((raw) => myLeadIds.has(String((raw as { lead_id?: string }).lead_id || ''))),
      rawUsers: snap.rawUsers.map((u) =>
        u.id === uid ? u : { ...u, email: undefined, baseSalary: undefined },
      ),
    };
  }
  if (viewer.role === 'مدير إنتاج') {
    return {
      ...snap,
      quotes: snap.quotes.filter(
        (q) =>
          String(q.productionAssignedId || '').trim() === uid ||
          String(q.pricedById || '').trim() === uid,
      ),
      shootList: snap.shootList.filter(
        (b) => String(b.productionAssignedId || '').trim() === uid,
      ),
      invsRaw: [],
    };
  }
  if (viewer.role === 'محاسب') {
    const approvedLeadIds = new Set(
      snap.invsRaw
        .filter((raw) => String((raw as { record_origin?: string }).record_origin || '') === 'عرض_سعر_معتمد')
        .map((raw) => String((raw as { lead_id?: string }).lead_id || ''))
        .filter((id) => id && id !== 'manual'),
    );
    return {
      ...snap,
      leadsList: snap.leadsList.filter((l) => approvedLeadIds.has(l.id)),
      quotes: snap.quotes.filter((q) => q.status === 'مكتمل' || Boolean(q.invoiceId)),
      rawUsers: snap.rawUsers.map((u) => ({ ...u, baseSalary: undefined })),
    };
  }
  return snap;
}

export { mapInvoiceRowRaw };
