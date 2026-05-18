/**
 * تنفيذات PostgREST لمسارات REST عند VITE_USE_SUPABASE — تُستدعى من src/lib/api/*
 */
import { getSupabase } from '@/lib/supabase/client';
import { getSupabaseActor } from '@/lib/supabase/getActor';
import { normalizeInvoiceFromRow } from '@/lib/supabase/invoiceNormalize';
import { validateManualJournalLines } from '@/lib/accounting/validateManualJournalLines';
import {
  mapLeadFromRow,
  mapUserFromRow,
  mapManualCustomerFromRow,
  mapExpenseFromRow,
  mergeProductionSpendLinesIntoRawNote,
  mapPriceQuoteFromRow,
  mapManualJournalFromRow,
  mapAccountingPolicyFromRow,
  mapClosedMonthFromRow,
  mapMonthlyTargetFromRow,
  mapCustodySettingsMap,
  mapAuditFromRow,
  mapAttendanceFromRow,
} from '@/lib/supabase/postgrestMappers';
import type {
  Lead,
  User,
  ManualCustomer,
  Invoice,
  Expense,
  PriceQuote,
  ManualJournalEntry,
  AccountingPolicy,
  MonthlyTarget,
  AuditEvent,
  AttendanceRecord,
  CustodySpendLine,
} from '@/app/context/DataContext';

function newId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/* ---------- leads ---------- */
export async function fetchLeadsSb(): Promise<Lead[]> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  let q = sb.from('leads').select('*').order('updated_at', { ascending: false });
  if (actor.role === 'مندوب') {
    q = q.eq('assigned_to_id', actor.id);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapLeadFromRow(r as Record<string, unknown>));
}

/* ---------- users ---------- */
export async function fetchUsersSb(): Promise<User[]> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  const fullDirectory =
    actor.role === 'مالك' ||
    actor.role === 'مدير مبيعات' ||
    actor.role === 'محاسب' ||
    actor.role === 'مدير إنتاج';
  const { data, error } = await sb
    .from('users')
    .select('id,email,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const u = mapUserFromRow(row as Record<string, unknown>);
    if (fullDirectory) return u;
    const { email: _e, baseSalary: _b, ...rest } = u;
    return { ...rest, email: undefined, baseSalary: undefined };
  });
}

function makePlaceholderEmailSb(name: string): string {
  const base = String(name || 'staff')
    .replace(/[^\w\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'staff';
  let rand = '';
  try {
    rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  } catch {
    rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  return `${base}-${rand}@staff.internal`.toLowerCase();
}

/** تسجيل مستخدم Auth عبر REST حتى لا تتبدّل جلسة المالك في عميل supabase-js */
async function authSignUpViaRest(email: string, password: string): Promise<void> {
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!base || !anon) throw new Error('إعدادات Supabase ناقصة (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const res = await fetch(`${base}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify({ email, password }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const desc =
      (typeof j.error_description === 'string' && j.error_description) ||
      (typeof j.msg === 'string' && j.msg) ||
      (typeof j.message === 'string' && j.message) ||
      (typeof j.error === 'string' && j.error) ||
      `HTTP ${res.status}`;
    const s = String(desc);
    if (/already registered|already been registered|User already|duplicate|exists/i.test(s)) {
      throw new Error('هذا البريد مسجل مسبقاً في تسجيل الدخول (Authentication)');
    }
    if (
      res.status === 429 ||
      /rate limit|too many requests|email rate limit|over_email_send_rate/i.test(s)
    ) {
      throw new Error(
        'وصل مشروع Supabase لحد إرسال رسائل البريد (تأكيد الحساب). جرّب بعد دقيقة أو دقيقتين، أو من لوحة Supabase: Authentication → Providers → Email عطّل «Confirm email» في بيئة التجربة، أو أنشئ المستخدم يدوياً من Authentication → Users ثم أضف نفس البريد في جدول الموظفين.',
      );
    }
    throw new Error(s);
  }
}

/**
 * إضافة موظف في public.users (المالك أو المحاسب).
 * إذا أدخل المالك بريداً حقيقياً + كلمة مرور (8 أحرف على الأقل) يُنشأ حساب Supabase Auth تلقائياً
 * (طلب REST منفصل حتى تبقى جلسة المالك كما هي)، ثم يُدرج الصف في public.users.
 * المحاسب لا يمكنه إنشاء دور «مالك».
 */
export async function createUserSb(payload: {
  name: string;
  role: string;
  email?: string;
  password?: string;
  avatar?: string;
  baseSalary?: number;
  skills?: string[];
}): Promise<{ user: User; tempPassword?: string }> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك' && actor.role !== 'محاسب') {
    throw new Error('غير مصرح: إضافة الموظفين للمالك أو المحاسب فقط');
  }

  const name = String(payload.name || '').trim();
  const roleRaw = String(payload.role || '').trim();
  const allowed: User['role'][] = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
  if (!name || !(allowed as string[]).includes(roleRaw)) {
    throw new Error('الاسم والدور مطلوبان');
  }
  const role = roleRaw as User['role'];
  if (actor.role === 'محاسب' && role === 'مالك') {
    throw new Error('المحاسب لا يمكنه إنشاء حساب مالك');
  }

  const sb = getSupabase();
  const providedRaw = String(payload.email || '').trim();
  const providedEmail = providedRaw.length > 0;
  let email = providedRaw.toLowerCase();
  if (!providedEmail) {
    for (let tries = 0; tries < 24; tries++) {
      const candidate = makePlaceholderEmailSb(name);
      const { data: hit } = await sb.from('users').select('id').eq('email', candidate).maybeSingle();
      if (!hit) {
        email = candidate;
        break;
      }
    }
    if (!email) throw new Error('تعذّر توليد بريد داخلي فريد');
  }

  const password = String(payload.password || '').trim();
  const isInternalEmail = email.endsWith('@staff.internal');
  if (providedEmail && !isInternalEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('صيغة البريد غير صالحة');
    }
    if (password.length < 8) {
      throw new Error('أدخل كلمة مرور من 8 أحرف على الأقل حتى يتمكن الموظف من تسجيل الدخول');
    }
  }

  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) throw new Error('البريد مستخدم مسبقاً في جدول الموظفين');

  if (providedEmail && !isInternalEmail && password.length >= 8) {
    await authSignUpViaRest(email, password);
  }

  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  const payrollRolesForSalary = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];
  const baseSalary =
    actor.role === 'مالك'
      ? Math.max(0, Math.round(Number(payload.baseSalary) || 0))
      : payrollRolesForSalary.includes(role)
        ? Math.max(0, Math.round(Number(payload.baseSalary) || 0))
        : null;
  const avatar = payload.avatar ? String(payload.avatar).trim() || null : null;
  const nowIso = new Date().toISOString();

  const insert: Record<string, unknown> = {
    id: newId('u'),
    email,
    password_hash: null,
    name,
    role,
    avatar,
    base_salary: baseSalary,
    skills_json: skills,
    stats_json: {},
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data, error } = await sb.from('users').insert(insert).select('*').single();
  if (error) {
    const msg = error.message || 'فشل إنشاء الموظف';
    if (providedEmail && !isInternalEmail && password.length >= 8) {
      throw new Error(
        `${msg} — إن وُجد حساب في Authentication بنفس البريد دون صف في الموظفين، احذف المستخدم من لوحة Supabase ثم أعد المحاولة.`,
      );
    }
    throw new Error(msg);
  }
  if (!data) throw new Error('فشل إنشاء الموظف');

  return { user: mapUserFromRow(data as Record<string, unknown>) };
}

