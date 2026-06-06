import { coerceAccountingWorkspaceArray } from '@/lib/accounting/accountingWorkspacePersistence';
import { getSupabase } from '@/lib/supabase/client';
import { getSupabaseActor } from '@/lib/supabase/getActor';

const SINGLE_ID = 'default';

const OWNER_KEYS = new Set([
  'closedFiscalYears',
  'printBranding',
  'leadIngestion',
  'slaEscalation',
  'leadDataQuality',
  'workflowRules',
  'integrations',
  'entityComments',
  'uiVisualMode',
  'seoIntelligenceStore',
]);

const ACCOUNTING_KEYS = new Set([
  'chartOfAccounts',
  'payrollApprovals',
  'payrollApprovalRequests',
  'financialReopenRequests',
  'openingBalancesByYear',
  'journalCodebook',
  'customerCodePrefix',
  'expenseCodebook',
  'expenseSavedViews',
  'payrollAutoSendDay',
  'expenseEscalations',
]);

const PAYROLL_SALES_DISCOUNT_KEYS = new Set(['payrollSalesDiscounts']);

const EQUIPMENT_KEYS = new Set(['equipmentItems']);
const BOOKING_MISC_KEYS = new Set(['otherBookings']);
const PERSONAL_KEYS = new Set(['personalTodosByUserId', 'notifyForegroundByUserId']);
const ALL_ROLES = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];

function canPatchKey(key: string, role: string): boolean {
  if (!role) return false;
  if (PERSONAL_KEYS.has(key)) return ALL_ROLES.includes(role);
  if (BOOKING_MISC_KEYS.has(key)) return ALL_ROLES.includes(role);
  if (OWNER_KEYS.has(key)) return role === 'مالك';
  if (ACCOUNTING_KEYS.has(key)) return role === 'مالك' || role === 'محاسب';
  if (PAYROLL_SALES_DISCOUNT_KEYS.has(key)) return role === 'مالك' || role === 'مدير إنتاج';
  if (EQUIPMENT_KEYS.has(key)) return role === 'مالك' || role === 'محاسب' || role === 'مدير إنتاج';
  return false;
}

const OTHER_BOOKINGS_MAX = 400;
const STR = (x: unknown) => (typeof x === 'string' ? x : '');

function normalizeOtherBookingsPatch(val: unknown): unknown[] | null {
  if (!Array.isArray(val)) return null;
  const out: unknown[] = [];
  for (const item of val.slice(0, OTHER_BOOKINGS_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = STR(o.id).trim().slice(0, 120);
    const title = STR(o.title).trim().slice(0, 200);
    const statement = STR(o.statement).trim().slice(0, 4000);
    if (!id || !statement) continue;
    out.push({
      id,
      title: title || 'حجز آخر',
      statement,
      date: typeof o.date === 'string' && o.date.trim() ? String(o.date).trim().slice(0, 32) : undefined,
      createdAt:
        typeof o.createdAt === 'string' && o.createdAt.trim()
          ? o.createdAt.trim().slice(0, 40)
          : new Date().toISOString(),
      createdById: STR(o.createdById).trim().slice(0, 120),
      createdByName: STR(o.createdByName).trim().slice(0, 160),
    });
  }
  return out;
}

function normalizeAccountingPatchValue(key: string, val: unknown): unknown {
  if (key === 'chartOfAccounts' || key === 'journalCodebook') {
    return coerceAccountingWorkspaceArray(val);
  }
  return val;
}

function sanitizeAccountingDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out = { ...doc };
  if (Object.prototype.hasOwnProperty.call(out, 'chartOfAccounts')) {
    out.chartOfAccounts = coerceAccountingWorkspaceArray(out.chartOfAccounts);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'journalCodebook')) {
    out.journalCodebook = coerceAccountingWorkspaceArray(out.journalCodebook);
  }
  return out;
}

function deepMergeDoc(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    out[k] = normalizeAccountingPatchValue(k, v);
  }
  return out;
}

