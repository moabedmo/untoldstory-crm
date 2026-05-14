import type {
  Lead,
  User,
  ManualCustomer,
  Expense,
  PriceQuote,
  ManualJournalEntry,
  MonthlyTarget,
  AuditEvent,
  AttendanceRecord,
  CustodySpendLine,
} from '@/app/context/DataContext';

const PRODUCTION_SPEND_MARKER = '\n__PSL_v1__:';

function utf8ToB64(s: string): string {
  try {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin);
  } catch {
    return btoa(unescape(encodeURIComponent(s)));
  }
}

function b64ToUtf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return decodeURIComponent(escape(atob(b64)));
  }
}

export function stripProductionSpendMarkerFromRawNote(raw: string | null | undefined): string {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  const idx = s.lastIndexOf(PRODUCTION_SPEND_MARKER);
  if (idx < 0) return s;
  return s.slice(0, idx).trimEnd();
}

export function parseProductionSpendLinesFromRawNote(raw: string | null | undefined): CustodySpendLine[] {
  if (raw == null || raw === '') return [];
  const s = String(raw);
  const idx = s.lastIndexOf(PRODUCTION_SPEND_MARKER);
  if (idx < 0) return [];
  const b64 = s.slice(idx + PRODUCTION_SPEND_MARKER.length).trim();
  if (!b64) return [];
  try {
    const json = b64ToUtf8(b64);
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x: any) => ({
      id: String(x?.id || `CL-${Math.random().toString(36).slice(2, 8)}`),
      title: String(x?.title || ''),
      amount: Math.max(0, Number(x?.amount) || 0),
      category: (x?.category as CustodySpendLine['category']) || 'تشغيل',
      costCenter: String(x?.costCenter || 'عام'),
      note: typeof x?.note === 'string' ? x.note : undefined,
      attachments: Array.isArray(x?.attachments)
        ? x.attachments.map((a: any) => ({
            id: String(a?.id || `ATT-${Math.random().toString(36).slice(2, 9)}`),
            fileName: String(a?.fileName || 'مرفق'),
            mimeType: typeof a?.mimeType === 'string' ? a.mimeType : undefined,
            dataBase64: typeof a?.dataBase64 === 'string' ? a.dataBase64 : undefined,
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

export function mergeProductionSpendLinesIntoRawNote(
  rawNote: string | null | undefined,
  lines: CustodySpendLine[],
): string {
  const base = stripProductionSpendMarkerFromRawNote(rawNote);
  const payload = utf8ToB64(JSON.stringify(lines));
  return `${base.trimEnd()}${PRODUCTION_SPEND_MARKER}${payload}`;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'object' && !Array.isArray(v)) return v as T;
  if (Array.isArray(v)) return v as T;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function iso(v: unknown): string {
  if (typeof v === 'string' && v) return v;
  if (v instanceof Date) return v.toISOString();
  return new Date().toISOString();
}

export function mapLeadFromRow(r: Record<string, unknown>): Lead {
  const timeline = parseJson<Lead['timeline']>(r.timeline_json, []);
  return {
    id: String(r.id ?? ''),
    customerCode: r.customer_code ? String(r.customer_code) : undefined,
    name: String(r.name ?? ''),
    company: String(r.company ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    status: String(r.status ?? '') as Lead['status'],
    assignedTo: r.assigned_to_id ? String(r.assigned_to_id) : undefined,
    budget: Number(r.budget) || 0,
    companySize: (() => {
      const cs = String(r.company_size ?? 'صغير');
      return cs === 'صغير' || cs === 'متوسط' || cs === 'كبير' ? (cs as Lead['companySize']) : 'صغير';
    })(),
    source: String(r.source ?? ''),
    category: String(r.category ?? '') as Lead['category'],
    score: Number(r.score) || 0,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    followUpAt: r.follow_up_at ? iso(r.follow_up_at) : undefined,
    lossReasonCode: (() => {
      const lr = r.loss_reason_code != null ? String(r.loss_reason_code) : '';
      const allowed: NonNullable<Lead['lossReasonCode']>[] = [
        'budget',
        'price',
        'timing',
        'competition',
        'no_response',
        'scope',
        'other',
      ];
      return (allowed as string[]).includes(lr) ? (lr as Lead['lossReasonCode']) : undefined;
    })(),
    slaStatus: String(r.sla_status ?? 'مستقر') as Lead['slaStatus'],
    timeline: Array.isArray(timeline) ? timeline : [],
  };
}

export function mapUserFromRow(r: Record<string, unknown>): User {
  const skills = parseJson<User['skills']>(r.skills_json, []);
  const statsRaw = parseJson<Record<string, unknown>>(r.stats_json, {});
  const role = String(r.role || '').trim();
  const allowed: User['role'][] = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
  const rr = (allowed as string[]).includes(role) ? (role as User['role']) : 'مندوب';
  return {
    id: String(r.id ?? ''),
    email: typeof r.email === 'string' ? r.email : undefined,
    name: String(r.name ?? 'موظف'),
    role: rr,
    authSource: 'database',
    avatar:
      typeof r.avatar === 'string' && r.avatar
        ? r.avatar
        : 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    skills: Array.isArray(skills) ? skills : [],
    baseSalary: (() => {
      const v = r.base_salary;
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    })(),
    stats: {
      dealsWon: Number(statsRaw.dealsWon) || 0,
      points: Number(statsRaw.points) || 0,
      avgResponseTime: typeof statsRaw.avgResponseTime === 'string' ? statsRaw.avgResponseTime : '0 min',
      revenue: typeof statsRaw.revenue === 'number' ? statsRaw.revenue : undefined,
    },
  };
}

export function mapManualCustomerFromRow(r: Record<string, unknown>): ManualCustomer {
  return {
    id: String(r.id ?? ''),
    customerCode: String(r.customer_code ?? ''),
    name: String(r.name ?? ''),
    company: r.company ? String(r.company) : undefined,
    phone: r.phone ? String(r.phone) : undefined,
    email: r.email ? String(r.email) : undefined,
    sourceLabel: r.source_label ? String(r.source_label) : undefined,
    createdAt: iso(r.created_at),
    createdById: String(r.created_by_id ?? ''),
    createdByName: String(r.created_by_name ?? ''),
    createdByRole: String(r.created_by_role ?? 'محاسب') as ManualCustomer['createdByRole'],
  };
}

/** صيغة خام لـ normalizeInvoice في DataContext */
export function mapInvoiceRowRaw(r: Record<string, unknown>): Record<string, unknown> {
  const collections = parseJson(r.collections_json, []);
  return {
    id: r.id,
    customerCode: r.customer_code ?? undefined,
    leadId: r.lead_id ?? '',
    customerName: r.customer_name,
    amount: r.amount,
    vatRate: r.vat_rate ?? undefined,
    vatAmount: r.vat_amount ?? undefined,
    totalAmount: r.total_amount ?? undefined,
    costCenter: r.cost_center ?? undefined,
    status: r.status,
    date: typeof r.date === 'string' ? r.date : iso(r.date),
    recordOrigin: r.record_origin ?? undefined,
    priceQuoteId: r.price_quote_id ?? undefined,
    paidAmount: r.paid_amount ?? undefined,
    remainingAmount: r.remaining_amount ?? undefined,
    nextDueDate: r.next_due_date
      ? typeof r.next_due_date === 'string'
        ? r.next_due_date
        : iso(r.next_due_date)
      : undefined,
    collections,
  };
}

export function mapExpenseFromRow(r: Record<string, unknown>): Expense {
  const rawNoteFull = r.note != null ? String(r.note) : '';
  const rawNote = stripProductionSpendMarkerFromRawNote(rawNoteFull);
  const stripPay = (s: string) => s.replace(/\n?__pay:(كاش|بنك)__\s*/g, '').trim();
  const noteForUi = (() => {
    if (!rawNote.length) return undefined;
    let cleaned = stripPay(rawNote);
    if (!cleaned) return undefined;
    if (cleaned.includes('__sb_id:')) {
      const withoutId = cleaned.replace(/\n?__sb_id:[^_\n]+__\s*/g, '');
      const withoutMarker = withoutId.replace(/(?:^|\n)مقدّم الطلب:\s*[^\n]+$/m, '').trim();
      return withoutMarker.length > 0 ? withoutMarker : undefined;
    }
    return cleaned || undefined;
  })();

  const submittedByIdFromNote = (() => {
    const m = rawNote.match(/__sb_id:([^_\s\n]+)__/);
    return m ? m[1].trim() : '';
  })();

  const submittedByNameFromCol = (() => {
    const v = r.submitted_by_name;
    if (v == null || v === '') return '';
    const s = String(v).trim();
    return s && s !== 'null' ? s : '';
  })();

  const submittedByNameFromNote = (() => {
    const m = rawNote.match(/(?:^|\n)مقدّم الطلب:\s*([^\n]+)/);
    if (!m) return '';
    return m[1].replace(/\s*__sb_id:[^_\s]+__\s*$/, '').trim();
  })();

  return {
    id: String(r.id ?? ''),
    title: String(r.title ?? ''),
    category: String(r.category ?? 'أخرى') as Expense['category'],
    amount: Number(r.amount) || 0,
    vatRate: typeof r.vat_rate === 'number' ? r.vat_rate : undefined,
    vatAmount: typeof r.vat_amount === 'number' ? r.vat_amount : undefined,
    totalAmount: typeof r.total_amount === 'number' ? r.total_amount : undefined,
    costCenter: r.cost_center ? String(r.cost_center) : undefined,
    status: String(r.status ?? 'قيد الانتظار') as Expense['status'],
    approvalStatus: (() => {
      const s = String(r.approval_status ?? 'قيد الاعتماد').trim();
      const allowed: Expense['approvalStatus'][] = ['قيد الاعتماد', 'معتمد', 'مرفوض'];
      return (allowed as string[]).includes(s) ? (s as Expense['approvalStatus']) : 'قيد الاعتماد';
    })(),
    approvedBy: r.approved_by ? String(r.approved_by) : undefined,
    vendor: r.vendor ? String(r.vendor) : undefined,
    note: noteForUi,
    date: iso(r.date),
    submittedById: r.submitted_by_id != null && String(r.submitted_by_id).trim() !== ''
      ? String(r.submitted_by_id).trim()
      : (r as { submittedById?: unknown }).submittedById != null && String((r as { submittedById?: unknown }).submittedById).trim() !== ''
        ? String((r as { submittedById?: unknown }).submittedById).trim()
        : submittedByIdFromNote || undefined,
    submittedByName: submittedByNameFromCol || submittedByNameFromNote || undefined,
    paymentMethod: (() => {
      const v = r.payment_method;
      if (v != null && v !== '') {
        const s = String(v).trim();
        if (s === 'كاش' || s === 'بنك') return s as Expense['paymentMethod'];
      }
      const m = rawNoteFull.match(/__pay:(كاش|بنك)__/);
      if (m && (m[1] === 'كاش' || m[1] === 'بنك')) return m[1] as Expense['paymentMethod'];
      return undefined;
    })(),
    productionSpendLines: parseProductionSpendLinesFromRawNote(rawNoteFull),
  };
}

export function mapPriceQuoteFromRow(r: Record<string, unknown>): PriceQuote {
  return {
    id: String(r.id ?? ''),
    leadId: String(r.lead_id ?? ''),
    customerName: String(r.customer_name ?? ''),
    title: String(r.title ?? ''),
    amount: Number(r.amount) || 0,
    vatRate: typeof r.vat_rate === 'number' ? r.vat_rate : undefined,
    vatAmount: typeof r.vat_amount === 'number' ? r.vat_amount : undefined,
    totalAmount: typeof r.total_amount === 'number' ? r.total_amount : undefined,
    costCenter: r.cost_center ? String(r.cost_center) : undefined,
    note: r.note ? String(r.note) : undefined,
    createdById: String(r.created_by_id ?? ''),
    createdByName: String(r.created_by_name ?? ''),
    createdAt: iso(r.created_at),
    status: (() => {
      const st = String(r.status ?? 'قيد اعتماد المالك');
      const allowed: PriceQuote['status'][] = ['بانتظار التسعير', 'قيد اعتماد المالك', 'معتمد', 'مرفوض', 'مكتمل', 'مغلق - رفض العميل'];
      return (allowed as string[]).includes(st) ? (st as PriceQuote['status']) : 'قيد اعتماد المالك';
    })(),
    productionAssignedId: r.production_assigned_id ? String(r.production_assigned_id) : undefined,
    productionAssignedName: r.production_assigned_name ? String(r.production_assigned_name) : undefined,
    pricedById: r.priced_by_id ? String(r.priced_by_id) : undefined,
    pricedByName: r.priced_by_name ? String(r.priced_by_name) : undefined,
    pricedAt: r.priced_at ? iso(r.priced_at) : undefined,
    pricingNote: r.pricing_note ? String(r.pricing_note) : undefined,
    approvedBy: r.approved_by ? String(r.approved_by) : undefined,
    approvedAt: r.approved_at ? iso(r.approved_at) : undefined,
    invoiceId: r.invoice_id ? String(r.invoice_id) : undefined,
    paymentSchedule: parseJson(r.payment_schedule_json, undefined) as import('@/app/context/DataContext').PaymentInstallment[] | undefined,
    initialPayment: r.initial_payment ? Number(r.initial_payment) : undefined,
    clientPayments: parseJson(r.client_payments_json, undefined) as import('@/app/context/DataContext').ClientPayment[] | undefined,
    clientAcceptedAt: r.client_accepted_at ? iso(r.client_accepted_at) : undefined,
    clientRejectedAt: r.client_rejected_at ? iso(r.client_rejected_at) : undefined,
    clientRejectionNote: r.client_rejection_note ? String(r.client_rejection_note) : undefined,
    companyMarginPercent: (() => {
      const v = r.company_margin_percent;
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
    productionCostAmount: (() => {
      const v = r.production_cost_amount;
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    })(),
  };
}

export function mapManualJournalFromRow(r: Record<string, unknown>): ManualJournalEntry {
  const lines = parseJson<ManualJournalEntry['lines']>(r.lines_json, []);
  return {
    id: String(r.id ?? ''),
    date: iso(r.date),
    description: String(r.description ?? ''),
    lines: Array.isArray(lines) ? lines : [],
  };
}

export function mapAccountingPolicyFromRow(r: Record<string, unknown> | null): {
  policyNotes: string;
  allowedCostCentersForQuotes: string[];
  minAmountHighlight: number;
} | null {
  if (!r) return null;
  const allowed = parseJson<string[]>(r.allowed_cost_centers_json, []);
  return {
    policyNotes: String(r.policy_notes ?? ''),
    allowedCostCentersForQuotes: Array.isArray(allowed) ? allowed : [],
    minAmountHighlight: Number(r.min_amount_highlight) || 0,
  };
}

export function mapClosedMonthFromRow(r: Record<string, unknown>): string {
  return String(r.month_key ?? '');
}

export function mapMonthlyTargetFromRow(r: Record<string, unknown>): MonthlyTarget {
  return {
    repId: String(r.rep_id ?? ''),
    leadsTarget: Number(r.leads_target) || 0,
    revenueTarget: Number(r.revenue_target) || 0,
    callsTarget: Number(r.calls_target) || 0,
    dailyCallsTarget: Number(r.daily_calls_target) || 0,
    weeklyCallsTarget: Number(r.weekly_calls_target) || 0,
  };
}

export function mapCustodySettingsMap(r: Record<string, unknown> | null): Record<string, string> | null {
  if (!r) return null;
  const j = parseJson<Record<string, string>>(r.custody_account_map_json, {});
  return typeof j === 'object' && j ? j : {};
}

export function mapAuditFromRow(r: Record<string, unknown>): AuditEvent {
  return {
    id: String(r.id ?? ''),
    action: String(r.action ?? ''),
    entityType: String(r.entity_type ?? '') as AuditEvent['entityType'],
    entityId: r.entity_id ? String(r.entity_id) : undefined,
    actorId: String(r.actor_id ?? ''),
    actorName: String(r.actor_name ?? ''),
    details: r.details ? String(r.details) : undefined,
    createdAt: iso(r.created_at),
  };
}

export function mapDocJsonRow<T>(r: Record<string, unknown>): T | null {
  const doc = r.doc_json;
  if (doc && typeof doc === 'object') return doc as T;
  return null;
}

export function mapAttendanceFromRow(r: Record<string, unknown>): AttendanceRecord {
  const t = String(r.type ?? 'in');
  const s = String(r.source ?? 'machine');
  return {
    id: String(r.id ?? ''),
    repId: String(r.rep_id ?? ''),
    type: t === 'out' ? 'out' : 'in',
    source: s === 'manual' ? 'manual' : 'machine',
    createdAt: iso(r.created_at),
  };
}