export async function patchUserSb(
  id: string,
  patch: Partial<{
    name: string;
    email: string;
    role: User['role'];
    avatar: string | null;
    skills: User['skills'];
    baseSalary: number;
    stats: User['stats'];
    newPassword?: string;
  }>,
): Promise<User> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  const { data: existingRow, error: exErr } = await sb.from('users').select('*').eq('id', id).maybeSingle();
  if (exErr || !existingRow) throw new Error('المستخدم غير موجود');
  const existing = mapUserFromRow(existingRow as Record<string, unknown>);

  const canOwner = actor.role === 'مالك';
  const isSelf = actor.id === existing.id;
  const canSalesSkills = actor.role === 'مدير مبيعات' && existing.role === 'مندوب';
  const payrollRolesForSalary = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];
  const canAccountingSalary =
    (actor.role === 'محاسب' || actor.role === 'مالك') && payrollRolesForSalary.includes(existing.role);

  const data: Record<string, unknown> = {};
  if (patch.name != null && String(patch.name).trim()) {
    if (!canOwner && !isSelf) throw new Error('غير مصرح');
    data.name = String(patch.name).trim();
  }
  if (patch.email !== undefined && patch.email !== null) {
    if (!canOwner) throw new Error('غير مصرح بتعديل البريد');
    if (existing.role === 'مالك' && existing.id !== actor.id) {
      throw new Error('لا يمكن تغيير بريد حساب مالك آخر');
    }
    const email = String(patch.email || '')
      .trim()
      .toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('صيغة البريد غير صالحة');
    }
    const { data: clash, error: clashErr } = await sb.from('users').select('id').eq('email', email).neq('id', id).maybeSingle();
    if (clashErr) throw new Error(clashErr.message);
    if (clash) throw new Error('البريد مستخدم لمستخدم آخر');
    data.email = email;
  }
  if (patch.role != null) {
    if (!canOwner) throw new Error('غير مصرح');
    const allowed: User['role'][] = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
    const r = String(patch.role).trim() as User['role'];
    if (!allowed.includes(r)) throw new Error('دور غير صالح');
    data.role = r;
  }
  if (patch.avatar !== undefined) {
    if (!canOwner && !isSelf) throw new Error('غير مصرح');
    data.avatar = patch.avatar ? String(patch.avatar).trim() : null;
  }
  if (patch.skills != null) {
    if (!(canOwner || canSalesSkills)) throw new Error('غير مصرح');
    data.skills_json = Array.isArray(patch.skills) ? patch.skills : [];
  }
  if (patch.baseSalary != null) {
    if (existing.role === 'مالك' && existing.id !== actor.id) {
      throw new Error('لا يمكن تعديل راتب حساب مالك آخر');
    }
    if (canOwner) {
      data.base_salary = Math.max(0, Math.round(Number(patch.baseSalary) || 0));
    } else {
      if (!payrollRolesForSalary.includes(existing.role) && !(existing.role === 'مالك' && existing.id === actor.id)) {
        throw new Error('لا يُخزَّن راتب أساسي لهذا الدور');
      }
      if (!canAccountingSalary) throw new Error('غير مصرح');
      data.base_salary = Math.max(0, Math.round(Number(patch.baseSalary) || 0));
    }
  }
  if (patch.stats != null && typeof patch.stats === 'object') {
    if (!canOwner) throw new Error('غير مصرح');
    data.stats_json = patch.stats;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'newPassword')) {
    throw new Error(
      'تعيين باسورد الموظف من الواجهة غير متاح في وضع Supabase المباشر. إمّا من لوحة Supabase ← Authentication ← Users، أو استخدم خادم التطبيق (Express + Prisma) حيث يُحدَّث bcrypt في قاعدة البيانات.',
    );
  }
  if (Object.keys(data).length === 0) return existing;

  const { data: row, error } = await sb.from('users').update(data).eq('id', id).select('*').single();
  if (error || !row) throw new Error(error?.message || 'فشل التحديث');
  return mapUserFromRow(row as Record<string, unknown>);
}

export async function deleteUserSb(targetId: string): Promise<void> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك') throw new Error('غير مصرح');
  if (targetId === actor.id) throw new Error('لا يمكن حذف حسابك الحالي');
  const sb = getSupabase();
  const { data: targetRow, error: tErr } = await sb.from('users').select('id,role').eq('id', targetId).maybeSingle();
  if (tErr || !targetRow) throw new Error('المستخدم غير موجود');
  if (String((targetRow as { role?: string }).role) === 'مالك') throw new Error('لا يمكن حذف حساب مالك');

  await sb.from('monthly_targets').delete().eq('rep_id', targetId);
  await sb.from('attendance_records').delete().eq('rep_id', targetId);
  await sb.from('leads').update({ assigned_to_id: null }).eq('assigned_to_id', targetId);
  const { error } = await sb.from('users').delete().eq('id', targetId);
  if (error) throw new Error(error.message);
}

/* ---------- manual customers ---------- */
export async function fetchManualCustomersSb(): Promise<ManualCustomer[]> {
  await getSupabaseActor();
  const sb = getSupabase();
  const { data, error } = await sb.from('manual_customers').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapManualCustomerFromRow(r as Record<string, unknown>));
}

export async function createManualCustomerSb(payload: {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  sourceLabel?: string;
  customerCode?: string;
}): Promise<ManualCustomer> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك' && actor.role !== 'محاسب') throw new Error('غير مصرح');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('الاسم مطلوب');
  const sb = getSupabase();
  const row = {
    id: newId('mc'),
    name,
    customer_code: payload.customerCode ? String(payload.customerCode).trim() : null,
    company: payload.company ? String(payload.company).trim() : null,
    phone: payload.phone ? String(payload.phone).trim() : null,
    email: payload.email ? String(payload.email).trim().toLowerCase() : null,
    source_label: payload.sourceLabel ? String(payload.sourceLabel).trim() : 'يدوي',
    created_by_id: actor.id,
    created_by_name: actor.name,
    created_by_role: actor.role,
  };
  const { data, error } = await sb.from('manual_customers').insert(row).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return mapManualCustomerFromRow(data as Record<string, unknown>);
}