export async function fetchWorkspaceStateSb(): Promise<Record<string, unknown>> {
  const sb = getSupabase();
  const { data, error } = await sb.from('workspace_state').select('doc_json').eq('id', SINGLE_ID).maybeSingle();
  if (error) throw new Error(error.message);
  const doc = (data as { doc_json?: unknown } | null)?.doc_json;
  return doc && typeof doc === 'object'
    ? sanitizeAccountingDoc(doc as Record<string, unknown>)
    : {};
}

export async function patchWorkspaceStateSb(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return fetchWorkspaceStateSb();

  for (const k of keys) {
    if (
      !OWNER_KEYS.has(k) &&
      !ACCOUNTING_KEYS.has(k) &&
      !EQUIPMENT_KEYS.has(k) &&
      !PERSONAL_KEYS.has(k) &&
      !BOOKING_MISC_KEYS.has(k)
    ) {
      throw new Error(`مفتاح غير مدعوم: ${k}`);
    }
    if (!canPatchKey(k, actor.role)) {
      throw new Error(`غير مصرح بتعديل: ${k}`);
    }
  }

  const { data: row, error: readErr } = await sb
    .from('workspace_state')
    .select('doc_json')
    .eq('id', SINGLE_ID)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);

  let cur =
    row && typeof (row as { doc_json?: unknown }).doc_json === 'object'
      ? sanitizeAccountingDoc(
          { ...((row as { doc_json: Record<string, unknown> }).doc_json || {}) } as Record<string, unknown>,
        )
      : {};

  let patchForMerge = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'otherBookings')) {
    const norm = normalizeOtherBookingsPatch(patch.otherBookings);
    if (norm === null) throw new Error('otherBookings غير صالح');
    patchForMerge = { ...patchForMerge, otherBookings: norm };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'personalTodosByUserId')) {
    const inc = patch.personalTodosByUserId;
    if (inc !== null && typeof inc !== 'object') throw new Error('personalTodosByUserId غير صالح');
    const incoming = (inc || {}) as Record<string, unknown>;
    if (actor.role !== 'مالك') {
      for (const uid of Object.keys(incoming)) {
        if (uid !== actor.id) throw new Error('يمكن تحديث مهامك الشخصية فقط');
      }
    }
    for (const [, arr] of Object.entries(incoming)) {
      if (!Array.isArray(arr)) throw new Error('قائمة مهام غير صالحة');
    }
    const base =
      cur.personalTodosByUserId && typeof cur.personalTodosByUserId === 'object'
        ? (cur.personalTodosByUserId as Record<string, unknown>)
        : {};
    patchForMerge = {
      ...patchForMerge,
      personalTodosByUserId: { ...base, ...incoming },
    };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notifyForegroundByUserId')) {
    const inc = patch.notifyForegroundByUserId;
    if (inc !== null && typeof inc !== 'object') throw new Error('notifyForegroundByUserId غير صالح');
    const incoming = (inc || {}) as Record<string, unknown>;
    if (actor.role !== 'مالك') {
      for (const uid of Object.keys(incoming)) {
        if (uid !== actor.id) throw new Error('يمكن تحديث إعداد إشعارك فقط');
      }
    }
    for (const [, val] of Object.entries(incoming)) {
      if (typeof val !== 'boolean') throw new Error('قيمة notifyForegroundByUserId غير صالحة');
    }
    const base =
      cur.notifyForegroundByUserId && typeof cur.notifyForegroundByUserId === 'object'
        ? (cur.notifyForegroundByUserId as Record<string, unknown>)
        : {};
    patchForMerge = {
      ...patchForMerge,
      notifyForegroundByUserId: { ...base, ...incoming },
    };
  }

  const next = deepMergeDoc(cur, patchForMerge as Record<string, unknown>);
  const { data: updated, error: upErr } = await sb
    .from('workspace_state')
    .upsert(
      { id: SINGLE_ID, doc_json: next, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select('doc_json')
    .single();
  if (upErr) throw new Error(upErr.message);
  const doc = (updated as { doc_json?: unknown })?.doc_json;
  return doc && typeof doc === 'object'
    ? sanitizeAccountingDoc(doc as Record<string, unknown>)
    : {};
}