export async function patchManualCustomerSb(
  id: string,
  patch: Partial<{
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    sourceLabel: string | null;
    customerCode: string | null;
  }>,
): Promise<ManualCustomer> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك' && actor.role !== 'محاسب') throw new Error('غير مصرح');
  const sb = getSupabase();
  const rowUp: Record<string, unknown> = {};
  if (patch.name != null) rowUp.name = String(patch.name).trim();
  if (patch.company !== undefined) rowUp.company = patch.company ? String(patch.company).trim() : null;
  if (patch.phone !== undefined) rowUp.phone = patch.phone ? String(patch.phone).trim() : null;
  if (patch.email !== undefined) rowUp.email = patch.email ? String(patch.email).trim().toLowerCase() : null;
  if (patch.sourceLabel !== undefined) rowUp.source_label = patch.sourceLabel ? String(patch.sourceLabel).trim() : null;
  if (patch.customerCode !== undefined) rowUp.customer_code = patch.customerCode ? String(patch.customerCode).trim() : null;
  if (Object.keys(rowUp).length === 0) {
    const { data: ex } = await sb.from('manual_customers').select('*').eq('id', id).maybeSingle();
    if (!ex) throw new Error('غير موجود');
    return mapManualCustomerFromRow(ex as Record<string, unknown>);
  }
  const { data, error } = await sb.from('manual_customers').update(rowUp).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  return mapManualCustomerFromRow(data as Record<string, unknown>);
}

export async function deleteManualCustomerSb(id: string): Promise<void> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك' && actor.role !== 'محاسب') throw new Error('غير مصرح');
  const { error } = await getSupabase().from('manual_customers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ---------- invoices ---------- */
export async function fetchInvoicesSb(): Promise<Invoice[]> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('invoices').select('*').order('date', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => normalizeInvoiceFromRow(r as Record<string, unknown>));
}

export async function createInvoiceSb(
  payload: Partial<Invoice> & {
    customerName: string;
    amount: number;
    status: Invoice['status'];
    date?: string;
    collections?: Invoice['collections'];
  },
): Promise<Invoice> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const customerName = String(payload.customerName || '').trim();
  if (!customerName) throw new Error('اسم العميل مطلوب');
  const status = String(payload.status || 'قيد الانتظار').trim();
  const amount = Math.max(0, Math.round(Number(payload.amount) || 0));
  const vatRate = typeof payload.vatRate === 'number' ? payload.vatRate : 14;
  const vatAmount =
    typeof payload.vatAmount === 'number' ? Math.round(payload.vatAmount) : Math.round(amount * (vatRate / 100));
  const totalAmount =
    typeof payload.totalAmount === 'number' ? Math.round(payload.totalAmount) : amount + vatAmount;
  const dateIso = payload.date ? String(payload.date) : new Date().toISOString();
  const collections = Array.isArray(payload.collections) ? payload.collections : [];
  const paidAmount =
    typeof payload.paidAmount === 'number'
      ? Math.round(payload.paidAmount)
      : status === 'مدفوع'
        ? totalAmount
        : 0;
  const remainingAmount =
    typeof payload.remainingAmount === 'number'
      ? Math.round(payload.remainingAmount)
      : Math.max(0, totalAmount - paidAmount);

  const insert: Record<string, unknown> = {
    ...(payload.id ? { id: String(payload.id).trim() } : { id: newId('inv') }),
    customer_code: payload.customerCode ? String(payload.customerCode).trim() : null,
    lead_id: payload.leadId ? String(payload.leadId).trim() : null,
    customer_name: customerName,
    amount,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total_amount: totalAmount,
    cost_center: payload.costCenter ? String(payload.costCenter).trim() : 'عام',
    status,
    date: dateIso,
    record_origin: payload.recordOrigin ? String(payload.recordOrigin) : 'يدوي_محاسب',
    price_quote_id: payload.priceQuoteId ? String(payload.priceQuoteId).trim() : null,
    paid_amount: paidAmount,
    remaining_amount: remainingAmount,
    next_due_date: payload.nextDueDate ? String(payload.nextDueDate) : null,
    collections_json: collections,
  };
  const sb = getSupabase();
  const { data, error } = await sb.from('invoices').insert(insert).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل إنشاء الفاتورة');
  return normalizeInvoiceFromRow(data as Record<string, unknown>);
}

export async function patchInvoiceSb(
  id: string,
  patch: Partial<Omit<Invoice, 'nextDueDate'>> & {
    collections?: Invoice['collections'];
    nextDueDate?: string | null;
  },
): Promise<Invoice> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const sb = getSupabase();
  const rowUp: Record<string, unknown> = {};
  if (patch.customerName != null) rowUp.customer_name = String(patch.customerName).trim();
  if (patch.amount != null) rowUp.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
  if (patch.vatRate != null) rowUp.vat_rate = Number(patch.vatRate);
  if (patch.vatAmount != null) rowUp.vat_amount = Math.round(Number(patch.vatAmount) || 0);
  if (patch.totalAmount != null) rowUp.total_amount = Math.round(Number(patch.totalAmount) || 0);
  if (patch.costCenter != null) rowUp.cost_center = String(patch.costCenter).trim();
  if (patch.status != null) rowUp.status = String(patch.status).trim();
  if (patch.date != null) rowUp.date = String(patch.date);
  if (patch.recordOrigin !== undefined) rowUp.record_origin = patch.recordOrigin ? String(patch.recordOrigin) : null;
  if (patch.leadId !== undefined) rowUp.lead_id = patch.leadId ? String(patch.leadId).trim() : null;
  if (patch.customerCode !== undefined) rowUp.customer_code = patch.customerCode ? String(patch.customerCode).trim() : null;
  if (patch.priceQuoteId !== undefined) rowUp.price_quote_id = patch.priceQuoteId ? String(patch.priceQuoteId).trim() : null;
  if (patch.paidAmount != null) rowUp.paid_amount = Math.round(Number(patch.paidAmount) || 0);
  if (patch.remainingAmount != null) rowUp.remaining_amount = Math.round(Number(patch.remainingAmount) || 0);
  if ('nextDueDate' in patch) rowUp.next_due_date = patch.nextDueDate ? String(patch.nextDueDate) : null;
  if (patch.collections != null) rowUp.collections_json = Array.isArray(patch.collections) ? patch.collections : [];

  if (Object.keys(rowUp).length === 0) {
    const { data: ex } = await sb.from('invoices').select('*').eq('id', id).maybeSingle();
    if (!ex) throw new Error('غير موجود');
    return normalizeInvoiceFromRow(ex as Record<string, unknown>);
  }
  const { data, error } = await sb.from('invoices').update(rowUp).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  return normalizeInvoiceFromRow(data as Record<string, unknown>);
}

/* ---------- expenses ---------- */
/** PostgREST يفشل إن لم تُضف أعمدة submitted_by في قاعدة Supabase بعد */
function isMissingSubmittedByColumnError(message: string): boolean {
  return /submitted_by_id|submitted_by_name|schema cache/i.test(String(message || ''));
}

function isMissingPaymentMethodColumnError(message: string): boolean {
  const m = String(message || '');
  return /payment_method/i.test(m) && (/schema cache|Could not find|does not exist|unknown column|column of .expenses|PGRST/i.test(m));
}

function stripPayTagFromNote(note: string): string {
  return String(note || '').replace(/\n?__pay:(كاش|بنك)__\s*/g, '').trim();
}

/** عند غياب عمود payment_method: نخزّن الطريقة في الملاحظة */
function mergePayTagIntoNote(base: string, method: 'كاش' | 'بنك'): string {
  const without = stripPayTagFromNote(base);
  const tag = `__pay:${method}__`;
  return without ? `${without}\n${tag}` : tag;
}

/** عند غياب أعمدة مقدّم الطلب: نخزّن اسم مقدّم الطلب في الملاحظة */
function noteWithSubmitterFallback(
  originalNote: string | null | undefined,
  submitterName: string,
  submitterId: string
): string | null {
  const name = String(submitterName || '').trim() || 'مستخدم';
  const id = String(submitterId || '').trim();
  const base = originalNote != null ? String(originalNote).trim() : '';
  const marker = 'مقدّم الطلب:';
  if (base.includes(marker)) {
    return base.length > 0 ? base : null;
  }
  const line = `${marker} ${name}`;
  const idFrag = id ? `\n__sb_id:${id}__` : '';
  if (!base) return `${line}${idFrag}` || null;
  return `${base}\n${line}${idFrag}`;
}

export async function fetchExpensesSb(): Promise<Expense[]> {
  const actor = await getSupabaseActor();
  if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('expenses').select('*').order('date', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapExpenseFromRow(r as Record<string, unknown>));
}

export async function createExpenseSb(payload: Partial<Expense> & { title: string }): Promise<Expense> {
  const actor = await getSupabaseActor();
  if (!['محاسب', 'مالك', 'مدير إنتاج', 'مدير مبيعات'].includes(actor.role)) throw new Error('غير مصرح');
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('العنوان مطلوب');
  const category = String(payload.category || 'أخرى').trim();
  const amount = Math.max(0, Math.round(Number(payload.amount) || 0));
  const vatRate = typeof payload.vatRate === 'number' ? payload.vatRate : 14;
  const vatAmount =
    typeof payload.vatAmount === 'number' ? Math.round(payload.vatAmount) : Math.round(amount * (vatRate / 100));
  const totalAmount = typeof payload.totalAmount === 'number' ? Math.round(payload.totalAmount) : amount + vatAmount;
  const dateIso = payload.date ? String(payload.date) : new Date().toISOString();
  const approvalStatus =
    payload.approvalStatus != null && String(payload.approvalStatus).trim() !== ''
      ? String(payload.approvalStatus).trim()
      : 'قيد الاعتماد';
  const nowIso = new Date().toISOString();
  const rowBase: Record<string, unknown> = {
    ...(payload.id ? { id: String(payload.id).trim() } : { id: newId('exp') }),
    title,
    category,
    amount,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total_amount: totalAmount,
    cost_center: payload.costCenter ? String(payload.costCenter).trim() : 'عام',
    status: String(payload.status || 'قيد الانتظار').trim(),
    approval_status: approvalStatus,
    approved_by: payload.approvedBy ? String(payload.approvedBy).trim() : null,
    vendor: payload.vendor ? String(payload.vendor).trim() : null,
    note: payload.note ? String(payload.note).trim() : null,
    date: dateIso,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const submitterName = actor.name ? String(actor.name).trim() : '';
  const rowWithSubmitter = {
    ...rowBase,
    submitted_by_id: actor.id,
    submitted_by_name: submitterName || null,
  };
  const sb = getSupabase();
  let { data, error } = await sb.from('expenses').insert(rowWithSubmitter).select('*').single();
  if (error && isMissingSubmittedByColumnError(error.message)) {
    const compat = {
      ...rowBase,
      note: noteWithSubmitterFallback(
        rowBase.note != null ? String(rowBase.note) : undefined,
        submitterName || 'مستخدم',
        actor.id
      ),
    };
    const second = await sb.from('expenses').insert(compat).select('*').single();
    data = second.data;
    error = second.error;
  }
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return mapExpenseFromRow(data as Record<string, unknown>);
}

export async function deleteExpenseSb(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('expenses').delete().eq('id', id);
  if (error) throw new Error(error.message || 'فشل حذف المصروف');
}

export async function patchExpenseSb(id: string, patch: Partial<Expense>): Promise<Expense> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  const { data: exRow } = await sb.from('expenses').select('*').eq('id', id).maybeSingle();
  if (!exRow) throw new Error('غير موجود');

  const canApprove = actor.role === 'مالك';
  if (patch.approvalStatus != null || patch.approvedBy !== undefined) {
    if (!canApprove) throw new Error('غير مصرح باعتماد المصروفات');
  } else if (!['محاسب', 'مالك', 'مدير إنتاج', 'مدير مبيعات'].includes(actor.role)) {
    throw new Error('غير مصرح');
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'productionSpendLines')) {
    if (patch.approvalStatus != null || patch.approvedBy !== undefined) {
      throw new Error('افصل تحديث بنود الصرف عن اعتماد المالك');
    }
    const allowedSpendKeys = new Set<string>(['productionSpendLines', 'note']);
    const badKeys = Object.keys(patch).filter((k) => !allowedSpendKeys.has(k));
    if (badKeys.length) {
      throw new Error('مع تحديث البنود يُسمح بإرسال productionSpendLines أو note فقط');
    }
    if (actor.role !== 'مدير إنتاج') throw new Error('فقط مدير الإنتاج يحدّث بنود صرف طلب التمويل');
    if (String(exRow.approval_status ?? '').trim() !== 'معتمد') {
      throw new Error('بنود الصرف متاحة بعد اعتماد المالك فقط');
    }
    const submittedById = exRow.submitted_by_id != null ? String(exRow.submitted_by_id).trim() : '';
    const actorId = String(actor.id || '').trim();
    const vendor = (exRow.vendor != null ? String(exRow.vendor) : '').trim();
    const sname = (exRow.submitted_by_name != null ? String(exRow.submitted_by_name) : '').trim();
    const uname = (actor.name || '').trim();
    const owns =
      (submittedById && submittedById === actorId) ||
      (vendor === 'طلب مدير الإنتاج' && !!uname && sname === uname);
    if (!owns) throw new Error('هذا الطلب لا يخصك');
    const rawLines = patch.productionSpendLines;
    const lines = (Array.isArray(rawLines) ? rawLines : []) as CustodySpendLine[];
    const sum = lines.reduce((s, l) => s + (Math.max(0, Number(l.amount) || 0)), 0);
    const cap = Math.max(0, Number(exRow.total_amount ?? exRow.amount) || 0);
    if (sum > cap + 0.01) throw new Error('مجموع البنود يتجاوز مبلغ الطلب المعتمد');
    const prev = exRow.note != null ? String(exRow.note) : '';
    const baseNote = patch.note !== undefined ? String(patch.note ?? '') : prev;
    const mergedNote = mergeProductionSpendLinesIntoRawNote(baseNote, lines);
    const rowUpSpend: Record<string, unknown> = {
      note: mergedNote,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await sb.from('expenses').update(rowUpSpend).eq('id', id).select('*').single();
    if (error || !data) throw new Error(error?.message || 'فشل التحديث');
    return mapExpenseFromRow(data as Record<string, unknown>);
  }

  const rowUp: Record<string, unknown> = {};
  if (patch.title != null) rowUp.title = String(patch.title).trim();
  if (patch.category != null) rowUp.category = String(patch.category).trim();
  if (patch.amount != null) rowUp.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
  if (patch.vatRate != null) rowUp.vat_rate = Number(patch.vatRate);
  if (patch.vatAmount != null) rowUp.vat_amount = Math.round(Number(patch.vatAmount) || 0);
  if (patch.totalAmount != null) rowUp.total_amount = Math.round(Number(patch.totalAmount) || 0);
  if (patch.costCenter != null) rowUp.cost_center = String(patch.costCenter).trim();
  if (patch.status != null) rowUp.status = String(patch.status).trim();
  if (patch.date != null) rowUp.date = String(patch.date);
  if (patch.vendor !== undefined) rowUp.vendor = patch.vendor ? String(patch.vendor).trim() : null;
  if (patch.note !== undefined) rowUp.note = patch.note ? String(patch.note).trim() : null;
  if (patch.approvalStatus != null) rowUp.approval_status = String(patch.approvalStatus).trim();
  if (patch.approvedBy !== undefined) rowUp.approved_by = patch.approvedBy ? String(patch.approvedBy).trim() : null;
  if ('paymentMethod' in patch) {
    const pm = patch.paymentMethod;
    rowUp.payment_method =
      pm === null || pm === undefined || (typeof pm === 'string' && pm.trim() === '') ? null : String(pm).trim();
  }

  if (Object.keys(rowUp).length === 0) return mapExpenseFromRow(exRow as Record<string, unknown>);
  rowUp.updated_at = new Date().toISOString();
  let { data, error } = await sb.from('expenses').update(rowUp).eq('id', id).select('*').single();

  if (error && isMissingPaymentMethodColumnError(error.message) && 'payment_method' in rowUp) {
    const nextUp: Record<string, unknown> = { ...rowUp };
    delete nextUp.payment_method;
    const prevNote = exRow.note != null ? String(exRow.note) : '';
    if (patch.status === 'قيد الانتظار' || patch.paymentMethod === null) {
      const s = stripPayTagFromNote(prevNote);
      nextUp.note = s.length > 0 ? s : null;
    } else if (patch.paymentMethod === 'كاش' || patch.paymentMethod === 'بنك') {
      nextUp.note = mergePayTagIntoNote(prevNote, patch.paymentMethod);
    }
    nextUp.updated_at = new Date().toISOString();
    const second = await sb.from('expenses').update(nextUp).eq('id', id).select('*').single();
    data = second.data;
    error = second.error;
  }

  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  return mapExpenseFromRow(data as Record<string, unknown>);
}

/* ---------- price quotes ---------- */
export async function fetchPriceQuotesSb(): Promise<PriceQuote[]> {
  const actor = await getSupabaseActor();
  if (!['مالك', 'مدير مبيعات', 'محاسب', 'مندوب', 'مدير إنتاج'].includes(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  let q = sb.from('price_quotes').select('*').order('created_at', { ascending: false });
  if (actor.role === 'مندوب') q = q.eq('created_by_id', actor.id);
  if (actor.role === 'مدير إنتاج') q = q.eq('production_assigned_id', actor.id);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapPriceQuoteFromRow(r as Record<string, unknown>));
}

export async function createPriceQuoteSb(
  payload: Omit<PriceQuote, 'createdAt' | 'approvedBy' | 'approvedAt' | 'invoiceId'> & {
    id?: string;
  },
): Promise<PriceQuote> {
  const leadId = String(payload.leadId || '').trim();
  const customerName = String(payload.customerName || '').trim();
  const title = String(payload.title || '').trim();
  const amount = Math.max(0, Math.round(Number(payload.amount) || 0));
  if (!leadId || !customerName || !title || !amount) throw new Error('بيانات عرض السعر ناقصة');
  // resolve actor for created_by fields — fall back to payload if getSupabaseActor fails
  let actorId = String(payload.createdById || '').trim();
  let actorName = String(payload.createdByName || '').trim();
  if (!actorId || !actorName) {
    try {
      const actor = await getSupabaseActor();
      actorId = actorId || actor.id;
      actorName = actorName || actor.name;
    } catch {
      // session may not be needed if actorId/Name already provided
    }
  }
  const vatRate = typeof payload.vatRate === 'number' ? payload.vatRate : 14;
  const vatAmount =
    typeof payload.vatAmount === 'number' ? Math.round(payload.vatAmount) : Math.round(amount * (vatRate / 100));
  const totalAmount = typeof payload.totalAmount === 'number' ? Math.round(payload.totalAmount) : amount + vatAmount;
  const row: Record<string, unknown> = {
    ...(payload.id ? { id: String(payload.id).trim() } : { id: newId('pq') }),
    lead_id: leadId,
    customer_name: customerName,
    title,
    amount,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total_amount: totalAmount,
    cost_center: payload.costCenter ? String(payload.costCenter).trim() : 'عام',
    note: payload.note ? String(payload.note).trim() : null,
    created_by_id: actorId || 'unknown',
    created_by_name: actorName || 'unknown',
    status: payload.status || 'قيد اعتماد المالك',
    production_assigned_id: payload.productionAssignedId || null,
    production_assigned_name: payload.productionAssignedName || null,
    pricing_note: payload.pricingNote || null,
    updated_at: new Date().toISOString(),
  };
  const sb = getSupabase();
  const { data, error } = await sb.from('price_quotes').insert(row).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return mapPriceQuoteFromRow(data as Record<string, unknown>);
}

function canPatchQuoteSb(
  actor: { id: string; role: string },
  existing: { created_by_id?: string | null; production_assigned_id?: string | null },
): boolean {
  if (actor.role === 'مالك' || actor.role === 'مدير مبيعات') return true;
  if (actor.role === 'مندوب' && String(existing.created_by_id || '') === actor.id) return true;
  if (actor.role === 'مدير إنتاج' && String(existing.production_assigned_id || '') === actor.id) return true;
  return false;
}

export async function patchPriceQuoteSb(
  id: string,
  patch: Partial<PriceQuote>,
): Promise<PriceQuote> {
  const actor = await getSupabaseActor();
  const sb = getSupabase();
  const { data: exRow, error: exErr } = await sb.from('price_quotes').select('*').eq('id', id).maybeSingle();
  if (exErr || !exRow) throw new Error('غير موجود');
  if (!canPatchQuoteSb(actor, exRow as { created_by_id?: string; production_assigned_id?: string })) {
    throw new Error('غير مصرح بتعديل عرض السعر');
  }

  const rowUp: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status != null) rowUp.status = String(patch.status).trim();
  if (patch.approvedBy != null) rowUp.approved_by = String(patch.approvedBy);
  if (patch.approvedAt != null) rowUp.approved_at = String(patch.approvedAt);
  if (patch.invoiceId != null) rowUp.invoice_id = String(patch.invoiceId);
  if (patch.amount != null) rowUp.amount = Math.round(Number(patch.amount));
  if (patch.vatRate != null) rowUp.vat_rate = Number(patch.vatRate);
  if (patch.vatAmount != null) rowUp.vat_amount = Math.round(Number(patch.vatAmount));
  if (patch.totalAmount != null) rowUp.total_amount = Math.round(Number(patch.totalAmount));
  if (patch.pricedById != null) rowUp.priced_by_id = String(patch.pricedById);
  if (patch.pricedByName != null) rowUp.priced_by_name = String(patch.pricedByName);
  if (patch.pricedAt != null) rowUp.priced_at = String(patch.pricedAt);
  if (patch.pricingNote != null) rowUp.pricing_note = String(patch.pricingNote);
  if (patch.productionAssignedId !== undefined) {
    rowUp.production_assigned_id = patch.productionAssignedId ? String(patch.productionAssignedId).trim() : null;
  }
  if (patch.productionAssignedName !== undefined) {
    rowUp.production_assigned_name = patch.productionAssignedName ? String(patch.productionAssignedName).trim() : null;
  }
  if (patch.paymentSchedule != null) rowUp.payment_schedule_json = JSON.stringify(patch.paymentSchedule);
  if (patch.initialPayment != null) rowUp.initial_payment = Number(patch.initialPayment);
  if (patch.clientPayments != null) rowUp.client_payments_json = JSON.stringify(patch.clientPayments);
  if (patch.clientAcceptedAt != null) rowUp.client_accepted_at = String(patch.clientAcceptedAt);
  if (patch.clientRejectedAt != null) rowUp.client_rejected_at = String(patch.clientRejectedAt);
  if (patch.clientRejectionNote != null) rowUp.client_rejection_note = String(patch.clientRejectionNote);
  if (patch.companyMarginPercent !== undefined) {
    rowUp.company_margin_percent = Math.min(100, Math.max(0, Number(patch.companyMarginPercent) || 0));
  }
  if (patch.productionCostAmount !== undefined) {
    rowUp.production_cost_amount = Math.round(Number(patch.productionCostAmount) || 0);
  }

  const { data, error } = await sb.from('price_quotes').update(rowUp).eq('id', id).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  return mapPriceQuoteFromRow(data as Record<string, unknown>);
}

/* ---------- accounting policy ---------- */
export async function fetchAccountingPolicySb(): Promise<AccountingPolicy | null> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('accounting_policy').select('*').eq('id', 'default').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    await sb.from('accounting_policy').insert({
      id: 'default',
      policy_notes: '',
      allowed_cost_centers_json: [],
      min_amount_highlight: 0,
    });
    const { data: d2 } = await sb.from('accounting_policy').select('*').eq('id', 'default').maybeSingle();
    return d2 ? mapAccountingPolicyFromRow(d2 as Record<string, unknown>) : null;
  }
  return mapAccountingPolicyFromRow(data as Record<string, unknown>);
}

export async function patchAccountingPolicySb(patch: Partial<AccountingPolicy>): Promise<AccountingPolicy> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  await fetchAccountingPolicySb();
  const upd: Record<string, unknown> = {};
  if (patch.policyNotes !== undefined) upd.policy_notes = String(patch.policyNotes || '');
  if (patch.allowedCostCentersForQuotes != null) {
    upd.allowed_cost_centers_json = Array.isArray(patch.allowedCostCentersForQuotes)
      ? patch.allowedCostCentersForQuotes
      : [];
  }
  if (patch.minAmountHighlight != null) upd.min_amount_highlight = Math.max(0, Math.round(Number(patch.minAmountHighlight) || 0));
  const sb = getSupabase();
  const { data, error } = await sb
    .from('accounting_policy')
    .update(upd)
    .eq('id', 'default')
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  const pol = mapAccountingPolicyFromRow(data as Record<string, unknown>);
  if (!pol) throw new Error('سياسة غير صالحة');
  return pol;
}

/* ---------- manual journals ---------- */
export async function fetchManualJournalsSb(): Promise<ManualJournalEntry[]> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb
    .from('manual_journal_entries')
    .select('*')
    .order('date', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapManualJournalFromRow(r as Record<string, unknown>));
}

export async function createManualJournalSb(body: {
  id?: string;
  description: string;
  lines: unknown[];
  date?: string;
}): Promise<ManualJournalEntry> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const description = String(body.description || '').trim();
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!description || lines.length === 0) throw new Error('الوصف والبنود مطلوبان');
  const journalCheck = validateManualJournalLines(lines);
  if (!journalCheck.ok) throw new Error(journalCheck.error);
  const dateIso = body.date ? String(body.date) : new Date().toISOString();
  const row = {
    ...(body.id ? { id: String(body.id).trim() } : { id: newId('mj') }),
    date: dateIso,
    description,
    lines_json: journalCheck.lines,
  };
  const sb = getSupabase();
  const { data, error } = await sb.from('manual_journal_entries').insert(row).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return mapManualJournalFromRow(data as Record<string, unknown>);
}

export async function deleteManualJournalSb(id: string): Promise<void> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const { error } = await getSupabase().from('manual_journal_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ---------- closed months ---------- */
export async function fetchClosedMonthsSb(): Promise<string[]> {
  await getSupabaseActor();
  const sb = getSupabase();
  const { data, error } = await sb.from('closed_months').select('month_key').order('month_key', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data
    .map((r) => mapClosedMonthFromRow(r as Record<string, unknown>))
    .filter((k) => {
      if (typeof k !== 'string' || !/^\d{4}-\d{2}$/.test(k)) return false;
      const m = Number(k.slice(5, 7));
      return m >= 1 && m <= 12;
    });
}

export async function postCloseMonthSb(monthKey: string): Promise<string[]> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك') throw new Error('غير مصرح');
  const mk = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mk)) throw new Error('month_key غير صالح');
  const monthNum = Number(mk.slice(5, 7));
  if (monthNum < 1 || monthNum > 12) throw new Error('الشهر يجب أن يكون بين 01 و 12');
  const sb = getSupabase();
  const { error } = await sb.from('closed_months').upsert({ month_key: mk }, { onConflict: 'month_key' });
  if (error) throw new Error(error.message);
  return fetchClosedMonthsSb();
}

export async function postReopenMonthSb(monthKey: string): Promise<string[]> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك') throw new Error('غير مصرح');
  const mk = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mk)) throw new Error('month_key غير صالح');
  const monthNum = Number(mk.slice(5, 7));
  if (monthNum < 1 || monthNum > 12) throw new Error('الشهر يجب أن يكون بين 01 و 12');
  const { error } = await getSupabase().from('closed_months').delete().eq('month_key', mk);
  if (error) throw new Error(error.message);
  return fetchClosedMonthsSb();
}

/* ---------- monthly targets ---------- */
export async function fetchMonthlyTargetsSb(): Promise<MonthlyTarget[]> {
  await getSupabaseActor();
  const sb = getSupabase();
  const { data, error } = await sb.from('monthly_targets').select('*');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapMonthlyTargetFromRow(r as Record<string, unknown>));
}

export async function patchMonthlyTargetSb(repId: string, patch: Partial<MonthlyTarget>): Promise<MonthlyTarget> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data: ex } = await sb.from('monthly_targets').select('*').eq('rep_id', repId).maybeSingle();
  const base = ex
    ? mapMonthlyTargetFromRow(ex as Record<string, unknown>)
    : {
        repId,
        leadsTarget: 15,
        revenueTarget: 250000,
        callsTarget: 80,
        dailyCallsTarget: 8,
        weeklyCallsTarget: 40,
        commissionPercent: 0,
      };
  const data = {
    rep_id: repId,
    leads_target:
      patch.leadsTarget != null ? Math.max(0, Math.round(Number(patch.leadsTarget) || 0)) : base.leadsTarget,
    revenue_target:
      patch.revenueTarget != null ? Math.max(0, Math.round(Number(patch.revenueTarget) || 0)) : base.revenueTarget,
    calls_target: patch.callsTarget != null ? Math.max(0, Math.round(Number(patch.callsTarget) || 0)) : base.callsTarget,
    daily_calls_target:
      patch.dailyCallsTarget != null ? Math.max(0, Math.round(Number(patch.dailyCallsTarget) || 0)) : base.dailyCallsTarget,
    weekly_calls_target:
      patch.weeklyCallsTarget != null
        ? Math.max(0, Math.round(Number(patch.weeklyCallsTarget) || 0))
        : base.weeklyCallsTarget,
    commission_percent:
      patch.commissionPercent != null
        ? Math.min(100, Math.max(0, Number(patch.commissionPercent) || 0))
        : base.commissionPercent,
  };
  const { data: row, error } = await sb
    .from('monthly_targets')
    .upsert(data, { onConflict: 'rep_id' })
    .select('*')
    .single();
  if (error || !row) throw new Error(error?.message || 'فشل الحفظ');
  return mapMonthlyTargetFromRow(row as Record<string, unknown>);
}

/* ---------- custody settings ---------- */
export async function fetchCustodySettingsSb(): Promise<Record<string, string>> {
  const actor = await getSupabaseActor();
  if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('custody_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    await sb.from('custody_settings').insert({ id: 'default', custody_account_map_json: {} });
    return {};
  }
  const m = mapCustodySettingsMap(data as Record<string, unknown>);
  return m && typeof m === 'object' ? m : {};
}

export async function patchCustodySettingsSb(body: {
  custodyAccountByCategory?: Record<string, string>;
  map?: Record<string, string>;
}): Promise<Record<string, string>> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب') throw new Error('غير مصرح');
  const incoming = body.custodyAccountByCategory ?? body.map;
  const next =
    typeof incoming === 'object' && incoming !== null && !Array.isArray(incoming) ? incoming : {};
  const sb = getSupabase();
  await sb.from('custody_settings').upsert({ id: 'default', custody_account_map_json: next }, { onConflict: 'id' });
  const { data } = await sb.from('custody_settings').select('*').eq('id', 'default').maybeSingle();
  const m = data ? mapCustodySettingsMap(data as Record<string, unknown>) : {};
  return m && typeof m === 'object' ? m : {};
}

/* ---------- audit ---------- */
export async function fetchAuditEventsSb(): Promise<AuditEvent[]> {
  await getSupabaseActor();
  const sb = getSupabase();
  const { data, error } = await sb.from('audit_events').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapAuditFromRow(r as Record<string, unknown>));
}

const ENTITY_TYPES = new Set(['lead', 'invoice', 'user', 'system']);

export async function postAuditEventSb(
  payload: Omit<AuditEvent, 'id' | 'createdAt' | 'actorId' | 'actorName'>,
): Promise<AuditEvent> {
  const actor = await getSupabaseActor();
  const action = String(payload.action || '').trim();
  if (!action) throw new Error('الإجراء مطلوب');
  let entityType = String(payload.entityType || 'system').trim();
  if (!ENTITY_TYPES.has(entityType)) entityType = 'system';
  const entityId = payload.entityId != null ? String(payload.entityId).trim() || null : null;
  const details = payload.details != null ? String(payload.details) : null;
  const id = newId('aud');
  const sb = getSupabase();
  const row = {
    id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    actor_id: actor.id,
    actor_name: actor.name,
    details,
  };
  const { data, error } = await sb.from('audit_events').insert(row).select('*').single();
  if (error || !data) throw new Error(error?.message || 'فشل التسجيل');
  return mapAuditFromRow(data as Record<string, unknown>);
}

/* ---------- custody funds (doc_json) ---------- */

/** مدير إنتاج يرى/يحرّر عهدة مرتبطة به حتى لو doc_json قديم بدون productionManagerId */
function custodyDocForProductionManager(doc: unknown, actor: { id: string; name: string }): boolean {
  if (typeof doc !== 'object' || !doc) return false;
  const d = doc as Record<string, unknown>;
  const pm = String(d.productionManagerId ?? d.production_manager_id ?? '').trim();
  if (pm === actor.id) return true;
  if (pm) return false;
  const pname = String(d.productionManagerName ?? d.production_manager_name ?? '').trim();
  const aname = String(actor.name || '').trim();
  if (pname && aname && pname === aname) return true;
  const st = String(d.status || '');
  const creator = String(d.createdById ?? d.created_by_id ?? '').trim();
  if ((st === 'طلب_بانتظار_المالك' || st === 'مرفوض_طلب') && creator === actor.id) return true;
  return false;
}

export async function fetchCustodyFundsSb(): Promise<unknown[]> {
  const actor = await getSupabaseActor();
  if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('custody_funds').select('doc_json,updated_at').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  let docs = data.map((r) => (r as { doc_json?: unknown }).doc_json).filter(Boolean);
  if (actor.role === 'مدير إنتاج') {
    docs = docs.filter((doc) => custodyDocForProductionManager(doc, actor));
  }
  return docs;
}

export async function createCustodyFundSb(doc: unknown): Promise<unknown> {
  const actor = await getSupabaseActor();
  const raw = doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  const id = String(raw.id || newId('CF')).trim();
  if (!id) throw new Error('بيانات غير صالحة');
  const merged: Record<string, unknown> = { ...raw, id };
  if (actor.role === 'مدير إنتاج') {
    if (String(merged.createdById) !== actor.id) throw new Error('غير مصرح');
  } else if (actor.role === 'محاسب') {
    /* مسودة محاسب */
  } else throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('custody_funds').insert({ id, doc_json: merged }).select('doc_json').single();
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return (data as { doc_json: unknown }).doc_json;
}

export async function deleteCustodyFundSb(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('custody_funds').delete().eq('id', id);
  if (error) throw new Error(error.message || 'فشل حذف العهدة');
}

export async function putCustodyFundSb(id: string, doc: unknown): Promise<unknown> {
  const actor = await getSupabaseActor();
  if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role)) throw new Error('غير مصرح');
  const raw = doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...raw, id: String(id).trim() };
  if (actor.role === 'مدير إنتاج' && !custodyDocForProductionManager(merged, actor)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data: ex } = await sb.from('custody_funds').select('id').eq('id', id).maybeSingle();
  if (!ex) {
    const { data, error } = await sb.from('custody_funds').insert({ id, doc_json: merged }).select('doc_json').single();
    if (error || !data) throw new Error(error?.message || 'فشل الحفظ');
    return (data as { doc_json: unknown }).doc_json;
  }
  const { data, error } = await sb.from('custody_funds').update({ doc_json: merged }).eq('id', id).select('doc_json').single();
  if (error || !data) throw new Error(error?.message || 'فشل الحفظ');
  return (data as { doc_json: unknown }).doc_json;
}

/* ---------- bookings doc tables ---------- */
async function fetchDocBookingsSb(table: string): Promise<unknown[]> {
  await getSupabaseActor();
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select('doc_json').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => (r as { doc_json?: unknown }).doc_json).filter(Boolean);
}

export const fetchShootBookingsSb = () => fetchDocBookingsSb('shoot_bookings');
export const fetchEquipmentBookingsSb = () => fetchDocBookingsSb('equipment_bookings');
export const fetchMeetingBookingsSb = () => fetchDocBookingsSb('meeting_bookings');

async function insertDocBookingSb(
  table: string,
  doc: Record<string, unknown>,
  canCreate: (role: string) => boolean,
): Promise<unknown> {
  const actor = await getSupabaseActor();
  if (!canCreate(actor.role)) throw new Error('غير مصرح');
  const id = String(doc.id || newId('BK')).trim();
  const merged = { ...doc, id };
  const sb = getSupabase();
  const { data, error } = await sb.from(table).insert({ id, doc_json: merged }).select('doc_json').single();
  if (error || !data) throw new Error(error?.message || 'فشل الإنشاء');
  return (data as { doc_json: unknown }).doc_json;
}

async function deleteDocBookingSb(
  table: string,
  id: string,
  canDelete: (role: string) => boolean,
): Promise<void> {
  const actor = await getSupabaseActor();
  if (!canDelete(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message || 'فشل الحذف');
}

async function patchDocBookingSb(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  canPatch: (role: string) => boolean,
): Promise<unknown> {
  const actor = await getSupabaseActor();
  if (!canPatch(actor.role)) throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data: row } = await sb.from(table).select('doc_json').eq('id', id).maybeSingle();
  const cur =
    row && typeof (row as { doc_json?: unknown }).doc_json === 'object'
      ? ({ ...((row as { doc_json: Record<string, unknown> }).doc_json || {}) } as Record<string, unknown>)
      : {};
  const merged = { ...cur, ...patch, id };
  const { data, error } = await sb.from(table).update({ doc_json: merged }).eq('id', id).select('doc_json').single();
  if (error || !data) throw new Error(error?.message || 'فشل التحديث');
  return (data as { doc_json: unknown }).doc_json;
}

export async function createShootBookingSb(doc: Record<string, unknown>): Promise<unknown> {
  return insertDocBookingSb('shoot_bookings', doc, (r) => r === 'مندوب' || r === 'مدير إنتاج');
}

export async function patchShootBookingSb(id: string, patch: Record<string, unknown>): Promise<unknown> {
  return patchDocBookingSb('shoot_bookings', id, patch, (r) =>
    ['مالك', 'مدير مبيعات', 'محاسب', 'مدير إنتاج'].includes(r),
  );
}

export async function deleteShootBookingSb(id: string): Promise<void> {
  return deleteDocBookingSb('shoot_bookings', id, (r) => ['مالك', 'مدير مبيعات', 'مدير إنتاج'].includes(r));
}

export async function createEquipmentBookingSb(doc: Record<string, unknown>): Promise<unknown> {
  return insertDocBookingSb('equipment_bookings', doc, (r) => r === 'مندوب' || r === 'مدير إنتاج');
}

export async function patchEquipmentBookingSb(id: string, patch: Record<string, unknown>): Promise<unknown> {
  return patchDocBookingSb('equipment_bookings', id, patch, (r) =>
    ['مالك', 'مدير مبيعات', 'محاسب', 'مدير إنتاج'].includes(r),
  );
}

export async function deleteEquipmentBookingSb(id: string): Promise<void> {
  return deleteDocBookingSb('equipment_bookings', id, (r) => ['مالك', 'مدير مبيعات', 'مدير إنتاج'].includes(r));
}

export async function createMeetingBookingSb(doc: Record<string, unknown>): Promise<unknown> {
  return insertDocBookingSb('meeting_bookings', doc, (r) => r === 'مندوب' || r === 'مدير مبيعات');
}

export async function patchMeetingBookingSb(id: string, patch: Record<string, unknown>): Promise<unknown> {
  return patchDocBookingSb('meeting_bookings', id, patch, (r) =>
    ['مالك', 'مدير مبيعات', 'محاسب', 'مدير إنتاج'].includes(r),
  );
}

export async function deleteMeetingBookingSb(id: string): Promise<void> {
  return deleteDocBookingSb('meeting_bookings', id, (r) => ['مالك', 'مدير مبيعات', 'مدير إنتاج'].includes(r));
}

/* ---------- workspace state ---------- */
export { fetchWorkspaceStateSb, patchWorkspaceStateSb } from '@/lib/supabase/workspaceStateSb';

/* ---------- attendance ---------- */
export async function fetchAttendanceRecordsSb(): Promise<AttendanceRecord[]> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const sb = getSupabase();
  const { data, error } = await sb.from('attendance_records').select('*').order('created_at', { ascending: false }).limit(4000);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.map((r) => mapAttendanceFromRow(r as Record<string, unknown>));
}

export async function postAttendanceRecordSb(body: {
  repId: string;
  type?: string;
  source?: string;
  id?: string;
  createdAt?: string;
}): Promise<AttendanceRecord> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'محاسب' && actor.role !== 'مالك') throw new Error('غير مصرح');
  const repId = String(body.repId || '').trim();
  if (!repId) throw new Error('repId مطلوب');
  const type = body.type === 'out' ? 'out' : 'in';
  const source = body.source === 'manual' ? 'manual' : 'machine';
  const id = body.id ? String(body.id).trim() : newId('ATT');
  const createdAt = body.createdAt ? String(body.createdAt) : new Date().toISOString();
  const sb = getSupabase();
  const { data, error } = await sb
    .from('attendance_records')
    .insert({ id, rep_id: repId, type, source, created_at: createdAt })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'فشل التسجيل');
  return mapAttendanceFromRow(data as Record<string, unknown>);
}
