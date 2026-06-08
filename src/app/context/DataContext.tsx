import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getAppPublicOrigin, getOAuthApiOrigin } from '@/config/site';
import { getApiBaseUrl } from '@/config/api';
import { isServerDataMode } from '@/config/dataSource';
import { isSupabaseDirectMode } from '@/config/supabaseMode';
import {
  fetchSupabaseWorkspaceSnapshot,
  filterWorkspaceSnapshotForViewer,
} from '@/lib/supabase/loadWorkspaceSnapshot';
import { supabaseCreateLead, supabaseDeleteLead, supabasePatchLead } from '@/lib/supabase/leadsRepo';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { mapUserFromRow } from '@/lib/supabase/postgrestMappers';
import {
  fetchLeadsApi,
  createLeadApi,
  patchLeadApi,
  deleteLeadApi,
  demoChannelIngestApi,
  syncRealMetaLeadsApi,
  syncRealLinkedInLeadsApi,
  syncRealGoogleAdsLeadsApi,
} from '@/lib/api/leadsApi';
import {
  fetchUsersApi,
  createUserApi,
  patchUserApi,
  deleteUserApi,
} from '@/lib/api/usersApi';
import { repSkillMatchesLeadCategory } from '@/lib/repSkills';
import {
  fetchManualCustomersApi,
  createManualCustomerApi,
} from '@/lib/api/manualCustomersApi';
import { fetchInvoicesApi, createInvoiceApi, patchInvoiceApi } from '@/lib/api/invoicesApi';
import { fetchExpensesApi, createExpenseApi, patchExpenseApi, deleteExpenseApi } from '@/lib/api/expensesApi';
import { fetchPriceQuotesApi, createPriceQuoteApi, patchPriceQuoteApi } from '@/lib/api/priceQuotesApi';
import { fetchAccountingPolicyApi, patchAccountingPolicyApi } from '@/lib/api/accountingPolicyApi';
import {
  fetchManualJournalsApi,
  createManualJournalApi,
  updateManualJournalApi,
  deleteManualJournalApi,
} from '@/lib/api/manualJournalsApi';
import { fetchClosedMonthsApi, postCloseMonthApi, postReopenMonthApi } from '@/lib/api/closedMonthsApi';
import { fetchMonthlyTargetsApi, patchMonthlyTargetApi } from '@/lib/api/monthlyTargetsApi';
import { fetchCustodySettingsApi, patchCustodySettingsApi } from '@/lib/api/custodySettingsApi';
import { fetchAuditEventsApi, postAuditEventApi } from '@/lib/api/auditEventsApi';
import {
  fetchCustodyFundsApi,
  createCustodyFundApi,
  putCustodyFundApi,
  deleteCustodyFundApi,
  promoteCustodyDraftsToOwnerApi,
} from '@/lib/api/custodyFundsApi';
import {
  fetchShootBookingsApi,
  createShootBookingApi,
  patchShootBookingApi,
  deleteShootBookingApi,
} from '@/lib/api/shootBookingsApi';
import {
  fetchEquipmentBookingsApi,
  createEquipmentBookingApi,
  patchEquipmentBookingApi,
  deleteEquipmentBookingApi,
} from '@/lib/api/equipmentBookingsApi';
import {
  fetchMeetingBookingsApi,
  createMeetingBookingApi,
  patchMeetingBookingApi,
  deleteMeetingBookingApi,
} from '@/lib/api/meetingBookingsApi';
import { fetchWorkspaceStateApi, patchWorkspaceStateApi } from '@/lib/api/workspaceStateApi';
import { fetchAttendanceRecordsApi, postAttendanceRecordApi } from '@/lib/api/attendanceRecordsApi';
import { buildSystemNotifications } from './buildSystemNotifications';
import { clearLegacyOnboardingStorageKeys } from './legacyStorageCleanup';
import { getMonthKey } from './dateMonthKey';
import { notifyNewInboundLeads, resetInboundLeadToastState } from '@/lib/inboundLeadToasts';
import { notifyClientChannel } from '@/lib/clientChannelNotify';
import { fetchLeadsSb } from '@/lib/supabase/directApiSb';
import {
  mergeLeadsFromServer,
  removeLeadFromList,
  upsertLeadInList,
} from '@/lib/leads/mergeLeadsFromServer';
import { upsertById, removeById, prependUniqueAudit } from '@/lib/sync/entityListMerge';
import { subscribeWorkspaceRealtime } from '@/lib/supabase/subscribeWorkspaceRealtime';
import { toast } from 'sonner';
import { syncWorkspacePatch, type WorkspaceStatePatch } from './workspaceSync';
import {
  accountingSaveErrorHint,
  coerceAccountingWorkspaceArray,
  mergeChartOfAccountsLists,
  mergeJournalCodingRulesLists,
  readCachedChartOfAccounts,
  readCachedJournalCodebook,
  writeAccountingCache,
} from '@/lib/accounting/accountingWorkspacePersistence';
import { normalizeLeadPhone, leadPhoneDigitsKey, isValidLeadPhone } from '@/lib/leadPhone';

/** حذف قيد يومية أثناء التراجع — لا يرمي للأعلى */
async function tryDeleteManualJournal(journalId: string): Promise<void> {
  try {
    await deleteManualJournalApi(journalId);
  } catch {
    /* تجاهل */
  }
}

// Types
export type LeadStatus = 'جديد' | 'قيد التواصل' | 'عرض سعر' | 'تفاوض' | 'مغلق - فوز' | 'مغلق - خسارة';

/** نتيجة محاولة حذف ليد — للرسائل في الواجهة */
export type DeleteLeadResult = 'deleted' | 'forbidden' | 'blocked' | 'failed';

export type BulkDeleteLeadsResult = {
  deleted: number;
  blocked: number;
  failed: number;
};
export type LeadCategory = 'إنجليزي' | 'شركات كبرى' | 'شركات صغيرة' | 'إعلانات' | 'سوشيال ميديا';

export interface Activity {
  id: string;
  leadId: string;
  action: string;
  note?: string;
  channelType?: 'call' | 'chat' | 'other';
  evidenceType?: 'recording' | 'chat_export' | 'link' | 'note_only';
  evidenceRef?: string;
  durationSeconds?: number;
  qaStatus?: 'pending' | 'approved' | 'rejected';
  qaReviewedById?: string;
  qaReviewedByName?: string;
  qaReviewedAt?: string;
  qaComment?: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  customerCode?: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  status: LeadStatus;
  assignedTo?: string; // User ID
  budget: number;
  companySize: 'صغير' | 'متوسط' | 'كبير';
  source: string;
  category: LeadCategory;
  score: number;
  createdAt: string;
  updatedAt: string;
  followUpAt?: string;
  lossReasonCode?: 'price' | 'timing' | 'budget' | 'competition' | 'no_response' | 'scope' | 'other';
  slaStatus: 'مستقر' | 'متأخر' | 'حرج';
  timeline: Activity[];
}

export interface User {
  id: string;
  name: string;
  role: 'مالك' | 'مدير مبيعات' | 'مندوب' | 'محاسب' | 'مدير إنتاج';
  avatar: string;
  /** مهارات التوزيع — تصنيفات ليدز جاهزة أو مهارات مخصّصة */
  skills: string[];
  baseSalary?: number;
  /** عند تسجيل الدخول عبر الباك اند */
  email?: string;
  authSource?: 'database' | 'demo';
  stats: {
    dealsWon: number;
    points: number;
    avgResponseTime: string; // e.g., "15 min"
    revenue?: number;
  };
}

export interface ManualCustomer {
  id: string;
  customerCode: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  sourceLabel?: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  createdByRole: User['role'];
}

/** مصدر تسجيل الفاتورة في الدفاتر */
export type InvoiceRecordOrigin = 'عرض_سعر_معتمد' | 'يدوي_محاسب' | 'ترحيل';

export interface InvoiceCollection {
  id: string;
  date: string;
  amount: number;
  method: 'كاش' | 'تحويل';
  journalEntryId?: string;
  note?: string;
}

export interface Invoice {
  id: string;
  customerCode?: string;
  leadId: string;
  customerName: string;
  amount: number;
  vatRate?: number;
  vatAmount?: number;
  totalAmount?: number;
  costCenter?: string;
  status: 'مدفوع' | 'قيد الانتظار' | 'متأخر';
  date: string;
  /** من أين أُثبتت الفاتورة محاسبياً */
  recordOrigin?: InvoiceRecordOrigin;
  /** إن وُلدت من عرض سعر معتمد */
  priceQuoteId?: string;
  paidAmount?: number;
  remainingAmount?: number;
  nextDueDate?: string;
  collections?: InvoiceCollection[];
}

/** طلب عرض سعر مالي من المبيعات — لا يُسجَّل عند المحاسب إلا بعد اعتماد المالك */
export interface PriceQuote {
  id: string;
  leadId: string;
  customerName: string;
  title: string;
  amount: number;
  vatRate?: number;
  vatAmount?: number;
  totalAmount?: number;
  costCenter?: string;
  note?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  status: 'بانتظار التسعير' | 'قيد اعتماد المالك' | 'معتمد' | 'مرفوض' | 'مكتمل' | 'مغلق - رفض العميل';
  productionAssignedId?: string;
  productionAssignedName?: string;
  pricedById?: string;
  pricedByName?: string;
  pricedAt?: string;
  pricingNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  invoiceId?: string;
  paymentSchedule?: PaymentInstallment[];
  initialPayment?: number;
  clientPayments?: ClientPayment[];
  clientAcceptedAt?: string;
  clientRejectedAt?: string;
  clientRejectionNote?: string;
  /** أمر شغل (حجز تصوير) يُنشأ تلقائياً بعد موافقة العميل */
  workOrderShootBookingId?: string;
  /** نسبة هامش الشركة على أساس بنود التكلفة (يحددها مدير الإنتاج عند التسعير) */
  companyMarginPercent?: number;
  /** مجموع بنود التكلفة قبل تطبيق نسبة الشركة */
  productionCostAmount?: number;
}

export interface ClientPayment {
  id: string;
  amount: number;
  dueDate: string;
  method: 'كاش' | 'تحويل';
  note?: string;
}

export interface PaymentInstallment {
  id: string;
  dueDate: string;
  amount: number;
  note?: string;
  paid?: boolean;
  paidAt?: string;
}

/** قيود وسياسة يحددها المحاسب لعروض الأسعار */
export interface AccountingPolicy {
  policyNotes: string;
  allowedCostCentersForQuotes: string[];
  /** مبلغ يُبرز التنبيه عند تجاوزه (0 = تعطيل) */
  minAmountHighlight: number;
}

export interface Expense {
  id: string;
  title: string;
  category: 'رواتب' | 'إيجارات' | 'معدات' | 'تسويق' | 'تشغيل' | 'ضيافة' | 'نثريات' | 'أخرى';
  amount: number;
  vatRate?: number;
  vatAmount?: number;
  totalAmount?: number;
  costCenter?: string;
  status: 'مدفوع' | 'قيد الانتظار';
  approvalStatus: 'قيد الاعتماد' | 'معتمد' | 'مرفوض';
  approvedBy?: string;
  vendor?: string;
  note?: string;
  /** من أنشأ طلب/سجل المصروف */
  submittedById?: string;
  submittedByName?: string;
  /** عند «مدفوع»: كيف تم الصرف (للدفاتر) */
  paymentMethod?: 'كاش' | 'بنك' | null;
  date: string;
  /** بنود الصرف والمرفقات بعد اعتماد المالك (طلبات مدير الإنتاج؛ تُخزَّن في note على السيرفر) */
  productionSpendLines?: CustodySpendLine[];
}

export interface RepSnapshot {
  repId: string;
  repName: string;
  avatar: string;
  totalAssigned: number;
  activeLeads: number;
  wonDeals: number;
  lostDeals: number;
  conversionRate: number;
  revenue: number;
  overdueLeads: number;
  avgResponseMins: number;
  lastActivityAt?: string;
  leadsTarget: number;
  revenueTarget: number;
  callsTarget: number;
  callsCount: number;
  leadsTargetProgress: number;
  revenueTargetProgress: number;
  callsTargetProgress: number;
  documentedTouches: number;
  confirmedContacts: number;
  leadsWithConfirmedContact: number;
  confirmedContactCoverage: number;
  documentationQualityScore: number;
  dailyCallsTarget: number;
  weeklyCallsTarget: number;
  dailyCallsCount: number;
  weeklyCallsCount: number;
  dailyCallsProgress: number;
  weeklyCallsProgress: number;
  commissionPercent: number;
  estimatedCommission: number;
}

export interface MonthlyTarget {
  repId: string;
  leadsTarget: number;
  revenueTarget: number;
  callsTarget: number;
  dailyCallsTarget: number;
  weeklyCallsTarget: number;
  /** نسبة عمولة على الإيراد المحقق (صفقات فوز) — للتقارير */
  commissionPercent: number;
}

export interface PerformanceAlert {
  id: string;
  level: 'high' | 'medium' | 'low';
  message: string;
  repId?: string;
  createdAt: string;
}

export interface SlaHeatmapItem {
  day: string;
  stable: number;
  late: number;
  critical: number;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: 'lead' | 'invoice' | 'user' | 'system';
  entityId?: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  details?: string;
}

export interface ChartOfAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isSystem?: boolean;
}

export interface ManualJournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  costCenter?: string;
  note?: string;
}

export interface ManualJournalEntry {
  id: string;
  date: string;
  description: string;
  lines: ManualJournalLine[];
}

/** أكواد يومية محفوظة لتطبيقها على سطور القيد (نفس بنية الواجهة) */
export interface JournalCodingRule {
  id: string;
  title: string;
  accountCode: string;
  costCenter: string;
}

/** قواعد تكويد أرقام المصروفات حسب الفئة (شاشة المحاسب) */
export interface ExpenseCodingRule {
  category: Expense['category'];
  prefix: string;
}

const DEFAULT_EXPENSE_CODING_RULES: ExpenseCodingRule[] = [
  { category: 'رواتب', prefix: 'EXP-SAL' },
  { category: 'إيجارات', prefix: 'EXP-RNT' },
  { category: 'معدات', prefix: 'EXP-EQP' },
  { category: 'تسويق', prefix: 'EXP-MKT' },
  { category: 'تشغيل', prefix: 'EXP-OPS' },
  { category: 'ضيافة', prefix: 'EXP-HSP' },
  { category: 'نثريات', prefix: 'EXP-PET' },
  { category: 'أخرى', prefix: 'EXP-OTH' },
];

function normalizeJournalCodingRulesFromArray(raw: unknown): JournalCodingRule[] {
  const arr = coerceAccountingWorkspaceArray(raw);
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      id: String(x.id ?? `jr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      title: String(x.title ?? '').trim(),
      accountCode: String(x.accountCode ?? '').trim(),
      costCenter: String(x.costCenter ?? 'عام').trim() || 'عام',
    }))
    .filter((x) => x.title && x.accountCode);
}

function mergeExpenseCodingRulesFromArray(raw: unknown): ExpenseCodingRule[] {
  const base = DEFAULT_EXPENSE_CODING_RULES.map((r) => ({ ...r }));
  if (!Array.isArray(raw)) return base;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const cat = (row as { category?: string }).category;
    const prefix = String((row as { prefix?: string }).prefix ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (!prefix || typeof cat !== 'string') continue;
    const i = base.findIndex((r) => r.category === cat);
    if (i >= 0) base[i] = { category: cat as Expense['category'], prefix };
  }
  return base;
}

/** عرض فلتر مصروفات محفوظ من شاشة المحاسب */
export interface ExpenseSavedView {
  id: string;
  name: string;
  month: string;
  code: string;
  keyword: string;
}

function normalizeExpenseSavedViews(raw: unknown): ExpenseSavedView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object')
    .map((x: any) => ({
      id: String(x.id || `view-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      name: String(x.name ?? '').trim(),
      month: String(x.month ?? '').slice(0, 7),
      code: String(x.code ?? ''),
      keyword: String(x.keyword ?? ''),
    }))
    .filter((v) => v.name);
}

/** تعليقات على كيان (معرّف مصروف/حجز → قائمة تعليقات) */
export type EntityCommentsMap = Record<string, { by: string; text: string; at: string }[]>;

function normalizeEntityComments(raw: unknown): EntityCommentsMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: EntityCommentsMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const list = v
      .filter((item) => item && typeof item === 'object')
      .map((item: any) => ({
        by: String(item?.by ?? ''),
        text: String(item?.text ?? ''),
        at: typeof item?.at === 'string' ? item.at : new Date().toISOString(),
      }))
      .filter((c) => c.text.trim());
    if (list.length > 0) out[k] = list;
  }
  return out;
}

export type ExpenseEscalationState = { requiredByOwner: boolean; approvedByManager?: boolean };

function normalizeExpenseEscalations(raw: unknown): Record<string, ExpenseEscalationState> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ExpenseEscalationState> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as { requiredByOwner?: boolean; approvedByManager?: boolean };
    out[k] = {
      requiredByOwner: Boolean(o.requiredByOwner),
      approvedByManager: typeof o.approvedByManager === 'boolean' ? o.approvedByManager : undefined,
    };
  }
  return out;
}

/** مهمة شخصية من الرئيسية (تُخزَّن لكل مستخدم) */
export interface PersonalTodo {
  id: string;
  text: string;
  done: boolean;
  dueAt?: string;
  reminder30Emitted?: boolean;
  reminder60Emitted?: boolean;
  /** بعد إطلاق تنبيه «حان الموعد» (نافذة + صوت) لا يتكرر */
  dueAlarmEmitted?: boolean;
}

export function normalizePersonalTodos(raw: unknown): PersonalTodo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any) => {
    const dueAt =
      typeof x?.dueAt === 'string' && String(x.dueAt).trim() ? String(x.dueAt).trim() : undefined;

    return {
      id: String(x?.id ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      text: String(x?.text ?? ''),
      done: Boolean(x?.done),
      dueAt,
      reminder30Emitted: Boolean(x?.reminder30Emitted),
      reminder60Emitted: Boolean(x?.reminder60Emitted),
      dueAlarmEmitted: Boolean(x?.dueAlarmEmitted),
    };
  });
}

function normalizePersonalTodosByUserId(raw: unknown): Record<string, PersonalTodo[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PersonalTodo[]> = {};
  for (const [uid, arr] of Object.entries(raw as Record<string, unknown>)) {
    out[uid] = normalizePersonalTodos(Array.isArray(arr) ? arr : []);
  }
  return out;
}

function mergeTodoReminderFlags(base: PersonalTodo, overlay?: PersonalTodo): PersonalTodo {
  if (!overlay) return base;
  return {
    ...base,
    reminder30Emitted: Boolean(base.reminder30Emitted) || Boolean(overlay.reminder30Emitted),
    reminder60Emitted: Boolean(base.reminder60Emitted) || Boolean(overlay.reminder60Emitted),
    dueAlarmEmitted: Boolean(base.dueAlarmEmitted) || Boolean(overlay.dueAlarmEmitted),
  };
}

/** يدمج لقطة السيرفر مع الحالة المحلية دون إعادة مهام محذوفة محلياً. */
function mergePersonalTodosByUserId(
  prev: Record<string, PersonalTodo[]>,
  fromServer: unknown,
): Record<string, PersonalTodo[]> {
  const srv = normalizePersonalTodosByUserId(fromServer);
  const uids = new Set([...Object.keys(prev || {}), ...Object.keys(srv)]);
  const out: Record<string, PersonalTodo[]> = {};
  for (const uid of uids) {
    const remote = srv[uid] || [];
    const local = (prev || {})[uid] || [];

    if (local.length < remote.length) {
      const remoteById = new Map(remote.map((t) => [t.id, t]));
      out[uid] = normalizePersonalTodos(
        local.map((t) => mergeTodoReminderFlags(t, remoteById.get(t.id))),
      );
      continue;
    }

    const byId = new Map<string, PersonalTodo>();
    for (const t of remote) byId.set(t.id, t);
    for (const t of local) {
      const r = byId.get(t.id);
      if (!r) {
        byId.set(t.id, t);
        continue;
      }
      byId.set(t.id, mergeTodoReminderFlags(r, t));
    }
    out[uid] = normalizePersonalTodos([...byId.values()]);
  }
  return out;
}

/** مفتاح مهام موحّد (سلسلة مكمّمة) — يستخدم في الخريطة وlocalStorage ومزامنة السيرفر */
export function canonicalTodoUserId(uidRaw: unknown): string {
  if (uidRaw === undefined || uidRaw === null) return '';
  return String(uidRaw)
    .replace(/^\uFEFF/, '')
    .trim();
}

function parseTodosLsJson(raw: string | null): unknown {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** نفس ما يعرض الواجهة: دمج مهام المعيِّن من الخريطة + المحلي (يجب أن يكون أساس setPersonalTodos) */
function mergeDisplayedPersonalTodos(
  map: Record<string, PersonalTodo[]>,
  uidRaw: unknown,
): PersonalTodo[] {
  const uid = canonicalTodoUserId(uidRaw);
  if (!uid) return [];

  const rawStr = uidRaw !== undefined && uidRaw !== null ? String(uidRaw) : '';
  const keysToTry = [uid];
  if (rawStr && rawStr !== uid && !keysToTry.includes(rawStr)) keysToTry.push(rawStr);

  const mapKeyUsed =
    keysToTry.find((k) => Object.prototype.hasOwnProperty.call(map, k)) ?? keysToTry[0];
  const fromMap: PersonalTodo[] = Array.isArray(map[mapKeyUsed]) ? map[mapKeyUsed]! : [];

  /** إذا الحالة في الذاكرة عرّفت للمستخدم (حتى []) لا نعيد المهام المحذوفة من localStorage القديم */
  if (Object.prototype.hasOwnProperty.call(map, mapKeyUsed)) {
    return normalizePersonalTodos(
      fromMap.map((t) => ({ ...t, text: String(t.text ?? '').trim() })).filter((t) => t.text),
    );
  }

  let fromLs: PersonalTodo[] = [];
  try {
    if (typeof window !== 'undefined') {
      let rawLs = localStorage.getItem(`prod_system_todos_${uid}`);
      if (rawLs == null && keysToTry[1]) rawLs = localStorage.getItem(`prod_system_todos_${keysToTry[1]}`);
      const parsed = parseTodosLsJson(rawLs);
      fromLs = normalizePersonalTodos(Array.isArray(parsed) ? parsed : []);
    }
  } catch {
    fromLs = [];
  }

  const byId = new Map<string, PersonalTodo>();
  for (const t of fromLs) {
    const tx = String(t.text ?? '').trim();
    if (tx) byId.set(t.id, { ...t, text: tx });
  }
  for (const t of fromMap) {
    const tx = String(t.text ?? '').trim();
    if (!tx) continue;
    byId.set(t.id, mergeTodoReminderFlags({ ...t, text: tx }, byId.get(t.id)));
  }
  return normalizePersonalTodos([...byId.values()]);
}

function normalizeNotifyForegroundByUserId(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = v === true || v === 1 || v === '1';
  }
  return out;
}

/** تكويد المحاسب: فئة المصروف → رمز الحساب في دليل الحسابات */
export type CustodyAccountByCategory = Record<Expense['category'], string>;

export type CustodyFundStatus =
  | 'مسودة'
  | 'طلب_بانتظار_المالك'
  | 'مرفوض_طلب'
  | 'بانتظار_دفع_محاسب'
  | 'جاهزة_للاستلام'
  | 'نشطة'
  | 'تسوية_بانتظار_محاسب'
  | 'مرفوض_تسوية'
  | 'مقفلة';

export type CustodyCurrency = 'EGP' | 'USD';

/** مرفقات بند العهدة (تُحفظ في التخزين المحلي؛ حافظ على ملفات صغيرة لتجاوز حد المتصفّح). */
export interface CustodySpendAttachment {
  id: string;
  fileName: string;
  mimeType?: string;
  /** بيانات الملف بتشفير نصي (بدون بادئة data:) */
  dataBase64?: string;
}

export interface CustodySpendLine {
  id: string;
  title: string;
  amount: number;
  category: Expense['category'];
  costCenter: string;
  note?: string;
  attachments?: CustodySpendAttachment[];
}

export interface CustodyFund {
  id: string;
  title: string;
  description: string;
  totalAmount: number;
  /** عملة العهدة — القيود المحاسبية تُسجَّل بالجنيه المصري */
  currency?: CustodyCurrency;
  /** سعر صرف USD→EGP عند currency=USD (يحدده المحاسب قبل الصرف) */
  exchangeRate?: number;
  status: CustodyFundStatus;
  createdAt: string;
  createdById: string;
  createdByName: string;
  productionManagerId: string;
  productionManagerName: string;
  settlementRejectedReason?: string;
  paymentMethod?: 'كاش' | 'تحويل';
  paymentAt?: string;
  receivedMethod?: 'كاش' | 'تحويل';
  receivedAt?: string;
  /** وقت اعتماد صرف العهدة من المالك (إن وُجد في البيانات) */
  approvedAt?: string;
  receivedNote?: string;
  spendLines: CustodySpendLine[];
  settlementSubmittedAt?: string;
  /** قيد صرف العهدة من الصندوق (مدين عهدة / دائن بنك) */
  journalEntryPaymentId?: string;
  /** قيد إقفال العهدة بعد التسوية (مدين مصروفات / دائن عهدة) */
  journalEntrySettlementId?: string;
  /** @deprecated استخدم journalEntrySettlementId */
  journalEntryId?: string;
  requestRejectReason?: string;
}

export function custodyFundAmountInEgp(
  fund: Pick<CustodyFund, 'totalAmount' | 'currency' | 'exchangeRate'>,
): number {
  const amt = Math.max(0, Number(fund.totalAmount) || 0);
  if (fund.currency === 'USD') {
    const rate = Math.max(0, Number(fund.exchangeRate) || 0);
    if (rate <= 0) return 0;
    return Math.round(amt * rate * 100) / 100;
  }
  return amt;
}

export function custodyLineAmountInEgp(
  amount: number,
  fund: Pick<CustodyFund, 'currency' | 'exchangeRate'>,
): number {
  const a = Math.max(0, Number(amount) || 0);
  if (fund.currency === 'USD') {
    const rate = Math.max(0, Number(fund.exchangeRate) || 0);
    if (rate <= 0) return 0;
    return Math.round(a * rate * 100) / 100;
  }
  return a;
}

export function accountantCanEditCustodyFundFull(fund: CustodyFund): boolean {
  return ['مسودة', 'مرفوض_طلب', 'طلب_بانتظار_المالك', 'بانتظار_دفع_محاسب'].includes(fund.status);
}

export function accountantCanEditCustodyFundLimited(fund: CustodyFund): boolean {
  return ['جاهزة_للاستلام', 'نشطة', 'تسوية_بانتظار_محاسب'].includes(fund.status);
}

function migrateCustodySpendLine(raw: any): CustodySpendLine {
  const attachments: CustodySpendAttachment[] = Array.isArray(raw?.attachments)
    ? raw.attachments.map((a: any) => ({
      id: String(a?.id || `ATT-${Math.random().toString(36).slice(2, 9)}`),
      fileName: String(a?.fileName || 'مرفق'),
      mimeType: typeof a?.mimeType === 'string' ? a.mimeType : undefined,
      dataBase64: typeof a?.dataBase64 === 'string' ? a.dataBase64 : undefined,
    }))
    : [];
  return {
    id: String(raw?.id || `CL-${Math.random().toString(36).slice(2, 9)}`),
    title: String(raw?.title || ''),
    amount: Math.max(0, Number(raw?.amount) || 0),
    category: (raw?.category as Expense['category']) || 'تشغيل',
    costCenter: String(raw?.costCenter || 'عام'),
    note: typeof raw?.note === 'string' ? raw.note : undefined,
    attachments,
  };
}

function migrateCustodyFund(raw: any): CustodyFund {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const statusMap: Record<string, CustodyFundStatus> = {
    'مرسلة_للمالك_تسليم': 'طلب_بانتظار_المالك',
    'مرفوض_تسليم': 'مرفوض_طلب',
    'مرسلة_للمالك_تسوية': 'تسوية_بانتظار_محاسب',
    draft: 'مسودة',
    pending_owner: 'طلب_بانتظار_المالك',
    pending_owner_approval: 'طلب_بانتظار_المالك',
    rejected_request: 'مرفوض_طلب',
    pending_payment: 'بانتظار_دفع_محاسب',
    active: 'نشطة',
    closed: 'مقفلة',
  };
  const st = r.status;
  let status = (statusMap[String(st || '')] || st || 'مسودة') as CustodyFundStatus;
  const settlementId =
    r.journalEntrySettlementId ??
    r.journal_entry_settlement_id ??
    r.journalEntryId ??
    r.journal_entry_id;
  const payId = r.journalEntryPaymentId ?? r.journal_entry_payment_id;
  if (status === 'جاهزة_للاستلام' && !payId) {
    status = 'بانتظار_دفع_محاسب';
  }
  let productionManagerId = String(r.productionManagerId ?? r.production_manager_id ?? '').trim();
  const createdById = String(r.createdById ?? r.created_by_id ?? '').trim();
  if (!productionManagerId && (status === 'طلب_بانتظار_المالك' || status === 'مرفوض_طلب') && createdById) {
    productionManagerId = createdById;
  }
  const spendRaw = r.spendLines ?? r.spend_lines;
  const rawCurrency = String(r.currency ?? r.currency_code ?? 'EGP').trim().toUpperCase();
  const currency: CustodyCurrency = rawCurrency === 'USD' ? 'USD' : 'EGP';
  const exchangeRateRaw = r.exchangeRate ?? r.exchange_rate;
  const exchangeRate =
    exchangeRateRaw != null && String(exchangeRateRaw).trim() !== ''
      ? Math.max(0, Number(exchangeRateRaw) || 0)
      : undefined;
  return {
    id: String(r.id || `CF-${Math.random().toString(36).slice(2, 10)}`),
    title: String(r.title || ''),
    description: String(r.description || ''),
    totalAmount: Math.max(0, Number(r.totalAmount ?? r.total_amount) || 0),
    currency,
    exchangeRate: currency === 'USD' && exchangeRate && exchangeRate > 0 ? exchangeRate : undefined,
    status,
    createdAt: String((r.createdAt ?? r.created_at) || new Date().toISOString()),
    createdById,
    createdByName: String(r.createdByName ?? r.created_by_name ?? ''),
    productionManagerId,
    productionManagerName: String(r.productionManagerName ?? r.production_manager_name ?? '').trim(),
    settlementRejectedReason: (() => {
      const v = r.settlementRejectedReason ?? r.settlement_rejected_reason;
      return typeof v === 'string' ? v : undefined;
    })(),
    paymentMethod: (r.paymentMethod ?? r.payment_method) as CustodyFund['paymentMethod'],
    paymentAt: (r.paymentAt ?? r.payment_at) as string | undefined,
    receivedMethod: (r.receivedMethod ?? r.received_method) as CustodyFund['receivedMethod'],
    receivedAt: (r.receivedAt ?? r.received_at) as string | undefined,
    approvedAt: (r.approvedAt ?? r.approved_at) as string | undefined,
    receivedNote: (r.receivedNote ?? r.received_note) as string | undefined,
    spendLines: Array.isArray(spendRaw) ? spendRaw.map(migrateCustodySpendLine) : [],
    settlementSubmittedAt: (r.settlementSubmittedAt ?? r.settlement_submitted_at) as string | undefined,
    journalEntryPaymentId: payId != null && String(payId) !== '' ? String(payId) : undefined,
    journalEntrySettlementId: settlementId != null && String(settlementId) !== '' ? String(settlementId) : undefined,
    journalEntryId: settlementId != null && String(settlementId) !== '' ? String(settlementId) : undefined,
    requestRejectReason: (r.requestRejectReason ?? r.request_reject_reason ?? r.handoverRejectedReason) as string | undefined,
  };
}

/** عهدة مرتبطة بمدير الإنتاج الحالي (يدعم بيانات قديمة أو doc_json بدون productionManagerId) */
export function custodyFundBelongsToProductionManager(f: CustodyFund, userId: string, userName?: string): boolean {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const pmId = String(f.productionManagerId || '').trim();
  if (pmId === uid) return true;
  if (pmId && pmId !== uid) return false;
  const uname = String(userName || '').trim();
  if (uname && String(f.productionManagerName || '').trim() === uname) return true;
  if ((f.status === 'طلب_بانتظار_المالك' || f.status === 'مرفوض_طلب') && String(f.createdById || '').trim() === uid) return true;
  return false;
}

/** طلب مصروف إنتاج يخص مدير الإنتاج (نفس منطق جدول «طلب مصروف» في لوحة الإنتاج) */
export function productionExpenseBelongsToManager(exp: Expense, userId: string, userName?: string): boolean {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const sid = String(exp.submittedById || '').trim();
  if (sid && sid === uid) return true;
  if ((exp.vendor || '').trim() !== 'طلب مدير الإنتاج') return false;
  const sname = (exp.submittedByName || '').trim();
  const uname = (userName || '').trim();
  return !!(uname && sname === uname);
}

export interface AttendanceRecord {
  id: string;
  repId: string;
  type: 'in' | 'out';
  source: 'machine' | 'manual';
  createdAt: string;
}

export interface PayrollApproval {
  monthKey: string;
  approvedAt: string;
  approvedById: string;
  approvedByName: string;
}

/** خصم يدوي على مندوب مبيعات — يظهر في كشف رواتب المحاسب */
export interface PayrollSalesDiscount {
  id: string;
  repId: string;
  repName: string;
  monthKey: string;
  amount: number;
  reason: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface PayrollApprovalRequest {
  id: string;
  monthKey: string;
  requestedAt: string;
  requestedById: string;
  requestedByName: string;
  requestMode: 'manual' | 'scheduled';
  status: 'بانتظار_اعتماد_المالك' | 'معتمد' | 'مرفوض';
  claimsSummary: {
    pendingExpensesCount: number;
    pendingProdClaimsCount: number;
    pendingCustodyPaymentsCount: number;
    totalEstimatedAmount: number;
  };
  approvedAt?: string;
  approvedById?: string;
  approvedByName?: string;
  rejectedAt?: string;
  rejectedById?: string;
  rejectedByName?: string;
  rejectReason?: string;
}

export interface FinancialPeriodReopenRequest {
  id: string;
  monthKey: string;
  requestedAt: string;
  requestedById: string;
  requestedByName: string;
  reason: string;
  status: 'بانتظار_اعتماد_المالك' | 'معتمد' | 'مرفوض';
  approvedAt?: string;
  approvedById?: string;
  approvedByName?: string;
  rejectedAt?: string;
  rejectedById?: string;
  rejectedByName?: string;
  rejectReason?: string;
}

export interface SystemNotification {
  id: string;
  level: 'high' | 'medium' | 'low';
  priority?: 'critical' | 'normal';
  queue?: 'ops';
  title: string;
  message: string;
  createdAt: string;
  targetRoles?: User['role'][];
  entityType?: 'lead' | 'invoice' | 'user' | 'system';
  entityId?: string;
  targetUserId?: string;
  /** تبويب في الشريط الجانبي للانتقال السريع عند الضغط على التنبيه */
  navigateTab?: string;
  /** ليدز مرتبطة بالتنبيه — للانتقال المباشر عند الضغط */
  leadIds?: string[];
}

/** بنود تنفيذ إنتاج لتغطية ما صُرِف تجاه الحجز (فواتير/مورد) قبل طلب المحاسب للدفع. */
export interface BookingSpendLine {
  id: string;
  description: string;
  amount: number;
  invoiceRef?: string;
  vendor?: string;
  createdAt: string;
}

/** حالات جانب المنظومة بعد اعتماد مالي للحجز: الإنتاج أولًا ثم الدفع المحاسبي. */
export type BookingFinancialStatusPhase =
  | 'غير_مطلوب'
  | 'بانتظار_اعتماد_مالك'
  | 'بانتظار_تنفيذ_إنتاج'
  | 'بانتظار_تنفيذ_محاسب'
  | 'منفذ';

export interface ShootBooking {
  id: string;
  repId: string;
  repName: string;
  leadId?: string;
  customerName: string;
  date: string;
  time: string;
  location: string;
  notes?: string;
  status: 'قيد المراجعة' | 'معتمد' | 'مرفوض' | 'مكتمل';
  requestedByRole?: User['role'];
  estimatedCost?: number;
  /** عند الإنشاء من موافقة العميل على عرض سعر */
  priceQuoteId?: string;
  productionAssignedId?: string;
  productionAssignedName?: string;
  workOrderFromQuote?: boolean;
  workOrderChecklist?: { id: string; label: string; done: boolean }[];
  financialStatus?: BookingFinancialStatusPhase;
  /** بعد اعتماد مالك + تقدير مصروف: مصروف «قيد الانتظار» يظهر بالدفاتر كالتزام */
  accrualExpenseId?: string;
  spendLines?: BookingSpendLine[];
  executionSubmittedAt?: string;
  paymentMethod?: 'كاش' | 'تحويل';
  paymentAt?: string;
  paymentExpenseId?: string;
  createdAt: string;
}

export interface EquipmentBooking {
  id: string;
  repId: string;
  repName: string;
  leadId?: string;
  customerName: string;
  equipmentName: string;
  quantity: number;
  fromDate: string;
  toDate: string;
  notes?: string;
  status: 'قيد المراجعة' | 'معتمد' | 'مرفوض' | 'تم التسليم';
  requestedByRole?: User['role'];
  estimatedCost?: number;
  financialStatus?: BookingFinancialStatusPhase;
  accrualExpenseId?: string;
  spendLines?: BookingSpendLine[];
  executionSubmittedAt?: string;
  paymentMethod?: 'كاش' | 'تحويل';
  paymentAt?: string;
  paymentExpenseId?: string;
  createdAt: string;
}

export interface MeetingBooking {
  id: string;
  repId: string;
  repName: string;
  leadId?: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
  venueType?: 'داخل_المقر' | 'خارج_المقر';
  location?: string;
  notes?: string;
  status?: 'قيد المراجعة' | 'معتمد' | 'مرفوض' | 'مكتمل';
  requestedByRole?: User['role'];
  estimatedCost?: number;
  financialStatus?: BookingFinancialStatusPhase;
  accrualExpenseId?: string;
  spendLines?: BookingSpendLine[];
  executionSubmittedAt?: string;
  paymentMethod?: 'كاش' | 'تحويل';
  paymentAt?: string;
  paymentExpenseId?: string;
  createdAt: string;
}

/** حجز عام مذكور ببيان نصي — يُخزَّن في workspace حتى يتوفر جدول مخصص */
export interface OtherBooking {
  id: string;
  title: string;
  /** بيان / وصف الحجز */
  statement: string;
  date?: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  totalQuantity: number;
  active: boolean;
  createdAt: string;
}

export interface PrintBrandingSettings {
  companyName: string;
  logoDataUrl?: string;
  reportHeader: string;
  reportFooter: string;
  primaryColor: string;
  showPrintDate: boolean;
  showPageNumbers: boolean;
  signatureName?: string;
  signatureTitle?: string;
}

export type ExternalLeadChannel = 'facebook' | 'linkedin' | 'google' | 'email';
export type IntegrationProvider = 'facebook' | 'instagram' | 'google_ads' | 'whatsapp' | 'linkedin';

export interface ExternalIntegrationConnection {
  provider: IntegrationProvider;
  connected: boolean;
  accountLabel?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  tokenExpiresAt?: string;
  status: 'idle' | 'connected' | 'expired' | 'error';
  lastError?: string;
}

export interface LeadIngestionChannelConfig {
  connected: boolean;
  label: string;
  accountRef: string;
  autoSync: boolean;
  lastSyncAt?: string;
}

export interface LeadIngestionSettings {
  autoRouteToManager: boolean;
  managerUserId?: string;
  /** webhook اختياري لإشعار العميل (n8n / WhatsApp / بريد) — يتجاوز VITE_CLIENT_NOTIFY_WEBHOOK_URL */
  clientNotifyWebhookUrl?: string;
  facebook: LeadIngestionChannelConfig;
  linkedin: LeadIngestionChannelConfig;
  google: LeadIngestionChannelConfig;
  email: LeadIngestionChannelConfig;
}

/** عرض عربي واضح: من أي قناة + أي حساب مربوط (لحقل مصدر الليد). */
function buildExternalIngestionAccountTag(
  channel: ExternalLeadChannel,
  cfg: LeadIngestionChannelConfig,
  integrations: ExternalIntegrationConnection[],
): string {
  const ref = (cfg.accountRef || '').trim();
  if (channel === 'facebook') {
    const fb = integrations.find((i) => i.provider === 'facebook' && i.connected)?.accountLabel;
    const ig = integrations.find((i) => i.provider === 'instagram' && i.connected)?.accountLabel;
    return (fb || ig || ref || 'حساب مربوط').trim();
  }
  if (channel === 'linkedin') {
    return (integrations.find((i) => i.provider === 'linkedin' && i.connected)?.accountLabel || ref || 'حساب مربوط').trim();
  }
  if (channel === 'google') {
    return (integrations.find((i) => i.provider === 'google_ads' && i.connected)?.accountLabel || ref || 'حساب مربوط').trim();
  }
  return ref || 'صندوق البريد';
}

export function buildExternalLeadSourceDisplay(
  channel: ExternalLeadChannel,
  cfg: LeadIngestionChannelConfig,
  integrations: ExternalIntegrationConnection[],
): string {
  const base =
    channel === 'facebook'
      ? 'فيسبوك / إنستجرام'
      : channel === 'linkedin'
        ? 'لينكد إن'
        : channel === 'google'
          ? 'جوجل إعلانات'
          : 'بريد (استيراد)';
  const tag = buildExternalIngestionAccountTag(channel, cfg, integrations);
  return `${base} — ${tag}`;
}

export interface SlaEscalationSettings {
  warningAfterMinutes: number;
  criticalAfterMinutes: number;
  autoReassignAfterHours: number;
}

export interface LeadDataQualitySettings {
  rejectDuplicateLeads: boolean;
  duplicatePhone: boolean;
  duplicateEmail: boolean;
  requireCompany: boolean;
  requireBudget: boolean;
}

export interface WorkflowRulesSettings {
  quoteRequiresOwnerApproval: boolean;
  externalMeetingRequiresOwnerApproval: boolean;
  expenseRequiresOwnerApproval: boolean;
}

interface DataContextType {
  leads: Lead[];
  users: User[];
  invoices: Invoice[];
  priceQuotes: PriceQuote[];
  accountingPolicy: AccountingPolicy;
  expenses: Expense[];
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'score' | 'slaStatus' | 'timeline'>) => boolean;
  bulkAddLeads: (
    leads: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'score' | 'slaStatus' | 'timeline'>[]
  ) => Promise<{ created: number; failed: number }>;
  updateLeadStatus: (leadId: string, status: LeadStatus, note?: string) => void;
  logLeadInteraction: (leadId: string, action: string, note?: string, meta?: Partial<Pick<Activity, 'channelType' | 'evidenceType' | 'evidenceRef' | 'durationSeconds'>>) => void;
  reviewLeadActivity: (leadId: string, activityId: string, decision: 'approved' | 'rejected', comment?: string) => boolean;
  setLeadFollowUp: (leadId: string, followUpAt?: string) => void;
  assignLead: (leadId: string, userId?: string) => void;
  assignLeadsBulk: (leadIds: string[], userId?: string) => Promise<number>;
  deleteLead: (leadId: string) => Promise<DeleteLeadResult>;
  deleteLeadsBulk: (leadIds: string[]) => Promise<BulkDeleteLeadsResult>;
  updateUserSkills: (userId: string, skills: string[]) => Promise<boolean>;
  addEmployee: (employee: {
    name: string;
    role: User['role'];
    baseSalary?: number;
    avatar?: string;
    /** بريد تسجيل الدخول على السيرفر (اختياري؛ يُنشأ بريد داخلي لو تُرك فارغاً) */
    email?: string;
    /** ≥٨ أحرف؛ فارغ = توليد كلمة مرور آمنة وتُعرض بعد الإنشاء */
    password?: string;
  }) => Promise<boolean>;
  manualCustomers: ManualCustomer[];
  addManualCustomer: (payload: { name: string; company?: string; phone?: string; email?: string; sourceLabel?: string }) => Promise<boolean>;
  updateEmployeeSalary: (userId: string, baseSalary: number) => Promise<boolean>;
  updateEmployeeProfile: (
    userId: string,
    patch: { name?: string; avatar?: string; role?: User['role']; email?: string; baseSalary?: number },
  ) => Promise<boolean>;
  /** المالك يعيّن كلمة مرور جديدة لموظف (خادم Prisma). في وضع Supabase المباشر استخدم لوحة Supabase → Authentication. */
  ownerSetEmployeePassword: (userId: string, newPassword: string) => Promise<boolean>;
  removeEmployee: (userId: string) => Promise<boolean>;
  getLeadScore: (lead: Partial<Lead>) => number;
  refreshSLA: () => void;
  logout: () => void;
  addInvoice: (invoice: Omit<Invoice, 'id' | 'date'>) => Promise<boolean>;
  updateInvoiceStatus: (invoiceId: string, status: Invoice['status']) => Promise<boolean>;
  recordInvoiceCollection: (invoiceId: string, payload: { amount: number; method: 'كاش' | 'تحويل'; nextDueDate?: string; note?: string }) => Promise<boolean>;
  addPriceQuote: (data: Omit<PriceQuote, 'id' | 'createdAt' | 'status' | 'createdById' | 'createdByName' | 'approvedBy' | 'approvedAt' | 'invoiceId' | 'pricedById' | 'pricedByName' | 'pricedAt'>) => Promise<boolean>;
  productionPriceQuote: (
    quoteId: string,
    amount: number,
    vatRate: number,
    pricingNote?: string,
    companyMarginPercent?: number,
    productionCostAmount?: number,
  ) => Promise<boolean>;
  reassignPricingRequest: (quoteId: string, toUserId: string, toUserName: string) => Promise<boolean>;
  approvePriceQuote: (quoteId: string, paymentSchedule?: PaymentInstallment[], initialPayment?: number) => Promise<boolean>;
  rejectPriceQuote: (quoteId: string) => Promise<boolean>;
  /** المالك يعيد العرض لمسار الإنتاج لإعادة التسعير (من قيد اعتماد المالك) */
  ownerReturnPriceQuoteToProduction: (quoteId: string, ownerNote?: string) => Promise<boolean>;
  repRecordClientAcceptance: (quoteId: string, clientPayments: ClientPayment[]) => Promise<boolean>;
  repRecordClientRejection: (quoteId: string, note?: string) => Promise<boolean>;
  updateAccountingPolicy: (patch: Partial<AccountingPolicy>) => Promise<void>;
  addExpense: (expense: Omit<Expense, 'id' | 'date' | 'approvalStatus' | 'approvedBy'>) => Promise<boolean>;
  updateExpenseStatus: (expenseId: string, status: Expense['status'], paymentMethod?: Expense['paymentMethod']) => Promise<boolean>;
  approveExpense: (expenseId: string) => Promise<boolean>;
  rejectExpense: (expenseId: string) => Promise<boolean>;
  closedMonths: string[];
  closeMonth: (monthKey: string) => Promise<boolean>;
  reopenMonth: (monthKey: string) => Promise<boolean>;
  isMonthClosed: (monthKey: string) => boolean;
  chartOfAccounts: ChartOfAccount[];
  addChartAccount: (account: Omit<ChartOfAccount, 'isSystem'>) => Promise<boolean>;
  removeChartAccount: (code: string) => Promise<boolean>;
  addJournalCodingRule: (rule: Omit<JournalCodingRule, 'id'>) => Promise<boolean>;
  removeJournalCodingRule: (id: string) => Promise<boolean>;
  manualJournalEntries: ManualJournalEntry[];
  addManualJournalEntry: (entry: Omit<ManualJournalEntry, 'id'>) => Promise<boolean>;
  updateManualJournalEntry: (id: string, entry: Omit<ManualJournalEntry, 'id'>) => Promise<boolean>;
  removeManualJournalEntry: (id: string) => Promise<boolean>;
  getManualJournalModifyBlockReason: (id: string, newDate?: string) => string | null;
  journalCodingRules: JournalCodingRule[];
  setJournalCodingRules: React.Dispatch<React.SetStateAction<JournalCodingRule[]>>;
  expenseCodingRules: ExpenseCodingRule[];
  setExpenseCodingRules: React.Dispatch<React.SetStateAction<ExpenseCodingRule[]>>;
  customerCodePrefix: string;
  setCustomerCodePrefix: React.Dispatch<React.SetStateAction<string>>;
  expenseSavedViews: ExpenseSavedView[];
  setExpenseSavedViews: React.Dispatch<React.SetStateAction<ExpenseSavedView[]>>;
  payrollAutoSendDay: number | '';
  setPayrollAutoSendDay: React.Dispatch<React.SetStateAction<number | ''>>;
  entityComments: EntityCommentsMap;
  setEntityComments: React.Dispatch<React.SetStateAction<EntityCommentsMap>>;
  expenseEscalations: Record<string, ExpenseEscalationState>;
  setExpenseEscalations: React.Dispatch<React.SetStateAction<Record<string, ExpenseEscalationState>>>;
  uiVisualMode: 'premium' | 'classic';
  setUiVisualMode: React.Dispatch<React.SetStateAction<'premium' | 'classic'>>;
  personalTodos: PersonalTodo[];
  setPersonalTodos: React.Dispatch<React.SetStateAction<PersonalTodo[]>>;
  desktopNotifyWhenVisible: boolean;
  setDesktopNotifyWhenVisible: (value: boolean) => void;
  closedFiscalYears: string[];
  closeFiscalYear: (year: string, openingBalancesForNextYear: { accountCode: string; balance: number }[]) => Promise<boolean>;
  reopenFiscalYear: (year: string) => Promise<boolean>;
  getOpeningBalances: (year: string) => { accountCode: string; balance: number }[];
  saveOpeningBalancesForYear: (year: string, balances: { accountCode: string; balance: number }[]) => Promise<boolean>;
  openingBalancesByYear: Record<string, { accountCode: string; balance: number }[]>;
  attendanceRecords: AttendanceRecord[];
  logAttendance: (repId: string, type: 'in' | 'out', source?: 'machine' | 'manual') => Promise<boolean>;
  payrollApprovals: PayrollApproval[];
  payrollApprovalRequests: PayrollApprovalRequest[];
  payrollSalesDiscounts: PayrollSalesDiscount[];
  addPayrollSalesDiscount: (input: {
    repId: string;
    monthKey?: string;
    amount: number;
    reason: string;
  }) => Promise<boolean>;
  removePayrollSalesDiscount: (id: string) => Promise<boolean>;
  getPayrollSalesDiscountTotal: (repId: string, monthKey: string) => number;
  financialReopenRequests: FinancialPeriodReopenRequest[];
  approvePayroll: (monthKey: string) => Promise<boolean>;
  reopenPayroll: (monthKey: string) => Promise<boolean>;
  isPayrollApproved: (monthKey: string) => boolean;
  requestPayrollApproval: (monthKey: string, mode?: 'manual' | 'scheduled') => Promise<boolean>;
  ownerApprovePayrollRequest: (requestId: string) => Promise<boolean>;
  ownerRejectPayrollRequest: (requestId: string, reason?: string) => Promise<boolean>;
  requestMonthReopen: (monthKey: string, reason: string) => Promise<boolean>;
  ownerApproveMonthReopenRequest: (requestId: string) => Promise<boolean>;
  ownerRejectMonthReopenRequest: (requestId: string, reason?: string) => Promise<boolean>;
  getSystemNotifications: () => SystemNotification[];
  /**
   * إعادة جلب لقطة كاملة من السيرفر (مستخدمة عند فتح التنبيهات وغيرها). لا يوجد WebSocket؛ الاعتماد على
   * استجابة REST مصفّاة بصلاحيات JWT على الخادم. لقطة خفيفة «للإشعارات فقط» غير متوفرة حالياً.
   * في الوضع المحلي ترجع true دون شبكة.
   */
  refreshServerWorkspace: () => Promise<boolean>;
  getRepSnapshots: () => RepSnapshot[];
  monthlyTargets: MonthlyTarget[];
  updateMonthlyTarget: (repId: string, patch: Partial<Omit<MonthlyTarget, 'repId'>>) => Promise<void>;
  getPerformanceAlerts: () => PerformanceAlert[];
  getSlaHeatmap: (days?: number) => SlaHeatmapItem[];
  auditEvents: AuditEvent[];
  addAuditEvent: (event: Omit<AuditEvent, 'id' | 'createdAt' | 'actorId' | 'actorName'>) => void;
  shootBookings: ShootBooking[];
  equipmentBookings: EquipmentBooking[];
  meetingBookings: MeetingBooking[];
  equipmentItems: EquipmentItem[];
  addShootBooking: (
    booking: Omit<ShootBooking, 'id' | 'repId' | 'repName' | 'createdAt' | 'status'>,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  addEquipmentBooking: (booking: Omit<EquipmentBooking, 'id' | 'repId' | 'repName' | 'createdAt' | 'status'>) => Promise<boolean>;
  addMeetingBooking: (booking: Omit<MeetingBooking, 'id' | 'repId' | 'repName' | 'createdAt'>) => Promise<boolean>;
  addEquipmentItem: (item: Omit<EquipmentItem, 'id' | 'createdAt' | 'active'>) => boolean;
  removeEquipmentItem: (id: string) => boolean;
  updateShootBookingStatus: (id: string, status: ShootBooking['status']) => Promise<boolean>;
  productionUpdateWorkOrder: (
    bookingId: string,
    patch: { workOrderChecklist?: ShootBooking['workOrderChecklist']; notes?: string; markComplete?: boolean },
  ) => Promise<boolean>;
  updateEquipmentBookingStatus: (id: string, status: EquipmentBooking['status']) => Promise<boolean>;
  updateMeetingBookingStatus: (id: string, status: NonNullable<MeetingBooking['status']>) => Promise<boolean>;
  accountantExecuteShootBookingClaim: (id: string, method: 'كاش' | 'تحويل') => Promise<boolean>;
  accountantExecuteEquipmentBookingClaim: (id: string, method: 'كاش' | 'تحويل') => Promise<boolean>;
  accountantExecuteMeetingBookingClaim: (id: string, method: 'كاش' | 'تحويل') => Promise<boolean>;
  /** مدير إنتاج يثبت بنود الصرف وفواتير المورد بعد اعتماد المالك بحجز له تقدير مصروف. */
  productionSubmitBookingSpendToAccountant: (
    kind: 'shoot' | 'equipment' | 'meeting',
    bookingId: string,
    spendLinesDraft: Omit<BookingSpendLine, 'id' | 'createdAt'>[],
  ) => Promise<boolean>;
  removeShootBooking: (id: string) => Promise<boolean>;
  removeEquipmentBooking: (id: string) => Promise<boolean>;
  removeMeetingBooking: (id: string) => Promise<boolean>;
  otherBookings: OtherBooking[];
  addOtherBooking: (data: { title?: string; statement: string; date?: string }) => Promise<boolean>;
  removeOtherBooking: (id: string) => Promise<boolean>;
  printBrandingSettings: PrintBrandingSettings;
  updatePrintBrandingSettings: (patch: Partial<PrintBrandingSettings>) => void;
  leadIngestionSettings: LeadIngestionSettings;
  updateLeadIngestionSettings: (patch: Partial<LeadIngestionSettings>) => void;
  slaEscalationSettings: SlaEscalationSettings;
  updateSlaEscalationSettings: (patch: Partial<SlaEscalationSettings>) => void;
  leadDataQualitySettings: LeadDataQualitySettings;
  updateLeadDataQualitySettings: (patch: Partial<LeadDataQualitySettings>) => void;
  workflowRulesSettings: WorkflowRulesSettings;
  updateWorkflowRulesSettings: (patch: Partial<WorkflowRulesSettings>) => void;
  integrations: ExternalIntegrationConnection[];
  startIntegrationConnect: (provider: IntegrationProvider) => { ok: boolean; authUrl?: string; reason?: string };
  completeIntegrationConnect: (provider: IntegrationProvider, payload: { accountLabel?: string; tokenExpiresAt?: string }) => boolean;
  markIntegrationError: (provider: IntegrationProvider, message: string) => void;
  disconnectIntegration: (provider: IntegrationProvider) => boolean;
  /** يعيد عدد الليدز المُنشأة فعلياً على السيرفر (بعد اكتمال الطلب)، أو المحلي فوراً. */
  syncExternalLeads: (channel: ExternalLeadChannel, count?: number) => Promise<number>;
  custodyFunds: CustodyFund[];
  custodyAccountByCategory: CustodyAccountByCategory;
  updateCustodyAccountByCategory: (patch: Partial<CustodyAccountByCategory>) => Promise<void>;
  /** طلب عهدة من مدير الإنتاج → ينتظر المالك */
  createCustodyRequest: (data: { title: string; description: string; totalAmount: number }) => Promise<boolean>;
  /** مسودة محاسب لعهدة مخصصة لمدير إنتاج */
  createCustodyFund: (data: {
    title: string;
    description: string;
    totalAmount: number;
    productionManagerId: string;
    currency?: CustodyCurrency;
    exchangeRate?: number;
    /** افتراضي true — تصل للمالك فوراً بحالة بانتظار اعتماد المالك */
    sendToOwner?: boolean;
  }) => Promise<boolean>;
  updateCustodyDraft: (
    id: string,
    patch: Partial<
      Pick<
        CustodyFund,
        'title' | 'description' | 'totalAmount' | 'productionManagerId' | 'productionManagerName' | 'currency' | 'exchangeRate'
      >
    >
  ) => Promise<boolean>;
  submitCustodyDraftToOwner: (id: string) => Promise<boolean>;
  /** إرسال كل مسودات العهدة للمالك دفعة واحدة */
  submitAllCustodyDraftsToOwner: () => Promise<number>;
  ownerApproveCustodyRequest: (id: string) => Promise<boolean>;
  ownerRejectCustodyRequest: (id: string, reason?: string) => Promise<boolean>;
  /** بعد اعتماد المالك: المحاسب يسجل الدفع ويُنشأ قيد الصرف */
  accountantRecordCustodyPayment: (id: string, method: 'كاش' | 'تحويل') => Promise<boolean>;
  managerReceiveCustody: (id: string, note?: string) => Promise<boolean>;
  managerUpdateCustodySpendLines: (id: string, lines: CustodySpendLine[]) => Promise<boolean>;
  /** بعد اعتماد المالك: تسجيل بنود الصرف والفواتير لطلب مصروف الإنتاج */
  managerUpdateApprovedExpenseSpendLines: (expenseId: string, lines: CustodySpendLine[]) => Promise<boolean>;
  managerSubmitCustodySettlement: (id: string, lines: CustodySpendLine[]) => Promise<boolean>;
  accountantApproveCustodySettlement: (id: string) => Promise<boolean>;
  accountantRejectCustodySettlement: (id: string, reason?: string) => Promise<boolean>;
  hardDeleteCustodyFund: (id: string) => Promise<boolean>;
  hardDeleteExpense: (id: string) => Promise<boolean>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const INITIAL_USERS: User[] = [
  { id: 'u1', name: 'خالد البنداري', role: 'مالك', avatar: '/avatars/khaled-bandary.png', skills: [], stats: { dealsWon: 45, points: 2500, avgResponseTime: '12 min', revenue: 1250000 } },
  { id: 'u2', name: 'سارة مدير المبيعات', role: 'مدير مبيعات', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop', skills: [], stats: { dealsWon: 30, points: 1800, avgResponseTime: '15 min' } },
  { id: 'u3', name: 'محمد مندوب', role: 'مندوب', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop', skills: ['إنجليزي', 'شركات كبرى'], baseSalary: 12000, stats: { dealsWon: 55, points: 3200, avgResponseTime: '8 min', revenue: 450000 } },
  { id: 'u4', name: 'ياسين مندوب', role: 'مندوب', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop', skills: ['سوشيال ميديا', 'إعلانات', 'شركات صغيرة'], baseSalary: 11500, stats: { dealsWon: 38, points: 2100, avgResponseTime: '20 min', revenue: 280000 } },
  { id: 'u5', name: 'خالد المحاسب', role: 'محاسب', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=100&h=100&fit=crop', skills: [], stats: { dealsWon: 0, points: 0, avgResponseTime: '0 min' } },
  { id: 'u6', name: 'أحمد مدير الإنتاج', role: 'مدير إنتاج', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop', skills: [], stats: { dealsWon: 0, points: 0, avgResponseTime: '0 min' } },
];

const DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY: CustodyAccountByCategory = {
  'رواتب': '5110',
  'إيجارات': '5110',
  'معدات': '5110',
  'تسويق': '5110',
  'تشغيل': '5110',
  'ضيافة': '5110',
  'نثريات': '5110',
  'أخرى': '5110',
};

const DEFAULT_TARGETS: MonthlyTarget[] = [
  { repId: 'u3', leadsTarget: 20, revenueTarget: 350000, callsTarget: 90, dailyCallsTarget: 8, weeklyCallsTarget: 40, commissionPercent: 5 },
  { repId: 'u4', leadsTarget: 18, revenueTarget: 300000, callsTarget: 85, dailyCallsTarget: 7, weeklyCallsTarget: 35, commissionPercent: 5 },
];

const DEFAULT_WORK_ORDER_CHECKLIST: NonNullable<ShootBooking['workOrderChecklist']> = [
  { id: 'wo-prep', label: 'تأكيد الموعد والموقع مع العميل', done: false },
  { id: 'wo-team', label: 'تجهيز الفريق والمعدات', done: false },
  { id: 'wo-shoot', label: 'تنفيذ جلسة التصوير', done: false },
  { id: 'wo-deliver', label: 'تسليم المخرجات للعميل', done: false },
];

const CUSTODY_ASSET_ACCOUNT_CODE = '1150';

const VALID_COA_TYPES = new Set<ChartOfAccount['type']>(['asset', 'liability', 'equity', 'revenue', 'expense']);

function normalizeChartOfAccounts(raw: unknown): ChartOfAccount[] {
  const arr = coerceAccountingWorkspaceArray(raw);
  const out: ChartOfAccount[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const code = String(o.code ?? '').trim();
    const name = String(o.name ?? '').trim();
    const typeRaw = String(o.type ?? 'expense') as ChartOfAccount['type'];
    const type = VALID_COA_TYPES.has(typeRaw) ? typeRaw : 'expense';
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, type, isSystem: Boolean(o.isSystem) });
  }
  return out;
}

function ensureCustodyAccountInChart(accounts: ChartOfAccount[]): ChartOfAccount[] {
  if (accounts.some((a) => a.code === CUSTODY_ASSET_ACCOUNT_CODE)) return accounts;
  return [
    ...accounts,
    { code: CUSTODY_ASSET_ACCOUNT_CODE, name: 'عهدة إنتاج (أمانة)', type: 'asset', isSystem: true },
  ];
}

const DEFAULT_CHART_OF_ACCOUNTS: ChartOfAccount[] = [
  { code: '1010', name: 'الصندوق/البنك', type: 'asset', isSystem: true },
  { code: '1150', name: 'عهدة إنتاج (أمانة)', type: 'asset', isSystem: true },
  { code: '1120', name: 'العملاء (ذمم مدينة)', type: 'asset', isSystem: true },
  { code: '2110', name: 'الموردون (ذمم دائنة)', type: 'liability', isSystem: true },
  { code: '2210', name: 'ضريبة قيمة مضافة مخرجات', type: 'liability', isSystem: true },
  { code: '1220', name: 'ضريبة قيمة مضافة مدخلات', type: 'asset', isSystem: true },
  { code: '4110', name: 'إيراد خدمات', type: 'revenue', isSystem: true },
  { code: '5110', name: 'مصروف تشغيل', type: 'expense', isSystem: true },
];

const DEFAULT_PRINT_BRANDING: PrintBrandingSettings = {
  companyName: 'The Untold Story System',
  reportHeader: 'تقرير داخلي',
  reportFooter: 'هذه الوثيقة صادرة من النظام الداخلي للشركة.',
  primaryColor: '#4F46E5',
  showPrintDate: true,
  showPageNumbers: true,
  signatureName: '',
  signatureTitle: '',
};

const DEFAULT_LEAD_INGESTION_SETTINGS: LeadIngestionSettings = {
  autoRouteToManager: true,
  managerUserId: 'u2',
  clientNotifyWebhookUrl: '',
  facebook: {
    connected: false,
    label: 'Facebook Page',
    accountRef: '',
    autoSync: true,
  },
  linkedin: {
    connected: false,
    label: 'LinkedIn Page',
    accountRef: '',
    autoSync: true,
  },
  google: {
    connected: false,
    label: 'Google Ads',
    accountRef: '',
    autoSync: true,
  },
  email: {
    connected: false,
    label: 'Email Inbox',
    accountRef: '',
    autoSync: true,
  },
};

const DEFAULT_SLA_ESCALATION_SETTINGS: SlaEscalationSettings = {
  warningAfterMinutes: 30,
  criticalAfterMinutes: 60,
  autoReassignAfterHours: 8,
};

const DEFAULT_LEAD_DATA_QUALITY_SETTINGS: LeadDataQualitySettings = {
  rejectDuplicateLeads: true,
  duplicatePhone: true,
  duplicateEmail: true,
  requireCompany: true,
  requireBudget: true,
};

const DEFAULT_WORKFLOW_RULES_SETTINGS: WorkflowRulesSettings = {
  quoteRequiresOwnerApproval: true,
  externalMeetingRequiresOwnerApproval: true,
  expenseRequiresOwnerApproval: true,
};

const DEFAULT_INTEGRATIONS: ExternalIntegrationConnection[] = [
  { provider: 'facebook', connected: false, status: 'idle' },
  { provider: 'instagram', connected: false, status: 'idle' },
  { provider: 'google_ads', connected: false, status: 'idle' },
  { provider: 'whatsapp', connected: false, status: 'idle' },
  { provider: 'linkedin', connected: false, status: 'idle' },
];

/** Keep legacy lead-ingestion channel flags aligned with OAuth integration rows (pull + UI). */
function computeLeadIngestionFromIntegrations(
  prev: LeadIngestionSettings,
  integrationsList: ExternalIntegrationConnection[],
): LeadIngestionSettings {
  const fbConnected = integrationsList.some(
    (i) => (i.provider === 'facebook' || i.provider === 'instagram') && i.connected,
  );
  const fbAccount =
    integrationsList.find((i) => i.provider === 'facebook' && i.connected)?.accountLabel ||
    integrationsList.find((i) => i.provider === 'instagram' && i.connected)?.accountLabel;

  const liConnected = integrationsList.some((i) => i.provider === 'linkedin' && i.connected);
  const liAccount = integrationsList.find((i) => i.provider === 'linkedin' && i.connected)?.accountLabel;

  const goConnected = integrationsList.some((i) => i.provider === 'google_ads' && i.connected);
  const goAccount = integrationsList.find((i) => i.provider === 'google_ads' && i.connected)?.accountLabel;

  const pickRef = (connected: boolean, label: string | undefined, fallback: string) => {
    if (!connected) return fallback;
    const t = label?.trim();
    return t || fallback;
  };

  return {
    ...prev,
    facebook: {
      ...prev.facebook,
      connected: fbConnected,
      accountRef: pickRef(fbConnected, fbAccount, prev.facebook.accountRef),
    },
    linkedin: {
      ...prev.linkedin,
      connected: liConnected,
      accountRef: pickRef(liConnected, liAccount, prev.linkedin.accountRef),
    },
    google: {
      ...prev.google,
      connected: goConnected,
      accountRef: pickRef(goConnected, goAccount, prev.google.accountRef),
    },
  };
}

const DEFAULT_EQUIPMENT_ITEMS: EquipmentItem[] = [
  { id: 'eq-1', name: 'Sony A7IV', category: 'كاميرات', totalQuantity: 3, active: true, createdAt: new Date().toISOString() },
  { id: 'eq-2', name: 'DJI Ronin RS3', category: 'مثبتات', totalQuantity: 2, active: true, createdAt: new Date().toISOString() },
  { id: 'eq-3', name: 'Aputure 300d', category: 'إضاءة', totalQuantity: 4, active: true, createdAt: new Date().toISOString() },
];

const DEMO_EXTRA_LEADS: Lead[] = [
  {
    id: 'l5',
    name: 'عمرو جمال',
    company: 'Vision Media',
    phone: '01055511223',
    email: 'amr@vision.com',
    status: 'تفاوض',
    assignedTo: 'u3',
    budget: 30000,
    companySize: 'متوسط',
    source: 'تحويل عميل',
    category: 'إعلانات',
    score: 72,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    followUpAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    slaStatus: 'متأخر',
    timeline: [],
  },
  {
    id: 'l6',
    name: 'ريم خالد',
    company: 'Edu Spark',
    phone: '01177733661',
    email: 'reem@eduspark.com',
    status: 'مغلق - خسارة',
    assignedTo: 'u4',
    budget: 22000,
    companySize: 'متوسط',
    source: 'لينكد إن',
    category: 'إنجليزي',
    score: 58,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    slaStatus: 'مستقر',
    timeline: [],
  },
  {
    id: 'l7',
    name: 'محمود نادر',
    company: 'Factory One',
    phone: '01200088994',
    email: 'mahmoud@factoryone.com',
    status: 'قيد التواصل',
    assignedTo: 'u4',
    budget: 65000,
    companySize: 'كبير',
    source: 'معرض',
    category: 'شركات كبرى',
    score: 84,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    followUpAt: new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString(),
    slaStatus: 'حرج',
    timeline: [],
  },
  {
    id: 'l8',
    name: 'إسلام حاتم',
    company: 'Bright Foods',
    phone: '01033445566',
    email: 'eslam@brightfoods.com',
    status: 'مغلق - خسارة',
    assignedTo: 'u3',
    budget: 27000,
    companySize: 'متوسط',
    source: 'موقع الشركة',
    category: 'شركات صغيرة',
    score: 61,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(),
    slaStatus: 'مستقر',
    timeline: [],
  },
  {
    id: 'l9',
    name: 'هالة نصر',
    company: 'Nova Clinics',
    phone: '01199887722',
    email: 'hala@novaclinics.com',
    status: 'مغلق - فوز',
    assignedTo: 'u4',
    budget: 38000,
    companySize: 'كبير',
    source: 'توصية',
    category: 'سوشيال ميديا',
    score: 89,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 60).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    slaStatus: 'مستقر',
    timeline: [],
  },
  {
    id: 'l10',
    name: 'كريم شوقي',
    company: 'Sky Events',
    phone: '01277889966',
    email: 'karim@skyevents.com',
    status: 'عرض سعر',
    assignedTo: 'u3',
    budget: 52000,
    companySize: 'كبير',
    source: 'معرض',
    category: 'إعلانات',
    score: 80,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    followUpAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    slaStatus: 'متأخر',
    timeline: [],
  },
];

const DEMO_EXTRA_INVOICES: Invoice[] = [
  { id: 'inv4', leadId: 'l5', customerName: 'عمرو جمال', amount: 30000, vatRate: 14, vatAmount: 4200, totalAmount: 34200, costCenter: 'إعلانات', status: 'مدفوع', date: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() },
  { id: 'inv5', leadId: 'l7', customerName: 'محمود نادر', amount: 65000, vatRate: 14, vatAmount: 9100, totalAmount: 74100, costCenter: 'شركات كبرى', status: 'قيد الانتظار', date: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
  { id: 'inv6', leadId: 'manual', customerName: 'شركة أفق', amount: 18000, vatRate: 14, vatAmount: 2520, totalAmount: 20520, costCenter: 'تصوير', status: 'متأخر', date: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString() },
  { id: 'inv7', leadId: 'l9', customerName: 'هالة نصر', amount: 38000, vatRate: 14, vatAmount: 5320, totalAmount: 43320, costCenter: 'سوشيال ميديا', status: 'مدفوع', date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  { id: 'inv8', leadId: 'l10', customerName: 'كريم شوقي', amount: 52000, vatRate: 14, vatAmount: 7280, totalAmount: 59280, costCenter: 'إعلانات', status: 'قيد الانتظار', date: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString() },
];

const DEFAULT_ACCOUNTING_POLICY: AccountingPolicy = {
  policyNotes:
    'عروض الأسعار الصادرة من المبيعات لا تُثبت في الدفاتر ولا تظهر للمحاسب كفواتير إلا بعد اعتماد المالك. الفواتير اليدوية من المحاسب تُستخدم للإثباتات الداخلية فقط.',
  allowedCostCentersForQuotes: ['سوشيال ميديا', 'تصوير', 'إعلانات', 'شركات كبرى', 'مبيعات', 'عام', 'أخرى'],
  minAmountHighlight: 100000,
};

/** عرض سعر تجريبي بانتظار المالك (للتوضيح في الديمو) */
const DEMO_PENDING_PRICE_QUOTES: PriceQuote[] = [
  {
    id: 'PQ-DEMO-01',
    leadId: 'l10',
    customerName: 'كريم شوقي / Sky Events',
    title: 'باقة تغطية إعلانية + تصوير',
    amount: 52000,
    vatRate: 14,
    vatAmount: 7280,
    totalAmount: 59280,
    costCenter: 'إعلانات',
    note: 'عرض سعر مرسل للعميل — بانتظار اعتماد المالك للتسجيل المحاسبي',
    createdById: 'u3',
    createdByName: 'محمد مندوب',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    status: 'قيد اعتماد المالك',
  },
];

const DEMO_EXTRA_EXPENSES: Expense[] = [
  { id: 'exp4', title: 'رواتب فريق المونتاج', category: 'رواتب', amount: 28000, vatRate: 0, vatAmount: 0, totalAmount: 28000, costCenter: 'تصوير', status: 'مدفوع', approvalStatus: 'معتمد', approvedBy: 'أحمد المالك', vendor: 'Payroll', date: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString() },
  { id: 'exp5', title: 'اشتراك أدوات SaaS', category: 'تشغيل', amount: 4500, vatRate: 14, vatAmount: 630, totalAmount: 5130, costCenter: 'عام', status: 'قيد الانتظار', approvalStatus: 'قيد الاعتماد', vendor: 'Tools Inc', date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
  { id: 'exp6', title: 'إعلانات توليد ليدز', category: 'تسويق', amount: 9000, vatRate: 14, vatAmount: 1260, totalAmount: 10260, costCenter: 'إعلانات', status: 'مدفوع', approvalStatus: 'معتمد', approvedBy: 'سارة مدير المبيعات', vendor: 'Google Ads', date: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString() },
];

const DEMO_MANUAL_JOURNALS: ManualJournalEntry[] = [
  {
    id: 'JRN-DEMO-01',
    date: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(),
    description: 'قيد تسوية مصروف مقدم',
    lines: [
      { accountCode: '5110', debit: 2500, credit: 0, costCenter: 'عام', note: 'مصروف تشغيلي' },
      { accountCode: '1010', debit: 0, credit: 2500, costCenter: 'عام', note: 'صرف من البنك' },
    ],
  },
  {
    id: 'JRN-DEMO-02',
    date: new Date(Date.now() - 1000 * 60 * 60 * 15).toISOString(),
    description: 'إثبات مخصص عمولات',
    lines: [
      { accountCode: '5110', debit: 4000, credit: 0, costCenter: 'مبيعات', note: 'عمولات مناديب' },
      { accountCode: '2110', debit: 0, credit: 4000, costCenter: 'مبيعات', note: 'التزام مستحق' },
    ],
  },
];

const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'audit-demo-1', action: 'مراجعة أداء المندوبين', entityType: 'system', actorId: 'u1', actorName: 'أحمد المالك', createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(), details: 'متابعة لوحة المالك' },
  { id: 'audit-demo-2', action: 'تحديث أهداف شهرية', entityType: 'user', entityId: 'u3', actorId: 'u2', actorName: 'سارة مدير المبيعات', createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(), details: 'رفع هدف الإيراد' },
  { id: 'audit-demo-3', action: 'اعتماد مصروف', entityType: 'invoice', entityId: 'exp4', actorId: 'u2', actorName: 'سارة مدير المبيعات', createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(), details: 'رواتب فريق المونتاج' },
  { id: 'audit-demo-4', action: 'إضافة قيد يومية يدوي', entityType: 'system', entityId: 'JRN-DEMO-01', actorId: 'u5', actorName: 'خالد المحاسب', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), details: 'قيد تسوية مصروف مقدم' },
  { id: 'audit-demo-5', action: 'إغلاق صفقة', entityType: 'lead', entityId: 'l9', actorId: 'u4', actorName: 'ياسين مندوب', createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(), details: 'إغلاق - فوز' },
  { id: 'audit-demo-6', action: 'تحديث حالة ليد', entityType: 'lead', entityId: 'l10', actorId: 'u3', actorName: 'محمد مندوب', createdAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(), details: 'نقل إلى عرض سعر' },
];

/** فشل جلب الحجوزات لا يُحوَّل إلى [] — كان يسبب مسح كل القائمة في الواجهة عند أي خطأ شبكة أو رفض مؤقت. */
async function fetchWorkspaceBookingSlice<T>(p: Promise<T[]>): Promise<T[] | undefined> {
  try {
    const v = await p;
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** آخر قوائم حجوزات ناجحة لهذه الجلسة — لا تُحمَّل لمستخدم آخر؛ تُمسح عند logout و index.html?_hl=1 */
const SESSION_BOOKING_BACKUP_SHOOT = 'prod_system_last_shoot_bookings_json_v1';
const SESSION_BOOKING_BACKUP_EQUIP = 'prod_system_last_equipment_bookings_json_v1';
const SESSION_BOOKING_BACKUP_MEET = 'prod_system_last_meeting_bookings_json_v1';

function persistSessionBookingBackup(key: string, value: unknown) {
  try {
    if (typeof window === 'undefined') return;
    /** منع كارثة الرفريش: السيرفر يرسل [] خطأ أو مؤقت → لا نمحو آخر قائمة كان عندها بيانات */
    if (Array.isArray(value) && value.length === 0) {
      const prevBk = readSessionBookingBackup(key);
      if (prevBk !== null && prevBk.length > 0) return;
    }
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

type LocalBookingMirror = { shoot?: unknown[]; equip?: unknown[]; meet?: unknown[] };

function localBookingMirrorKeyFromIdPart(idPart: string) {
  return `prod_system_ls_bookings_mirror_v1_${idPart}`;
}

/** نفس `sub` الذي يضعه الباك في JWT — أفضل من معرف الواجهة اللي قد يختلف بعد التطبيع */
function jwtSubFromStoredToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const token = localStorage.getItem('prod_system_jwt');
    if (!token?.includes('.')) return undefined;
    const part = token.split('.')[1];
    if (!part) return undefined;
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (b64.length % 4)) % 4;
    b64 += '='.repeat(pad);
    const json = atob(b64);
    const payload = JSON.parse(json) as { sub?: unknown };
    const sub = payload?.sub;
    return typeof sub === 'string' && sub.trim() ? canonicalTodoUserId(sub) : undefined;
  } catch {
    return undefined;
  }
}

function bookingMirrorIdParts(uiFallback?: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const j = jwtSubFromStoredToken();
  const u = uiFallback ? canonicalTodoUserId(uiFallback) : '';
  for (const id of [j, u]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readBookingMirrorBucket(idPart: string): LocalBookingMirror | null {
  if (typeof window === 'undefined' || !idPart) return null;
  try {
    const raw = localStorage.getItem(localBookingMirrorKeyFromIdPart(idPart));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? (o as LocalBookingMirror) : null;
  } catch {
    return null;
  }
}

function mergeBookingMirrorPreferRicher(a: LocalBookingMirror, b: LocalBookingMirror): LocalBookingMirror {
  const pick = (xa?: unknown[], xb?: unknown[]): unknown[] | undefined => {
    const la = Array.isArray(xa) ? xa.length : 0;
    const lb = Array.isArray(xb) ? xb.length : 0;
    if (la >= lb && la > 0) return xa;
    if (lb > la) return xb;
    return xa ?? xb;
  };
  return {
    shoot: pick(a.shoot, b.shoot),
    equip: pick(a.equip, b.equip),
    meet: pick(a.meet, b.meet),
  };
}

/** دمج كل المفاتيح الممكنة (jwt.sub + معرف الواجهة) علشان المرآة القديمة والجديدة تتقاب */
function readLocalBookingMirror(uiFallback?: string | undefined): LocalBookingMirror | null {
  let acc: LocalBookingMirror = {};
  let anyBucket = false;
  for (const idPart of bookingMirrorIdParts(uiFallback)) {
    const d = readBookingMirrorBucket(idPart);
    if (!d) continue;
    acc = mergeBookingMirrorPreferRicher(acc, d);
    anyBucket = true;
  }
  return anyBucket ? acc : null;
}

/** نسخة تنجو من ريفريش — تُكتب لكل من jwt.sub وبصمة الواجهة إن وُجدت */
function persistLocalBookingMirror(
  uid: string | undefined,
  patch: Partial<{ shoot: unknown[]; equip: unknown[]; meet: unknown[] }>,
): void {
  if (typeof window === 'undefined') return;
  const idParts = bookingMirrorIdParts(uid);
  if (idParts.length === 0) return;
  for (const idPart of idParts) {
    try {
      const prevDoc = readBookingMirrorBucket(idPart) || {};
      const next: LocalBookingMirror = { ...prevDoc };
      const ks = ['shoot', 'equip', 'meet'] as const;
      for (const k of ks) {
        const v = patch[k];
        if (v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) {
          const oldArr = prevDoc[k];
          if (Array.isArray(oldArr) && oldArr.length > 0) continue;
        }
        next[k] = v;
      }
      localStorage.setItem(localBookingMirrorKeyFromIdPart(idPart), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}

function clearBookingMirrorBuckets(uiFallback?: string | undefined): void {
  if (typeof window === 'undefined') return;
  for (const idPart of bookingMirrorIdParts(uiFallback)) {
    try {
      localStorage.removeItem(localBookingMirrorKeyFromIdPart(idPart));
    } catch {
      /* ignore */
    }
  }
}

function readSessionBookingBackup(key: string): unknown[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clearSessionBookingBackups() {
  if (typeof window === 'undefined') return;
  for (const key of [SESSION_BOOKING_BACKUP_SHOOT, SESSION_BOOKING_BACKUP_EQUIP, SESSION_BOOKING_BACKUP_MEET]) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** جلسة مكتوبة من supabase-js قبل/بدون prod_system_supabase — بدونها يُمسح prod_system_current_user ويُعاد المستخدم لصفحة الدخول فوراً */
function hasSupabasePersistedSessionInLocalStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-') && k.includes('auth-token')) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** جلسة REST (JWT) أو وضع Supabase المباشر بعد تسجيل الدخول */
function hasServerAuthToken(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isSupabaseDirectMode()) {
      if (localStorage.getItem('prod_system_supabase') === '1') return true;
      if (hasSupabasePersistedSessionInLocalStorage()) return true;
      return false;
    }
    return Boolean(localStorage.getItem('prod_system_jwt'));
  } catch {
    return false;
  }
}

/** أثناء hydrate من localStorage: لا تفرّغ المستخدم لو جلسة Supabase قادمة من onAuthStateChange */
function shouldPreserveUserForPendingSupabaseSession(): boolean {
  return isSupabaseDirectMode() && hasSupabasePersistedSessionInLocalStorage();
}

/** مفاتيح supabase-js في localStorage (مثل sb-xxx-auth-token) — لازم تمسح مع الخروج وإلا الجلسة ترجع بعد الريفريش */
function clearSupabasePersistedAuthFromLocalStorage() {
  if (typeof window === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-')) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

type LeadCreatePayload = Parameters<typeof createLeadApi>[0];
type LeadPatchPayload = Parameters<typeof patchLeadApi>[1];

function serverCreateLead(payload: LeadCreatePayload) {
  if (isSupabaseDirectMode()) return supabaseCreateLead(payload);
  return createLeadApi(payload);
}

function serverPatchLead(id: string, patch: LeadPatchPayload) {
  if (isSupabaseDirectMode()) return supabasePatchLead(id, patch);
  return patchLeadApi(id, patch);
}

async function serverDeleteLead(id: string): Promise<void> {
  if (isSupabaseDirectMode()) return supabaseDeleteLead(id);
  return deleteLeadApi(id);
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const normalizeRole = (rawRole: unknown): User['role'] => {
    const raw = String(rawRole || '').trim();
    const lowered = raw.toLowerCase();
    const roleMap: Record<string, User['role']> = {
      'مالك': 'مالك',
      'المالك': 'مالك',
      owner: 'مالك',
      'مدير مبيعات': 'مدير مبيعات',
      'sales manager': 'مدير مبيعات',
      'sales-manager': 'مدير مبيعات',
      salesmanager: 'مدير مبيعات',
      'مندوب': 'مندوب',
      'sales rep': 'مندوب',
      'sales-rep': 'مندوب',
      salesrep: 'مندوب',
      rep: 'مندوب',
      'محاسب': 'محاسب',
      accountant: 'محاسب',
      'مدير إنتاج': 'مدير إنتاج',
      'production manager': 'مدير إنتاج',
      'production-manager': 'مدير إنتاج',
      productionmanager: 'مدير إنتاج',
    };
    return roleMap[raw] || roleMap[lowered] || 'مندوب';
  };

  const parseSafe = <T,>(raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  const normalizeUser = (raw: any): User => {
    const role = normalizeRole(raw?.role);
    const fromDb = raw?.authSource === 'database';
    const isLegacyOwnerPresentation = !fromDb && raw?.id === 'u1';
    const tid = canonicalTodoUserId(raw?.id);
    const idStable = tid !== '' ? tid : `u-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: idStable,
      name: fromDb
        ? (raw?.name || 'موظف')
        : isLegacyOwnerPresentation
          ? 'خالد البنداري'
          : (raw?.name || 'موظف'),
      role,
      email: typeof raw?.email === 'string' ? raw.email : undefined,
      authSource: raw?.authSource === 'database' ? 'database' : 'demo',
      avatar:
        fromDb
          ? (raw?.avatar || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop')
          : isLegacyOwnerPresentation
            ? '/avatars/khaled-bandary.png'
            : (raw?.avatar || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop'),
      skills: Array.isArray(raw?.skills) ? raw.skills : [],
      baseSalary: (() => {
        const v = raw?.baseSalary ?? raw?.base_salary;
        if (v != null && v !== '') {
          const n = Number(v);
          if (Number.isFinite(n)) return Math.round(n);
        }
        if (!fromDb && role === 'مندوب') return 10000;
        return undefined;
      })(),
      stats: {
        dealsWon: Number(raw?.stats?.dealsWon) || 0,
        points: Number(raw?.stats?.points) || 0,
        avgResponseTime: raw?.stats?.avgResponseTime || '0 min',
        revenue: typeof raw?.stats?.revenue === 'number' ? raw.stats.revenue : undefined,
      },
    };
  };
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [manualCustomers, setManualCustomers] = useState<ManualCustomer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  /** يزداد عند كل تسجيل خروج لمنع استجابة /auth/me المتأخرة من إعادة تسجيل الدخول ضمنياً. */
  const authBootstrapEpochRef = useRef(0);
  /** إلغاء طلب /auth/me الجاري عند تسجيل الخروج */
  const authMeAbortRef = useRef<AbortController | null>(null);
  /** لمرآة حجوزات localStorage بمفتاح المستخدم — يُقرأ بعد ريفريش عندما prev=[] */
  const bookingMirrorUidRef = useRef<string | undefined>(undefined);
  bookingMirrorUidRef.current = currentUser?.id;
  // IDs deleted locally — persisted in localStorage so they survive page refreshes
  const LS_DEL_SHOOT = 'prod_system_deleted_shoot_ids_v1';
  const LS_DEL_EQUIP = 'prod_system_deleted_equip_ids_v1';
  const LS_DEL_MEET  = 'prod_system_deleted_meet_ids_v1';

  function loadDeletedIds(key: string): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]); }
    catch { return new Set(); }
  }
  function saveDeletedIds(key: string, set: Set<string>) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* private mode */ }
  }
  function addDeletedId(key: string, ref: React.MutableRefObject<Set<string>>, id: string) {
    ref.current.add(id);
    saveDeletedIds(key, ref.current);
  }
  function purgeDeletedId(key: string, ref: React.MutableRefObject<Set<string>>, id: string) {
    ref.current.delete(id);
    saveDeletedIds(key, ref.current);
  }

  const deletedShootIdsRef = useRef<Set<string>>(loadDeletedIds(LS_DEL_SHOOT));
  const deletedEquipIdsRef = useRef<Set<string>>(loadDeletedIds(LS_DEL_EQUIP));
  const deletedMeetIdsRef  = useRef<Set<string>>(loadDeletedIds(LS_DEL_MEET));

  const SESSION_SIGNED_OUT_KEY = 'prod_system_session_signed_out_v1';
  const readSessionSignedOut = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(SESSION_SIGNED_OUT_KEY) === '1';
    } catch {
      return false;
    }
  };
  /** استعادة المستخدم من /auth/me أو التخزين أو التبويبات الأخرى — تُحظر بعد خروج قاعدة البيانات حتى دخول صريح */
  const rehydrateUser = useCallback((next: User | null) => {
    if (next != null && next.authSource !== 'demo' && readSessionSignedOut()) {
      try {
        if (hasServerAuthToken()) {
          window.sessionStorage.removeItem(SESSION_SIGNED_OUT_KEY);
        } else {
          return;
        }
      } catch {
        return;
      }
    }
    setCurrentUserState(next);
  }, []);
  /** setCurrentUser العام من الواجهة (تسجيل الدخول) — يلغي قفل الجلسة */
  const setCurrentUserPublic = useCallback((next: User | null) => {
    if (next != null) {
      try {
        if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_SIGNED_OUT_KEY);
      } catch {
        /* ignore */
      }
    }
    setCurrentUserState(next);
  }, []);

  /** مزامنة مستخدم التطبيق مع جلسة Supabase — يمنع «دخول ثم خروج فوري» بسبب سباق bootstrap أو تبويب آخر يمسح prod_system_current_user */
  useEffect(() => {
    if (!isSupabaseDirectMode()) return;
    let cancelled = false;
    const syncFromSession = async (session: Session | null) => {
      if (cancelled) return;
      if (!session?.user?.email) {
        rehydrateUser(null);
        try {
          localStorage.removeItem('prod_system_supabase');
        } catch {
          /* ignore */
        }
        return;
      }
      const em = session.user.email.trim().toLowerCase();
      try {
        const sb = getSupabase();
        const { data: profile, error } = await sb
          .from('users')
          .select('id,email,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at')
          .eq('email', em)
          .maybeSingle();
        if (cancelled) return;
        if (error || !profile) {
          await sb.auth.signOut();
          try {
            localStorage.removeItem('prod_system_supabase');
          } catch {
            /* ignore */
          }
          rehydrateUser(null);
          return;
        }
        try {
          localStorage.setItem('prod_system_supabase', '1');
        } catch {
          /* ignore */
        }
        try {
          window.sessionStorage.removeItem(SESSION_SIGNED_OUT_KEY);
        } catch {
          /* ignore */
        }
        rehydrateUser(mapUserFromRow(profile as Record<string, unknown>));
      } catch {
        try {
          localStorage.removeItem('prod_system_supabase');
        } catch {
          /* ignore */
        }
      }
    };

    const sb = getSupabase();
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return;
      void syncFromSession(session);
    });
    void (async () => {
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!cancelled) void syncFromSession(session);
    })();
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [rehydrateUser]);

  const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>(DEFAULT_TARGETS);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [closedMonths, setClosedMonths] = useState<string[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>(() => {
    const cached = readCachedChartOfAccounts();
    if (cached.length > 0) return ensureCustodyAccountInChart(cached);
    return DEFAULT_CHART_OF_ACCOUNTS;
  });
  const [manualJournalEntries, setManualJournalEntries] = useState<ManualJournalEntry[]>([]);
  const [journalCodingRules, setJournalCodingRulesState] = useState<JournalCodingRule[]>(() =>
    readCachedJournalCodebook(),
  );
  const customerCodePrefixRef = useRef('CUS');
  const [customerCodePrefix, setCustomerCodePrefixState] = useState('CUS');
  const [expenseCodingRules, setExpenseCodingRulesState] = useState<ExpenseCodingRule[]>(() =>
    DEFAULT_EXPENSE_CODING_RULES.map((r) => ({ ...r }))
  );
  const [expenseSavedViews, setExpenseSavedViewsState] = useState<ExpenseSavedView[]>([]);
  const [payrollAutoSendDay, setPayrollAutoSendDayState] = useState<number | ''>('');
  const [entityComments, setEntityCommentsState] = useState<EntityCommentsMap>({});
  const [expenseEscalations, setExpenseEscalationsState] = useState<Record<string, ExpenseEscalationState>>({});
  const [uiVisualMode, setUiVisualModeState] = useState<'premium' | 'classic'>('premium');
  const [personalTodosByUserId, setPersonalTodosByUserIdState] = useState<Record<string, PersonalTodo[]>>({});
  const [notifyForegroundByUserId, setNotifyForegroundByUserIdState] = useState<Record<string, boolean>>({});
  const [closedFiscalYears, setClosedFiscalYears] = useState<string[]>([]);
  const [openingBalancesByYear, setOpeningBalancesByYear] = useState<Record<string, { accountCode: string; balance: number }[]>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [payrollApprovals, setPayrollApprovals] = useState<PayrollApproval[]>([]);
  const [payrollApprovalRequests, setPayrollApprovalRequests] = useState<PayrollApprovalRequest[]>([]);
  const [payrollSalesDiscounts, setPayrollSalesDiscounts] = useState<PayrollSalesDiscount[]>([]);
  const [financialReopenRequests, setFinancialReopenRequests] = useState<FinancialPeriodReopenRequest[]>([]);
  const [shootBookings, setShootBookings] = useState<ShootBooking[]>([]);
  const [equipmentBookings, setEquipmentBookings] = useState<EquipmentBooking[]>([]);
  const [meetingBookings, setMeetingBookings] = useState<MeetingBooking[]>([]);
  const [otherBookings, setOtherBookings] = useState<OtherBooking[]>([]);
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>(DEFAULT_EQUIPMENT_ITEMS);
  const [printBrandingSettings, setPrintBrandingSettings] = useState<PrintBrandingSettings>(DEFAULT_PRINT_BRANDING);
  const [leadIngestionSettings, setLeadIngestionSettings] = useState<LeadIngestionSettings>(DEFAULT_LEAD_INGESTION_SETTINGS);
  const [slaEscalationSettings, setSlaEscalationSettings] = useState<SlaEscalationSettings>(DEFAULT_SLA_ESCALATION_SETTINGS);
  const [leadDataQualitySettings, setLeadDataQualitySettings] = useState<LeadDataQualitySettings>(DEFAULT_LEAD_DATA_QUALITY_SETTINGS);
  const [workflowRulesSettings, setWorkflowRulesSettings] = useState<WorkflowRulesSettings>(DEFAULT_WORKFLOW_RULES_SETTINGS);
  const [integrations, setIntegrations] = useState<ExternalIntegrationConnection[]>(DEFAULT_INTEGRATIONS);
  const [priceQuotes, setPriceQuotes] = useState<PriceQuote[]>([]);
  const [accountingPolicy, setAccountingPolicy] = useState<AccountingPolicy>(DEFAULT_ACCOUNTING_POLICY);
  const [custodyFunds, setCustodyFunds] = useState<CustodyFund[]>([]);
  const [custodyAccountByCategory, setCustodyAccountByCategory] = useState<CustodyAccountByCategory>(DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY);

  useEffect(() => {
    clearLegacyOnboardingStorageKeys();
  }, []);

  /** استعادة مهام محفوظة من localStorage (مهمّة لوضع السيرفر قبل اكتمال جلب Workspace) */
  useEffect(() => {
    try {
      const fromLs: Record<string, PersonalTodo[]> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith('prod_system_todos_')) continue;
        const uid = k.slice('prod_system_todos_'.length);
        if (!uid) continue;
        const rawLs = localStorage.getItem(k);
        fromLs[uid] = normalizePersonalTodos(parseSafe<unknown>(rawLs));
      }
      if (Object.keys(fromLs).length === 0) return;
      setPersonalTodosByUserIdState((p) => mergePersonalTodosByUserId(p, fromLs));
    } catch {
      /* ignore */
    }
  }, []);

  const normalizeUsers = (rawUsers: any[]): User[] => rawUsers.map((u: any) => normalizeUser(u));
  const normalizeInvoice = (raw: any): Invoice => {
    const amount = Number(raw?.amount) || 0;
    const vatRate = typeof raw?.vatRate === 'number' ? raw.vatRate : 14;
    const vatAmount = typeof raw?.vatAmount === 'number' ? raw.vatAmount : Math.round(amount * (vatRate / 100));
    const totalAmount = typeof raw?.totalAmount === 'number' ? raw.totalAmount : amount + vatAmount;
    const paidAmountRaw = typeof raw?.paidAmount === 'number' ? raw.paidAmount : (raw?.status === 'مدفوع' ? totalAmount : 0);
    const paidAmount = Math.max(0, Math.min(totalAmount, paidAmountRaw));
    const remainingAmount = Math.max(0, totalAmount - paidAmount);
    return {
      ...raw,
      leadId: typeof raw?.leadId === 'string' ? raw.leadId : '',
      customerCode: raw?.customerCode || undefined,
      amount,
      vatRate,
      vatAmount,
      totalAmount,
      paidAmount,
      remainingAmount,
      nextDueDate: typeof raw?.nextDueDate === 'string' ? raw.nextDueDate : undefined,
      collections: Array.isArray(raw?.collections) ? raw.collections : [],
    };
  };
  const normalizeMeetingBooking = (raw: any): MeetingBooking => ({
    ...raw,
    leadId: typeof raw?.leadId === 'string' ? raw.leadId : undefined,
    durationMins: Math.max(15, Number(raw?.durationMins) || 60),
    venueType: (raw?.venueType as MeetingBooking['venueType']) || 'داخل_المقر',
    status: (raw?.status as MeetingBooking['status']) || 'معتمد',
    requestedByRole: raw?.requestedByRole as User['role'] | undefined,
    estimatedCost: typeof raw?.estimatedCost === 'number' ? raw.estimatedCost : undefined,
    financialStatus: (raw?.financialStatus as MeetingBooking['financialStatus']) || 'غير_مطلوب',
    paymentMethod: raw?.paymentMethod as MeetingBooking['paymentMethod'] | undefined,
    paymentAt: typeof raw?.paymentAt === 'string' ? raw.paymentAt : undefined,
    paymentExpenseId: typeof raw?.paymentExpenseId === 'string' ? raw.paymentExpenseId : undefined,
  });

  const normalizeOtherBookings = (raw: unknown): OtherBooking[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x) => x && typeof x === 'object')
      .map((x: any) => ({
        id: String(x.id ?? '').trim(),
        title: String(x.title ?? '').trim() || 'حجز آخر',
        statement: String(x.statement ?? '').trim(),
        date: typeof x.date === 'string' && x.date.trim() ? String(x.date).trim().slice(0, 32) : undefined,
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
        createdById: String(x.createdById ?? '').trim(),
        createdByName: String(x.createdByName ?? '').trim(),
      }))
      .filter((b) => b.id && b.statement);
  };

  const buildCustomerCodeFromSeed = useCallback((seed: string) => {
    const clean = (seed || 'customer').trim();
    const numeric = clean.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10000;
    const pref = (customerCodePrefixRef.current || 'CUS').toUpperCase().replace(/\s+/g, '') || 'CUS';
    return `${pref}-${String(numeric).padStart(4, '0')}`;
  }, []);

  useEffect(() => {
    customerCodePrefixRef.current = customerCodePrefix;
  }, [customerCodePrefix]);

  // Initial Mock Data
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem('prod_system_force_logout_next') === '1') {
        window.sessionStorage.removeItem('prod_system_force_logout_next');
        localStorage.removeItem('prod_system_jwt');
        localStorage.removeItem('prod_system_current_user');
        localStorage.removeItem('prod_system_supabase');
        clearSupabasePersistedAuthFromLocalStorage();
      }
    } catch {
      /* ignore */
    }
    const savedLeads = localStorage.getItem('prod_system_leads');
    const savedUsers = localStorage.getItem('prod_system_users');
    const savedUser = localStorage.getItem('prod_system_current_user');
    const savedInvoices = localStorage.getItem('prod_system_invoices');
    const savedExpenses = localStorage.getItem('prod_system_expenses');
    const savedClosedMonths = localStorage.getItem('prod_system_closed_months');
    const savedTargets = localStorage.getItem('prod_system_targets');
    const savedAudit = localStorage.getItem('prod_system_audit');
    const savedChart = localStorage.getItem('prod_system_chart_of_accounts');
    const savedJournals = localStorage.getItem('prod_system_manual_journals');
    const savedClosedYears = localStorage.getItem('prod_system_closed_fiscal_years');
    const savedOpenings = localStorage.getItem('prod_system_opening_balances_by_year');
    const savedAttendance = localStorage.getItem('prod_system_attendance_records');
    const savedPayrollApprovals = localStorage.getItem('prod_system_payroll_approvals');
    const savedPayrollApprovalRequests = localStorage.getItem('prod_system_payroll_approval_requests');
    const savedPayrollSalesDiscounts = localStorage.getItem('prod_system_payroll_sales_discounts');
    const savedFinancialReopenRequests = localStorage.getItem('prod_system_financial_reopen_requests');
    const savedShootBookings = localStorage.getItem('prod_system_shoot_bookings');
    const savedEquipmentBookings = localStorage.getItem('prod_system_equipment_bookings');
    const savedMeetingBookings = localStorage.getItem('prod_system_meeting_bookings');
    const savedOtherBookings = localStorage.getItem('prod_system_other_bookings');
    const savedEquipmentItems = localStorage.getItem('prod_system_equipment_items');
    const savedPrintBranding = localStorage.getItem('prod_system_print_branding');
    const savedLeadIngestion = localStorage.getItem('prod_system_lead_ingestion_settings');
    const savedSlaEscalation = localStorage.getItem('prod_system_sla_escalation_settings');
    const savedLeadDataQuality = localStorage.getItem('prod_system_lead_data_quality_settings');
    const savedWorkflowRules = localStorage.getItem('prod_system_workflow_rules_settings');
    const savedIntegrations = localStorage.getItem('prod_system_external_integrations');
    const savedPriceQuotes = localStorage.getItem('prod_system_price_quotes');
    const savedAccountingPolicy = localStorage.getItem('prod_system_accounting_policy');
    const savedCustodyFunds = localStorage.getItem('prod_system_custody_funds');
    const savedCustodyAccountMap = localStorage.getItem('prod_system_custody_account_map');
    const savedManualCustomers = localStorage.getItem('prod_system_manual_customers');
    const savedJournalCodebook = localStorage.getItem('prod_system_journal_codebook');
    const savedExpenseCodebook = localStorage.getItem('prod_system_expense_codebook');
    const savedCustomerCodePrefix = localStorage.getItem('prod_system_customer_code_prefix');
    const savedExpenseSavedViews = localStorage.getItem('prod_system_expense_saved_views');
    const savedPayrollAutoSendDay = localStorage.getItem('prod_system_payroll_auto_send_day');
    const savedEntityComments = localStorage.getItem('prod_system_entity_comments');
    const savedExpenseEscalations = localStorage.getItem('prod_system_expense_escalations');

    const usersCandidate = parseSafe<any[]>(savedUsers);
    const leadsCandidate = parseSafe<Lead[]>(savedLeads);
    const parsedUsersRaw: any[] | null = Array.isArray(usersCandidate) ? usersCandidate : null;
    const parsedLeadsRaw: Lead[] | null = Array.isArray(leadsCandidate) ? leadsCandidate : null;

    if (parsedLeadsRaw && parsedUsersRaw) {
      const parsedUsers = normalizeUsers(parsedUsersRaw);
      const hasAccountant = parsedUsers.some((u: any) => u.role === 'محاسب');
      const mergedLeads = [...parsedLeadsRaw];
      if (!isServerDataMode()) {
        DEMO_EXTRA_LEADS.forEach((lead) => {
          if (!mergedLeads.some(l => l.id === lead.id)) mergedLeads.push(lead);
        });
      }
      setLeads(
        isServerDataMode()
          ? []
          : mergedLeads.map((l) => ({
              ...l,
              customerCode: l.customerCode || buildCustomerCodeFromSeed(l.id || l.name),
            }))
      );

      /** لا تحمّل prod_system_users في وضع السيرفر — يخلط مستخدمين تجريبيين (أرقام u-…) غير موجودة في Postgres فيفشل الحذف بـ«المستخدم غير موجود». */
      if (!isServerDataMode()) {
        let nextUsers = [...parsedUsers];
        if (!hasAccountant) {
          const accountant = INITIAL_USERS.find(u => u.role === 'محاسب');
          if (accountant && !nextUsers.some((u: any) => u.id === accountant.id)) nextUsers.push(accountant);
        }
        if (!nextUsers.some((u: any) => u.role === 'مدير إنتاج')) {
          const pm = INITIAL_USERS.find(u => u.role === 'مدير إنتاج');
          if (pm && !nextUsers.some((u: any) => u.id === pm.id)) nextUsers.push(pm);
        }
        if (nextUsers.length !== parsedUsers.length) {
          const nu = normalizeUsers(nextUsers);
          setUsers(nu);
          localStorage.setItem('prod_system_users', JSON.stringify(nu));
        } else {
          setUsers(parsedUsers);
        }
      } else {
        setUsers([]);
      }

      if (savedInvoices) {
        const rawInvoices = parseSafe<any[]>(savedInvoices);
        const parsedInvoices = Array.isArray(rawInvoices) ? rawInvoices.map((inv: Invoice) => normalizeInvoice({
          ...inv,
          costCenter: inv.costCenter || 'عام',
          recordOrigin: (inv.recordOrigin as Invoice['recordOrigin']) || 'ترحيل',
        })) : [];
        const mergedInvoices = [...parsedInvoices];
        if (!isServerDataMode()) {
          DEMO_EXTRA_INVOICES.forEach((inv: Invoice) => {
            if (!mergedInvoices.some((i: Invoice) => i.id === inv.id)) mergedInvoices.push(inv);
          });
        }
        setInvoices(isServerDataMode() ? [] : mergedInvoices);
      }
      if (savedExpenses) {
        const rawExpenses = parseSafe<any[]>(savedExpenses);
        const parsedExpenses = Array.isArray(rawExpenses) ? rawExpenses.map((exp: Expense) => {
          const baseAmount = Number(exp.amount) || 0;
          const vatRate = typeof exp.vatRate === 'number' ? exp.vatRate : 14;
          const vatAmount = typeof exp.vatAmount === 'number' ? exp.vatAmount : Math.round(baseAmount * (vatRate / 100));
          const totalAmount = typeof exp.totalAmount === 'number' ? exp.totalAmount : baseAmount + vatAmount;
          return {
            ...exp,
            vatRate,
            vatAmount,
            totalAmount,
            costCenter: exp.costCenter || 'عام',
            approvalStatus: exp.approvalStatus || 'قيد الاعتماد',
          };
        }) : [];
        const mergedExpenses: Expense[] = [...parsedExpenses];
        if (!isServerDataMode()) {
          DEMO_EXTRA_EXPENSES.forEach((exp: Expense) => {
            if (mergedExpenses.some((e: Expense) => e.id === exp.id)) return;
            const baseAmount = Number(exp.amount) || 0;
            const vatRate = typeof exp.vatRate === 'number' ? exp.vatRate : 14;
            const vatAmount =
              typeof exp.vatAmount === 'number' ? exp.vatAmount : Math.round(baseAmount * (vatRate / 100));
            const totalAmount =
              typeof exp.totalAmount === 'number' ? exp.totalAmount : baseAmount + vatAmount;
            mergedExpenses.push({
              ...exp,
              vatRate,
              vatAmount,
              totalAmount,
              costCenter: exp.costCenter || 'عام',
              approvalStatus: exp.approvalStatus || 'قيد الاعتماد',
            });
          });
        }
        setExpenses(isServerDataMode() ? [] : mergedExpenses);
      }
      if (!isServerDataMode() && savedClosedMonths) {
        const rawClosedMonths = parseSafe<any[]>(savedClosedMonths);
        if (Array.isArray(rawClosedMonths)) setClosedMonths(rawClosedMonths);
      }
      if (!isServerDataMode() && savedTargets) {
        const rawTargets = parseSafe<any[]>(savedTargets);
        const parsedTargets: MonthlyTarget[] = (Array.isArray(rawTargets) ? rawTargets : []).map((t: MonthlyTarget) => ({
          ...t,
          callsTarget: typeof t.callsTarget === 'number' ? t.callsTarget : 80,
          dailyCallsTarget: typeof (t as any).dailyCallsTarget === 'number' ? (t as any).dailyCallsTarget : 8,
          weeklyCallsTarget: typeof (t as any).weeklyCallsTarget === 'number' ? (t as any).weeklyCallsTarget : 40,
          commissionPercent: typeof (t as any).commissionPercent === 'number' ? (t as any).commissionPercent : 0,
        }));
        setMonthlyTargets(parsedTargets);
      }
      else if (!isServerDataMode()) setMonthlyTargets(DEFAULT_TARGETS);
      if (!isServerDataMode() && savedAudit) {
        const rawAudit = parseSafe<any[]>(savedAudit);
        const parsedAudit: AuditEvent[] = Array.isArray(rawAudit) ? rawAudit : [];
        const mergedAudit = [...parsedAudit];
        if (!isServerDataMode()) {
          DEMO_AUDIT_EVENTS.forEach((a) => {
            if (!mergedAudit.some(x => x.id === a.id)) mergedAudit.push(a);
          });
        }
        setAuditEvents(mergedAudit);
      } else if (!isServerDataMode()) {
        setAuditEvents(DEMO_AUDIT_EVENTS);
      }
      if (!isServerDataMode() && savedChart) {
        const rawChart = parseSafe<unknown>(savedChart);
        const normalized = normalizeChartOfAccounts(rawChart);
        if (normalized.length > 0) {
          setChartOfAccounts(ensureCustodyAccountInChart(normalized));
        }
      }
      else if (!isServerDataMode()) setChartOfAccounts(DEFAULT_CHART_OF_ACCOUNTS);
      if (!isServerDataMode() && savedJournals) {
        const rawJournals = parseSafe<any[]>(savedJournals);
        const parsedJournals: ManualJournalEntry[] = Array.isArray(rawJournals) ? rawJournals : [];
        const mergedJournals = [...parsedJournals];
        if (!isServerDataMode()) {
          DEMO_MANUAL_JOURNALS.forEach((j) => {
            if (!mergedJournals.some(x => x.id === j.id)) mergedJournals.push(j);
          });
        }
        setManualJournalEntries(mergedJournals);
      } else if (!isServerDataMode()) {
        setManualJournalEntries(DEMO_MANUAL_JOURNALS);
      }
      if (!isServerDataMode() && savedJournalCodebook) {
        const rawJournalRules = parseSafe<unknown>(savedJournalCodebook);
        setJournalCodingRulesState(normalizeJournalCodingRulesFromArray(rawJournalRules));
      }
      if (!isServerDataMode() && savedExpenseCodebook) {
        const rawExpRules = parseSafe<unknown>(savedExpenseCodebook);
        setExpenseCodingRulesState(mergeExpenseCodingRulesFromArray(rawExpRules));
      }
      if (!isServerDataMode() && savedCustomerCodePrefix) {
        const p = String(savedCustomerCodePrefix).trim().replace(/\s+/g, '') || 'CUS';
        setCustomerCodePrefixState(p);
        customerCodePrefixRef.current = p;
      }
      if (!isServerDataMode() && savedExpenseSavedViews) {
        const rawViews = parseSafe<unknown>(savedExpenseSavedViews);
        setExpenseSavedViewsState(normalizeExpenseSavedViews(rawViews));
      }
      if (!isServerDataMode() && savedPayrollAutoSendDay) {
        const num = Number(savedPayrollAutoSendDay);
        if (Number.isFinite(num) && num >= 1 && num <= 28) setPayrollAutoSendDayState(num);
      }
      if (!isServerDataMode() && savedEntityComments) {
        setEntityCommentsState(normalizeEntityComments(parseSafe<unknown>(savedEntityComments)));
      }
      if (!isServerDataMode() && savedExpenseEscalations) {
        setExpenseEscalationsState(normalizeExpenseEscalations(parseSafe<unknown>(savedExpenseEscalations)));
      }
      if (!isServerDataMode()) {
        const savedVm = localStorage.getItem('prod_system_ui_visual_mode');
        if (savedVm === 'classic' || savedVm === 'premium') setUiVisualModeState(savedVm);
        try {
          const todoMap: Record<string, PersonalTodo[]> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith('prod_system_todos_')) continue;
            const uid = k.slice('prod_system_todos_'.length);
            const rawLs = localStorage.getItem(k);
            if (!rawLs) continue;
            todoMap[uid] = normalizePersonalTodos(parseSafe<unknown>(rawLs));
          }
          if (Object.keys(todoMap).length) {
            setPersonalTodosByUserIdState((prev) => ({ ...prev, ...todoMap }));
          }
        } catch {
          /* تجاهل مفاتيح تالفة */
        }
        try {
          const fgMap: Record<string, boolean> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith('prod_system_todo_notify_u_')) continue;
            const uid = k.slice('prod_system_todo_notify_u_'.length);
            fgMap[uid] = localStorage.getItem(k) === '1';
          }
          if (Object.keys(fgMap).length) {
            setNotifyForegroundByUserIdState((prev) => ({ ...prev, ...fgMap }));
          }
        } catch {
          /* ignore */
        }
      }
      if (!isServerDataMode() && savedClosedYears) {
        const rawClosedYears = parseSafe<any[]>(savedClosedYears);
        if (Array.isArray(rawClosedYears)) setClosedFiscalYears(rawClosedYears);
      }
      if (!isServerDataMode() && savedOpenings) {
        const rawOpenings = parseSafe<Record<string, { accountCode: string; balance: number }[]>>(savedOpenings);
        if (rawOpenings && typeof rawOpenings === 'object') setOpeningBalancesByYear(rawOpenings);
      }
      if (!isServerDataMode() && savedAttendance) {
        const rawAttendance = parseSafe<any[]>(savedAttendance);
        if (Array.isArray(rawAttendance)) setAttendanceRecords(rawAttendance);
      }
      if (!isServerDataMode() && savedPayrollApprovals) {
        const rawPayrollApprovals = parseSafe<any[]>(savedPayrollApprovals);
        if (Array.isArray(rawPayrollApprovals)) setPayrollApprovals(rawPayrollApprovals);
      }
      if (!isServerDataMode() && savedPayrollApprovalRequests) {
        const rawRequests = parseSafe<any[]>(savedPayrollApprovalRequests);
        if (Array.isArray(rawRequests)) setPayrollApprovalRequests(rawRequests);
      }
      if (!isServerDataMode() && savedPayrollSalesDiscounts) {
        const rawDiscounts = parseSafe<PayrollSalesDiscount[]>(savedPayrollSalesDiscounts);
        if (Array.isArray(rawDiscounts)) setPayrollSalesDiscounts(rawDiscounts.slice(0, 500));
      }
      if (!isServerDataMode() && savedFinancialReopenRequests) {
        const rawReopenRequests = parseSafe<any[]>(savedFinancialReopenRequests);
        if (Array.isArray(rawReopenRequests)) setFinancialReopenRequests(rawReopenRequests);
      }
      if (!isServerDataMode() && savedShootBookings) {
        const rawShootBookings = parseSafe<any[]>(savedShootBookings);
        if (Array.isArray(rawShootBookings)) setShootBookings(rawShootBookings);
      }
      if (!isServerDataMode() && savedEquipmentBookings) {
        const rawEquipmentBookings = parseSafe<any[]>(savedEquipmentBookings);
        if (Array.isArray(rawEquipmentBookings)) setEquipmentBookings(rawEquipmentBookings);
      }
      if (!isServerDataMode() && savedMeetingBookings) {
        const rawMeetingBookings = parseSafe<any[]>(savedMeetingBookings);
        if (Array.isArray(rawMeetingBookings)) setMeetingBookings(rawMeetingBookings.map(normalizeMeetingBooking));
      }
      if (!isServerDataMode() && savedOtherBookings) {
        setOtherBookings(normalizeOtherBookings(parseSafe<unknown>(savedOtherBookings)));
      }
      if (!isServerDataMode() && savedEquipmentItems) {
        try {
          const parsed = parseSafe<EquipmentItem[]>(savedEquipmentItems) || [];
          setEquipmentItems(parsed.length > 0 ? parsed : DEFAULT_EQUIPMENT_ITEMS);
        } catch {
          setEquipmentItems(DEFAULT_EQUIPMENT_ITEMS);
        }
      }
      if (!isServerDataMode() && savedPrintBranding) {
        try {
          const parsedBranding = parseSafe<any>(savedPrintBranding);
          setPrintBrandingSettings({
            companyName: parsedBranding?.companyName || DEFAULT_PRINT_BRANDING.companyName,
            logoDataUrl: parsedBranding?.logoDataUrl || '',
            reportHeader: parsedBranding?.reportHeader || DEFAULT_PRINT_BRANDING.reportHeader,
            reportFooter: parsedBranding?.reportFooter || DEFAULT_PRINT_BRANDING.reportFooter,
            primaryColor: parsedBranding?.primaryColor || DEFAULT_PRINT_BRANDING.primaryColor,
            showPrintDate: typeof parsedBranding?.showPrintDate === 'boolean' ? parsedBranding.showPrintDate : DEFAULT_PRINT_BRANDING.showPrintDate,
            showPageNumbers: typeof parsedBranding?.showPageNumbers === 'boolean' ? parsedBranding.showPageNumbers : DEFAULT_PRINT_BRANDING.showPageNumbers,
            signatureName: parsedBranding?.signatureName || '',
            signatureTitle: parsedBranding?.signatureTitle || '',
          });
        } catch {
          setPrintBrandingSettings(DEFAULT_PRINT_BRANDING);
        }
      }
      if (!isServerDataMode() && savedLeadIngestion) {
        const rawIngestion = parseSafe<Partial<LeadIngestionSettings>>(savedLeadIngestion);
        if (rawIngestion && typeof rawIngestion === 'object') {
          setLeadIngestionSettings({
            autoRouteToManager: typeof rawIngestion.autoRouteToManager === 'boolean'
              ? rawIngestion.autoRouteToManager
              : DEFAULT_LEAD_INGESTION_SETTINGS.autoRouteToManager,
            managerUserId: typeof rawIngestion.managerUserId === 'string'
              ? rawIngestion.managerUserId
              : DEFAULT_LEAD_INGESTION_SETTINGS.managerUserId,
            clientNotifyWebhookUrl:
              typeof rawIngestion.clientNotifyWebhookUrl === 'string'
                ? rawIngestion.clientNotifyWebhookUrl
                : DEFAULT_LEAD_INGESTION_SETTINGS.clientNotifyWebhookUrl,
            facebook: { ...DEFAULT_LEAD_INGESTION_SETTINGS.facebook, ...(rawIngestion.facebook || {}) },
            linkedin: { ...DEFAULT_LEAD_INGESTION_SETTINGS.linkedin, ...(rawIngestion.linkedin || {}) },
            google: { ...DEFAULT_LEAD_INGESTION_SETTINGS.google, ...(rawIngestion.google || {}) },
            email: { ...DEFAULT_LEAD_INGESTION_SETTINGS.email, ...(rawIngestion.email || {}) },
          });
        } else {
          setLeadIngestionSettings(DEFAULT_LEAD_INGESTION_SETTINGS);
        }
      } else if (!isServerDataMode()) {
        setLeadIngestionSettings(DEFAULT_LEAD_INGESTION_SETTINGS);
      }
      if (!isServerDataMode() && savedSlaEscalation) {
        const rawSla = parseSafe<Partial<SlaEscalationSettings>>(savedSlaEscalation);
        if (rawSla && typeof rawSla === 'object') {
          setSlaEscalationSettings({
            warningAfterMinutes: Math.max(5, Number(rawSla.warningAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.warningAfterMinutes),
            criticalAfterMinutes: Math.max(10, Number(rawSla.criticalAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.criticalAfterMinutes),
            autoReassignAfterHours: Math.max(0, Number(rawSla.autoReassignAfterHours) || DEFAULT_SLA_ESCALATION_SETTINGS.autoReassignAfterHours),
          });
        } else {
          setSlaEscalationSettings(DEFAULT_SLA_ESCALATION_SETTINGS);
        }
      } else if (!isServerDataMode()) {
        setSlaEscalationSettings(DEFAULT_SLA_ESCALATION_SETTINGS);
      }
      if (!isServerDataMode() && savedLeadDataQuality) {
        const rawQuality = parseSafe<Partial<LeadDataQualitySettings>>(savedLeadDataQuality);
        if (rawQuality && typeof rawQuality === 'object') {
          setLeadDataQualitySettings({
            ...DEFAULT_LEAD_DATA_QUALITY_SETTINGS,
            ...rawQuality,
          });
        } else {
          setLeadDataQualitySettings(DEFAULT_LEAD_DATA_QUALITY_SETTINGS);
        }
      } else if (!isServerDataMode()) {
        setLeadDataQualitySettings(DEFAULT_LEAD_DATA_QUALITY_SETTINGS);
      }
      if (!isServerDataMode() && savedWorkflowRules) {
        const rawRules = parseSafe<Partial<WorkflowRulesSettings>>(savedWorkflowRules);
        if (rawRules && typeof rawRules === 'object') {
          setWorkflowRulesSettings({
            ...DEFAULT_WORKFLOW_RULES_SETTINGS,
            ...rawRules,
          });
        } else {
          setWorkflowRulesSettings(DEFAULT_WORKFLOW_RULES_SETTINGS);
        }
      } else if (!isServerDataMode()) {
        setWorkflowRulesSettings(DEFAULT_WORKFLOW_RULES_SETTINGS);
      }
      if (!isServerDataMode() && savedIntegrations) {
        const rawIntegrations = parseSafe<ExternalIntegrationConnection[]>(savedIntegrations);
        if (Array.isArray(rawIntegrations)) {
          const normalized = DEFAULT_INTEGRATIONS.map((base) => {
            const hit = rawIntegrations.find((x) => x?.provider === base.provider);
            return hit ? { ...base, ...hit } : base;
          });
          setIntegrations(normalized);
        } else {
          setIntegrations(DEFAULT_INTEGRATIONS);
        }
      } else if (!isServerDataMode()) {
        setIntegrations(DEFAULT_INTEGRATIONS);
      }
      if (savedPriceQuotes) {
        const rawPQ = parseSafe<PriceQuote[]>(savedPriceQuotes);
        const mergedPQ = Array.isArray(rawPQ) ? [...rawPQ] : [];
        if (!isServerDataMode()) {
          DEMO_PENDING_PRICE_QUOTES.forEach((q) => {
            if (!mergedPQ.some(x => x.id === q.id)) mergedPQ.push(q);
          });
        }
        setPriceQuotes(isServerDataMode() ? [] : mergedPQ);
      } else {
        setPriceQuotes(isServerDataMode() ? [] : [...DEMO_PENDING_PRICE_QUOTES]);
      }
      if (savedAccountingPolicy) {
        const rawPol = parseSafe<Partial<AccountingPolicy>>(savedAccountingPolicy);
        if (rawPol && typeof rawPol === 'object') {
          setAccountingPolicy({
            ...DEFAULT_ACCOUNTING_POLICY,
            ...rawPol,
            policyNotes: typeof rawPol.policyNotes === 'string' ? rawPol.policyNotes : DEFAULT_ACCOUNTING_POLICY.policyNotes,
            allowedCostCentersForQuotes:
              Array.isArray(rawPol.allowedCostCentersForQuotes) && rawPol.allowedCostCentersForQuotes.length > 0
                ? rawPol.allowedCostCentersForQuotes
                : DEFAULT_ACCOUNTING_POLICY.allowedCostCentersForQuotes,
            minAmountHighlight: typeof rawPol.minAmountHighlight === 'number' ? rawPol.minAmountHighlight : DEFAULT_ACCOUNTING_POLICY.minAmountHighlight,
          });
        }
      } else {
        setAccountingPolicy(DEFAULT_ACCOUNTING_POLICY);
      }
      if (!isServerDataMode() && savedCustodyFunds) {
        const rawCf = parseSafe<any[]>(savedCustodyFunds);
        if (Array.isArray(rawCf)) setCustodyFunds(rawCf.map(migrateCustodyFund));
      }
      if (!isServerDataMode() && savedCustodyAccountMap) {
        const rawMap = parseSafe<Partial<CustodyAccountByCategory>>(savedCustodyAccountMap);
        if (rawMap && typeof rawMap === 'object') {
          setCustodyAccountByCategory({ ...DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY, ...rawMap });
        }
      }
      if (savedManualCustomers) {
        const rawCustomers = parseSafe<any[]>(savedManualCustomers);
        if (Array.isArray(rawCustomers)) {
          setManualCustomers(
            rawCustomers
              .map((c) => ({
                id: c.id || `CUS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                customerCode: c.customerCode || buildCustomerCodeFromSeed(c.id || c.name || 'manual'),
                name: String(c.name || '').trim(),
                company: c.company ? String(c.company) : undefined,
                phone: c.phone ? String(c.phone) : undefined,
                email: c.email ? String(c.email) : undefined,
                sourceLabel: c.sourceLabel ? String(c.sourceLabel) : 'يدوي',
                createdAt: c.createdAt || new Date().toISOString(),
                createdById: c.createdById || 'unknown',
                createdByName: c.createdByName || 'مستخدم',
                createdByRole: c.createdByRole || 'محاسب',
              }))
              .filter((c) => c.name)
          );
        }
      }
      if (savedUser) {
        const parsedUser = parseSafe<any>(savedUser);
        if (parsedUser && typeof parsedUser === 'object') {
          const nu = normalizeUser(parsedUser);
          const serverAuth = hasServerAuthToken();
          if (!serverAuth && (isServerDataMode() || nu.authSource === 'database')) {
            if (!shouldPreserveUserForPendingSupabaseSession()) {
              localStorage.removeItem('prod_system_current_user');
              rehydrateUser(null);
            }
          } else if (!serverAuth) {
            rehydrateUser(nu);
          } else {
            /** مع JWT + سيرفر: JSON المحفوظ أحياناً بدون authSource → كان يمنع مزامنة Workspace لحد ما /auth/me يخلص؛ الحجوزات تفضل [] */
            rehydrateUser(
              serverAuth && isServerDataMode()
                ? normalizeUser({ ...parsedUser, authSource: 'database' })
                : nu,
            );
          }
        } else if (!shouldPreserveUserForPendingSupabaseSession()) rehydrateUser(null);
      } else if (!shouldPreserveUserForPendingSupabaseSession()) rehydrateUser(null);
    } else if (isServerDataMode()) {
      setLeads([]);
      setUsers([]);
      setManualCustomers([]);
      setInvoices([]);
      setExpenses([]);
      setPriceQuotes([]);
      setMonthlyTargets(DEFAULT_TARGETS);
      setAuditEvents([]);
      setClosedMonths([]);
      setChartOfAccounts(DEFAULT_CHART_OF_ACCOUNTS);
      setManualJournalEntries([]);
      setClosedFiscalYears([]);
      setOpeningBalancesByYear({});
      setPayrollApprovals([]);
      setPayrollApprovalRequests([]);
      setFinancialReopenRequests([]);
      setShootBookings([]);
      setEquipmentBookings([]);
      setMeetingBookings([]);
      setOtherBookings([]);
      setEquipmentItems(DEFAULT_EQUIPMENT_ITEMS);
      setPrintBrandingSettings(DEFAULT_PRINT_BRANDING);
      setLeadIngestionSettings(DEFAULT_LEAD_INGESTION_SETTINGS);
      setSlaEscalationSettings(DEFAULT_SLA_ESCALATION_SETTINGS);
      setLeadDataQualitySettings(DEFAULT_LEAD_DATA_QUALITY_SETTINGS);
      setWorkflowRulesSettings(DEFAULT_WORKFLOW_RULES_SETTINGS);
      setIntegrations(DEFAULT_INTEGRATIONS);
      setAccountingPolicy(DEFAULT_ACCOUNTING_POLICY);
      setCustodyFunds([]);
      setCustodyAccountByCategory(DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY);
      setAttendanceRecords([]);
      if (!shouldPreserveUserForPendingSupabaseSession()) rehydrateUser(null);
    } else {
      const initialLeads: Lead[] = [
        {
          id: 'l1',
          name: 'علي حسن',
          company: 'شركة النور للإنتاج',
          phone: '01012345678',
          email: 'ali@example.com',
          status: 'جديد',
          budget: 50000,
          companySize: 'كبير',
          source: 'فيسبوك',
          category: 'شركات كبرى',
          score: 85,
          createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
          updatedAt: new Date().toISOString(),
          slaStatus: 'مستقر',
          timeline: [
            { id: 'a1', leadId: 'l1', action: 'إضافة الليد', userId: 'u2', userName: 'سارة', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString() }
          ]
        },
        {
          id: 'l2',
          name: 'منى أحمد',
          company: 'مؤسسة الإبداع',
          phone: '01122334455',
          email: 'mona@example.com',
          status: 'قيد التواصل',
          assignedTo: 'u3',
          budget: 15000,
          companySize: 'متوسط',
          source: 'لينكد إن',
          category: 'إنجليزي',
          score: 60,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
          slaStatus: 'متأخر',
          timeline: [
            { id: 'a2', leadId: 'l2', action: 'إضافة الليد', userId: 'u2', userName: 'سارة', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
            { id: 'a3', leadId: 'l2', action: 'تعيين المندوب محمد', userId: 'u2', userName: 'سارة', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString() }
          ]
        },
        {
          id: 'l3',
          name: 'أحمد سعيد',
          company: 'جلوبال أدز',
          phone: '01556677889',
          email: 'ahmed@global.com',
          status: 'مغلق - فوز',
          assignedTo: 'u3',
          budget: 45000,
          companySize: 'كبير',
          source: 'موقع الشركة',
          category: 'إعلانات',
          score: 95,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
          updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
          slaStatus: 'مستقر',
          timeline: []
        },
        {
          id: 'l4',
          name: 'سارة محمود',
          company: 'بوتيك شوب',
          phone: '01099887766',
          email: 'sara@shop.com',
          status: 'عرض سعر',
          assignedTo: 'u4',
          budget: 8000,
          companySize: 'صغير',
          source: 'سوشيال ميديا',
          category: 'سوشيال ميديا',
          score: 40,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
          updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(),
          slaStatus: 'مستقر',
          timeline: []
        }
      ];

      const initialInvoices: Invoice[] = [
        { id: 'inv1', leadId: 'l3', customerName: 'أحمد سعيد', amount: 45000, vatRate: 14, vatAmount: 6300, totalAmount: 51300, costCenter: 'إعلانات', status: 'مدفوع', date: new Date().toISOString() },
        { id: 'inv2', leadId: 'l1', customerName: 'علي حسن', amount: 50000, vatRate: 14, vatAmount: 7000, totalAmount: 57000, costCenter: 'سوشيال ميديا', status: 'قيد الانتظار', date: new Date().toISOString() },
        { id: 'inv3', leadId: 'l4', customerName: 'سارة محمود', amount: 8000, vatRate: 14, vatAmount: 1120, totalAmount: 9120, costCenter: 'تصوير', status: 'مدفوع', date: new Date(Date.now() - 86400000).toISOString() }
      ];
      const initialExpenses: Expense[] = [
        { id: 'exp1', title: 'إيجار الاستوديو', category: 'إيجارات', amount: 12000, vatRate: 14, vatAmount: 1680, totalAmount: 13680, costCenter: 'تصوير', status: 'مدفوع', approvalStatus: 'معتمد', approvedBy: 'أحمد المالك', vendor: 'Studio Rent', date: new Date().toISOString() },
        { id: 'exp2', title: 'حملة إعلانية', category: 'تسويق', amount: 7000, vatRate: 14, vatAmount: 980, totalAmount: 7980, costCenter: 'إعلانات', status: 'قيد الانتظار', approvalStatus: 'قيد الاعتماد', vendor: 'Meta Ads', date: new Date(Date.now() - 86400000).toISOString() },
        { id: 'exp3', title: 'صيانة كاميرات', category: 'معدات', amount: 5000, vatRate: 14, vatAmount: 700, totalAmount: 5700, costCenter: 'تصوير', status: 'مدفوع', approvalStatus: 'معتمد', approvedBy: 'أحمد المالك', vendor: 'Gear Pro', date: new Date(Date.now() - 172800000).toISOString() }
      ];
      const seededLeads = [...initialLeads, ...DEMO_EXTRA_LEADS];
      const seededLeadsWithCodes = seededLeads.map((l) => ({ ...l, customerCode: l.customerCode || buildCustomerCodeFromSeed(l.id || l.name) }));
      const seededInvoices = [...initialInvoices, ...DEMO_EXTRA_INVOICES];
      const seededExpenses = [...initialExpenses, ...DEMO_EXTRA_EXPENSES];

      setLeads(seededLeadsWithCodes);
      setUsers(INITIAL_USERS);
      setManualCustomers([]);
      setInvoices(seededInvoices);
      setExpenses(seededExpenses);
      if (!shouldPreserveUserForPendingSupabaseSession()) rehydrateUser(null);
      setMonthlyTargets(DEFAULT_TARGETS);
      setAuditEvents(DEMO_AUDIT_EVENTS);
      setClosedMonths([]);
      setChartOfAccounts(DEFAULT_CHART_OF_ACCOUNTS);
      setManualJournalEntries(DEMO_MANUAL_JOURNALS);
      setClosedFiscalYears([]);
      setOpeningBalancesByYear({});
      setPayrollApprovals([]);
      setShootBookings([]);
      setEquipmentBookings([]);
      setMeetingBookings([]);
      setOtherBookings([]);
      setEquipmentItems(DEFAULT_EQUIPMENT_ITEMS);
      setPrintBrandingSettings(DEFAULT_PRINT_BRANDING);
      setLeadIngestionSettings(DEFAULT_LEAD_INGESTION_SETTINGS);
      setSlaEscalationSettings(DEFAULT_SLA_ESCALATION_SETTINGS);
      setLeadDataQualitySettings(DEFAULT_LEAD_DATA_QUALITY_SETTINGS);
      setWorkflowRulesSettings(DEFAULT_WORKFLOW_RULES_SETTINGS);
      setIntegrations(DEFAULT_INTEGRATIONS);
      setAttendanceRecords([
        { id: 'att1', repId: 'u3', type: 'in', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString() },
        { id: 'att2', repId: 'u3', type: 'out', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString() },
        { id: 'att3', repId: 'u4', type: 'in', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8.5).toISOString() },
      ]);
      localStorage.setItem('prod_system_leads', JSON.stringify(seededLeadsWithCodes));
      localStorage.setItem('prod_system_users', JSON.stringify(INITIAL_USERS));
      localStorage.setItem('prod_system_invoices', JSON.stringify(seededInvoices));
      localStorage.setItem('prod_system_expenses', JSON.stringify(seededExpenses));
      localStorage.setItem('prod_system_closed_months', JSON.stringify([]));
      if (!shouldPreserveUserForPendingSupabaseSession()) localStorage.removeItem('prod_system_current_user');
      localStorage.setItem('prod_system_targets', JSON.stringify(DEFAULT_TARGETS));
      localStorage.setItem('prod_system_audit', JSON.stringify(DEMO_AUDIT_EVENTS));
      localStorage.setItem('prod_system_chart_of_accounts', JSON.stringify(DEFAULT_CHART_OF_ACCOUNTS));
      localStorage.setItem('prod_system_manual_journals', JSON.stringify(DEMO_MANUAL_JOURNALS));
      localStorage.setItem('prod_system_closed_fiscal_years', JSON.stringify([]));
      localStorage.setItem('prod_system_opening_balances_by_year', JSON.stringify({}));
      localStorage.setItem('prod_system_payroll_approvals', JSON.stringify([]));
      localStorage.setItem('prod_system_payroll_approval_requests', JSON.stringify([]));
      localStorage.setItem('prod_system_financial_reopen_requests', JSON.stringify([]));
      localStorage.setItem('prod_system_shoot_bookings', JSON.stringify([]));
      localStorage.setItem('prod_system_equipment_bookings', JSON.stringify([]));
      localStorage.setItem('prod_system_other_bookings', JSON.stringify([]));
      localStorage.setItem('prod_system_equipment_items', JSON.stringify(DEFAULT_EQUIPMENT_ITEMS));
      localStorage.setItem('prod_system_print_branding', JSON.stringify(DEFAULT_PRINT_BRANDING));
      localStorage.setItem('prod_system_lead_ingestion_settings', JSON.stringify(DEFAULT_LEAD_INGESTION_SETTINGS));
      localStorage.setItem('prod_system_sla_escalation_settings', JSON.stringify(DEFAULT_SLA_ESCALATION_SETTINGS));
      localStorage.setItem('prod_system_lead_data_quality_settings', JSON.stringify(DEFAULT_LEAD_DATA_QUALITY_SETTINGS));
      localStorage.setItem('prod_system_workflow_rules_settings', JSON.stringify(DEFAULT_WORKFLOW_RULES_SETTINGS));
      localStorage.setItem('prod_system_external_integrations', JSON.stringify(DEFAULT_INTEGRATIONS));
      localStorage.setItem('prod_system_price_quotes', JSON.stringify(DEMO_PENDING_PRICE_QUOTES));
      localStorage.setItem('prod_system_accounting_policy', JSON.stringify(DEFAULT_ACCOUNTING_POLICY));
      setPriceQuotes([...DEMO_PENDING_PRICE_QUOTES]);
      setAccountingPolicy(DEFAULT_ACCOUNTING_POLICY);
      setCustodyFunds([]);
      setCustodyAccountByCategory(DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY);
      localStorage.setItem('prod_system_custody_funds', JSON.stringify([]));
      localStorage.setItem('prod_system_custody_account_map', JSON.stringify(DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY));
      localStorage.setItem('prod_system_manual_customers', JSON.stringify([]));
      localStorage.setItem('prod_system_attendance_records', JSON.stringify([
        { id: 'att1', repId: 'u3', type: 'in', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString() },
        { id: 'att2', repId: 'u3', type: 'out', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString() },
        { id: 'att3', repId: 'u4', type: 'in', source: 'machine', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8.5).toISOString() },
      ]));
    }
  }, []);

  /** استعادة جلسة: JWT + /auth/me أو Supabase Auth + صف users */
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem('prod_system_force_logout_next') === '1') {
        window.sessionStorage.removeItem('prod_system_force_logout_next');
        localStorage.removeItem('prod_system_jwt');
        localStorage.removeItem('prod_system_current_user');
        localStorage.removeItem('prod_system_supabase');
        clearSupabasePersistedAuthFromLocalStorage();
        return;
      }
    } catch {
      /* ignore */
    }

    if (isSupabaseDirectMode()) {
      return;
    }

    const token = localStorage.getItem('prod_system_jwt');
    if (!token) return;
    let cancelled = false;
    const epochAtStart = authBootstrapEpochRef.current;
    const ac = new AbortController();
    authMeAbortRef.current = ac;
    const base = getApiBaseUrl();
    fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('auth'))))
      .then((data) => {
        if (cancelled || epochAtStart !== authBootstrapEpochRef.current) return;
        if (!localStorage.getItem('prod_system_jwt') || !data?.user) return;
        rehydrateUser(
          normalizeUser({ ...data.user, authSource: 'database' })
        );
      })
      .catch((err: unknown) => {
        if (cancelled || epochAtStart !== authBootstrapEpochRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err && typeof err === 'object' && (err as Error).name === 'AbortError') return;
        localStorage.removeItem('prod_system_jwt');
        localStorage.removeItem('prod_system_current_user');
        rehydrateUser(null);
      })
      .finally(() => {
        if (authMeAbortRef.current === ac) authMeAbortRef.current = null;
      });
    return () => {
      cancelled = true;
      ac.abort();
      if (authMeAbortRef.current === ac) authMeAbortRef.current = null;
    };
  }, []);

  /** يمنع تطبيق Workspace قديم بعد إعادة تشغيل التأثير (Strict Mode أو تغيير المستخدم). */
  const workspaceApplyEpochRef = useRef(0);
  /** جلب الحجوزات مع أول تشغيل — لا ينتظر currentUser لتفادي بقاء القائمة [] بعد الرفريش. */
  const bookingBootstrapEpochRef = useRef(0);

  const loadServerWorkspaceImplRef = useRef<() => Promise<boolean>>(async () => false);

  loadServerWorkspaceImplRef.current = async (): Promise<boolean> => {
    workspaceApplyEpochRef.current += 1;
    const epoch = workspaceApplyEpochRef.current;
    try {
        let leadsList: Lead[];
        let rawUsers: User[];
        let customers: ManualCustomer[];
        let invs: Invoice[];
        let exps: Expense[];
        let quotes: PriceQuote[];
        let pol: AccountingPolicy | null;
        let journals: ManualJournalEntry[];
        let closedM: string[];
        let targets: MonthlyTarget[];
        let custodyMap: Record<string, string> | null;
        let auditList: AuditEvent[];
        let custodyList: unknown[];
        let shootList: ShootBooking[] | undefined;
        let equipList: EquipmentBooking[] | undefined;
        let meetList: MeetingBooking[] | undefined;
        let workspaceDoc: Record<string, unknown>;
        let attendanceRec: AttendanceRecord[];

        if (isSupabaseDirectMode()) {
          const snapRaw = await fetchSupabaseWorkspaceSnapshot();
          const snap = currentUser
            ? filterWorkspaceSnapshotForViewer(snapRaw, {
                id: currentUser.id,
                role: currentUser.role,
              })
            : snapRaw;
          leadsList = snap.leadsList;
          rawUsers = snap.rawUsers;
          customers = snap.customers;
          invs = snap.invsRaw.map((raw) => normalizeInvoice(raw));
          exps = snap.exps;
          quotes = snap.quotes;
          pol = snap.pol;
          journals = snap.journals;
          closedM = snap.closedM;
          targets = snap.targets;
          custodyMap = snap.custodyMap;
          auditList = snap.auditList;
          custodyList = snap.custodyList;
          shootList = snap.shootList.length > 0 ? snap.shootList : undefined;
          equipList = snap.equipList.length > 0 ? snap.equipList : undefined;
          meetList = snap.meetList.length > 0 ? snap.meetList : undefined;
          workspaceDoc = snap.workspaceDoc;
          attendanceRec = snap.attendanceRec;
        } else {
          const tuple = await Promise.all([
            /** خطأ ليدز أو مستخدمين كان يُلغي المزامنة كلها → الحجوزات تظل [] بعد الريفريش رغم أن GET الحجوزات يعمل */
            fetchLeadsApi().catch(() => []),
            fetchUsersApi().catch(() => []),
            fetchManualCustomersApi().catch(() => []),
            fetchInvoicesApi().catch(() => []),
            fetchExpensesApi().catch(() => []),
            fetchPriceQuotesApi().catch(() => []),
            fetchAccountingPolicyApi().catch(() => null),
            fetchManualJournalsApi().catch(() => []),
            fetchClosedMonthsApi().catch(() => []),
            fetchMonthlyTargetsApi().catch(() => []),
            fetchCustodySettingsApi().catch(() => null),
            fetchAuditEventsApi().catch(() => []),
            fetchCustodyFundsApi().catch(() => []),
            fetchWorkspaceBookingSlice(fetchShootBookingsApi()),
            fetchWorkspaceBookingSlice(fetchEquipmentBookingsApi()),
            fetchWorkspaceBookingSlice(fetchMeetingBookingsApi()),
            fetchWorkspaceStateApi().catch(() => ({})),
            fetchAttendanceRecordsApi().catch(() => []),
          ]);
          leadsList = tuple[0];
          rawUsers = tuple[1];
          customers = tuple[2];
          invs = tuple[3];
          exps = tuple[4];
          quotes = tuple[5];
          pol = tuple[6];
          journals = tuple[7];
          closedM = tuple[8];
          targets = tuple[9];
          custodyMap = tuple[10];
          auditList = tuple[11];
          custodyList = tuple[12];
          shootList = tuple[13];
          equipList = tuple[14];
          meetList = tuple[15];
          workspaceDoc = tuple[16] as Record<string, unknown>;
          attendanceRec = tuple[17];
        }
        if (epoch !== workspaceApplyEpochRef.current) return false;
        setLeads((prev) => mergeLeadsFromServer(prev, leadsList));
        setUsers(rawUsers.map((u) => normalizeUser({ ...u, authSource: 'database' })));
        setManualCustomers(customers);
        setInvoices(invs.map(normalizeInvoice));
        setExpenses(exps);
        setPriceQuotes(Array.isArray(quotes) ? quotes : []);
        if (pol && typeof pol === 'object') {
          setAccountingPolicy({
            ...DEFAULT_ACCOUNTING_POLICY,
            ...pol,
            // if DB has an empty list use the default (empty list means "not configured yet")
            allowedCostCentersForQuotes:
              Array.isArray(pol.allowedCostCentersForQuotes) && pol.allowedCostCentersForQuotes.length > 0
                ? pol.allowedCostCentersForQuotes
                : DEFAULT_ACCOUNTING_POLICY.allowedCostCentersForQuotes,
          });
        }
        setManualJournalEntries(Array.isArray(journals) ? journals : []);
        setClosedMonths(Array.isArray(closedM) ? closedM : []);
        const mt = Array.isArray(targets) ? targets : [];
        setMonthlyTargets(mt.length > 0 ? mt : DEFAULT_TARGETS);
        if (custodyMap && typeof custodyMap === 'object') {
          setCustodyAccountByCategory((prev) => ({
            ...DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY,
            ...prev,
            ...custodyMap,
          }));
        }
        setAuditEvents(Array.isArray(auditList) ? auditList : []);
        if (Array.isArray(custodyList)) {
          setCustodyFunds(custodyList.map(migrateCustodyFund));
        }
        if (
          currentUser &&
          ['مالك', 'محاسب', 'مدير إنتاج'].includes(currentUser.role)
        ) {
          try {
            const freshCustody = await fetchCustodyFundsApi();
            if (epoch === workspaceApplyEpochRef.current && Array.isArray(freshCustody)) {
              setCustodyFunds(freshCustody.map(migrateCustodyFund));
            }
          } catch (e) {
            console.warn('[custody] dedicated fetch failed', e);
          }
        }
        if (shootList !== undefined) {
          const uid = bookingMirrorUidRef.current;
          const filteredShootList = shootList.filter((b) => !deletedShootIdsRef.current.has(b.id));
          // clean up IDs the server no longer returns (delete confirmed)
          const shootServerIds = new Set(shootList.map((b) => b.id));
          [...deletedShootIdsRef.current].filter((id) => !shootServerIds.has(id)).forEach((id) => purgeDeletedId(LS_DEL_SHOOT, deletedShootIdsRef, id));
          setShootBookings((prev) => {
            let next: ShootBooking[];
            if (filteredShootList.length > 0) {
              next = filteredShootList;
            } else if (prev.length > 0) {
              next = prev.filter((b) => !deletedShootIdsRef.current.has(b.id));
            } else {
              const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT);
              const bkFiltered = bk ? (bk as ShootBooking[]).filter((b) => !deletedShootIdsRef.current.has(b.id)) : null;
              if (bkFiltered !== null && bkFiltered.length > 0) next = bkFiltered;
              else {
                const lm = readLocalBookingMirror(uid);
                const ls = lm?.shoot;
                const lsFiltered = Array.isArray(ls) ? (ls as ShootBooking[]).filter((b) => !deletedShootIdsRef.current.has(b.id)) : [];
                next = lsFiltered.length > 0 ? lsFiltered : filteredShootList;
              }
            }
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, next);
            if (next.length > 0) persistLocalBookingMirror(uid, { shoot: next });
            return next;
          });
        } else {
          const uid = bookingMirrorUidRef.current;
          const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT);
          const bkFiltered = bk ? (bk as ShootBooking[]).filter((b) => !deletedShootIdsRef.current.has(b.id)) : null;
          const lm = readLocalBookingMirror(uid)?.shoot;
          const fromLs = Array.isArray(lm) ? (lm as ShootBooking[]).filter((b) => !deletedShootIdsRef.current.has(b.id)) : null;
          if (bkFiltered !== null && bkFiltered.length > 0) {
            setShootBookings(bkFiltered);
          } else if (fromLs && fromLs.length > 0) {
            setShootBookings(fromLs);
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, fromLs);
          }
        }
        if (equipList !== undefined) {
          const uid = bookingMirrorUidRef.current;
          const filteredEquipList = equipList.filter((b) => !deletedEquipIdsRef.current.has(b.id));
          const equipServerIds = new Set(equipList.map((b) => b.id));
          [...deletedEquipIdsRef.current].filter((id) => !equipServerIds.has(id)).forEach((id) => purgeDeletedId(LS_DEL_EQUIP, deletedEquipIdsRef, id));
          setEquipmentBookings((prev) => {
            let next: EquipmentBooking[];
            if (filteredEquipList.length > 0) {
              next = filteredEquipList;
            } else if (prev.length > 0) {
              next = prev.filter((b) => !deletedEquipIdsRef.current.has(b.id));
            } else {
              const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP);
              const bkFiltered = bk ? (bk as EquipmentBooking[]).filter((b) => !deletedEquipIdsRef.current.has(b.id)) : null;
              if (bkFiltered !== null && bkFiltered.length > 0) next = bkFiltered;
              else {
                const lm = readLocalBookingMirror(uid)?.equip;
                const lsFiltered = Array.isArray(lm) ? (lm as EquipmentBooking[]).filter((b) => !deletedEquipIdsRef.current.has(b.id)) : [];
                next = lsFiltered.length > 0 ? lsFiltered : filteredEquipList;
              }
            }
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, next);
            if (next.length > 0) persistLocalBookingMirror(uid, { equip: next });
            return next;
          });
        } else {
          const uid = bookingMirrorUidRef.current;
          const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP);
          const bkFiltered = bk ? (bk as EquipmentBooking[]).filter((b) => !deletedEquipIdsRef.current.has(b.id)) : null;
          const lm = readLocalBookingMirror(uid)?.equip;
          const fromLs = Array.isArray(lm) ? (lm as EquipmentBooking[]).filter((b) => !deletedEquipIdsRef.current.has(b.id)) : null;
          if (bkFiltered !== null && bkFiltered.length > 0) {
            setEquipmentBookings(bkFiltered);
          } else if (fromLs && fromLs.length > 0) {
            setEquipmentBookings(fromLs);
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, fromLs);
          }
        }
        if (meetList !== undefined) {
          const filteredMeetList = meetList.filter((b) => !deletedMeetIdsRef.current.has(b.id));
          const meetServerIds = new Set(meetList.map((b) => b.id));
          [...deletedMeetIdsRef.current].filter((id) => !meetServerIds.has(id)).forEach((id) => purgeDeletedId(LS_DEL_MEET, deletedMeetIdsRef, id));
          const normalizedMeetings = filteredMeetList.map(normalizeMeetingBooking);
          const uid = bookingMirrorUidRef.current;
          setMeetingBookings((prev) => {
            let nextNormalized: MeetingBooking[];
            if (normalizedMeetings.length > 0) {
              nextNormalized = normalizedMeetings;
            } else if (prev.length > 0) {
              nextNormalized = prev.filter((b) => !deletedMeetIdsRef.current.has(b.id));
            } else {
              const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET);
              const bkFiltered = bk ? (bk as MeetingBooking[]).filter((b) => !deletedMeetIdsRef.current.has(b.id)) : null;
              if (bkFiltered !== null && bkFiltered.length > 0) nextNormalized = bkFiltered.map(normalizeMeetingBooking);
              else {
                const lm = readLocalBookingMirror(uid)?.meet;
                const lsFiltered = Array.isArray(lm) ? (lm as MeetingBooking[]).filter((b) => !deletedMeetIdsRef.current.has(b.id)) : [];
                nextNormalized = lsFiltered.length > 0 ? lsFiltered.map(normalizeMeetingBooking) : normalizedMeetings;
              }
            }
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, nextNormalized);
            if (nextNormalized.length > 0) persistLocalBookingMirror(uid, { meet: nextNormalized });
            return nextNormalized;
          });
        } else {
          const uid = bookingMirrorUidRef.current;
          const bk = readSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET);
          const bkFiltered = bk ? (bk as MeetingBooking[]).filter((b) => !deletedMeetIdsRef.current.has(b.id)) : null;
          const lm = readLocalBookingMirror(uid)?.meet;
          const fromLsRaw = Array.isArray(lm) ? (lm as MeetingBooking[]).filter((b) => !deletedMeetIdsRef.current.has(b.id)) : null;
          const fromLs = fromLsRaw && fromLsRaw.length > 0 ? fromLsRaw.map(normalizeMeetingBooking) : null;
          if (bkFiltered !== null && bkFiltered.length > 0) {
            setMeetingBookings((bkFiltered as MeetingBooking[]).map(normalizeMeetingBooking));
          } else if (fromLs) {
            setMeetingBookings(fromLs);
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, fromLs);
          }
        }

        const ws = workspaceDoc && typeof workspaceDoc === 'object' ? (workspaceDoc as Record<string, unknown>) : {};
        if (Array.isArray(ws.otherBookings)) {
          setOtherBookings(normalizeOtherBookings(ws.otherBookings));
        } else {
          setOtherBookings([]);
        }
        if (Object.keys(ws).length > 0) {
          if (ws.chartOfAccounts !== undefined) {
            const fromServer = normalizeChartOfAccounts(ws.chartOfAccounts);
            const cached = readCachedChartOfAccounts();
            setChartOfAccounts((prev) => {
              const merged = mergeChartOfAccountsLists(fromServer, prev, cached);
              const base = merged.length > 0 ? merged : DEFAULT_CHART_OF_ACCOUNTS;
              return ensureCustodyAccountInChart(base);
            });
          }
          if (Array.isArray(ws.closedFiscalYears)) setClosedFiscalYears(ws.closedFiscalYears as string[]);
          if (ws.openingBalancesByYear && typeof ws.openingBalancesByYear === 'object') {
            setOpeningBalancesByYear(ws.openingBalancesByYear as Record<string, { accountCode: string; balance: number }[]>);
          }
          if (Array.isArray(ws.payrollApprovals)) setPayrollApprovals(ws.payrollApprovals as PayrollApproval[]);
          if (Array.isArray(ws.payrollApprovalRequests)) {
            setPayrollApprovalRequests(ws.payrollApprovalRequests as PayrollApprovalRequest[]);
          }
          if (Array.isArray(ws.payrollSalesDiscounts)) {
            setPayrollSalesDiscounts(
              (ws.payrollSalesDiscounts as PayrollSalesDiscount[]).slice(0, 500),
            );
          }
          if (Array.isArray(ws.financialReopenRequests)) {
            setFinancialReopenRequests(ws.financialReopenRequests as FinancialPeriodReopenRequest[]);
          }
          const eq = ws.equipmentItems;
          if (Array.isArray(eq) && eq.length > 0) setEquipmentItems(eq as EquipmentItem[]);
          if (ws.printBranding && typeof ws.printBranding === 'object') {
            setPrintBrandingSettings({ ...DEFAULT_PRINT_BRANDING, ...(ws.printBranding as object) } as PrintBrandingSettings);
          }
          if (ws.leadIngestion && typeof ws.leadIngestion === 'object') {
            const rawIngestion = ws.leadIngestion as Partial<LeadIngestionSettings>;
            setLeadIngestionSettings({
              autoRouteToManager: typeof rawIngestion.autoRouteToManager === 'boolean'
                ? rawIngestion.autoRouteToManager
                : DEFAULT_LEAD_INGESTION_SETTINGS.autoRouteToManager,
              managerUserId: typeof rawIngestion.managerUserId === 'string'
                ? rawIngestion.managerUserId
                : DEFAULT_LEAD_INGESTION_SETTINGS.managerUserId,
              clientNotifyWebhookUrl:
                typeof rawIngestion.clientNotifyWebhookUrl === 'string'
                  ? rawIngestion.clientNotifyWebhookUrl
                  : DEFAULT_LEAD_INGESTION_SETTINGS.clientNotifyWebhookUrl,
              facebook: { ...DEFAULT_LEAD_INGESTION_SETTINGS.facebook, ...(rawIngestion.facebook || {}) },
              linkedin: { ...DEFAULT_LEAD_INGESTION_SETTINGS.linkedin, ...(rawIngestion.linkedin || {}) },
              google: { ...DEFAULT_LEAD_INGESTION_SETTINGS.google, ...(rawIngestion.google || {}) },
              email: { ...DEFAULT_LEAD_INGESTION_SETTINGS.email, ...(rawIngestion.email || {}) },
            });
          }
          if (ws.slaEscalation && typeof ws.slaEscalation === 'object') {
            const rawSla = ws.slaEscalation as Partial<SlaEscalationSettings>;
            setSlaEscalationSettings({
              warningAfterMinutes: Math.max(5, Number(rawSla.warningAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.warningAfterMinutes),
              criticalAfterMinutes: Math.max(10, Number(rawSla.criticalAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.criticalAfterMinutes),
              autoReassignAfterHours: Math.max(0, Number(rawSla.autoReassignAfterHours) || DEFAULT_SLA_ESCALATION_SETTINGS.autoReassignAfterHours),
            });
          }
          if (ws.leadDataQuality && typeof ws.leadDataQuality === 'object') {
            setLeadDataQualitySettings({
              ...DEFAULT_LEAD_DATA_QUALITY_SETTINGS,
              ...(ws.leadDataQuality as object),
            });
          }
          if (ws.workflowRules && typeof ws.workflowRules === 'object') {
            setWorkflowRulesSettings({
              ...DEFAULT_WORKFLOW_RULES_SETTINGS,
              ...(ws.workflowRules as object),
            });
          }
          if (Array.isArray(ws.integrations)) {
            const rawIntegrations = ws.integrations as ExternalIntegrationConnection[];
            const normalized = DEFAULT_INTEGRATIONS.map((base) => {
              const hit = rawIntegrations.find((x) => x?.provider === base.provider);
              return hit ? { ...base, ...hit } : base;
            });
            setIntegrations(normalized);
          }
          if (ws.journalCodebook !== undefined) {
            const fromServer = normalizeJournalCodingRulesFromArray(ws.journalCodebook);
            const cached = readCachedJournalCodebook();
            setJournalCodingRulesState((prev) => mergeJournalCodingRulesLists(fromServer, prev, cached));
          }
          if (ws.expenseCodebook !== undefined) {
            setExpenseCodingRulesState(mergeExpenseCodingRulesFromArray(ws.expenseCodebook));
          }
          if (typeof ws.customerCodePrefix === 'string' && ws.customerCodePrefix.trim()) {
            const p = ws.customerCodePrefix.trim().replace(/\s+/g, '') || 'CUS';
            setCustomerCodePrefixState(p);
            customerCodePrefixRef.current = p;
          }
          if (Array.isArray(ws.expenseSavedViews)) {
            setExpenseSavedViewsState(normalizeExpenseSavedViews(ws.expenseSavedViews));
          }
          if (ws.payrollAutoSendDay !== undefined) {
            if (ws.payrollAutoSendDay === null) setPayrollAutoSendDayState('');
            else {
              const d = Math.floor(Number(ws.payrollAutoSendDay));
              if (Number.isFinite(d) && d >= 1 && d <= 28) setPayrollAutoSendDayState(d);
              else setPayrollAutoSendDayState('');
            }
          }
          if (ws.entityComments !== undefined && ws.entityComments !== null && typeof ws.entityComments === 'object') {
            setEntityCommentsState(normalizeEntityComments(ws.entityComments));
          }
          if (ws.expenseEscalations !== undefined && ws.expenseEscalations !== null && typeof ws.expenseEscalations === 'object') {
            setExpenseEscalationsState(normalizeExpenseEscalations(ws.expenseEscalations));
          }
          if (ws.uiVisualMode === 'classic' || ws.uiVisualMode === 'premium') {
            setUiVisualModeState(ws.uiVisualMode);
          }
          if (ws.personalTodosByUserId !== undefined && ws.personalTodosByUserId !== null && typeof ws.personalTodosByUserId === 'object') {
            setPersonalTodosByUserIdState((prevMap) =>
              mergePersonalTodosByUserId(prevMap, ws.personalTodosByUserId),
            );
          }
          if (
            ws.notifyForegroundByUserId !== undefined &&
            ws.notifyForegroundByUserId !== null &&
            typeof ws.notifyForegroundByUserId === 'object'
          ) {
            setNotifyForegroundByUserIdState(normalizeNotifyForegroundByUserId(ws.notifyForegroundByUserId));
          }
        }
        const att = Array.isArray(attendanceRec) ? attendanceRec : [];
        if (att.length > 0) setAttendanceRecords(att);
        if (
          (currentUser?.role === 'مالك' || currentUser?.role === 'محاسب') &&
          Object.keys(ws).length > 0
        ) {
          const wsChart =
            ws.chartOfAccounts !== undefined ? normalizeChartOfAccounts(ws.chartOfAccounts) : [];
          const wsJournal =
            ws.journalCodebook !== undefined
              ? normalizeJournalCodingRulesFromArray(ws.journalCodebook)
              : [];
          const mergedChart = mergeChartOfAccountsLists(wsChart, readCachedChartOfAccounts());
          const mergedJournal = mergeJournalCodingRulesLists(wsJournal, readCachedJournalCodebook());
          const patch: Record<string, unknown> = {};
          if (mergedChart.length > wsChart.length) patch.chartOfAccounts = mergedChart;
          if (mergedJournal.length > wsJournal.length) patch.journalCodebook = mergedJournal;
          if (Object.keys(patch).length > 0) {
            void patchWorkspaceStateApi(patch).catch(() => {});
          }
        }
        return true;
      } catch {
        return false;
      }
  };

  /** جلب الحجوزات فوراً — بعد دخول SPA لازم يتشغّل تاني (مش deps فاضية)، وإلا أوّل تشغيل بس يحصل ومفيش JWT. */
  useEffect(() => {
    if (!isServerDataMode()) return;
    if (isSupabaseDirectMode()) return;
    if (!hasServerAuthToken()) return;
    if (!currentUser?.id) return;
    bookingBootstrapEpochRef.current += 1;
    const epoch = bookingBootstrapEpochRef.current;
    void (async () => {
      try {
        const [s, e, m] = await Promise.all([
          fetchWorkspaceBookingSlice(fetchShootBookingsApi()),
          fetchWorkspaceBookingSlice(fetchEquipmentBookingsApi()),
          fetchWorkspaceBookingSlice(fetchMeetingBookingsApi()),
        ]);
        if (epoch !== bookingBootstrapEpochRef.current) return;
        const uidBk = bookingMirrorUidRef.current ?? undefined;
        if (s !== undefined && s.length > 0) {
          const loadedShoot = s as ShootBooking[];
          setShootBookings((prev) => {
            if (epoch !== bookingBootstrapEpochRef.current) return prev;
            const next = loadedShoot.length >= prev.length || prev.length === 0 ? loadedShoot : prev;
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, next);
            if (next.length > 0) persistLocalBookingMirror(uidBk, { shoot: next });
            return next;
          });
        }
        if (e !== undefined && e.length > 0) {
          const loadedEquip = e as EquipmentBooking[];
          setEquipmentBookings((prev) => {
            if (epoch !== bookingBootstrapEpochRef.current) return prev;
            const next = loadedEquip.length >= prev.length || prev.length === 0 ? loadedEquip : prev;
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, next);
            if (next.length > 0) persistLocalBookingMirror(uidBk, { equip: next });
            return next;
          });
        }
        if (m !== undefined && m.length > 0) {
          const norm = m.map(normalizeMeetingBooking);
          setMeetingBookings((prev) => {
            if (epoch !== bookingBootstrapEpochRef.current) return prev;
            const next = norm.length >= prev.length || prev.length === 0 ? norm : prev;
            persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, next);
            if (next.length > 0) persistLocalBookingMirror(uidBk, { meet: next });
            return next;
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      bookingBootstrapEpochRef.current += 1;
    };
  }, [currentUser?.id]);

  /** مزامنة من API عند وضع السيرفر */
  useEffect(() => {
    if (!isServerDataMode()) return;
    if (currentUser?.authSource !== 'database') return;
    if (!hasServerAuthToken()) return;
    void loadServerWorkspaceImplRef.current();
    return () => {
      workspaceApplyEpochRef.current += 1;
    };
  }, [currentUser?.id, currentUser?.authSource]);

  useEffect(() => {
    writeAccountingCache(chartOfAccounts, journalCodingRules);
  }, [chartOfAccounts, journalCodingRules]);

  /** إن تعثّرت المزامنة الأولى أو رجعت حجوزات=[] بالغلط، جرّب جلب الحجوزات بعد لحظة دون لهث الـWorkspace كله */
  useEffect(() => {
    if (!isServerDataMode()) return;
    if (isSupabaseDirectMode()) return;
    if (!hasServerAuthToken()) return;
    if (!currentUser?.id) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const [s, e, m] = await Promise.all([
            fetchWorkspaceBookingSlice(fetchShootBookingsApi()),
            fetchWorkspaceBookingSlice(fetchEquipmentBookingsApi()),
            fetchWorkspaceBookingSlice(fetchMeetingBookingsApi()),
          ]);
          if (!alive) return;
          const uidBk = bookingMirrorUidRef.current ?? undefined;
          if (s !== undefined && s.length > 0) {
            const loadedShoot = s as ShootBooking[];
            setShootBookings((prev) => {
              const next =
                loadedShoot.length >= prev.length || prev.length === 0 ? loadedShoot : prev;
              persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, next);
              if (next.length > 0) persistLocalBookingMirror(uidBk, { shoot: next });
              return next;
            });
          }
          if (e !== undefined && e.length > 0) {
            const loadedEquip = e as EquipmentBooking[];
            setEquipmentBookings((prev) => {
              const next =
                loadedEquip.length >= prev.length || prev.length === 0 ? loadedEquip : prev;
              persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, next);
              if (next.length > 0) persistLocalBookingMirror(uidBk, { equip: next });
              return next;
            });
          }
          if (m !== undefined && m.length > 0) {
            const norm = m.map(normalizeMeetingBooking);
            setMeetingBookings((prev) => {
              const next = norm.length >= prev.length || prev.length === 0 ? norm : prev;
              persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, next);
              if (next.length > 0) persistLocalBookingMirror(uidBk, { meet: next });
              return next;
            });
          }
        } catch {
          /* تجاهل — محاولة إرجاع واجهة فقط */
        }
      })();
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [currentUser?.id]);

  /** لقطة REST كاملة — الخادم يحدّ الصلاحيات حسب JWT؛ الواجهة تعرض ما يعيده الـ API فقط. */
  const refreshServerWorkspace = useCallback(async (): Promise<boolean> => {
    if (!isServerDataMode()) return true;
    if (!hasServerAuthToken()) return false;
    return loadServerWorkspaceImplRef.current();
  }, []);

  /** toast فوري عند وصول ليد من n8n / القنوات — للمالك ومدير المبيعات */
  useEffect(() => {
    if (!currentUser?.id) {
      resetInboundLeadToastState();
      return;
    }
    notifyNewInboundLeads(leads, currentUser.role);
  }, [leads, currentUser?.id, currentUser?.role]);

  /** مزامنة دورية — fallback لو Realtime غير مفعّل (كل 90 ثانية لتقليل الحمل مع آلاف الليدز) */
  useEffect(() => {
    if (!isServerDataMode()) return;
    if (!hasServerAuthToken()) return;
    if (!currentUser?.id) return;

    let cancelled = false;
    const pollWorkspace = () => {
      if (cancelled || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') return;
      void refreshServerWorkspace();
    };

    void pollWorkspace();
    const id = window.setInterval(pollWorkspace, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentUser?.id, refreshServerWorkspace]);

  /** تحديث فوري لكل جداول النظام عبر Supabase Realtime */
  useEffect(() => {
    if (!isSupabaseDirectMode()) return;
    if (!currentUser?.id) return;

    let configRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleConfigRefresh = () => {
      if (configRefreshTimer) window.clearTimeout(configRefreshTimer);
      configRefreshTimer = window.setTimeout(() => {
        void refreshServerWorkspace();
      }, 2500);
    };

    let channel: ReturnType<typeof subscribeWorkspaceRealtime> | null = null;
    try {
      channel = subscribeWorkspaceRealtime({
        onLeadUpsert: (lead) => setLeads((prev) => upsertLeadInList(prev, lead)),
        onLeadDelete: (id) => setLeads((prev) => removeLeadFromList(prev, id)),
        onUserUpsert: (user) =>
          setUsers((prev) => upsertById(prev, normalizeUser({ ...user, authSource: 'database' }))),
        onUserDelete: (id) => setUsers((prev) => removeById(prev, id)),
        onManualCustomerUpsert: (customer) =>
          setManualCustomers((prev) => upsertById(prev, customer)),
        onManualCustomerDelete: (id) => setManualCustomers((prev) => removeById(prev, id)),
        onInvoiceRowUpsert: (raw) =>
          setInvoices((prev) => upsertById(prev, normalizeInvoice(raw))),
        onInvoiceDelete: (id) => setInvoices((prev) => removeById(prev, id)),
        onExpenseUpsert: (expense) => setExpenses((prev) => upsertById(prev, expense)),
        onExpenseDelete: (id) => setExpenses((prev) => removeById(prev, id)),
        onPriceQuoteUpsert: (quote) => setPriceQuotes((prev) => upsertById(prev, quote)),
        onPriceQuoteDelete: (id) => setPriceQuotes((prev) => removeById(prev, id)),
        onManualJournalUpsert: (entry) =>
          setManualJournalEntries((prev) => upsertById(prev, entry)),
        onManualJournalDelete: (id) => setManualJournalEntries((prev) => removeById(prev, id)),
        onAuditUpsert: (event) => setAuditEvents((prev) => prependUniqueAudit(prev, event)),
        onAttendanceUpsert: (record) => setAttendanceRecords((prev) => upsertById(prev, record)),
        onAttendanceDelete: (id) => setAttendanceRecords((prev) => removeById(prev, id)),
        onDocJsonUpsert: (table, id, doc) => {
          const withId = { ...doc, id };
          if (table === 'custody_funds') {
            setCustodyFunds((prev) => upsertById(prev, migrateCustodyFund(withId)));
            return;
          }
          if (table === 'shoot_bookings') {
            setShootBookings((prev) => upsertById(prev, withId as ShootBooking));
            return;
          }
          if (table === 'equipment_bookings') {
            setEquipmentBookings((prev) => upsertById(prev, withId as EquipmentBooking));
            return;
          }
          if (table === 'meeting_bookings') {
            setMeetingBookings((prev) =>
              upsertById(prev, normalizeMeetingBooking(withId)),
            );
          }
        },
        onDocJsonDelete: (table, id) => {
          if (table === 'custody_funds') setCustodyFunds((prev) => removeById(prev, id));
          else if (table === 'shoot_bookings') setShootBookings((prev) => removeById(prev, id));
          else if (table === 'equipment_bookings') setEquipmentBookings((prev) => removeById(prev, id));
          else if (table === 'meeting_bookings') setMeetingBookings((prev) => removeById(prev, id));
        },
        onWorkspaceDocReplace: () => scheduleConfigRefresh(),
        onAccountingPolicyReplace: (pol) => {
          if (!pol) return;
          setAccountingPolicy({
            ...DEFAULT_ACCOUNTING_POLICY,
            ...pol,
            allowedCostCentersForQuotes:
              Array.isArray(pol.allowedCostCentersForQuotes) && pol.allowedCostCentersForQuotes.length > 0
                ? pol.allowedCostCentersForQuotes
                : DEFAULT_ACCOUNTING_POLICY.allowedCostCentersForQuotes,
          });
        },
        onConfigTablesChanged: scheduleConfigRefresh,
      });
    } catch {
      /* Supabase غير مهيأ */
    }
    return () => {
      if (configRefreshTimer) window.clearTimeout(configRefreshTimer);
      if (channel) void getSupabase().removeChannel(channel);
    };
  }, [currentUser?.id, refreshServerWorkspace]);

  // Save to localStorage
  useEffect(() => {
    if (!isServerDataMode() && leads.length > 0) {
      localStorage.setItem('prod_system_leads', JSON.stringify(leads));
    }
    if (!isServerDataMode() && users.length > 0) {
      localStorage.setItem('prod_system_users', JSON.stringify(users));
    }
    if (!isServerDataMode() && invoices.length > 0) {
      localStorage.setItem('prod_system_invoices', JSON.stringify(invoices));
    }
    if (!isServerDataMode() && expenses.length > 0) {
      localStorage.setItem('prod_system_expenses', JSON.stringify(expenses));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_closed_months', JSON.stringify(closedMonths));
    }
    if (!isServerDataMode() && monthlyTargets.length > 0) {
      localStorage.setItem('prod_system_targets', JSON.stringify(monthlyTargets));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_audit', JSON.stringify(auditEvents.slice(0, 500)));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_chart_of_accounts', JSON.stringify(chartOfAccounts));
      localStorage.setItem('prod_system_manual_journals', JSON.stringify(manualJournalEntries));
      localStorage.setItem('prod_system_journal_codebook', JSON.stringify(journalCodingRules));
      localStorage.setItem('prod_system_expense_codebook', JSON.stringify(expenseCodingRules));
      localStorage.setItem('prod_system_customer_code_prefix', customerCodePrefix);
      localStorage.setItem('prod_system_expense_saved_views', JSON.stringify(expenseSavedViews));
      if (payrollAutoSendDay === '') localStorage.removeItem('prod_system_payroll_auto_send_day');
      else localStorage.setItem('prod_system_payroll_auto_send_day', String(payrollAutoSendDay));
      localStorage.setItem('prod_system_entity_comments', JSON.stringify(entityComments));
      localStorage.setItem('prod_system_expense_escalations', JSON.stringify(expenseEscalations));
      localStorage.setItem('prod_system_ui_visual_mode', uiVisualMode);
      for (const [uid, on] of Object.entries(notifyForegroundByUserId)) {
        localStorage.setItem(`prod_system_todo_notify_u_${uid}`, on ? '1' : '0');
      }
      if (currentUser?.id) {
        const curFg = notifyForegroundByUserId[currentUser.id] ?? false;
        localStorage.setItem('prod_system_todo_notify_foreground', curFg ? '1' : '0');
      }
      localStorage.setItem('prod_system_closed_fiscal_years', JSON.stringify(closedFiscalYears));
      localStorage.setItem('prod_system_opening_balances_by_year', JSON.stringify(openingBalancesByYear));
      localStorage.setItem('prod_system_attendance_records', JSON.stringify(attendanceRecords));
      localStorage.setItem('prod_system_payroll_approvals', JSON.stringify(payrollApprovals));
      localStorage.setItem('prod_system_payroll_approval_requests', JSON.stringify(payrollApprovalRequests));
      localStorage.setItem('prod_system_payroll_sales_discounts', JSON.stringify(payrollSalesDiscounts));
      localStorage.setItem('prod_system_financial_reopen_requests', JSON.stringify(financialReopenRequests));
      localStorage.setItem('prod_system_shoot_bookings', JSON.stringify(shootBookings));
      localStorage.setItem('prod_system_equipment_bookings', JSON.stringify(equipmentBookings));
      localStorage.setItem('prod_system_meeting_bookings', JSON.stringify(meetingBookings));
      localStorage.setItem('prod_system_other_bookings', JSON.stringify(otherBookings));
      localStorage.setItem('prod_system_equipment_items', JSON.stringify(equipmentItems));
      localStorage.setItem('prod_system_print_branding', JSON.stringify(printBrandingSettings));
      localStorage.setItem('prod_system_lead_ingestion_settings', JSON.stringify(leadIngestionSettings));
      localStorage.setItem('prod_system_sla_escalation_settings', JSON.stringify(slaEscalationSettings));
      localStorage.setItem('prod_system_lead_data_quality_settings', JSON.stringify(leadDataQualitySettings));
      localStorage.setItem('prod_system_workflow_rules_settings', JSON.stringify(workflowRulesSettings));
      localStorage.setItem('prod_system_external_integrations', JSON.stringify(integrations));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_price_quotes', JSON.stringify(priceQuotes));
      localStorage.setItem('prod_system_accounting_policy', JSON.stringify(accountingPolicy));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_custody_funds', JSON.stringify(custodyFunds));
      localStorage.setItem('prod_system_custody_account_map', JSON.stringify(custodyAccountByCategory));
    }
    if (!isServerDataMode()) {
      localStorage.setItem('prod_system_manual_customers', JSON.stringify(manualCustomers));
    }
    if (!currentUser) {
      localStorage.removeItem('prod_system_current_user');
    } else if (!hasServerAuthToken() && currentUser.authSource !== 'demo') {
      /* جلسة حقيقية (غير التجريب المحلي) لا تُحفظ بدون JWT — يمنع إعادة الدخول الوهمية */
      localStorage.removeItem('prod_system_current_user');
    } else {
      localStorage.setItem('prod_system_current_user', JSON.stringify(currentUser));
    }
    /* مرآة المهام الشخصية لكل الأوضاع (بما فيها السيرفر) — يعيد التحميل ويدمج مع لقطة Workspace */
    try {
      for (const [todoUid, list] of Object.entries(personalTodosByUserId)) {
        const key = `prod_system_todos_${todoUid}`;
        if (!list || list.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {
      /* ignore */
    }
  }, [leads, users, manualCustomers, invoices, expenses, currentUser, monthlyTargets, auditEvents, closedMonths, chartOfAccounts, manualJournalEntries, journalCodingRules, expenseCodingRules, customerCodePrefix, expenseSavedViews, payrollAutoSendDay, entityComments, expenseEscalations, uiVisualMode, personalTodosByUserId, notifyForegroundByUserId, closedFiscalYears, openingBalancesByYear, attendanceRecords, payrollApprovals, payrollApprovalRequests, financialReopenRequests, shootBookings, equipmentBookings, meetingBookings, otherBookings, equipmentItems, printBrandingSettings, leadIngestionSettings, slaEscalationSettings, leadDataQualitySettings, workflowRulesSettings, integrations, priceQuotes, accountingPolicy, custodyFunds, custodyAccountByCategory]);

  // Live local sync across multiple open windows/tabs
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      try {
        switch (event.key) {
          case 'prod_system_leads':
            if (event.newValue) setLeads(JSON.parse(event.newValue));
            break;
          case 'prod_system_users':
            if (isServerDataMode()) break;
            if (event.newValue) setUsers(normalizeUsers(JSON.parse(event.newValue)));
            break;
          case 'prod_system_invoices':
            if (event.newValue) {
              const inv = parseSafe<any[]>(event.newValue);
              if (Array.isArray(inv)) setInvoices(inv.map(normalizeInvoice));
            }
            break;
          case 'prod_system_expenses':
            if (event.newValue) setExpenses(JSON.parse(event.newValue));
            break;
          case 'prod_system_closed_months':
            if (event.newValue) setClosedMonths(JSON.parse(event.newValue));
            break;
          case 'prod_system_targets':
            if (event.newValue) setMonthlyTargets(JSON.parse(event.newValue));
            break;
          case 'prod_system_audit':
            if (event.newValue) setAuditEvents(JSON.parse(event.newValue));
            break;
          case 'prod_system_chart_of_accounts':
            if (event.newValue) {
              const normalized = normalizeChartOfAccounts(parseSafe<unknown>(event.newValue));
              if (normalized.length > 0) setChartOfAccounts(ensureCustodyAccountInChart(normalized));
            }
            break;
          case 'prod_system_manual_journals':
            if (event.newValue) setManualJournalEntries(JSON.parse(event.newValue));
            break;
          case 'prod_system_journal_codebook':
            if (event.newValue) {
              setJournalCodingRulesState(normalizeJournalCodingRulesFromArray(parseSafe<unknown>(event.newValue)));
            }
            break;
          case 'prod_system_expense_codebook':
            if (event.newValue) {
              const er = parseSafe<unknown>(event.newValue);
              setExpenseCodingRulesState(mergeExpenseCodingRulesFromArray(er));
            }
            break;
          case 'prod_system_customer_code_prefix':
            if (event.newValue != null) {
              const p = String(event.newValue).trim().replace(/\s+/g, '') || 'CUS';
              setCustomerCodePrefixState(p);
              customerCodePrefixRef.current = p;
            }
            break;
          case 'prod_system_expense_saved_views':
            if (event.newValue) {
              const ev = parseSafe<unknown>(event.newValue);
              setExpenseSavedViewsState(normalizeExpenseSavedViews(ev));
            }
            break;
          case 'prod_system_payroll_auto_send_day':
            if (event.newValue == null || event.newValue === '') setPayrollAutoSendDayState('');
            else {
              const num = Number(event.newValue);
              if (Number.isFinite(num) && num >= 1 && num <= 28) setPayrollAutoSendDayState(num);
              else setPayrollAutoSendDayState('');
            }
            break;
          case 'prod_system_entity_comments':
            if (event.newValue) setEntityCommentsState(normalizeEntityComments(parseSafe<unknown>(event.newValue)));
            break;
          case 'prod_system_expense_escalations':
            if (event.newValue) setExpenseEscalationsState(normalizeExpenseEscalations(parseSafe<unknown>(event.newValue)));
            break;
          case 'prod_system_ui_visual_mode':
            if (event.newValue === 'classic' || event.newValue === 'premium') setUiVisualModeState(event.newValue);
            break;
          case 'prod_system_closed_fiscal_years':
            if (event.newValue) setClosedFiscalYears(JSON.parse(event.newValue));
            break;
          case 'prod_system_opening_balances_by_year':
            if (event.newValue) setOpeningBalancesByYear(JSON.parse(event.newValue));
            break;
          case 'prod_system_attendance_records':
            if (event.newValue) setAttendanceRecords(JSON.parse(event.newValue));
            break;
          case 'prod_system_payroll_approvals':
            if (event.newValue) setPayrollApprovals(JSON.parse(event.newValue));
            break;
          case 'prod_system_payroll_approval_requests':
            if (event.newValue) setPayrollApprovalRequests(JSON.parse(event.newValue));
            break;
          case 'prod_system_payroll_sales_discounts':
            if (event.newValue) setPayrollSalesDiscounts(JSON.parse(event.newValue));
            break;
          case 'prod_system_financial_reopen_requests':
            if (event.newValue) setFinancialReopenRequests(JSON.parse(event.newValue));
            break;
          case 'prod_system_shoot_bookings':
            if (isServerDataMode()) break;
            if (event.newValue) setShootBookings(JSON.parse(event.newValue));
            break;
          case 'prod_system_equipment_bookings':
            if (isServerDataMode()) break;
            if (event.newValue) setEquipmentBookings(JSON.parse(event.newValue));
            break;
          case 'prod_system_meeting_bookings':
            if (isServerDataMode()) break;
            if (event.newValue) {
              const bookings = parseSafe<any[]>(event.newValue);
              if (Array.isArray(bookings)) setMeetingBookings(bookings.map(normalizeMeetingBooking));
            }
            break;
          case 'prod_system_other_bookings':
            if (event.newValue) setOtherBookings(normalizeOtherBookings(parseSafe<unknown>(event.newValue)));
            break;
          case 'prod_system_manual_customers':
            if (event.newValue) {
              const rawCustomers = parseSafe<any[]>(event.newValue);
              if (Array.isArray(rawCustomers)) {
                setManualCustomers(
                  rawCustomers
                    .map((c) => ({
                      id: c.id || `CUS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                      customerCode: c.customerCode || buildCustomerCodeFromSeed(c.id || c.name || 'manual'),
                      name: String(c.name || '').trim(),
                      company: c.company ? String(c.company) : undefined,
                      phone: c.phone ? String(c.phone) : undefined,
                      email: c.email ? String(c.email) : undefined,
                      sourceLabel: c.sourceLabel ? String(c.sourceLabel) : 'يدوي',
                      createdAt: c.createdAt || new Date().toISOString(),
                      createdById: c.createdById || 'unknown',
                      createdByName: c.createdByName || 'مستخدم',
                      createdByRole: c.createdByRole || 'محاسب',
                    }))
                    .filter((c) => c.name)
                );
              }
            }
            break;
          case 'prod_system_equipment_items':
            if (event.newValue) setEquipmentItems(JSON.parse(event.newValue));
            break;
          case 'prod_system_print_branding':
            if (event.newValue) setPrintBrandingSettings(JSON.parse(event.newValue));
            break;
          case 'prod_system_lead_ingestion_settings':
            if (event.newValue) {
              const cfg = parseSafe<LeadIngestionSettings>(event.newValue);
              if (cfg && typeof cfg === 'object') {
                setLeadIngestionSettings({
                  autoRouteToManager: typeof cfg.autoRouteToManager === 'boolean' ? cfg.autoRouteToManager : DEFAULT_LEAD_INGESTION_SETTINGS.autoRouteToManager,
                  managerUserId: cfg.managerUserId || DEFAULT_LEAD_INGESTION_SETTINGS.managerUserId,
                  facebook: { ...DEFAULT_LEAD_INGESTION_SETTINGS.facebook, ...(cfg.facebook || {}) },
                  linkedin: { ...DEFAULT_LEAD_INGESTION_SETTINGS.linkedin, ...(cfg.linkedin || {}) },
                  google: { ...DEFAULT_LEAD_INGESTION_SETTINGS.google, ...(cfg.google || {}) },
                  email: { ...DEFAULT_LEAD_INGESTION_SETTINGS.email, ...(cfg.email || {}) },
                });
              }
            }
            break;
          case 'prod_system_sla_escalation_settings':
            if (event.newValue) {
              const cfg = parseSafe<Partial<SlaEscalationSettings>>(event.newValue);
              if (cfg && typeof cfg === 'object') {
                setSlaEscalationSettings({
                  warningAfterMinutes: Math.max(5, Number(cfg.warningAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.warningAfterMinutes),
                  criticalAfterMinutes: Math.max(10, Number(cfg.criticalAfterMinutes) || DEFAULT_SLA_ESCALATION_SETTINGS.criticalAfterMinutes),
                  autoReassignAfterHours: Math.max(0, Number(cfg.autoReassignAfterHours) || DEFAULT_SLA_ESCALATION_SETTINGS.autoReassignAfterHours),
                });
              }
            }
            break;
          case 'prod_system_lead_data_quality_settings':
            if (event.newValue) {
              const cfg = parseSafe<Partial<LeadDataQualitySettings>>(event.newValue);
              if (cfg && typeof cfg === 'object') setLeadDataQualitySettings({ ...DEFAULT_LEAD_DATA_QUALITY_SETTINGS, ...cfg });
            }
            break;
          case 'prod_system_workflow_rules_settings':
            if (event.newValue) {
              const cfg = parseSafe<Partial<WorkflowRulesSettings>>(event.newValue);
              if (cfg && typeof cfg === 'object') setWorkflowRulesSettings({ ...DEFAULT_WORKFLOW_RULES_SETTINGS, ...cfg });
            }
            break;
          case 'prod_system_external_integrations':
            if (event.newValue) {
              const cfg = parseSafe<ExternalIntegrationConnection[]>(event.newValue);
              if (Array.isArray(cfg)) {
                const normalized = DEFAULT_INTEGRATIONS.map((base) => {
                  const hit = cfg.find((x) => x?.provider === base.provider);
                  return hit ? { ...base, ...hit } : base;
                });
                setIntegrations(normalized);
              }
            }
            break;
          case 'prod_system_price_quotes':
            if (event.newValue) {
              const pq = parseSafe<PriceQuote[]>(event.newValue);
              if (Array.isArray(pq)) setPriceQuotes(pq);
            }
            break;
          case 'prod_system_accounting_policy':
            if (event.newValue) {
              const pol = parseSafe<AccountingPolicy>(event.newValue);
              if (pol && typeof pol === 'object') setAccountingPolicy({ ...DEFAULT_ACCOUNTING_POLICY, ...pol });
            }
            break;
          case 'prod_system_custody_funds':
            if (event.newValue) {
              const cf = parseSafe<any[]>(event.newValue);
              if (Array.isArray(cf)) setCustodyFunds(cf.map(migrateCustodyFund));
            }
            break;
          case 'prod_system_custody_account_map':
            if (event.newValue) {
              const m = parseSafe<Partial<CustodyAccountByCategory>>(event.newValue);
              if (m && typeof m === 'object') setCustodyAccountByCategory({ ...DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY, ...m });
            }
            break;
          case 'prod_system_current_user':
            if (event.newValue) {
              try {
                const u = normalizeUser(JSON.parse(event.newValue));
                if (!hasServerAuthToken()) {
                  if (isServerDataMode()) break;
                  if (u.authSource !== 'demo') break;
                }
                rehydrateUser(u);
              } catch {
                /* ignore */
              }
            } else {
              if (isSupabaseDirectMode() && hasSupabasePersistedSessionInLocalStorage()) {
                void (async () => {
                  try {
                    const sb = getSupabase();
                    const { data: { session } } = await sb.auth.getSession();
                    const em = session?.user?.email?.trim().toLowerCase();
                    if (!em) return;
                    const { data: profile, error } = await sb
                      .from('users')
                      .select('id,email,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at')
                      .eq('email', em)
                      .maybeSingle();
                    if (error || !profile) return;
                    try {
                      localStorage.setItem('prod_system_supabase', '1');
                    } catch {
                      /* ignore */
                    }
                    rehydrateUser(mapUserFromRow(profile as Record<string, unknown>));
                  } catch {
                    /* ignore */
                  }
                })();
                break;
              }
              authBootstrapEpochRef.current += 1;
              rehydrateUser(null);
            }
            break;
          default:
            if (event.key?.startsWith('prod_system_todos_')) {
              const uid = event.key.slice('prod_system_todos_'.length);
              if (event.newValue) {
                setPersonalTodosByUserIdState((p) => ({
                  ...p,
                  [uid]: normalizePersonalTodos(parseSafe<unknown>(event.newValue)),
                }));
              } else {
                setPersonalTodosByUserIdState((p) => {
                  const n = { ...p };
                  delete n[uid];
                  return n;
                });
              }
            } else if (event.key?.startsWith('prod_system_todo_notify_u_')) {
              const uid = event.key.slice('prod_system_todo_notify_u_'.length);
              setNotifyForegroundByUserIdState((p) => ({
                ...p,
                [uid]: event.newValue === '1',
              }));
            }
            break;
        }
      } catch {
        // ignore malformed external updates
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persistJournalCodebook = async (next: JournalCodingRule[]): Promise<boolean> => {
    const normalized = normalizeJournalCodingRulesFromArray(next);
    if (isServerDataMode()) {
      try {
        const saved = await patchWorkspaceStateApi({ journalCodebook: normalized });
        const fromServer = normalizeJournalCodingRulesFromArray(saved.journalCodebook);
        const merged = mergeJournalCodingRulesLists(fromServer, normalized);
        setJournalCodingRulesState(merged);
        writeAccountingCache(chartOfAccounts, merged);
        if (fromServer.length < normalized.length) {
          void patchWorkspaceStateApi({ journalCodebook: merged }).catch(() => {});
        }
        return true;
      } catch (err) {
        toast.error(accountingSaveErrorHint(err instanceof Error ? err.message : 'تعذر حفظ أكواد اليومية'));
        return false;
      }
    }
    setJournalCodingRulesState(normalized);
    writeAccountingCache(chartOfAccounts, normalized);
    return true;
  };

  const setJournalCodingRules = useCallback((updater: React.SetStateAction<JournalCodingRule[]>) => {
    setJournalCodingRulesState((prev) => {
      const nextRaw = typeof updater === 'function' ? (updater as (p: JournalCodingRule[]) => JournalCodingRule[])(prev) : updater;
      const next = normalizeJournalCodingRulesFromArray(nextRaw);
      void persistJournalCodebook(next).then((ok) => {
        if (!ok) setJournalCodingRulesState(prev);
      });
      return next;
    });
  }, []);

  const addJournalCodingRule = async (rule: Omit<JournalCodingRule, 'id'>): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const title = String(rule.title || '').trim();
    const accountCode = String(rule.accountCode || '').trim();
    if (!title || !accountCode) return false;
    const entry: JournalCodingRule = {
      id: `jr-${Date.now()}`,
      title,
      accountCode,
      costCenter: String(rule.costCenter || 'عام').trim() || 'عام',
    };
    const next = [...journalCodingRules, entry];
    const ok = await persistJournalCodebook(next);
    if (!ok) return false;
    addAuditEvent({
      action: 'إضافة كود يومية جاهز',
      entityType: 'system',
      details: `${entry.title} (${entry.accountCode})`,
    });
    return true;
  };

  const removeJournalCodingRule = async (id: string): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const next = journalCodingRules.filter((r) => r.id !== id);
    if (next.length === journalCodingRules.length) return false;
    const ok = await persistJournalCodebook(next);
    if (!ok) return false;
    addAuditEvent({
      action: 'حذف كود يومية جاهز',
      entityType: 'system',
      details: id,
    });
    return true;
  };

  const setExpenseCodingRules = useCallback((updater: React.SetStateAction<ExpenseCodingRule[]>) => {
    setExpenseCodingRulesState((prev) => {
      const raw = typeof updater === 'function' ? (updater as (p: ExpenseCodingRule[]) => ExpenseCodingRule[])(prev) : updater;
      const next = mergeExpenseCodingRulesFromArray(raw);
      if (isServerDataMode()) void syncWorkspacePatch({ expenseCodebook: next }, () => { setExpenseCodingRulesState(prev); });
      return next;
    });
  }, []);

  const setCustomerCodePrefix = useCallback((updater: React.SetStateAction<string>) => {
    setCustomerCodePrefixState((prev) => {
      const raw = typeof updater === 'function' ? (updater as (p: string) => string)(prev) : updater;
      const next = String(raw ?? 'CUS').trim().replace(/\s+/g, '') || 'CUS';
      if (isServerDataMode()) void syncWorkspacePatch({ customerCodePrefix: next }, () => { setCustomerCodePrefixState(prev); });
      return next;
    });
  }, []);

  const setExpenseSavedViews = useCallback((updater: React.SetStateAction<ExpenseSavedView[]>) => {
    setExpenseSavedViewsState((prev) => {
      const raw = typeof updater === 'function' ? (updater as (p: ExpenseSavedView[]) => ExpenseSavedView[])(prev) : updater;
      const next = normalizeExpenseSavedViews(raw);
      if (isServerDataMode()) void syncWorkspacePatch({ expenseSavedViews: next }, () => { setExpenseSavedViewsState(prev); });
      return next;
    });
  }, []);

  const setPayrollAutoSendDay = useCallback((updater: React.SetStateAction<number | ''>) => {
    setPayrollAutoSendDayState((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: number | '') => number | '')(prev) : updater;
      if (next === '') {
        if (isServerDataMode()) void syncWorkspacePatch({ payrollAutoSendDay: null }, () => { setPayrollAutoSendDayState(prev); });
        return '';
      }
      const day = Math.max(1, Math.min(28, Math.floor(Number(next))));
      if (!Number.isFinite(day)) {
        if (isServerDataMode()) void syncWorkspacePatch({ payrollAutoSendDay: null }, () => { setPayrollAutoSendDayState(prev); });
        return '';
      }
      if (isServerDataMode()) void syncWorkspacePatch({ payrollAutoSendDay: day }, () => { setPayrollAutoSendDayState(prev); });
      return day;
    });
  }, []);

  const setEntityComments = useCallback((updater: React.SetStateAction<EntityCommentsMap>) => {
    setEntityCommentsState((prev) => {
      const raw = typeof updater === 'function' ? (updater as (p: EntityCommentsMap) => EntityCommentsMap)(prev) : updater;
      const next = normalizeEntityComments(raw);
      if (isServerDataMode()) void syncWorkspacePatch({ entityComments: next }, () => { setEntityCommentsState(prev); });
      return next;
    });
  }, []);

  const setExpenseEscalations = useCallback((updater: React.SetStateAction<Record<string, ExpenseEscalationState>>) => {
    setExpenseEscalationsState((prev) => {
      const raw =
        typeof updater === 'function'
          ? (updater as (p: Record<string, ExpenseEscalationState>) => Record<string, ExpenseEscalationState>)(prev)
          : updater;
      const next = normalizeExpenseEscalations(raw);
      if (isServerDataMode()) void syncWorkspacePatch({ expenseEscalations: next }, () => { setExpenseEscalationsState(prev); });
      return next;
    });
  }, []);

  /** مهام المعروضة: الحالة + localStorage — المنطق مُشارَك مع setPersonalTodos عبر mergeDisplayedPersonalTodos */
  const personalTodos = useMemo(
    () => mergeDisplayedPersonalTodos(personalTodosByUserId, currentUser?.id),
    [currentUser?.id, personalTodosByUserId],
  );

  const setUiVisualMode = useCallback((updater: React.SetStateAction<'premium' | 'classic'>) => {
    setUiVisualModeState((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: 'premium' | 'classic') => 'premium' | 'classic')(prev) : updater;
      const v = next === 'classic' ? 'classic' : 'premium';
      if (isServerDataMode()) void syncWorkspacePatch({ uiVisualMode: v }, () => { setUiVisualModeState(prev); });
      return v;
    });
  }, []);

  const setPersonalTodos = useCallback(
    (updater: React.SetStateAction<PersonalTodo[]>) => {
      const uidRawSnap = currentUser?.id;
      const uid = canonicalTodoUserId(uidRawSnap);
      if (!uid) return;
      setPersonalTodosByUserIdState((prev) => {
        const curList = mergeDisplayedPersonalTodos(prev, uidRawSnap);
        const raw =
          typeof updater === 'function' ? (updater as (p: PersonalTodo[]) => PersonalTodo[])(curList) : updater;
        const nextList = normalizePersonalTodos(raw);
        const nextMap = { ...prev, [uid]: nextList };
        try {
          if (typeof window !== 'undefined') {
            const lsKey = `prod_system_todos_${uid}`;
            if (nextList.length === 0) localStorage.removeItem(lsKey);
            else localStorage.setItem(lsKey, JSON.stringify(nextList));
          }
        } catch {
          /* ignore */
        }
        if (isServerDataMode()) {
          void patchWorkspaceStateApi({ personalTodosByUserId: { [uid]: nextList } }).catch(() => {});
        }
        return nextMap;
      });
    },
    [currentUser?.id],
  );

  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    try {
      const leg = localStorage.getItem('prod_system_todo_notify_foreground');
      if (leg !== '1' && leg !== '0') return;
      const v = leg === '1';
      localStorage.removeItem('prod_system_todo_notify_foreground');
      setNotifyForegroundByUserIdState((p) => {
        if (Object.prototype.hasOwnProperty.call(p, uid)) return p;
        const before = p;
        const next = { ...p, [uid]: v };
        if (isServerDataMode()) void syncWorkspacePatch({ notifyForegroundByUserId: { [uid]: v } }, () => { setNotifyForegroundByUserIdState(before); });
        return next;
      });
    } catch {
      /* ignore */
    }
  }, [currentUser?.id]);

  const desktopNotifyWhenVisible = useMemo(
    () => Boolean(currentUser?.id && notifyForegroundByUserId[currentUser.id]),
    [currentUser?.id, notifyForegroundByUserId],
  );

  const setDesktopNotifyWhenVisible = useCallback(
    (next: boolean) => {
      const uid = currentUser?.id;
      if (!uid) return;
      setNotifyForegroundByUserIdState((prev) => {
        const merged = { ...prev, [uid]: next };
        if (isServerDataMode()) void syncWorkspacePatch({ notifyForegroundByUserId: { [uid]: next } }, () => { setNotifyForegroundByUserIdState(prev); });
        return merged;
      });
    },
    [currentUser?.id],
  );

  const updatePrintBrandingSettings = (patch: Partial<PrintBrandingSettings>) => {
    setPrintBrandingSettings((prev) => {
      const next = { ...prev, ...patch };
      if (isServerDataMode()) void syncWorkspacePatch({ printBranding: next }, () => { setPrintBrandingSettings(prev); });
      return next;
    });
  };

  const updateLeadIngestionSettings = (patch: Partial<LeadIngestionSettings>) => {
    if (currentUser?.role !== 'مالك') return;
    setLeadIngestionSettings((prev) => {
      const next = {
        ...prev,
        ...patch,
        facebook: patch.facebook ? { ...prev.facebook, ...patch.facebook } : prev.facebook,
        linkedin: patch.linkedin ? { ...prev.linkedin, ...patch.linkedin } : prev.linkedin,
        google: patch.google ? { ...prev.google, ...patch.google } : prev.google,
        email: patch.email ? { ...prev.email, ...patch.email } : prev.email,
      };
      if (isServerDataMode()) void syncWorkspacePatch({ leadIngestion: next }, () => { setLeadIngestionSettings(prev); });
      return next;
    });
    addAuditEvent({
      action: 'تحديث إعدادات ربط مصادر الليدز',
      entityType: 'system',
      details: Object.keys(patch).join(',') || 'lead_ingestion',
    });
  };

  const updateSlaEscalationSettings = (patch: Partial<SlaEscalationSettings>) => {
    if (currentUser?.role !== 'مالك') return;
    setSlaEscalationSettings((prev) => {
      const next = {
        warningAfterMinutes: Math.max(5, Number(patch.warningAfterMinutes ?? prev.warningAfterMinutes) || prev.warningAfterMinutes),
        criticalAfterMinutes: Math.max(10, Number(patch.criticalAfterMinutes ?? prev.criticalAfterMinutes) || prev.criticalAfterMinutes),
        autoReassignAfterHours: Math.max(0, Number(patch.autoReassignAfterHours ?? prev.autoReassignAfterHours) || prev.autoReassignAfterHours),
      };
      if (isServerDataMode()) void syncWorkspacePatch({ slaEscalation: next }, () => { setSlaEscalationSettings(prev); });
      return next;
    });
    addAuditEvent({
      action: 'تحديث مصفوفة تصعيد SLA',
      entityType: 'system',
      details: Object.keys(patch).join(',') || 'sla_escalation',
    });
  };

  const updateLeadDataQualitySettings = (patch: Partial<LeadDataQualitySettings>) => {
    if (currentUser?.role !== 'مالك') return;
    setLeadDataQualitySettings((prev) => {
      const next = { ...prev, ...patch };
      if (isServerDataMode()) void syncWorkspacePatch({ leadDataQuality: next }, () => { setLeadDataQualitySettings(prev); });
      return next;
    });
    addAuditEvent({
      action: 'تحديث قواعد جودة بيانات الليدز',
      entityType: 'system',
      details: Object.keys(patch).join(',') || 'lead_data_quality',
    });
  };

  const updateWorkflowRulesSettings = (patch: Partial<WorkflowRulesSettings>) => {
    if (currentUser?.role !== 'مالك') return;
    setWorkflowRulesSettings((prev) => {
      const next = { ...prev, ...patch };
      if (isServerDataMode()) void syncWorkspacePatch({ workflowRules: next }, () => { setWorkflowRulesSettings(prev); });
      return next;
    });
    addAuditEvent({
      action: 'تحديث قواعد سير العمل',
      entityType: 'system',
      details: Object.keys(patch).join(',') || 'workflow_rules',
    });
  };

  const providerAuthPath: Record<IntegrationProvider, string> = {
    facebook: 'meta-facebook',
    instagram: 'meta-instagram',
    google_ads: 'google-ads',
    whatsapp: 'meta-whatsapp',
    linkedin: 'linkedin',
  };

  const startIntegrationConnect = (provider: IntegrationProvider) => {
    if (currentUser?.role !== 'مالك') return { ok: false, reason: 'unauthorized' };
    const appOrigin = getAppPublicOrigin();
    const apiOrigin = getOAuthApiOrigin();
    const callbackUrl = `${appOrigin}/?integration_provider=${provider}&integration_status=success`;
    const oauthBase = `${apiOrigin}/api/integrations/auth`;
    let authUrl = `${oauthBase}/${providerAuthPath[provider]}/start?callback=${encodeURIComponent(callbackUrl)}`;
    try {
      const jwt = localStorage.getItem('prod_system_jwt');
      if (jwt) authUrl += `&integration_jwt=${encodeURIComponent(jwt)}`;
    } catch {
      /* ignore */
    }
    addAuditEvent({
      action: `بدء ربط تكامل خارجي (${provider})`,
      entityType: 'system',
      details: authUrl,
    });
    return { ok: true, authUrl };
  };

  const completeIntegrationConnect = (
    provider: IntegrationProvider,
    payload: { accountLabel?: string; tokenExpiresAt?: string }
  ) => {
    if (currentUser?.role !== 'مالك') return false;
    const prevI = integrations;
    const prevLi = leadIngestionSettings;
    const nextI = prevI.map((row) =>
      row.provider === provider
        ? {
            ...row,
            connected: true,
            status: 'connected' as ExternalIntegrationConnection['status'],
            accountLabel: payload.accountLabel?.trim() || row.accountLabel || provider,
            connectedAt: new Date().toISOString(),
            tokenExpiresAt: payload.tokenExpiresAt,
            lastError: undefined,
          }
        : row
    );
    const nextLi = computeLeadIngestionFromIntegrations(prevLi, nextI);
    setIntegrations(nextI);
    setLeadIngestionSettings(nextLi);
    if (isServerDataMode()) {
      void syncWorkspacePatch({ integrations: nextI, leadIngestion: nextLi }, () => {
        setIntegrations(prevI);
        setLeadIngestionSettings(prevLi);
      });
    }
    addAuditEvent({
      action: `إتمام ربط تكامل خارجي (${provider})`,
      entityType: 'system',
      details: payload.accountLabel || provider,
    });
    return true;
  };

  const markIntegrationError = (provider: IntegrationProvider, message: string) => {
    if (currentUser?.role !== 'مالك') return;
    const prevI = integrations;
    const prevLi = leadIngestionSettings;
    const nextI = prevI.map((row) =>
      row.provider === provider
        ? {
            ...row,
            connected: false,
            status: 'error' as ExternalIntegrationConnection['status'],
            lastError: message || 'Integration error',
          }
        : row
    );
    const nextLi = computeLeadIngestionFromIntegrations(prevLi, nextI);
    setIntegrations(nextI);
    setLeadIngestionSettings(nextLi);
    if (isServerDataMode()) {
      void syncWorkspacePatch({ integrations: nextI, leadIngestion: nextLi }, () => {
        setIntegrations(prevI);
        setLeadIngestionSettings(prevLi);
      });
    }
    addAuditEvent({
      action: `خطأ تكامل خارجي (${provider})`,
      entityType: 'system',
      details: message || 'error',
    });
  };

  const disconnectIntegration = (provider: IntegrationProvider) => {
    if (currentUser?.role !== 'مالك') return false;
    const prevI = integrations;
    const prevLi = leadIngestionSettings;
    const nextI = prevI.map((row) =>
      row.provider === provider
        ? {
            ...row,
            connected: false,
            status: 'idle' as ExternalIntegrationConnection['status'],
            accountLabel: undefined,
            connectedAt: undefined,
            tokenExpiresAt: undefined,
            lastError: undefined,
          }
        : row
    );
    const nextLi = computeLeadIngestionFromIntegrations(prevLi, nextI);
    setIntegrations(nextI);
    setLeadIngestionSettings(nextLi);
    if (isServerDataMode()) {
      void syncWorkspacePatch({ integrations: nextI, leadIngestion: nextLi }, () => {
        setIntegrations(prevI);
        setLeadIngestionSettings(prevLi);
      });
    }
    addAuditEvent({
      action: `فصل تكامل خارجي (${provider})`,
      entityType: 'system',
      details: provider,
    });
    return true;
  };

  const findDuplicateLead = (leadInput: Partial<Lead>, currentLeads: Lead[]) => {
    if (!leadDataQualitySettings.rejectDuplicateLeads) return null;
    const phone = leadPhoneDigitsKey(leadInput.phone || '');
    const email = (leadInput.email || '').trim().toLowerCase();
    return currentLeads.find((l) => {
      if (leadDataQualitySettings.duplicatePhone) {
        const existingPhone = leadPhoneDigitsKey(l.phone || '');
        if (phone && existingPhone && phone === existingPhone) return true;
      }
      if (leadDataQualitySettings.duplicateEmail) {
        const existingEmail = (l.email || '').trim().toLowerCase();
        if (email && existingEmail && email === existingEmail) return true;
      }
      return false;
    }) || null;
  };

  const syncExternalLeads = async (channel: ExternalLeadChannel, count = 3): Promise<number> => {
    if (currentUser?.role !== 'مالك') return 0;
    const safeCount = Math.max(1, Math.min(50, Number(count) || 0));
    const cfg = leadIngestionSettings[channel];
    const oauthLinked =
      channel === 'facebook'
        ? integrations.some((i) => (i.provider === 'facebook' || i.provider === 'instagram') && i.connected)
        : channel === 'linkedin'
          ? integrations.some((i) => i.provider === 'linkedin' && i.connected)
          : channel === 'google'
            ? integrations.some((i) => i.provider === 'google_ads' && i.connected)
            : false;
    if (!cfg?.connected && !oauthLinked) return 0;

    const manager =
      users.find((u) => u.id === leadIngestionSettings.managerUserId && u.role === 'مدير مبيعات')
      || users.find((u) => u.role === 'مدير مبيعات');
    const managerId = leadIngestionSettings.autoRouteToManager ? manager?.id : undefined;
    const channelLabel = channel === 'facebook'
      ? 'Facebook'
      : channel === 'linkedin'
        ? 'LinkedIn'
        : channel === 'google'
          ? 'Google Ads'
          : 'Email';
    const sourceDisplay = buildExternalLeadSourceDisplay(channel, cfg, integrations);
    const categoryPool: LeadCategory[] = channel === 'linkedin'
      ? ['شركات كبرى', 'إنجليزي', 'إعلانات']
      : channel === 'facebook'
        ? ['سوشيال ميديا', 'إعلانات', 'شركات صغيرة']
        : channel === 'google'
          ? ['شركات صغيرة', 'إعلانات', 'سوشيال ميديا']
          : ['إنجليزي', 'شركات كبرى', 'سوشيال ميديا'];
    const sizePool: Lead['companySize'][] = ['صغير', 'متوسط', 'كبير'];

    const applyLastSync = () => {
      setLeadIngestionSettings((prev) => {
        const next = {
          ...prev,
          [channel]: { ...prev[channel], lastSyncAt: new Date().toISOString() },
        };
        if (isServerDataMode()) void syncWorkspacePatch({ leadIngestion: next }, () => { setLeadIngestionSettings(prev); });
        return next;
      });
    };

    const generated: Lead[] = Array.from({ length: safeCount }).map((_, idx) => {
      const id = Math.random().toString(36).slice(2, 11);
      const company = `${channelLabel} Prospect ${Math.floor(Math.random() * 900 + 100)}`;
      const name = `عميل ${channelLabel} ${Math.floor(Math.random() * 900 + 100)}`;
      const category = categoryPool[Math.floor(Math.random() * categoryPool.length)];
      const companySize = sizePool[Math.floor(Math.random() * sizePool.length)];
      const budget = Math.floor(8000 + Math.random() * 120000);
      const nowIso = new Date(Date.now() - idx * 1000 * 15).toISOString();
      const timeline: Activity[] = [
        {
          id: Math.random().toString(36).slice(2, 11),
          leadId: id,
          action: `استيراد تلقائي — ${sourceDisplay}`,
          note: cfg.accountRef ? `مرجع الحساب: ${cfg.accountRef}` : undefined,
          userId: 'sys',
          userName: 'تكامل المصادر',
          createdAt: nowIso,
        },
      ];
      if (managerId) {
        const managerName = manager?.name || 'مدير المبيعات';
        timeline.unshift({
          id: Math.random().toString(36).slice(2, 11),
          leadId: id,
          action: `تحويل تلقائي إلى ${managerName}`,
          userId: 'sys',
          userName: 'تكامل المصادر',
          createdAt: nowIso,
        });
      }
      return {
        id,
        customerCode: buildCustomerCodeFromSeed(id),
        name,
        company,
        phone: `01${Math.floor(100000000 + Math.random() * 899999999)}`,
        email: channel === 'email' ? `inbox.${id}@mail.leads` : `lead.${id}@${channel}.auto`,
        status: 'جديد',
        assignedTo: managerId,
        budget,
        companySize,
        source: sourceDisplay,
        category,
        score: getLeadScore({ budget, companySize, source: sourceDisplay, category }),
        createdAt: nowIso,
        updatedAt: nowIso,
        slaStatus: 'مستقر',
        timeline,
      };
    });

    if (isServerDataMode()) {
      if (!isSupabaseDirectMode() && channel === 'facebook') {
        try {
          const meta = await syncRealMetaLeadsApi({
            routeToManagerId: managerId ?? null,
            max: Math.min(120, safeCount + 40),
          });
          if (meta?.ok === false && (meta.code === 'no_token' || meta.code === 'graph_pages')) {
            return 0;
          }
          if (
            meta &&
            Array.isArray(meta.leads) &&
            (meta.code === 'meta_graph' || meta.code === 'no_pages' || (meta.created ?? 0) > 0)
          ) {
            if (meta.leads.length > 0) {
              setLeads((prev) => [...meta.leads, ...prev]);
            }
            applyLastSync();
            addAuditEvent({
              action: `مزامنة فيسبوك — إعلانات ميتا (Lead Ads حقيقي)`,
              entityType: 'lead',
              details: `created=${meta.created}, skippedDuplicates=${meta.skippedDuplicates ?? 0}, graphErrors=${meta.graphErrors ?? 0}`,
            });
            return meta.created;
          }
        } catch {
          /* يكمل للتجريبي */
        }
      }
      if (!isSupabaseDirectMode() && channel === 'linkedin') {
        try {
          const li = await syncRealLinkedInLeadsApi({
            routeToManagerId: managerId ?? null,
            max: Math.min(120, safeCount + 40),
          });
          if (li?.ok === false && li.code === 'no_token') {
            return 0;
          }
          if (
            li &&
            Array.isArray(li.leads) &&
            (li.code === 'linkedin_graph' || li.code === 'no_accounts' || (li.created ?? 0) > 0)
          ) {
            if (li.leads.length > 0) {
              setLeads((prev) => [...li.leads, ...prev]);
            }
            applyLastSync();
            addAuditEvent({
              action: `مزامنة لينكد إن — Lead Gen (حقيقي)`,
              entityType: 'lead',
              details: `created=${li.created}, skippedDuplicates=${li.skippedDuplicates ?? 0}, graphErrors=${li.graphErrors ?? 0}`,
            });
            return li.created;
          }
        } catch {
          /* يكمل للتجريبي */
        }
      }
      if (!isSupabaseDirectMode() && channel === 'google') {
        try {
          const ga = await syncRealGoogleAdsLeadsApi({
            routeToManagerId: managerId ?? null,
            max: Math.min(120, safeCount + 40),
          });
          if (ga?.ok === false && (ga.code === 'no_token' || ga.code === 'no_dev_token')) {
            return 0;
          }
          if (
            ga &&
            Array.isArray(ga.leads) &&
            (ga.code === 'google_ads' || ga.code === 'no_customers' || (ga.created ?? 0) > 0)
          ) {
            if (ga.leads.length > 0) {
              setLeads((prev) => [...ga.leads, ...prev]);
            }
            applyLastSync();
            addAuditEvent({
              action: `مزامنة Google Ads — Lead Form (حقيقي)`,
              entityType: 'lead',
              details: `created=${ga.created}, skippedDuplicates=${ga.skippedDuplicates ?? 0}, graphErrors=${ga.graphErrors ?? 0}`,
            });
            return ga.created;
          }
        } catch {
          /* يكمل للتجريبي */
        }
      }
      if (isSupabaseDirectMode()) {
        try {
          const pool: Lead[] = [...leads];
          const acceptedRowsSb: Lead[] = [];
          for (const lead of generated) {
            if (findDuplicateLead(lead, pool)) continue;
            const saved = await serverCreateLead({
              name: lead.name,
              company: lead.company,
              phone: lead.phone,
              email: lead.email,
              status: lead.status,
              budget: lead.budget,
              companySize: lead.companySize,
              source: lead.source,
              category: lead.category,
              score: lead.score,
              slaStatus: lead.slaStatus,
              customerCode: lead.customerCode,
              assignedTo: lead.assignedTo,
            });
            acceptedRowsSb.push(saved);
            pool.unshift(saved);
          }
          if (acceptedRowsSb.length > 0) {
            setLeads((prev) => [...acceptedRowsSb, ...prev]);
          }
          applyLastSync();
          addAuditEvent({
            action: `مزامنة ليدز من ${channelLabel} (Supabase)`,
            entityType: 'lead',
            details: `channel=${channel}, created=${acceptedRowsSb.length}, routeToManager=${managerId ? 'yes' : 'no'}, source=${sourceDisplay}`,
          });
          return acceptedRowsSb.length;
        } catch {
          return 0;
        }
      }
      try {
        const res = await demoChannelIngestApi({
          channel,
          count: safeCount,
          routeToManagerId: managerId ?? null,
          accountRef: cfg.accountRef || '',
          sourceDisplay,
        });
        if (res.leads.length > 0) {
          setLeads((prev) => [...res.leads, ...prev]);
        }
        applyLastSync();
        addAuditEvent({
          action: `مزامنة ليدز من ${channelLabel} (خادم)`,
          entityType: 'lead',
          details: `channel=${channel}, created=${res.created}, skippedDuplicates=${res.skippedDuplicates}, routeToManager=${managerId ? 'yes' : 'no'}, demo=${res.demo}`,
        });
        return res.created;
      } catch {
        return 0;
      }
    }

    const pool: Lead[] = [...leads];
    const acceptedRows: Lead[] = [];
    generated.forEach((lead) => {
      if (findDuplicateLead(lead, pool)) return;
      acceptedRows.push(lead);
      pool.unshift(lead);
    });
    const acceptedCount = acceptedRows.length;

    setLeads((prev) => [...acceptedRows, ...prev]);
    setLeadIngestionSettings((prev) => {
      const next = {
        ...prev,
        [channel]: { ...prev[channel], lastSyncAt: new Date().toISOString() },
      };
      return next;
    });
    addAuditEvent({
      action: `مزامنة ليدز من ${channelLabel}`,
      entityType: 'lead',
      details: `channel=${channel}, count=${acceptedCount}, routeToManager=${managerId ? 'yes' : 'no'}`,
    });
    return acceptedCount;
  };

  const addAuditEvent = useCallback((event: Omit<AuditEvent, 'id' | 'createdAt' | 'actorId' | 'actorName'>) => {
    const actor = currentUser || { id: 'sys', name: 'النظام' };
    const entry: AuditEvent = {
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString(),
      actorId: actor.id,
      actorName: actor.name,
      ...event,
    };
    if (isServerDataMode()) {
      void (async () => {
        try {
          const saved = await postAuditEventApi(event);
          setAuditEvents((prev) => [saved, ...prev].slice(0, 500));
        } catch {
          setAuditEvents((prev) => [entry, ...prev].slice(0, 500));
        }
      })();
      return;
    }
    setAuditEvents((prev) => [entry, ...prev].slice(0, 500));
  }, [currentUser]);

  const getLeadScore = useCallback((lead: Partial<Lead>) => {
    let score = 0;
    const budget = Number(lead.budget || 0);
    if (budget >= 100000) score += 45;
    else if (budget >= 50000) score += 35;
    else if (budget >= 20000) score += 25;
    else if (budget > 0) score += 12;

    if (lead.companySize === 'كبير') score += 22;
    else if (lead.companySize === 'متوسط') score += 14;
    else if (lead.companySize === 'صغير') score += 8;

    const source = (lead.source || '').toLowerCase();
    if (/linkedin|لينكد|referral|إحالة|website|موقع/.test(source)) score += 16;
    else if (/google|فيس|facebook|instagram|email|ايميل/.test(source)) score += 10;
    else if (source) score += 6;

    if (lead.category === 'شركات كبرى') score += 10;
    else if (lead.category === 'إنجليزي') score += 7;
    else if (lead.category) score += 4;

    const timelineCount = Array.isArray(lead.timeline) ? lead.timeline.length : 0;
    if (timelineCount >= 4) score += 7;
    else if (timelineCount >= 1) score += 3;

    if (lead.followUpAt) {
      const followUpTs = new Date(lead.followUpAt).getTime();
      if (!Number.isNaN(followUpTs) && followUpTs > Date.now()) score += 5;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }, []);

  const refreshSLA = useCallback(() => {
    if (isServerDataMode()) {
      setLeads((prev) => {
        const next: Lead[] = prev.map((lead) => {
          if (lead.status === 'مغلق - فوز' || lead.status === 'مغلق - خسارة') {
            const withSla = { ...lead, slaStatus: 'مستقر' as const };
            return { ...withSla, score: getLeadScore(withSla) };
          }
          const latestActivityAt = lead.timeline[0]?.createdAt || lead.updatedAt || lead.createdAt;
          const latestDate = new Date(latestActivityAt).getTime();
          const diffMins = (Date.now() - latestDate) / (1000 * 60);
          let slaStatus: Lead['slaStatus'] = 'مستقر';
          if (diffMins > slaEscalationSettings.criticalAfterMinutes) slaStatus = 'حرج';
          else if (diffMins > slaEscalationSettings.warningAfterMinutes) slaStatus = 'متأخر';
          const withSla = { ...lead, slaStatus };
          return { ...withSla, score: getLeadScore(withSla) };
        });
        const toSync = next.filter((l) => {
          const o = prev.find((p) => p.id === l.id);
          return o && (l.slaStatus !== o.slaStatus || l.score !== o.score);
        });
        if (toSync.length > 0) {
          void Promise.all(
            toSync.map((l) =>
              serverPatchLead(l.id, { slaStatus: l.slaStatus, score: l.score })
                .then((updated) => {
                  setLeads((cur) => cur.map((x) => (x.id === l.id ? updated : x)));
                })
                .catch(() => {
                  /* يبقى العرض المحسوب محلياً */
                })
            )
          );
        }
        return next;
      });
      return;
    }
    setLeads(prev => prev.map(lead => {
      if (lead.status === 'مغلق - فوز' || lead.status === 'مغلق - خسارة') return { ...lead, slaStatus: 'مستقر' };
      const latestActivityAt = lead.timeline[0]?.createdAt || lead.updatedAt || lead.createdAt;
      const latestDate = new Date(latestActivityAt).getTime();
      const diffMins = (Date.now() - latestDate) / (1000 * 60);
      let slaStatus: Lead['slaStatus'] = 'مستقر';
      if (diffMins > slaEscalationSettings.criticalAfterMinutes) slaStatus = 'حرج';
      else if (diffMins > slaEscalationSettings.warningAfterMinutes) slaStatus = 'متأخر';
      return { ...lead, slaStatus, score: getLeadScore(lead) };
    }));
  }, [getLeadScore, slaEscalationSettings]);

  const autoDistribute = (lead: Lead, currentLeads: Lead[]) => {
    let eligibleReps = users.filter(
      (u) => u.role === 'مندوب' && repSkillMatchesLeadCategory(u.skills || [], lead.category),
    );
    if (eligibleReps.length === 0) {
      eligibleReps = users.filter((u) => u.role === 'مندوب');
    }
    if (eligibleReps.length === 0) return undefined;

    // Distribute to rep with fewest active leads (simple load balancing)
    const repsLoad = eligibleReps.map(rep => ({
      id: rep.id,
      count: currentLeads.filter(l => l.assignedTo === rep.id && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length
    }));

    repsLoad.sort((a, b) => a.count - b.count);
    return repsLoad[0].id;
  };

  /** نشاط «توزيع تلقائي» يُحفَظ مع إنشاء الليد على السيرفر (مثل الوضع المحلي) */
  const buildServerAutoAssignTimeline = (assignedTo: string | undefined, leadIdPlaceholder: string): Activity[] | undefined => {
    if (!assignedTo) return undefined;
    const rep = users.find((u) => u.id === assignedTo);
    return [
      {
        id: `asg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        leadId: leadIdPlaceholder,
        action: `توزيع تلقائي للمندوب: ${rep?.name || assignedTo}`,
        userId: 'sys',
        userName: 'النظام الذكي',
        createdAt: new Date().toISOString(),
      },
    ];
  };

  const addLead = (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'score' | 'slaStatus' | 'timeline'>): boolean => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return false;
    const phone = normalizeLeadPhone(leadData.phone);
    if (!isValidLeadPhone(phone)) {
      toast.error('رقم الجوال غير صالح — استخدم 01xxxxxxxxx أو +971… / +44…');
      return false;
    }
    if (leadDataQualitySettings.requireCompany && !(leadData.company || '').trim()) {
      toast.error('حقل الشركة مطلوب حسب سياسة جودة البيانات');
      return false;
    }
    if (leadDataQualitySettings.requireBudget && (!Number(leadData.budget) || Number(leadData.budget) <= 0)) {
      toast.error('حقل الميزانية مطلوب حسب سياسة جودة البيانات');
      return false;
    }
    if (findDuplicateLead(leadData, leads)) {
      toast.error('هذا الليد موجود مسبقاً (تكرار في الهاتف أو البريد)');
      return false;
    }
    const score = getLeadScore(leadData);
    if (isServerDataMode()) {
      const tempId = `t-${Date.now()}`;
      const tempLead: Lead = {
        ...leadData,
        phone,
        id: tempId,
        customerCode: leadData.customerCode || buildCustomerCodeFromSeed(tempId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        score,
        slaStatus: 'مستقر',
        timeline: [],
      };
      const assignedToRaw = autoDistribute(tempLead, leads);
      // only use assignment IDs that look like real server IDs (UUID/CUID) — mock IDs like
      // 'u1'/'u3' come from INITIAL_USERS and would fail Supabase FK checks
      const assignedTo = assignedToRaw && assignedToRaw.length > 4 ? assignedToRaw : undefined;
      if (assignedTo) tempLead.assignedTo = assignedTo;
      // optimistic: show immediately before server responds
      setLeads((prev) => [tempLead, ...prev]);
      void (async () => {
        try {
          const autoTl = buildServerAutoAssignTimeline(assignedTo, tempId);
          const created = await serverCreateLead({
            name: leadData.name,
            company: leadData.company,
            phone,
            email: leadData.email,
            status: leadData.status,
            budget: leadData.budget,
            companySize: leadData.companySize,
            source: leadData.source,
            category: leadData.category,
            score,
            slaStatus: 'مستقر',
            customerCode: tempLead.customerCode,
            assignedTo,
            ...(autoTl ? { timeline: autoTl } : {}),
          });
          // replace temp with real record from server; if workspace sync already removed
          // the temp lead, prepend the created lead so it is never lost
          setLeads((prev) => {
            const idx = prev.findIndex((l) => l.id === tempId);
            if (idx >= 0) return prev.map((l) => (l.id === tempId ? created : l));
            // temp was wiped (e.g. background workspace sync); add real lead to front
            if (prev.some((l) => l.id === created.id)) return prev; // already present
            return [created, ...prev];
          });
          addAuditEvent({
            action: 'إضافة ليد جديد',
            entityType: 'lead',
            entityId: created.id,
            details: `Lead: ${created.name} - ${created.company}`,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'تعذر حفظ الليد على السيرفر';
          toast.error(`⚠️ لم يُحفظ على السيرفر — ${msg}`);
        }
      })();
      return true;
    }
    const id = Math.random().toString(36).substr(2, 9);
    
    // Create lead object first to pass to autoDistribute
    const lead: Lead = {
      ...leadData,
      phone,
      id,
      customerCode: leadData.customerCode || buildCustomerCodeFromSeed(id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      score,
      slaStatus: 'مستقر',
      timeline: [{
        id: Math.random().toString(36).substr(2, 9),
        leadId: id,
        action: 'إضافة الليد إلى النظام',
        userId: currentUser?.id || 'sys',
        userName: currentUser?.name || 'النظام',
        createdAt: new Date().toISOString()
      }]
    };

    const assignedTo = autoDistribute(lead, leads);
    if (assignedTo) {
      lead.assignedTo = assignedTo;
      const rep = users.find(u => u.id === assignedTo);
      lead.timeline.unshift({
        id: Math.random().toString(36).substr(2, 9),
        leadId: id,
        action: `توزيع تلقائي للمندوب: ${rep?.name}`,
        userId: 'sys',
        userName: 'النظام الذكي',
        createdAt: new Date().toISOString()
      });
    }

    setLeads(prev => [lead, ...prev]);
    addAuditEvent({
      action: 'إضافة ليد جديد',
      entityType: 'lead',
      entityId: lead.id,
      details: `Lead: ${lead.name} - ${lead.company}`,
    });
    return true;
  };

  const bulkAddLeads = async (
    leadsData: (Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'score' | 'slaStatus' | 'timeline'> & {
      createdAt?: string;
    })[]
  ): Promise<{ created: number; failed: number }> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) {
      return { created: 0, failed: leadsData.length };
    }
    const rejectedUpfront = leadsData.filter((ld) => {
      if (leadDataQualitySettings.requireCompany && !(ld.company || '').trim()) return true;
      if (leadDataQualitySettings.requireBudget && (!Number(ld.budget) || Number(ld.budget) <= 0)) return true;
      return findDuplicateLead(ld, leads);
    }).length;
    const acceptedInput = leadsData.filter((ld) => {
      if (leadDataQualitySettings.requireCompany && !(ld.company || '').trim()) return false;
      if (leadDataQualitySettings.requireBudget && (!Number(ld.budget) || Number(ld.budget) <= 0)) return false;
      return !findDuplicateLead(ld, leads);
    });
    if (isServerDataMode()) {
      const created: Lead[] = [];
      let pool: Lead[] = [...leads];
      for (const ld of acceptedInput) {
        try {
          const score = getLeadScore(ld);
          const tempId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          const tempLead: Lead = {
            ...ld,
            id: tempId,
            customerCode: ld.customerCode || buildCustomerCodeFromSeed(tempId),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            score,
            slaStatus: 'مستقر',
            timeline: [],
          };
          const assignedTo = autoDistribute(tempLead, pool);
          const autoTl = buildServerAutoAssignTimeline(assignedTo, tempId);
          const row = await serverCreateLead({
            name: ld.name,
            company: ld.company,
            phone: normalizeLeadPhone(ld.phone),
            email: ld.email,
            status: ld.status,
            budget: ld.budget,
            companySize: ld.companySize,
            source: ld.source,
            category: ld.category,
            score,
            slaStatus: 'مستقر',
            customerCode: tempLead.customerCode,
            assignedTo,
            ...(autoTl ? { timeline: autoTl } : {}),
          });
          created.push(row);
          pool = [row, ...pool];
        } catch {
          /* صف واحد فاشل — نكمل الباقي */
        }
      }
      if (created.length > 0) {
        setLeads((prev) => [...created, ...prev]);
        addAuditEvent({
          action: 'رفع ملف ليدز',
          entityType: 'lead',
          details: `عدد الليدز المضافة: ${created.length}`,
        });
      }
      return {
        created: created.length,
        failed: rejectedUpfront + (acceptedInput.length - created.length),
      };
    }
    const newLeads = acceptedInput.map(ld => {
      const id = Math.random().toString(36).substr(2, 9);
      const when = ld.createdAt || new Date().toISOString();
      const lead: Lead = {
        ...ld,
        phone: normalizeLeadPhone(ld.phone),
        id,
        customerCode: ld.customerCode || buildCustomerCodeFromSeed(id),
        createdAt: when,
        updatedAt: when,
        score: getLeadScore(ld),
        slaStatus: 'مستقر',
        timeline: [{
          id: Math.random().toString(36).substr(2, 9),
          leadId: id,
          action: 'رفع ملف ليدز (Bulk)',
          userId: currentUser?.id || 'sys',
          userName: currentUser?.name || 'النظام',
          createdAt: when,
        }]
      };
      
      const assignedTo = autoDistribute(lead, [...leads, ...acceptedInput as any]); // approximate distribution
      if (assignedTo) lead.assignedTo = assignedTo;
      return lead;
    });

    setLeads(prev => [...newLeads, ...prev]);
    addAuditEvent({
      action: 'رفع ملف ليدز',
      entityType: 'lead',
      details: `عدد الليدز المضافة: ${newLeads.length}`,
    });
    return {
      created: newLeads.length,
      failed: rejectedUpfront,
    };
  };

  const updateLeadStatus = (leadId: string, status: LeadStatus, note?: string) => {
    if (!currentUser) return;
    const targetLead = leads.find((l) => l.id === leadId);
    if (!targetLead) return;
    const canUpdate =
      currentUser.role === 'مالك' ||
      currentUser.role === 'مدير مبيعات' ||
      (currentUser.role === 'مندوب' && targetLead.assignedTo === currentUser.id);
    if (!canUpdate) return;
    if (isServerDataMode()) {
      void (async () => {
        try {
          const lossReason =
            status === 'مغلق - خسارة'
              ? (note?.match(/loss_reason=([a-z_]+)/)?.[1] as Lead['lossReasonCode'] | undefined)
              : undefined;
          const updated = await serverPatchLead(leadId, {
            status,
            note,
            ...(lossReason ? { lossReasonCode: lossReason } : {}),
          });
          setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
          addAuditEvent({
            action: 'تغيير حالة ليد',
            entityType: 'lead',
            entityId: leadId,
            details: `الحالة الجديدة: ${status}${note ? ` | ملاحظة: ${note}` : ''}`,
          });
        } catch {
          /* فشل الشبكة */
        }
      })();
      return;
    }
    setLeads(prev => prev.map(lead => {
      if (lead.id === leadId) {
        const lossReasonCode =
          status === 'مغلق - خسارة'
            ? (note?.match(/loss_reason=([a-z_]+)/)?.[1] as Lead['lossReasonCode'] | undefined)
            : undefined;
        const newActivity: Activity = {
          id: Math.random().toString(36).substr(2, 9),
          leadId,
          action: `تغيير الحالة إلى ${status}`,
          note,
          userId: currentUser?.id || 'sys',
          userName: currentUser?.name || 'النظام',
          createdAt: new Date().toISOString()
        };
        return {
          ...lead,
          status,
          lossReasonCode: status === 'مغلق - خسارة' ? (lossReasonCode || lead.lossReasonCode) : lead.lossReasonCode,
          updatedAt: new Date().toISOString(),
          timeline: [newActivity, ...lead.timeline],
        };
      }
      return lead;
    }));
    addAuditEvent({
      action: 'تغيير حالة ليد',
      entityType: 'lead',
      entityId: leadId,
      details: `الحالة الجديدة: ${status}${note ? ` | ملاحظة: ${note}` : ''}`,
    });
  };

  const logLeadInteraction = (
    leadId: string,
    action: string,
    note?: string,
    meta?: Partial<Pick<Activity, 'channelType' | 'evidenceType' | 'evidenceRef' | 'durationSeconds'>>
  ) => {
    if (!currentUser) return;
    const targetLead = leads.find((l) => l.id === leadId);
    if (!targetLead) return;
    const canLog =
      currentUser.role === 'مالك' ||
      currentUser.role === 'مدير مبيعات' ||
      (currentUser.role === 'مندوب' && targetLead.assignedTo === currentUser.id);
    if (!canLog) return;
    if (isServerDataMode()) {
      void (async () => {
        try {
          const updated = await serverPatchLead(leadId, {
            appendActivity: {
              action,
              note,
              ...(meta?.channelType ? { channelType: meta.channelType } : {}),
              ...(meta?.evidenceType ? { evidenceType: meta.evidenceType } : {}),
              ...(meta?.evidenceRef ? { evidenceRef: meta.evidenceRef, qaStatus: 'pending' as const } : {}),
              ...(typeof meta?.durationSeconds === 'number'
                ? { durationSeconds: Math.max(0, Math.round(meta.durationSeconds)) }
                : {}),
            },
          });
          setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
        } catch {
          /* ignore */
        }
      })();
      addAuditEvent({
        action: 'تسجيل تفاعل مع ليد',
        entityType: 'lead',
        entityId: leadId,
        details: action,
      });
      return;
    }
    setLeads(prev => prev.map(lead => {
      if (lead.id === leadId) {
        const newActivity: Activity = {
          id: Math.random().toString(36).substr(2, 9),
          leadId,
          action,
          note,
          channelType: meta?.channelType,
          evidenceType: meta?.evidenceType,
          evidenceRef: meta?.evidenceRef,
          durationSeconds: typeof meta?.durationSeconds === 'number' ? Math.max(0, Math.round(meta.durationSeconds)) : undefined,
          qaStatus: meta?.evidenceRef ? 'pending' : undefined,
          userId: currentUser?.id || 'sys',
          userName: currentUser?.name || 'النظام',
          createdAt: new Date().toISOString(),
        };
        return { ...lead, updatedAt: new Date().toISOString(), timeline: [newActivity, ...lead.timeline] };
      }
      return lead;
    }));
    addAuditEvent({
      action: 'تسجيل تفاعل مع ليد',
      entityType: 'lead',
      entityId: leadId,
      details: `${action}${note ? ` | ${note}` : ''}${meta?.evidenceRef ? ` | evidence=${meta.evidenceRef}` : ''}`,
    });
  };

  const reviewLeadActivity = (
    leadId: string,
    activityId: string,
    decision: 'approved' | 'rejected',
    comment?: string
  ) => {
    if (!(currentUser?.role === 'مدير مبيعات' || currentUser?.role === 'مالك')) return false;
    if (isServerDataMode()) {
      void (async () => {
        try {
          const updated = await serverPatchLead(leadId, {
            reviewActivity: { activityId, decision, comment },
          });
          setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
          addAuditEvent({
            action: decision === 'approved' ? 'اعتماد جودة تفاعل عميل' : 'رفض جودة تفاعل عميل',
            entityType: 'lead',
            entityId: leadId,
            details: `activity=${activityId}${comment ? ` | ${comment}` : ''}`,
          });
        } catch {
          /* ignore */
        }
      })();
      return true;
    }
    let ok = false;
    setLeads((prev) => prev.map((lead) => {
      if (lead.id !== leadId) return lead;
      const nextTimeline = lead.timeline.map((a) => {
        if (a.id !== activityId) return a;
        ok = true;
        return {
          ...a,
          qaStatus: decision,
          qaReviewedAt: new Date().toISOString(),
          qaReviewedById: currentUser.id,
          qaReviewedByName: currentUser.name,
          qaComment: comment?.trim() || undefined,
        };
      });
      return ok ? { ...lead, timeline: nextTimeline, updatedAt: new Date().toISOString() } : lead;
    }));
    if (!ok) return false;
    addAuditEvent({
      action: decision === 'approved' ? 'اعتماد جودة تفاعل عميل' : 'رفض جودة تفاعل عميل',
      entityType: 'lead',
      entityId: leadId,
      details: `activity=${activityId}${comment ? ` | ${comment}` : ''}`,
    });
    return true;
  };

  const setLeadFollowUp = (leadId: string, followUpAt?: string) => {
    if (!currentUser) return;
    const targetLead = leads.find((l) => l.id === leadId);
    if (!targetLead) return;
    const canSetFollowUp =
      currentUser.role === 'مالك' ||
      currentUser.role === 'مدير مبيعات' ||
      (currentUser.role === 'مندوب' && targetLead.assignedTo === currentUser.id);
    if (!canSetFollowUp) return;
    if (isServerDataMode()) {
      void (async () => {
        try {
          const note = followUpAt
            ? `الموعد: ${new Date(followUpAt).toLocaleString('ar-EG')}`
            : undefined;
          const updated = await serverPatchLead(leadId, {
            followUpAt: followUpAt ? followUpAt : null,
            appendActivity: {
              action: followUpAt ? 'تحديد موعد متابعة' : 'إلغاء موعد متابعة',
              note,
            },
          });
          setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
          addAuditEvent({
            action: followUpAt ? 'تحديد متابعة ليد' : 'إلغاء متابعة ليد',
            entityType: 'lead',
            entityId: leadId,
            details: followUpAt ? `followUp=${followUpAt}` : 'without follow up',
          });
        } catch {
          /* ignore */
        }
      })();
      return;
    }
    setLeads(prev => prev.map(lead => {
      if (lead.id !== leadId) return lead;
      const newActivity: Activity = {
        id: Math.random().toString(36).substr(2, 9),
        leadId,
        action: followUpAt ? 'تحديد موعد متابعة' : 'إلغاء موعد متابعة',
        note: followUpAt ? `الموعد: ${new Date(followUpAt).toLocaleString('ar-EG')}` : undefined,
        userId: currentUser?.id || 'sys',
        userName: currentUser?.name || 'النظام',
        createdAt: new Date().toISOString(),
      };
      return {
        ...lead,
        followUpAt: followUpAt || undefined,
        updatedAt: new Date().toISOString(),
        timeline: [newActivity, ...lead.timeline],
      };
    }));
    addAuditEvent({
      action: followUpAt ? 'تحديد متابعة ليد' : 'إلغاء متابعة ليد',
      entityType: 'lead',
      entityId: leadId,
      details: followUpAt ? `followUp=${followUpAt}` : 'without follow up',
    });
  };

  const assignLead = (leadId: string, userId?: string) => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return;
    const user = users.find(u => u.id === userId);
    if (userId && (!user || user.role !== 'مندوب')) return;
    if (isServerDataMode()) {
      void (async () => {
        try {
          const updated = await serverPatchLead(leadId, {
            assignedTo: userId || null,
            appendActivity: {
              action: userId ? `تعيين المندوب: ${user?.name || ''}` : 'إلغاء تعيين المندوب',
            },
          });
          setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
          addAuditEvent({
            action: userId ? 'تعيين ليد لمندوب' : 'إلغاء تعيين ليد',
            entityType: 'lead',
            entityId: leadId,
            details: userId ? `المندوب: ${user?.name || userId}` : 'بدون مندوب',
          });
        } catch {
          /* ignore */
        }
      })();
      return;
    }
    setLeads(prev => prev.map(lead => {
      if (lead.id === leadId) {
        const newActivity: Activity = {
          id: Math.random().toString(36).substr(2, 9),
          leadId,
          action: userId ? `تعيين المندوب: ${user?.name}` : 'إلغاء تعيين المندوب',
          userId: currentUser?.id || 'sys',
          userName: currentUser?.name || 'النظام',
          createdAt: new Date().toISOString()
        };
        return { ...lead, assignedTo: userId || undefined, updatedAt: new Date().toISOString(), timeline: [newActivity, ...lead.timeline] };
      }
      return lead;
    }));
    addAuditEvent({
      action: userId ? 'تعيين ليد لمندوب' : 'إلغاء تعيين ليد',
      entityType: 'lead',
      entityId: leadId,
      details: userId ? `المندوب: ${user?.name || userId}` : 'بدون مندوب',
    });
  };

  const assignLeadsBulk = async (leadIds: string[], userId?: string): Promise<number> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return 0;
    const user = users.find((u) => u.id === userId);
    if (userId && (!user || user.role !== 'مندوب')) return 0;
    const uniqueIds = [...new Set(leadIds.map((id) => String(id).trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return 0;

    if (isServerDataMode()) {
      const activityAction = userId
        ? `تعيين المندوب: ${user?.name || ''}`
        : 'إلغاء تعيين المندوب';
      const results = await Promise.allSettled(
        uniqueIds.map((leadId) =>
          serverPatchLead(leadId, {
            assignedTo: userId || null,
            appendActivity: { action: activityAction },
          }),
        ),
      );
      const updates = new Map<string, Lead>();
      let ok = 0;
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        updates.set(uniqueIds[index], result.value);
        ok += 1;
      });
      if (updates.size > 0) {
        setLeads((prev) => prev.map((l) => (updates.has(l.id) ? updates.get(l.id)! : l)));
        addAuditEvent({
          action: userId ? 'تعيين جماعي لليدز' : 'إلغاء تعيين جماعي لليدز',
          entityType: 'lead',
          details: userId
            ? `${ok} ليد → ${user?.name || userId}`
            : `إلغاء تعيين ${ok} ليد`,
        });
      }
      return ok;
    }

    const idSet = new Set(uniqueIds);
    let ok = 0;
    setLeads((prev) =>
      prev.map((lead) => {
        if (!idSet.has(lead.id)) return lead;
        ok += 1;
        const newActivity: Activity = {
          id: Math.random().toString(36).substr(2, 9),
          leadId: lead.id,
          action: userId ? `تعيين المندوب: ${user?.name}` : 'إلغاء تعيين المندوب',
          userId: currentUser?.id || 'sys',
          userName: currentUser?.name || 'النظام',
          createdAt: new Date().toISOString(),
        };
        return {
          ...lead,
          assignedTo: userId || undefined,
          updatedAt: new Date().toISOString(),
          timeline: [newActivity, ...lead.timeline],
        };
      }),
    );
    if (ok > 0) {
      addAuditEvent({
        action: userId ? 'تعيين جماعي لليدز' : 'إلغاء تعيين جماعي لليدز',
        entityType: 'lead',
        details: userId
          ? `${ok} ليد → ${user?.name || userId}`
          : `إلغاء تعيين ${ok} ليد`,
      });
    }
    return ok;
  };

  const deleteLead = async (leadId: string): Promise<DeleteLeadResult> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return 'forbidden';
    const blockedByInvoice = invoices.some((i) => i.leadId === leadId);
    const blockedByQuote = priceQuotes.some((q) => q.leadId === leadId);
    if (blockedByInvoice || blockedByQuote) return 'blocked';
    const lead = leads.find((l) => l.id === leadId);
    if (isServerDataMode()) {
      try {
        await serverDeleteLead(leadId);
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        addAuditEvent({
          action: 'حذف ليد',
          entityType: 'lead',
          entityId: leadId,
          details: lead ? `${lead.name} — ${lead.company}` : leadId,
        });
        return 'deleted';
      } catch (e: unknown) {
        if (isSupabaseDirectMode()) {
          const msg = e instanceof Error ? e.message : '';
          if (/فواتير|عروض أسعار|مرتبطة/.test(msg)) return 'blocked';
          return 'failed';
        }
        const st = typeof e === 'object' && e !== null && 'status' in e ? (e as { status?: number }).status : undefined;
        if (st === 409) return 'blocked';
        return 'failed';
      }
    }
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    addAuditEvent({
      action: 'حذف ليد',
      entityType: 'lead',
      entityId: leadId,
      details: lead ? `${lead.name} — ${lead.company}` : leadId,
    });
    return 'deleted';
  };

  const deleteLeadsBulk = async (leadIds: string[]): Promise<BulkDeleteLeadsResult> => {
    const empty = { deleted: 0, blocked: 0, failed: 0 };
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return empty;
    const uniqueIds = [...new Set(leadIds.map((id) => String(id).trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return empty;

    let deleted = 0;
    let blocked = 0;
    let failed = 0;
    for (const leadId of uniqueIds) {
      const result = await deleteLead(leadId);
      if (result === 'deleted') deleted += 1;
      else if (result === 'blocked') blocked += 1;
      else failed += 1;
    }

    if (deleted > 0) {
      addAuditEvent({
        action: 'حذف جماعي لليدز',
        entityType: 'lead',
        details: `تم حذف ${deleted} ليد${blocked ? ` — تخطي ${blocked} مرتبط بفواتير/عروض` : ''}${failed ? ` — فشل ${failed}` : ''}`,
      });
    }
    return { deleted, blocked, failed };
  };

  const updateUserSkills = async (userId: string, skills: string[]): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return false;
    if (isServerDataMode()) {
      const prevUser = users.find((u) => u.id === userId);
      try {
        const updated = await patchUserApi(userId, { skills });
        const normalized = normalizeUser({ ...updated, authSource: 'database' });
        setUsers((prev) => prev.map((u) => (u.id === userId ? normalized : u)));
        addAuditEvent({
          action: 'تحديث مهارات مندوب',
          entityType: 'user',
          entityId: userId,
          details: `${normalized.name}: ${skills.join(', ')}`,
        });
        return true;
      } catch {
        if (prevUser) setUsers((prev) => prev.map((u) => (u.id === userId ? prevUser : u)));
        return false;
      }
    }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, skills } : u));
    const user = users.find(u => u.id === userId);
    addAuditEvent({
      action: 'تحديث مهارات مندوب',
      entityType: 'user',
      entityId: userId,
      details: `${user?.name || userId}: ${skills.join(', ')}`,
    });
    return true;
  };

  const addEmployee = async (employee: {
    name: string;
    role: User['role'];
    baseSalary?: number;
    avatar?: string;
    email?: string;
    password?: string;
  }): Promise<boolean> => {
    const cleanName = employee.name.trim();
    if (!cleanName) {
      toast.error('اكتب اسم الموظف');
      return false;
    }
    const canAddStaff = currentUser?.role === 'مالك' || currentUser?.role === 'محاسب';
    if (!canAddStaff) {
      toast.error('إضافة الموظفين متاحة للمالك أو المحاسب فقط');
      return false;
    }
    if (currentUser?.role === 'محاسب' && employee.role === 'مالك') {
      toast.error('لا يمكن إنشاء حساب مالك من حساب المحاسب');
      return false;
    }
    const payrollSalaryRoles: User['role'][] = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];
    const fromOwnerAdd = currentUser?.role === 'مالك';
    const includeBaseSalary = fromOwnerAdd || payrollSalaryRoles.includes(employee.role);
    if (isServerDataMode()) {
      const emailRaw = typeof employee.email === 'string' ? employee.email.trim().toLowerCase() : '';
      const pwdRaw = typeof employee.password === 'string' ? employee.password.trim() : '';
      try {
        const { user: created, tempPassword } = await createUserApi({
          name: cleanName,
          role: employee.role,
          avatar: employee.avatar,
          baseSalary: includeBaseSalary ? Math.max(0, Number(employee.baseSalary) || 0) : undefined,
          ...(emailRaw ? { email: emailRaw } : {}),
          ...(pwdRaw.length >= 8 ? { password: pwdRaw } : {}),
        });
        setUsers((prev) => [normalizeUser({ ...created, authSource: 'database' }), ...prev]);
        const loginEmail =
          typeof created.email === 'string' && created.email.trim() ? created.email.trim() : emailRaw || '—';
        const internalEmailNote =
          isSupabaseDirectMode() && loginEmail.endsWith('@staff.internal')
            ? '\n(بريد داخلي — لتمكين الدخول أضف بريداً حقيقياً وكلمة مرور 8 أحرف من تعديل الموظف أو أنشئ حساباً جديداً.)'
            : '';
        if (tempPassword) {
          toast.success(`تم إنشاء حساب الدخول (${created.role})`, {
            description: `البريد: ${loginEmail}\nكلمة مرور مؤقتة (انسَخها وحفّظها للموظف): ${tempPassword}`,
            duration: 25_000,
          });
        } else if (pwdRaw.length >= 8) {
          toast.success(`تم إنشاء الموظف — الدور: ${created.role}`, {
            description: isSupabaseDirectMode()
              ? `البريد: ${loginEmail}\nيمكنه تسجيل الدخول فوراً بنفس البريد وكلمة المرور.`
              : `البريد: ${loginEmail}`,
            duration: 12_000,
          });
        } else {
          toast.success(`تم إنشاء الموظف — الدور: ${created.role}`, {
            description: `البريد: ${loginEmail}${internalEmailNote}`,
            duration: 12_000,
          });
        }
        addAuditEvent({
          action: 'إضافة موظف جديد',
          entityType: 'user',
          entityId: created.id,
          details: `${created.name} - ${created.role}${includeBaseSalary && (employee.baseSalary ?? 0) > 0 ? ` - مرتب أساسي ${employee.baseSalary ?? 0}` : ''}`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر إنشاء الموظف — تحقق من الشبكة أو أن البريد غير مكرر';
        toast.error(msg);
        return false;
      }
    }
    toast.error('غير متاح — اضبط وضع البيانات على السيرفر (مثلاً VITE_DATA_SOURCE=server) أو Supabase، وتأكد أن الخادم يعمل');
    return false;
  };

  const addManualCustomer = async (payload: {
    name: string;
    company?: string;
    phone?: string;
    email?: string;
    sourceLabel?: string;
  }): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'محاسب')) return false;
    const name = payload.name.trim();
    if (!name) return false;
    if (isServerDataMode()) {
      try {
        const row = await createManualCustomerApi({
          name,
          company: payload.company,
          phone: payload.phone,
          email: payload.email,
          sourceLabel: payload.sourceLabel,
        });
        setManualCustomers((prev) => [row, ...prev]);
        addAuditEvent({
          action: 'إضافة عميل يدوي',
          entityType: 'system',
          entityId: name,
          details: `${name} (${currentUser.role})`,
        });
        return true;
      } catch {
        return false;
      }
    }
    const next: ManualCustomer = {
      id: `CUS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerCode: buildCustomerCodeFromSeed(`${payload.name}-${Date.now()}`),
      name,
      company: payload.company?.trim() || undefined,
      phone: payload.phone?.trim() || undefined,
      email: payload.email?.trim() || undefined,
      sourceLabel: payload.sourceLabel?.trim() || 'يدوي',
      createdAt: new Date().toISOString(),
      createdById: currentUser.id,
      createdByName: currentUser.name,
      createdByRole: currentUser.role,
    };
    setManualCustomers((prev) => [next, ...prev]);
    addAuditEvent({
      action: 'إضافة عميل يدوي',
      entityType: 'system',
      entityId: next.id,
      details: `${next.name} (${next.createdByRole})`,
    });
    return true;
  };

  const updateEmployeeSalary = async (userId: string, baseSalary: number): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const v = Math.max(0, Number(baseSalary) || 0);
    if (isServerDataMode()) {
      const prevUser = users.find((u) => u.id === userId);
      try {
        const updated = await patchUserApi(userId, { baseSalary: v });
        const normalized = normalizeUser({ ...updated, authSource: 'database' });
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? normalized : u))
        );
        addAuditEvent({
          action: 'تحديث راتب أساسي',
          entityType: 'user',
          entityId: userId,
          details: `${normalized.name} - ${v} ج.م`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر حفظ الراتب على السيرفر';
        toast.error(msg);
        if (prevUser) setUsers((prev) => prev.map((u) => (u.id === userId ? prevUser : u)));
        return false;
      }
    }
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      return { ...u, baseSalary: v };
    }));
    const user = users.find(u => u.id === userId);
    addAuditEvent({
      action: 'تحديث راتب أساسي',
      entityType: 'user',
      entityId: userId,
      details: `${user?.name || userId} - ${v} ج.م`,
    });
    return true;
  };

  const updateEmployeeProfile = async (
    userId: string,
    patch: { name?: string; avatar?: string; role?: User['role']; email?: string; baseSalary?: number }
  ): Promise<boolean> => {
    if (!currentUser) return false;
    const target = users.find((u) => u.id === userId);
    if (!target) return false;

    const isOwner = currentUser.role === 'مالك';
    const isSelf = currentUser.id === userId;
    if (!isOwner && !isSelf) return false;
    if (isOwner && target.id === 'u1' && patch.role && patch.role !== 'مالك') return false;
    if (!isOwner && isSelf && patch.role != null) return false;

    const buildApiPatch = (): Parameters<typeof patchUserApi>[1] | null => {
      if (isOwner) {
        const p: Parameters<typeof patchUserApi>[1] = {};
        if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim();
        if (patch.role) p.role = patch.role;
        if (patch.avatar !== undefined) p.avatar = patch.avatar ? patch.avatar.trim() : null;
        if (typeof patch.email === 'string') {
          const em = patch.email.trim().toLowerCase();
          if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) p.email = em;
        }
        const cannotSetSalaryOnOtherOwner = target.role === 'مالك' && target.id !== currentUser.id;
        if (patch.baseSalary != null && !cannotSetSalaryOnOtherOwner) {
          p.baseSalary = Math.max(0, Math.round(Number(patch.baseSalary) || 0));
        }
        return Object.keys(p).length > 0 ? p : null;
      }
      const p: Parameters<typeof patchUserApi>[1] = {};
      if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim();
      if (patch.avatar !== undefined) p.avatar = patch.avatar ? patch.avatar.trim() : null;
      return Object.keys(p).length > 0 ? p : null;
    };

    const auditDetails = `${patch.name ? `name=${patch.name};` : ''}${patch.role ? `role=${patch.role};` : ''}${
      patch.avatar !== undefined ? 'avatar=updated;' : ''
    }${typeof patch.email === 'string' ? `email=${patch.email.trim()};` : ''}${
      patch.baseSalary != null ? `baseSalary=${patch.baseSalary};` : ''
    }`;

    if (isServerDataMode()) {
      const apiPatch = buildApiPatch();
      if (!apiPatch || Object.keys(apiPatch).length === 0) return false;
      try {
        const updated = await patchUserApi(userId, apiPatch);
        const normalized = normalizeUser({ ...updated, authSource: 'database' });
        setUsers((prev) => prev.map((u) => (u.id === userId ? normalized : u)));
        setCurrentUserState((cu) => {
          if (readSessionSignedOut()) return cu;
          return cu?.id === userId ? normalized : cu;
        });
        addAuditEvent({
          action: 'تعديل ملف موظف',
          entityType: 'user',
          entityId: userId,
          details: auditDetails,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر حفظ التعديل على السيرفر';
        toast.error(msg);
        return false;
      }
    }

    if (isOwner) {
      let applied = false;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u;
          const nextRole = patch.role || u.role;
          const nextName = typeof patch.name === 'string' ? patch.name.trim() : u.name;
          const nextAvatar =
            patch.avatar !== undefined
              ? typeof patch.avatar === 'string'
                ? patch.avatar.trim()
                : u.avatar
              : u.avatar;
          const nextEmail =
            typeof patch.email === 'string' && patch.email.trim()
              ? patch.email.trim().toLowerCase()
              : u.email;
          if (!nextName) return u;
          applied = true;
          return {
            ...u,
            name: nextName,
            email: nextEmail,
            avatar: nextAvatar || u.avatar,
            role: nextRole,
            skills: nextRole === 'مندوب' ? (u.skills || []) : [],
            baseSalary: (() => {
              const cannot = u.role === 'مالك' && u.id !== currentUser?.id;
              if (cannot) return u.baseSalary ?? 0;
              return patch.baseSalary != null
                ? Math.max(0, Math.round(Number(patch.baseSalary) || 0))
                : (u.baseSalary ?? 0);
            })(),
          };
        }),
      );
      if (!applied) return false;
      setCurrentUserState((cu) => {
        if (readSessionSignedOut()) return cu;
        if (!cu || cu.id !== userId) return cu;
        const nextRole = patch.role || cu.role;
        const nextName = typeof patch.name === 'string' ? patch.name.trim() : cu.name;
        const nextAvatar =
          patch.avatar !== undefined
            ? typeof patch.avatar === 'string'
              ? patch.avatar.trim()
              : cu.avatar
            : cu.avatar;
        const nextEmail =
          typeof patch.email === 'string' && patch.email.trim()
            ? patch.email.trim().toLowerCase()
            : cu.email;
        if (!nextName) return cu;
        return {
          ...cu,
          name: nextName,
          email: nextEmail,
          avatar: nextAvatar || cu.avatar,
          role: nextRole,
          skills: nextRole === 'مندوب' ? (cu.skills || []) : [],
          baseSalary: (() => {
            const cannot = cu.role === 'مالك' && currentUser && cu.id !== currentUser.id;
            if (cannot) return cu.baseSalary ?? 0;
            return patch.baseSalary != null
              ? Math.max(0, Math.round(Number(patch.baseSalary) || 0))
              : (cu.baseSalary ?? 0);
          })(),
        };
      });
      addAuditEvent({
        action: 'تعديل ملف موظف',
        entityType: 'user',
        entityId: userId,
        details: auditDetails,
      });
      return true;
    }

    const selfRow = users.find((x) => x.id === userId);
    if (!selfRow) return false;
    if (typeof patch.name === 'string' && !patch.name.trim() && patch.avatar === undefined) return false;
    const nextSelfName =
      typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : selfRow.name;
    let nextSelfAvatar: string | undefined = selfRow.avatar;
    if (patch.avatar !== undefined) {
      nextSelfAvatar = patch.avatar ? patch.avatar.trim() : undefined;
    }
    if (nextSelfName === selfRow.name && nextSelfAvatar === selfRow.avatar) return false;

    const nextAvatar: string =
      (nextSelfAvatar ?? selfRow.avatar) ||
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop';

    setUsers((prev) =>
      prev.map((row) => (row.id === userId ? { ...row, name: nextSelfName, avatar: nextAvatar } : row))
    );
    setCurrentUserState((cu) => {
      if (readSessionSignedOut()) return cu;
      return cu?.id === userId ? { ...cu, name: nextSelfName, avatar: nextAvatar } : cu;
    });
    addAuditEvent({
      action: 'تعديل ملف موظف',
      entityType: 'user',
      entityId: userId,
      details: auditDetails,
    });
    return true;
  };

  const ownerSetEmployeePassword = async (userId: string, newPassword: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') {
      toast.error('تعيين باسورد الموظف متاح للمالك فقط');
      return false;
    }
    if (currentUser.id === userId) {
      toast.info('استخدم قسم «كلمة مرور حساب المالك» أعلاه لتغيير باسوردك');
      return false;
    }
    const target = users.find((u) => u.id === userId);
    if (!target) {
      toast.error('لم يُعثر على الموظف');
      return false;
    }
    if (target.role === 'مالك') {
      toast.error('لا يمكن تغيير كلمة مرور حساب مالك آخر من هنا');
      return false;
    }
    const pwd = String(newPassword || '').trim();
    if (pwd.length < 8) {
      toast.error('كلمة المرور ٨ أحرف أو أكثر');
      return false;
    }
    if (!isServerDataMode()) {
      toast.error('غير متاح في الوضع المحلي بدون سيرفر');
      return false;
    }
    try {
      await patchUserApi(userId, { newPassword: pwd });
      addAuditEvent({
        action: 'تعيين كلمة مرور موظف (مالك)',
        entityType: 'user',
        entityId: userId,
        details: target.name,
      });
      toast.success('تم تحديث كلمة مرور الموظف');
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'تعذر تحديث كلمة المرور';
      toast.error(msg);
      return false;
    }
  };

  const removeEmployee = async (userId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const target = users.find((u) => u.id === userId);
    if (!target) {
      toast.error('لم يُعثر على الموظف في القائمة');
      return false;
    }
    if (target.role === 'مالك') {
      toast.error('لا يمكن حذف حساب مالك');
      return false;
    }
    if (target.id === 'u1') {
      toast.error('لا يمكن حذف المالك الأساسي');
      return false;
    }
    if (currentUser.id === userId) {
      toast.error('لا يمكن حذف الحساب المفتوح حالياً');
      return false;
    }

    if (isServerDataMode()) {
      try {
        await deleteUserApi(userId);
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setLeads((prev) =>
          prev.map((l) => (l.assignedTo === userId ? { ...l, assignedTo: undefined } : l))
        );
        addAuditEvent({
          action: 'حذف موظف',
          entityType: 'user',
          entityId: userId,
          details: `${target.name} - ${target.role}`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر الحذف — تحقق من الجلسة والشبكة';
        toast.error(msg);
        if (msg.includes('غير موجود')) {
          try {
            const fresh = await fetchUsersApi();
            setUsers(fresh.map((u) => normalizeUser({ ...u, authSource: 'database' })));
          } catch {
            setUsers((prev) => prev.filter((u) => u.id !== userId));
          }
        }
        return false;
      }
    }

    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setLeads((prev) => prev.map((l) => (l.assignedTo === userId ? { ...l, assignedTo: undefined } : l)));
    setCustodyFunds((prev) => prev.map((f) => {
      if (f.productionManagerId !== userId) return f;
      return {
        ...f,
        productionManagerId: '',
        productionManagerName: '',
        status: f.status === 'مقفلة' ? f.status : 'مسودة',
      };
    }));
    addAuditEvent({
      action: 'حذف موظف',
      entityType: 'user',
      entityId: userId,
      details: `${target.name} - ${target.role}`,
    });
    return true;
  };

  const isMonthClosed = (monthKey: string) => closedMonths.includes(monthKey);

  const closeMonth = async (monthKey: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    if (isServerDataMode()) {
      try {
        const list = await postCloseMonthApi(monthKey);
        setClosedMonths(list);
        addAuditEvent({
          action: 'تقفيل شهر محاسبي',
          entityType: 'system',
          details: `month=${monthKey}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setClosedMonths((prev) => (prev.includes(monthKey) ? prev : [monthKey, ...prev]));
    addAuditEvent({
      action: 'تقفيل شهر محاسبي',
      entityType: 'system',
      details: `month=${monthKey}`,
    });
    return true;
  };

  const reopenMonth = async (monthKey: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    if (isServerDataMode()) {
      try {
        const list = await postReopenMonthApi(monthKey);
        setClosedMonths(list);
        addAuditEvent({
          action: 'إعادة فتح شهر محاسبي',
          entityType: 'system',
          details: `month=${monthKey}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setClosedMonths((prev) => prev.filter((m) => m !== monthKey));
    addAuditEvent({
      action: 'إعادة فتح شهر محاسبي',
      entityType: 'system',
      details: `month=${monthKey}`,
    });
    return true;
  };

  const requestMonthReopen = async (monthKey: string, reason: string): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    if (!isMonthClosed(monthKey)) return false;
    if (!reason.trim()) return false;
    if (financialReopenRequests.some((r) => r.monthKey === monthKey && r.status === 'بانتظار_اعتماد_المالك')) return false;
    const req: FinancialPeriodReopenRequest = {
      id: `RFR-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      monthKey,
      requestedAt: new Date().toISOString(),
      requestedById: currentUser.id,
      requestedByName: currentUser.name,
      reason: reason.trim(),
      status: 'بانتظار_اعتماد_المالك',
    };
    const next = [req, ...financialReopenRequests].slice(0, 500);
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ financialReopenRequests: next });
        setFinancialReopenRequests(next);
        addAuditEvent({
          action: 'طلب إعادة فتح شهر محاسبي',
          entityType: 'system',
          details: `month=${monthKey} | reason=${req.reason}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setFinancialReopenRequests(next);
    addAuditEvent({
      action: 'طلب إعادة فتح شهر محاسبي',
      entityType: 'system',
      details: `month=${monthKey} | reason=${req.reason}`,
    });
    return true;
  };

  const ownerApproveMonthReopenRequest = async (requestId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const target = financialReopenRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'بانتظار_اعتماد_المالك') return false;
    const nextRequests = financialReopenRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'معتمد' as const,
            approvedAt: new Date().toISOString(),
            approvedById: currentUser.id,
            approvedByName: currentUser.name,
          }
        : r
    );

    if (isServerDataMode()) {
      try {
        const list = await postReopenMonthApi(target.monthKey);
        setClosedMonths(list);
        try {
          await patchWorkspaceStateApi({ financialReopenRequests: nextRequests });
        } catch {
          /* الشهر أُعيد فتحه؛ قد يتأخر حفظ حالة الطلب في workspace */
        }
        setFinancialReopenRequests(nextRequests);
        addAuditEvent({
          action: 'اعتماد طلب إعادة فتح شهر محاسبي',
          entityType: 'system',
          entityId: requestId,
          details: `month=${target.monthKey}`,
        });
        return true;
      } catch {
        return false;
      }
    }

    setFinancialReopenRequests(nextRequests);
    setClosedMonths((prev) => prev.filter((m) => m !== target.monthKey));
    addAuditEvent({
      action: 'اعتماد طلب إعادة فتح شهر محاسبي',
      entityType: 'system',
      entityId: requestId,
      details: `month=${target.monthKey}`,
    });
    return true;
  };

  const ownerRejectMonthReopenRequest = async (requestId: string, reason?: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const target = financialReopenRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'بانتظار_اعتماد_المالك') return false;
    const next = financialReopenRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'مرفوض' as const,
            rejectedAt: new Date().toISOString(),
            rejectedById: currentUser.id,
            rejectedByName: currentUser.name,
            rejectReason: reason?.trim() || undefined,
          }
        : r
    );
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ financialReopenRequests: next });
        setFinancialReopenRequests(next);
        addAuditEvent({
          action: 'رفض طلب إعادة فتح شهر محاسبي',
          entityType: 'system',
          entityId: requestId,
          details: `month=${target.monthKey}${reason ? ` | reason=${reason}` : ''}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setFinancialReopenRequests(next);
    addAuditEvent({
      action: 'رفض طلب إعادة فتح شهر محاسبي',
      entityType: 'system',
      entityId: requestId,
      details: `month=${target.monthKey}${reason ? ` | reason=${reason}` : ''}`,
    });
    return true;
  };

  const addChartAccount = async (account: Omit<ChartOfAccount, 'isSystem'>): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const code = String(account.code || '').trim();
    const name = String(account.name || '').trim();
    if (!code || !name) return false;
    if (chartOfAccounts.some((a) => a.code === code)) return false;
    const snapshot = chartOfAccounts;
    const nextAccounts = [...snapshot, { ...account, code, name, isSystem: false as const }];
    setChartOfAccounts(nextAccounts);
    if (isServerDataMode()) {
      try {
        const saved = await patchWorkspaceStateApi({ chartOfAccounts: nextAccounts });
        const fromServer = normalizeChartOfAccounts(saved.chartOfAccounts);
        const merged = mergeChartOfAccountsLists(fromServer, nextAccounts);
        const finalAccounts = ensureCustodyAccountInChart(merged.length > 0 ? merged : nextAccounts);
        setChartOfAccounts(finalAccounts);
        writeAccountingCache(finalAccounts, journalCodingRules);
        if (fromServer.length < nextAccounts.length) {
          void patchWorkspaceStateApi({ chartOfAccounts: finalAccounts }).catch(() => {});
        }
      } catch (err) {
        setChartOfAccounts(snapshot);
        toast.error(accountingSaveErrorHint(err instanceof Error ? err.message : 'تعذر حفظ الحساب'));
        return false;
      }
    } else {
      writeAccountingCache(nextAccounts, journalCodingRules);
    }
    addAuditEvent({
      action: 'إضافة حساب بدليل الحسابات',
      entityType: 'system',
      details: `${code} - ${name}`,
    });
    return true;
  };

  const removeChartAccount = async (code: string): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const target = chartOfAccounts.find((a) => a.code === code);
    if (!target || target.isSystem) return false;
    const inUseByJournals = manualJournalEntries.some((e) => e.lines.some((l) => l.accountCode === code));
    if (inUseByJournals) return false;
    const snapshot = chartOfAccounts;
    const next = snapshot.filter((a) => a.code !== code);
    if (isServerDataMode()) {
      try {
        const saved = await patchWorkspaceStateApi({ chartOfAccounts: next });
        const fromServer = normalizeChartOfAccounts(saved.chartOfAccounts);
        const finalAccounts = fromServer.length > 0 ? fromServer : next;
        setChartOfAccounts(finalAccounts);
        writeAccountingCache(finalAccounts, journalCodingRules);
      } catch (err) {
        toast.error(accountingSaveErrorHint(err instanceof Error ? err.message : 'تعذر حذف الحساب'));
        return false;
      }
    } else {
      setChartOfAccounts(next);
      writeAccountingCache(next, journalCodingRules);
    }
    addAuditEvent({
      action: 'حذف حساب من دليل الحسابات',
      entityType: 'system',
      details: code,
    });
    return true;
  };

  const getManualJournalModifyBlockReason = useCallback(
    (id: string, newDate?: string): string | null => {
      const entry = manualJournalEntries.find((e) => e.id === id);
      if (!entry) return 'missing';
      const entryYear = new Date(entry.date).getFullYear().toString();
      if (closedFiscalYears.includes(entryYear)) return 'closed_year';
      const monthKey = getMonthKey(`${entry.date}T12:00:00.000Z`);
      if (isMonthClosed(monthKey)) return 'closed_month';
      if (newDate) {
        const newYear = new Date(newDate).getFullYear().toString();
        if (closedFiscalYears.includes(newYear)) return 'closed_year';
        const newMonthKey = getMonthKey(`${newDate}T12:00:00.000Z`);
        if (isMonthClosed(newMonthKey)) return 'closed_month';
      }
      const refInvoice = invoices.some((inv) =>
        (inv.collections || []).some((c) => c.journalEntryId === id),
      );
      const refCustody = custodyFunds.some(
        (f) =>
          f.journalEntryPaymentId === id ||
          f.journalEntrySettlementId === id ||
          f.journalEntryId === id,
      );
      if (refInvoice || refCustody) return 'linked';
      return null;
    },
    [manualJournalEntries, closedFiscalYears, isMonthClosed, invoices, custodyFunds],
  );

  const normalizeManualJournalPayload = (entry: Omit<ManualJournalEntry, 'id'>) => {
    const validAccountCodes = new Set(chartOfAccounts.map((a) => a.code));
    const normalizedLines = entry.lines.map((line) => ({
      ...line,
      accountCode: (line.accountCode || '').trim(),
      costCenter: (line.costCenter || 'عام').trim() || 'عام',
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
    }));
    if (normalizedLines.length === 0) return null;
    const hasInvalidCode = normalizedLines.some(
      (line) => !line.accountCode || !validAccountCodes.has(line.accountCode),
    );
    if (hasInvalidCode) return null;
    const totalDebit = normalizedLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = normalizedLines.reduce((sum, l) => sum + l.credit, 0);
    if (totalDebit <= 0 || totalCredit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) return null;
    return {
      date: entry.date,
      description: String(entry.description || '').trim(),
      lines: normalizedLines,
    };
  };

  const addManualJournalEntry = async (entry: Omit<ManualJournalEntry, 'id'>): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const entryYear = new Date(entry.date).getFullYear().toString();
    if (closedFiscalYears.includes(entryYear)) return false;
    const monthKey = getMonthKey(`${entry.date}T12:00:00.000Z`);
    if (isMonthClosed(monthKey)) return false;
    const normalized = normalizeManualJournalPayload(entry);
    if (!normalized) return false;
    const newEntry: ManualJournalEntry = {
      ...normalized,
      id: `JRN-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    };
    if (isServerDataMode()) {
      try {
        const saved = await createManualJournalApi(newEntry);
        setManualJournalEntries((prev) => [saved, ...prev]);
      } catch {
        return false;
      }
    } else {
      setManualJournalEntries((prev) => [newEntry, ...prev]);
    }
    addAuditEvent({
      action: 'إضافة قيد يومية يدوي',
      entityType: 'system',
      entityId: newEntry.id,
      details: newEntry.description,
    });
    return true;
  };

  const updateManualJournalEntry = async (
    id: string,
    entry: Omit<ManualJournalEntry, 'id'>,
  ): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    if (getManualJournalModifyBlockReason(id, entry.date)) return false;
    const normalized = normalizeManualJournalPayload(entry);
    if (!normalized) return false;
    const updatedEntry: ManualJournalEntry = { id, ...normalized };
    if (isServerDataMode()) {
      try {
        const saved = await updateManualJournalApi(id, normalized);
        setManualJournalEntries((prev) => prev.map((e) => (e.id === id ? saved : e)));
      } catch {
        return false;
      }
    } else {
      setManualJournalEntries((prev) => prev.map((e) => (e.id === id ? updatedEntry : e)));
    }
    addAuditEvent({
      action: 'تعديل قيد يومية يدوي',
      entityType: 'system',
      entityId: id,
      details: normalized.description,
    });
    return true;
  };

  const removeManualJournalEntry = async (id: string): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const entry = manualJournalEntries.find((e) => e.id === id);
    if (!entry) return false;
    if (getManualJournalModifyBlockReason(id)) return false;

    if (isServerDataMode()) {
      try {
        await deleteManualJournalApi(id);
        setManualJournalEntries((prev) => prev.filter((e) => e.id !== id));
      } catch {
        return false;
      }
    } else {
      setManualJournalEntries((prev) => prev.filter((e) => e.id !== id));
    }
    addAuditEvent({
      action: 'حذف قيد يومية يدوي',
      entityType: 'system',
      entityId: id,
      details: entry.description,
    });
    return true;
  };

  const closeFiscalYear = async (
    year: string,
    openingBalancesForNextYear: { accountCode: string; balance: number }[]
  ): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    if (closedFiscalYears.includes(year)) return false;
    const nextYears = [year, ...closedFiscalYears];
    const nextYear = String(Number(year) + 1);
    const nextOpenings = { ...openingBalancesByYear, [nextYear]: openingBalancesForNextYear };
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({
          closedFiscalYears: nextYears,
          openingBalancesByYear: nextOpenings,
        });
        setClosedFiscalYears(nextYears);
        setOpeningBalancesByYear(nextOpenings);
        addAuditEvent({
          action: 'تقفيل سنة مالية',
          entityType: 'system',
          details: `year=${year}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setClosedFiscalYears(nextYears);
    setOpeningBalancesByYear(nextOpenings);
    addAuditEvent({
      action: 'تقفيل سنة مالية',
      entityType: 'system',
      details: `year=${year}`,
    });
    return true;
  };

  const reopenFiscalYear = async (year: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const nextYears = closedFiscalYears.filter((y) => y !== year);
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ closedFiscalYears: nextYears });
        setClosedFiscalYears(nextYears);
        addAuditEvent({
          action: 'إعادة فتح سنة مالية',
          entityType: 'system',
          details: `year=${year}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setClosedFiscalYears(nextYears);
    addAuditEvent({
      action: 'إعادة فتح سنة مالية',
      entityType: 'system',
      details: `year=${year}`,
    });
    return true;
  };

  const getOpeningBalances = (year: string) => openingBalancesByYear[year] || [];

  const saveOpeningBalancesForYear = async (
    year: string,
    balances: { accountCode: string; balance: number }[]
  ): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'محاسب')) return false;
    const yearKey = String(year || '').trim();
    if (!/^\d{4}$/.test(yearKey)) return false;
    if (closedFiscalYears.includes(yearKey)) return false;
    const validCodes = new Set(chartOfAccounts.map((a) => a.code));
    const normalized = balances
      .map((b) => ({
        accountCode: String(b.accountCode || '').trim(),
        balance: Number(b.balance) || 0,
      }))
      .filter((b) => b.accountCode && validCodes.has(b.accountCode) && Math.abs(b.balance) > 0.001);
    const nextOpenings = { ...openingBalancesByYear, [yearKey]: normalized };
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ openingBalancesByYear: nextOpenings });
        setOpeningBalancesByYear(nextOpenings);
        addAuditEvent({
          action: 'تحديث أرصدة افتتاحية',
          entityType: 'system',
          details: `year=${yearKey} accounts=${normalized.length}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setOpeningBalancesByYear(nextOpenings);
    addAuditEvent({
      action: 'تحديث أرصدة افتتاحية',
      entityType: 'system',
      details: `year=${yearKey} accounts=${normalized.length}`,
    });
    return true;
  };

  const logAttendance = async (repId: string, type: 'in' | 'out', source: 'machine' | 'manual' = 'machine'): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const nowIso = new Date().toISOString();
    if (isPayrollApproved(getMonthKey(nowIso))) return false;
    const rec: AttendanceRecord = {
      id: `ATT-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
      repId,
      type,
      source,
      createdAt: nowIso,
    };
    if (isServerDataMode()) {
      try {
        const saved = await postAttendanceRecordApi(rec);
        setAttendanceRecords((prev) => [saved, ...prev].slice(0, 4000));
      } catch {
        return false;
      }
    } else {
      setAttendanceRecords((prev) => [rec, ...prev].slice(0, 4000));
    }
    const rep = users.find(u => u.id === repId);
    addAuditEvent({
      action: type === 'in' ? 'تسجيل حضور' : 'تسجيل انصراف',
      entityType: 'user',
      entityId: repId,
      details: `${rep?.name || repId} عبر ${source}`,
    });
    return true;
  };

  const isPayrollApproved = (monthKey: string) => payrollApprovals.some(p => p.monthKey === monthKey);
  const calcPayrollClaimsSummary = () => {
    const pendingExpensesRows = expenses.filter((e) => e.approvalStatus === 'قيد الاعتماد');
    const pendingExpensesCount = pendingExpensesRows.length;
    const pendingExpensesAmount = pendingExpensesRows.reduce((sum, e) => sum + Number(e.totalAmount || e.amount || 0), 0);

    const pendingShoot = shootBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب');
    const pendingEquipment = equipmentBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب');
    const pendingMeeting = meetingBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب');
    const pendingProdClaimsCount = pendingShoot.length + pendingEquipment.length + pendingMeeting.length;
    const pendingProdClaimsAmount = [...pendingShoot, ...pendingEquipment, ...pendingMeeting]
      .reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0);

    const pendingCustodyRows = custodyFunds.filter((c) => c.status === 'بانتظار_دفع_محاسب');
    const pendingCustodyPaymentsCount = pendingCustodyRows.length;
    const pendingCustodyAmount = pendingCustodyRows.reduce((sum, c) => sum + Number(c.totalAmount || 0), 0);
    return {
      pendingExpensesCount,
      pendingProdClaimsCount,
      pendingCustodyPaymentsCount,
      totalEstimatedAmount: pendingExpensesAmount + pendingProdClaimsAmount + pendingCustodyAmount,
    };
  };

  const getSystemNotifications = useCallback((): SystemNotification[] => {
    return buildSystemNotifications({
      leads,
      users,
      expenses,
      invoices,
      payrollApprovals,
      payrollApprovalRequests,
      monthlyTargets,
      shootBookings,
      equipmentBookings,
      meetingBookings,
      priceQuotes,
      custodyFunds,
      leadIngestionSettings,
      slaEscalationSettings,
      attendanceRecordsCount: attendanceRecords.length,
      personalTodosByUserId,
      financialReopenRequests,
    });
  }, [
    leads,
    expenses,
    invoices,
    payrollApprovals,
    payrollApprovalRequests,
    users,
    monthlyTargets,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    priceQuotes,
    custodyFunds,
    leadIngestionSettings,
    slaEscalationSettings,
    attendanceRecords,
    personalTodosByUserId,
    financialReopenRequests,
  ]);

  const requestPayrollApproval = async (
    monthKey: string,
    mode: 'manual' | 'scheduled' = 'manual'
  ): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    if (isPayrollApproved(monthKey)) return false;
    if (payrollApprovalRequests.some((r) => r.monthKey === monthKey && r.status === 'بانتظار_اعتماد_المالك')) return false;
    const req: PayrollApprovalRequest = {
      id: `PRQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      monthKey,
      requestedAt: new Date().toISOString(),
      requestedById: currentUser.id,
      requestedByName: currentUser.name,
      requestMode: mode,
      status: 'بانتظار_اعتماد_المالك',
      claimsSummary: calcPayrollClaimsSummary(),
    };
    const next = [req, ...payrollApprovalRequests];
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ payrollApprovalRequests: next });
        setPayrollApprovalRequests(next);
        addAuditEvent({
          action: 'إرسال طلب اعتماد كشف المرتبات',
          entityType: 'system',
          entityId: req.id,
          details: `month=${monthKey}; mode=${mode}; amount=${req.claimsSummary.totalEstimatedAmount}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setPayrollApprovalRequests(next);
    addAuditEvent({
      action: 'إرسال طلب اعتماد كشف المرتبات',
      entityType: 'system',
      entityId: req.id,
      details: `month=${monthKey}; mode=${mode}; amount=${req.claimsSummary.totalEstimatedAmount}`,
    });
    return true;
  };

  const approvePayroll = async (monthKey: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    if (isPayrollApproved(monthKey)) return false;
    const approval: PayrollApproval = {
      monthKey,
      approvedAt: new Date().toISOString(),
      approvedById: currentUser?.id || 'sys',
      approvedByName: currentUser?.name || 'النظام',
    };
    const next = [approval, ...payrollApprovals];
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ payrollApprovals: next });
        setPayrollApprovals(next);
        addAuditEvent({
          action: 'اعتماد كشف المرتبات',
          entityType: 'system',
          details: `month=${monthKey} by ${approval.approvedByName}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setPayrollApprovals(next);
    addAuditEvent({
      action: 'اعتماد كشف المرتبات',
      entityType: 'system',
      details: `month=${monthKey} by ${approval.approvedByName}`,
    });
    return true;
  };

  const reopenPayroll = async (monthKey: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const next = payrollApprovals.filter((p) => p.monthKey !== monthKey);
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ payrollApprovals: next });
        setPayrollApprovals(next);
        addAuditEvent({
          action: 'إلغاء اعتماد كشف المرتبات',
          entityType: 'system',
          details: `month=${monthKey}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setPayrollApprovals(next);
    addAuditEvent({
      action: 'إلغاء اعتماد كشف المرتبات',
      entityType: 'system',
      details: `month=${monthKey}`,
    });
    return true;
  };

  const ownerApprovePayrollRequest = async (requestId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const target = payrollApprovalRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'بانتظار_اعتماد_المالك') return false;
    if (isPayrollApproved(target.monthKey)) return false;
    const approval: PayrollApproval = {
      monthKey: target.monthKey,
      approvedAt: new Date().toISOString(),
      approvedById: currentUser.id,
      approvedByName: currentUser.name,
    };
    const nextApprovals = [approval, ...payrollApprovals];
    const nextRequests = payrollApprovalRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'معتمد' as const,
            approvedAt: approval.approvedAt,
            approvedById: currentUser.id,
            approvedByName: currentUser.name,
          }
        : r
    );
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({
          payrollApprovals: nextApprovals,
          payrollApprovalRequests: nextRequests,
        });
        setPayrollApprovals(nextApprovals);
        setPayrollApprovalRequests(nextRequests);
        addAuditEvent({
          action: 'اعتماد طلب كشف المرتبات',
          entityType: 'system',
          entityId: requestId,
          details: `month=${target.monthKey}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setPayrollApprovals(nextApprovals);
    setPayrollApprovalRequests(nextRequests);
    addAuditEvent({
      action: 'اعتماد طلب كشف المرتبات',
      entityType: 'system',
      entityId: requestId,
      details: `month=${target.monthKey}`,
    });
    return true;
  };

  const ownerRejectPayrollRequest = async (requestId: string, reason?: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const target = payrollApprovalRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'بانتظار_اعتماد_المالك') return false;
    const next = payrollApprovalRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'مرفوض' as const,
            rejectedAt: new Date().toISOString(),
            rejectedById: currentUser.id,
            rejectedByName: currentUser.name,
            rejectReason: reason,
          }
        : r
    );
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ payrollApprovalRequests: next });
        setPayrollApprovalRequests(next);
        addAuditEvent({
          action: 'رفض طلب كشف المرتبات',
          entityType: 'system',
          entityId: requestId,
          details: reason || '',
        });
        return true;
      } catch {
        return false;
      }
    }
    setPayrollApprovalRequests(next);
    addAuditEvent({
      action: 'رفض طلب كشف المرتبات',
      entityType: 'system',
      entityId: requestId,
      details: reason || '',
    });
    return true;
  };

  const syncPayrollSalesDiscounts = async (next: PayrollSalesDiscount[]): Promise<boolean> => {
    const capped = next.slice(0, 500);
    if (isServerDataMode()) {
      try {
        await patchWorkspaceStateApi({ payrollSalesDiscounts: capped });
        setPayrollSalesDiscounts(capped);
        return true;
      } catch {
        return false;
      }
    }
    setPayrollSalesDiscounts(capped);
    return true;
  };

  const getPayrollSalesDiscountTotal = useCallback(
    (repId: string, monthKey: string) =>
      payrollSalesDiscounts
        .filter((d) => d.repId === repId && d.monthKey === monthKey)
        .reduce((s, d) => s + Math.max(0, Math.round(Number(d.amount) || 0)), 0),
    [payrollSalesDiscounts],
  );

  const addPayrollSalesDiscount = async (input: {
    repId: string;
    monthKey?: string;
    amount: number;
    reason: string;
  }): Promise<boolean> => {
    const role = currentUser?.role;
    if (role !== 'مالك' && role !== 'مدير إنتاج') return false;
    const mk =
      input.monthKey?.trim() ||
      new Date().toISOString().slice(0, 7);
    if (isPayrollApproved(mk)) return false;
    const rep = users.find((u) => u.id === input.repId);
    if (!rep || rep.role !== 'مندوب') return false;
    const amount = Math.max(0, Math.round(Number(input.amount) || 0));
    const reason = String(input.reason || '').trim().slice(0, 500);
    if (amount <= 0 || !reason) return false;
    const entry: PayrollSalesDiscount = {
      id: `psd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      repId: rep.id,
      repName: rep.name,
      monthKey: mk,
      amount,
      reason,
      createdById: currentUser!.id,
      createdByName: currentUser!.name,
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...payrollSalesDiscounts];
    const ok = await syncPayrollSalesDiscounts(next);
    if (ok) {
      addAuditEvent({
        action: 'خصم على مندوب مبيعات',
        entityType: 'user',
        entityId: rep.id,
        details: `${amount} — ${mk} — ${reason.slice(0, 80)}`,
      });
    }
    return ok;
  };

  const removePayrollSalesDiscount = async (id: string): Promise<boolean> => {
    const role = currentUser?.role;
    if (role !== 'مالك' && role !== 'مدير إنتاج') return false;
    const target = payrollSalesDiscounts.find((d) => d.id === id);
    if (!target) return false;
    if (isPayrollApproved(target.monthKey)) return false;
    const next = payrollSalesDiscounts.filter((d) => d.id !== id);
    const ok = await syncPayrollSalesDiscounts(next);
    if (ok) {
      addAuditEvent({
        action: 'إلغاء خصم مندوب',
        entityType: 'user',
        entityId: target.repId,
        details: `${target.amount} — ${target.monthKey}`,
      });
    }
    return ok;
  };

  const updateAccountingPolicy = async (patch: Partial<AccountingPolicy>) => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return;
    if (isServerDataMode()) {
      const prevSnap = accountingPolicy;
      try {
        const next = await patchAccountingPolicyApi(patch);
        setAccountingPolicy((prev) => ({
          ...prev,
          ...next,
          allowedCostCentersForQuotes: Array.isArray(next.allowedCostCentersForQuotes)
            ? next.allowedCostCentersForQuotes
            : prev.allowedCostCentersForQuotes,
        }));
        addAuditEvent({
          action: 'تحديث سياسة قيود المحاسبة',
          entityType: 'system',
          details: 'AccountingPolicy',
        });
      } catch {
        setAccountingPolicy(prevSnap);
      }
      return;
    }
    setAccountingPolicy(prev => ({
      ...prev,
      ...patch,
      allowedCostCentersForQuotes: Array.isArray(patch.allowedCostCentersForQuotes)
        ? patch.allowedCostCentersForQuotes
        : prev.allowedCostCentersForQuotes,
    }));
    addAuditEvent({
      action: 'تحديث سياسة قيود المحاسبة',
      entityType: 'system',
      details: 'AccountingPolicy',
    });
  };

  const addPriceQuote = async (data: Omit<PriceQuote, 'id' | 'createdAt' | 'status' | 'createdById' | 'createdByName' | 'approvedBy' | 'approvedAt' | 'invoiceId' | 'pricedById' | 'pricedByName' | 'pricedAt'>): Promise<boolean> => {
    if (!currentUser) return false;
    if (!(currentUser.role === 'مندوب' || currentUser.role === 'مدير مبيعات')) return false;
    const normAr = (s: string) => s.trim().normalize('NFC');
    const cc = normAr(data.costCenter || 'عام');
    const allowed = accountingPolicy.allowedCostCentersForQuotes;
    if (allowed.length > 0 && !allowed.some((a) => normAr(a) === cc)) {
      const newAllowed = [...allowed, cc];
      setAccountingPolicy((prev) => ({ ...prev, allowedCostCentersForQuotes: newAllowed }));
      if (isServerDataMode()) {
        patchAccountingPolicyApi({ allowedCostCentersForQuotes: newAllowed }).catch(() => {});
      }
    }
    const amount = Number(data.amount) || 0;
    const routedToProduction = Boolean(String(data.productionAssignedId || '').trim());
    // مسار المندوب/مدير المبيعات: التسعير عبر مدير الإنتاج المحدد ثم المالك
    if (!routedToProduction) return false;
    const vatRate = typeof data.vatRate === 'number' ? data.vatRate : 14;
    const vatAmount = amount > 0 ? (data.vatAmount ?? Math.round(amount * (vatRate / 100))) : 0;
    const totalAmount = amount > 0 ? (data.totalAmount ?? amount + vatAmount) : 0;
    const initialStatus: PriceQuote['status'] = 'بانتظار التسعير';
    const q: PriceQuote = {
      ...data,
      amount,
      vatRate,
      vatAmount,
      totalAmount,
      costCenter: cc,
      id: `PQ-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      status: initialStatus,
      createdById: currentUser.id,
      createdByName: currentUser.name,
    };
    if (isServerDataMode()) {
      try {
        const row = await createPriceQuoteApi({
          id: q.id,
          leadId: q.leadId,
          customerName: q.customerName,
          title: q.title,
          amount: q.amount,
          vatRate: q.vatRate,
          vatAmount: q.vatAmount,
          totalAmount: q.totalAmount,
          costCenter: q.costCenter,
          note: q.note,
          createdById: q.createdById,
          createdByName: q.createdByName,
          productionAssignedId: q.productionAssignedId,
          productionAssignedName: q.productionAssignedName,
          pricingNote: q.pricingNote,
          status: q.status as PriceQuote['status'],
        });
        setPriceQuotes((prev) => [row, ...prev]);
        updateLeadStatus(data.leadId, 'عرض سعر', 'طلب عرض سعر — بانتظار تسعير الإنتاج');
        addAuditEvent({
          action: 'إرسال طلب تسعير لمدير الإنتاج',
          entityType: 'system',
          entityId: q.id,
          details: `${q.title} — ${q.customerName} → ${q.productionAssignedName || 'إنتاج'}`,
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[addPriceQuote] createPriceQuoteApi failed:', msg);
        throw new Error(msg);
      }
    }
    setPriceQuotes(prev => [q, ...prev]);
    updateLeadStatus(data.leadId, 'عرض سعر', 'طلب عرض سعر — بانتظار تسعير الإنتاج');
    addAuditEvent({
      action: 'إرسال طلب تسعير لمدير الإنتاج',
      entityType: 'system',
      entityId: q.id,
      details: `${q.title} — ${q.customerName} → ${q.productionAssignedName || 'إنتاج'}`,
    });
    return true;
  };

  const productionPriceQuote = async (
    quoteId: string,
    amount: number,
    vatRate: number,
    pricingNote?: string,
    companyMarginPercent?: number,
    productionCostAmount?: number,
  ): Promise<boolean> => {
    if (!currentUser) return false;
    if (!(currentUser.role === 'مدير إنتاج' || currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات')) return false;
    const quote = priceQuotes.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'بانتظار التسعير') return false;
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) return false;
    const vr = typeof vatRate === 'number' ? vatRate : 14;
    const vatAmount = Math.round(amt * (vr / 100));
    const totalAmount = amt + vatAmount;
    const nowIso = new Date().toISOString();
    const cmpRaw = typeof companyMarginPercent === 'number' ? companyMarginPercent : 0;
    const cmp = Math.min(100, Math.max(0, cmpRaw));
    const costStored =
      typeof productionCostAmount === 'number' && productionCostAmount >= 0
        ? Math.round(productionCostAmount)
        : undefined;
    const patch: Partial<PriceQuote> = {
      status: 'قيد اعتماد المالك',
      amount: amt,
      vatRate: vr,
      vatAmount,
      totalAmount,
      pricedById: currentUser.id,
      pricedByName: currentUser.name,
      pricedAt: nowIso,
      pricingNote: pricingNote?.trim() || undefined,
      companyMarginPercent: cmp,
      ...(costStored !== undefined ? { productionCostAmount: costStored } : {}),
    };
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, patch as Parameters<typeof patchPriceQuoteApi>[1]);
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...row } : q)));
      } catch {
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
      }
    } else {
      setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
    }
    addAuditEvent({
      action: 'تسعير عرض سعر من الإنتاج',
      entityType: 'system',
      entityId: quoteId,
      details: `${quote.title} — قبل ضريبة ${amt.toLocaleString()} ج.م${cmp > 0 ? ` — هامش شركة ${cmp}%` : ''}${costStored !== undefined ? ` — تكلفة بنود ${costStored.toLocaleString()} ج.م` : ''} — بانتظار اعتماد المالك`,
    });
    return true;
  };

  /** تحويل طلب التسعير لمدير إنتاج آخر */
  const reassignPricingRequest = async (quoteId: string, toUserId: string, toUserName: string): Promise<boolean> => {
    if (!currentUser) return false;
    if (!(currentUser.role === 'مدير إنتاج' || currentUser.role === 'مالك')) return false;
    const quote = priceQuotes.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'بانتظار التسعير') return false;
    const patch: Partial<PriceQuote> = { productionAssignedId: toUserId, productionAssignedName: toUserName };
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, patch as Parameters<typeof patchPriceQuoteApi>[1]);
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...row } : q)));
      } catch {
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
      }
    } else {
      setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
    }
    addAuditEvent({
      action: 'تحويل طلب تسعير',
      entityType: 'system',
      entityId: quoteId,
      details: `من ${currentUser.name} إلى ${toUserName} — ${quote.title}`,
    });
    return true;
  };

  const approvePriceQuote = async (quoteId: string, paymentSchedule?: PaymentInstallment[], initialPayment?: number): Promise<boolean> => {
    if (!currentUser) return false;
    const canApproveQuote = workflowRulesSettings.quoteRequiresOwnerApproval
      ? currentUser.role === 'مالك'
      : (currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات');
    if (!canApproveQuote) return false;
    const quote = priceQuotes.find(q => q.id === quoteId);
    if (!quote || quote.status !== 'قيد اعتماد المالك') return false;
    const nowIso = new Date().toISOString();
    if (isMonthClosed(getMonthKey(nowIso))) return false;
    // Owner approval: store payment terms suggestion, move to "معتمد" (awaiting client)
    // The invoice is created ONLY after the sales rep records the client's actual acceptance
    const schedulePatch: Partial<PriceQuote> = {
      status: 'معتمد',
      approvedBy: currentUser.name,
      approvedAt: nowIso,
      paymentSchedule: paymentSchedule?.length ? paymentSchedule : undefined,
      initialPayment: initialPayment || undefined,
    };
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, schedulePatch);
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...row } : q)));
      } catch {
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...schedulePatch } : q)));
      }
    } else {
      setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...schedulePatch } : q)));
    }
    addAuditEvent({
      action: 'اعتماد عرض سعر — بانتظار موافقة العميل',
      entityType: 'system',
      entityId: quoteId,
      details: `${quote.customerName} — سيُرسَل للمندوب لتقديمه للعميل`,
    });
    void notifyClientChannel(
      {
        type: 'quote_approved',
        quoteId,
        customerName: quote.customerName,
        title: quote.title,
        totalAmount: quote.totalAmount ?? quote.amount,
      },
      leadIngestionSettings.clientNotifyWebhookUrl,
    );
    return true;
  };

  /** إنشاء أمر شغل (حجز تصوير) لمدير الإنتاج بعد موافقة العميل على عرض السعر */
  const spawnWorkOrderFromAcceptedQuote = async (quote: PriceQuote): Promise<string | null> => {
    const pmId = String(quote.productionAssignedId || quote.pricedById || '').trim();
    if (!pmId) return null;
    const pmName = String(quote.productionAssignedName || quote.pricedByName || '').trim();
    const existing = shootBookings.find(
      (b) => b.workOrderFromQuote && b.priceQuoteId === quote.id && b.productionAssignedId === pmId,
    );
    if (existing) return existing.id;
    const estCost =
      typeof quote.productionCostAmount === 'number' && quote.productionCostAmount > 0
        ? quote.productionCostAmount
        : quote.amount;
    const scheduleNote =
      quote.paymentSchedule?.length
        ? `\nجدول دفع مقترح: ${quote.paymentSchedule.map((p) => `${p.amount} ج.م — ${p.dueDate}`).join(' | ')}`
        : '';
    const workOrderId = `SB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const plannedDate = new Date();
    plannedDate.setDate(plannedDate.getDate() + 7);
    const row: ShootBooking = {
      id: workOrderId,
      repId: quote.createdById,
      repName: quote.createdByName,
      leadId: quote.leadId,
      customerName: quote.customerName,
      date: plannedDate.toISOString().slice(0, 10),
      time: '10:00',
      location: 'يُحدد مع العميل',
      notes: [
        `أمر شغل من عرض سعر معتمد: ${quote.title}`,
        quote.note || '',
        quote.pricingNote ? `ملاحظة التسعير: ${quote.pricingNote}` : '',
        scheduleNote,
      ]
        .filter(Boolean)
        .join('\n'),
      status: 'معتمد',
      requestedByRole: 'مندوب',
      estimatedCost: estCost > 0 ? estCost : undefined,
      priceQuoteId: quote.id,
      productionAssignedId: pmId,
      productionAssignedName: pmName || undefined,
      workOrderFromQuote: true,
      workOrderChecklist: DEFAULT_WORK_ORDER_CHECKLIST.map((x) => ({ ...x })),
      financialStatus: estCost > 0 ? 'بانتظار_تنفيذ_إنتاج' : 'غير_مطلوب',
      createdAt: new Date().toISOString(),
    };
    if (isServerDataMode()) {
      try {
        const saved = await createShootBookingApi(row);
        if (!saved || typeof saved !== 'object') return null;
        setShootBookings((prev) => [saved, ...prev.filter((b) => b.id !== row.id)]);
        return saved.id;
      } catch {
        return null;
      }
    }
    setShootBookings((prev) => [row, ...prev]);
    return row.id;
  };

  /** المندوب يسجل موافقة العميل وتفاصيل الدفع الفعلية → ينشئ الفاتورة وأمر شغل للإنتاج */
  const repRecordClientAcceptance = async (
    quoteId: string,
    clientPayments: ClientPayment[],
  ): Promise<boolean> => {
    if (!currentUser) return false;
    if (!(currentUser.role === 'مندوب' || currentUser.role === 'مدير مبيعات')) return false;
    const quote = priceQuotes.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'معتمد') return false;
    if (!clientPayments.length) return false;
    const pmId = String(quote.productionAssignedId || quote.pricedById || '').trim();
    if (!pmId) {
      toast.error('لا يوجد مدير إنتاج مخصص لهذا العرض — راجع مسار التسعير');
      return false;
    }
    const nowIso = new Date().toISOString();
    const vatRate = typeof quote.vatRate === 'number' ? quote.vatRate : 14;
    const vatAmount = quote.vatAmount ?? Math.round(quote.amount * (vatRate / 100));
    const totalAmount = quote.totalAmount ?? quote.amount + vatAmount;
    const invId = `INV-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const leadCustomerCode = leads.find((l) => l.id === quote.leadId)?.customerCode;
    // first payment (immediate) becomes a collection entry; future ones stay as schedule
    const immediatePayment = clientPayments.find((p) => !p.dueDate || p.dueDate <= nowIso.slice(0, 10));
    const initCollections: InvoiceCollection[] = immediatePayment
      ? [{
          id: `COL-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          date: nowIso,
          amount: Math.round(immediatePayment.amount),
          method: immediatePayment.method,
          note: immediatePayment.note || 'دفعة فورية عند التعاقد',
        }]
      : [];
    const initPaid = initCollections.reduce((s, c) => s + c.amount, 0);
    const workOrderId = await spawnWorkOrderFromAcceptedQuote(quote);
    const quotePatch: Partial<PriceQuote> = {
      status: 'مكتمل',
      clientPayments,
      clientAcceptedAt: nowIso,
      invoiceId: invId,
    };
    const quotePatchLocal: Partial<PriceQuote> = workOrderId
      ? { ...quotePatch, workOrderShootBookingId: workOrderId }
      : quotePatch;
    const newInvoice: Invoice = {
      id: invId,
      leadId: quote.leadId,
      customerCode: leadCustomerCode || buildCustomerCodeFromSeed(quote.leadId || quote.customerName),
      customerName: quote.customerName,
      amount: quote.amount,
      vatRate,
      vatAmount,
      totalAmount,
      costCenter: quote.costCenter || 'عام',
      status: initPaid >= totalAmount ? 'مدفوع' : 'قيد الانتظار',
      date: nowIso,
      recordOrigin: 'عرض_سعر_معتمد',
      priceQuoteId: quote.id,
      collections: initCollections,
      paidAmount: initPaid,
      remainingAmount: totalAmount - initPaid,
    };
    if (isServerDataMode()) {
      try {
        const invRow = await createInvoiceApi({
          ...newInvoice,
          collections: initCollections,
        });
        const ni = normalizeInvoice(invRow);
        setInvoices((prev) => [ni, ...prev]);
        try {
          const row = await patchPriceQuoteApi(quoteId, { ...quotePatch, invoiceId: ni.id });
          setPriceQuotes((prev) =>
            prev.map((q) => (q.id === quoteId ? { ...q, ...row, ...quotePatchLocal, invoiceId: ni.id } : q)),
          );
        } catch {
          setPriceQuotes((prev) =>
            prev.map((q) => (q.id === quoteId ? { ...q, ...quotePatchLocal, invoiceId: ni.id } : q)),
          );
        }
      } catch {
        return false;
      }
    } else {
      setInvoices((prev) => [newInvoice, ...prev]);
      setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...quotePatchLocal } : q)));
    }
    updateLeadStatus(quote.leadId, 'مغلق - فوز', 'موافقة العميل على عرض السعر');
    addAuditEvent({
      action: 'موافقة العميل — فاتورة وأمر شغل للإنتاج',
      entityType: 'invoice',
      entityId: invId,
      details: `${quote.title} — ${quote.customerName} — ${totalAmount.toLocaleString()} ج.م${workOrderId ? ` — أمر شغل ${workOrderId}` : ''}`,
    });
    if (!workOrderId) {
      toast.warning('تمت الفاتورة لكن تعذر إنشاء أمر الشغل لمدير الإنتاج — راجع الحجوزات');
    }
    void notifyClientChannel(
      {
        type: 'quote_won',
        quoteId: quote.id,
        customerName: quote.customerName,
        title: quote.title,
        workOrderId: workOrderId ?? undefined,
      },
      leadIngestionSettings.clientNotifyWebhookUrl,
    );
    return true;
  };

  /** المندوب يسجل رفض العميل */
  const repRecordClientRejection = async (quoteId: string, note?: string): Promise<boolean> => {
    if (!currentUser) return false;
    if (!(currentUser.role === 'مندوب' || currentUser.role === 'مدير مبيعات')) return false;
    const quote = priceQuotes.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'معتمد') return false;
    const nowIso = new Date().toISOString();
    const patch: Partial<PriceQuote> = { status: 'مغلق - رفض العميل', clientRejectedAt: nowIso, clientRejectionNote: note?.trim() || undefined };
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, patch);
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...row } : q)));
      } catch {
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
      }
    } else {
      setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
    }
    addAuditEvent({ action: 'رفض العميل لعرض السعر', entityType: 'system', entityId: quoteId, details: note || quote.customerName });
    return true;
  };

  const ownerReturnPriceQuoteToProduction = async (quoteId: string, ownerNote?: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const quote = priceQuotes.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'قيد اعتماد المالك') return false;
    if (!quote.productionAssignedId && !quote.pricedById) return false;
    const stamp = `طلب تعديل من المالك (${new Date().toLocaleString('ar-EG')})`;
    const noteLine = ownerNote?.trim() ? `${stamp}: ${ownerNote.trim()}` : stamp;
    const mergedPricingNote = [quote.pricingNote?.trim(), noteLine].filter(Boolean).join('\n---\n');
    const patch: Partial<PriceQuote> = {
      status: 'بانتظار التسعير',
      pricingNote: mergedPricingNote,
    };
    if (!quote.productionAssignedId?.trim() && quote.pricedById) {
      patch.productionAssignedId = String(quote.pricedById).trim();
      if (quote.pricedByName) patch.productionAssignedName = String(quote.pricedByName).trim();
    }
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, patch as Parameters<typeof patchPriceQuoteApi>[1]);
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? { ...q, ...row } : q)));
      } catch {
        return false;
      }
    } else {
      setPriceQuotes((prev) =>
        prev.map((q) =>
          q.id === quoteId
            ? { ...q, ...patch, approvedBy: undefined, approvedAt: undefined }
            : q,
        ),
      );
    }
    addAuditEvent({
      action: 'إرجاع عرض سعر للإنتاج لإعادة التسعير',
      entityType: 'system',
      entityId: quoteId,
      details: ownerNote?.trim() || quote.customerName,
    });
    return true;
  };

  const rejectPriceQuote = async (quoteId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const quote = priceQuotes.find(q => q.id === quoteId);
    if (!quote || quote.status !== 'قيد اعتماد المالك') return false;
    if (isServerDataMode()) {
      try {
        const row = await patchPriceQuoteApi(quoteId, { status: 'مرفوض' });
        setPriceQuotes((prev) => prev.map((q) => (q.id === quoteId ? row : q)));
        addAuditEvent({
          action: 'رفض عرض سعر مالي',
          entityType: 'system',
          entityId: quoteId,
          details: quote.customerName,
        });
        return true;
      } catch {
        return false;
      }
    }
    setPriceQuotes(prev =>
      prev.map(q => (q.id === quoteId ? { ...q, status: 'مرفوض', approvedBy: currentUser!.name, approvedAt: new Date().toISOString() } : q))
    );
    addAuditEvent({
      action: 'رفض عرض سعر مالي',
      entityType: 'system',
      entityId: quoteId,
      details: quote.customerName,
    });
    return true;
  };

  const addInvoice = async (invoiceData: Omit<Invoice, 'id' | 'date'>): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    if (invoiceData.recordOrigin === 'عرض_سعر_معتمد') return false;
    const nowIso = new Date().toISOString();
    if (isMonthClosed(getMonthKey(nowIso))) return false;
    const vatRate = typeof invoiceData.vatRate === 'number' ? invoiceData.vatRate : 14;
    const vatAmount = Math.round(invoiceData.amount * (vatRate / 100));
    const normalizedCustomerName = (invoiceData.customerName || '').trim().toLowerCase();
    const leadCustomerCode = invoiceData.leadId && invoiceData.leadId !== 'manual'
      ? leads.find((l) => l.id === invoiceData.leadId)?.customerCode
      : undefined;
    const manualCustomerCode = manualCustomers.find((c) => c.name.trim().toLowerCase() === normalizedCustomerName)?.customerCode;
    const resolvedCustomerCode = invoiceData.customerCode || leadCustomerCode || manualCustomerCode || buildCustomerCodeFromSeed(invoiceData.leadId || invoiceData.customerName || 'customer');
    const totalAmt = invoiceData.amount + vatAmount;
    if (isServerDataMode()) {
      try {
        const inv = await createInvoiceApi({
          ...invoiceData,
          customerCode: resolvedCustomerCode,
          vatRate,
          vatAmount,
          totalAmount: totalAmt,
          costCenter: invoiceData.costCenter || 'عام',
          recordOrigin: invoiceData.recordOrigin ?? 'يدوي_محاسب',
          status: invoiceData.status,
          date: nowIso,
          collections: [],
          paidAmount: invoiceData.status === 'مدفوع' ? totalAmt : 0,
          remainingAmount: invoiceData.status === 'مدفوع' ? 0 : totalAmt,
        });
        setInvoices((prev) => [normalizeInvoice(inv), ...prev]);
        addAuditEvent({
          action: 'إصدار فاتورة',
          entityType: 'invoice',
          entityId: invoiceData.customerName,
          details: `${invoiceData.customerName} - ${invoiceData.amount} ج.م`,
        });
        return true;
      } catch {
        return false;
      }
    }
    const newInvoice: Invoice = {
      ...invoiceData,
      customerCode: resolvedCustomerCode,
      vatRate,
      vatAmount,
      totalAmount: totalAmt,
      costCenter: invoiceData.costCenter || 'عام',
      recordOrigin: invoiceData.recordOrigin ?? 'يدوي_محاسب',
      priceQuoteId: invoiceData.priceQuoteId,
      paidAmount: invoiceData.status === 'مدفوع' ? totalAmt : 0,
      remainingAmount: invoiceData.status === 'مدفوع' ? 0 : totalAmt,
      collections: [],
      id: `INV-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      date: nowIso
    };
    setInvoices(prev => [newInvoice, ...prev]);
    addAuditEvent({
      action: 'إصدار فاتورة',
      entityType: 'invoice',
      entityId: newInvoice.id,
      details: `${newInvoice.customerName} - ${newInvoice.amount} ج.م`,
    });
    return true;
  };

  const updateInvoiceStatus = async (invoiceId: string, status: Invoice['status']): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const invoice = invoices.find(inv => inv.id === invoiceId);
    if (!invoice) return false;
    if (isMonthClosed(getMonthKey(invoice.date))) return false;
    const patchOne = (inv: Invoice): Partial<Invoice> => {
      const total = inv.totalAmount ?? inv.amount + (inv.vatAmount ?? Math.round(inv.amount * ((inv.vatRate ?? 14) / 100)));
      if (status === 'مدفوع') {
        return { status, paidAmount: total, remainingAmount: 0, nextDueDate: undefined };
      }
      return {
        status,
        paidAmount: Math.min(total, inv.paidAmount || 0),
        remainingAmount: Math.max(0, total - (inv.paidAmount || 0)),
      };
    };
    if (isServerDataMode()) {
      const patch = patchOne(invoice);
      try {
        const row = await patchInvoiceApi(invoiceId, patch);
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoiceId ? normalizeInvoice(row) : inv))
        );
        addAuditEvent({
          action: 'تغيير حالة فاتورة',
          entityType: 'invoice',
          entityId: invoiceId,
          details: `الحالة: ${status}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setInvoices(prev =>
      prev.map(inv => {
        if (inv.id !== invoiceId) return inv;
        return { ...inv, ...patchOne(inv) };
      })
    );
    addAuditEvent({
      action: 'تغيير حالة فاتورة',
      entityType: 'invoice',
      entityId: invoiceId,
      details: `الحالة: ${status}`,
    });
    return true;
  };

  const recordInvoiceCollection = async (
    invoiceId: string,
    payload: { amount: number; method: 'كاش' | 'تحويل'; nextDueDate?: string; note?: string }
  ): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return false;
    const nowIso = new Date().toISOString();
    if (isMonthClosed(getMonthKey(nowIso))) return false;
    const entryYear = new Date(nowIso).getFullYear().toString();
    if (closedFiscalYears.includes(entryYear)) return false;
    const total = invoice.totalAmount ?? invoice.amount + (invoice.vatAmount ?? Math.round(invoice.amount * ((invoice.vatRate ?? 14) / 100)));
    const paid = Math.max(0, Number(invoice.paidAmount) || 0);
    const remaining = Math.max(0, total - paid);
    const amount = Math.max(0, Number(payload.amount) || 0);
    if (amount <= 0 || remaining <= 0) return false;
    const applied = Math.min(amount, remaining);
    const journal: ManualJournalEntry = {
      id: `JRN-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      date: nowIso,
      description: `تحصيل دفعة من فاتورة ${invoice.id} (${payload.method})`,
      lines: [
        { accountCode: '1010', debit: applied, credit: 0, costCenter: invoice.costCenter || 'عام', note: `تحصيل من ${invoice.customerName}` },
        { accountCode: '1120', debit: 0, credit: applied, costCenter: invoice.costCenter || 'عام', note: `تخفيض ذمة عميل ${invoice.customerName}` },
      ],
    };
    const collection: InvoiceCollection = {
      id: `COL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      date: nowIso,
      amount: applied,
      method: payload.method,
      journalEntryId: journal.id,
      note: payload.note,
    };
    const nextPaid = Math.max(0, Number(invoice.paidAmount) || 0) + applied;
    const nextRemaining = Math.max(0, total - nextPaid);
    const nextStatus: Invoice['status'] =
      nextRemaining <= 0 ? 'مدفوع' : (invoice.status === 'متأخر' ? 'متأخر' : 'قيد الانتظار');
    const nextCollections = [collection, ...(invoice.collections || [])];
    const nextDueDateVal =
      nextRemaining > 0 ? (payload.nextDueDate || invoice.nextDueDate) : undefined;

    if (isServerDataMode()) {
      let rollbackJournalId: string | undefined;
      try {
        const savedJournal = await createManualJournalApi(journal);
        rollbackJournalId = savedJournal.id;
        setManualJournalEntries((prev) => [savedJournal, ...prev]);
        const collectionWithJournal: InvoiceCollection = {
          ...collection,
          journalEntryId: savedJournal.id,
        };
        const nextCollections2 = [collectionWithJournal, ...(invoice.collections || [])];
        const row = await patchInvoiceApi(invoiceId, {
          paidAmount: nextPaid,
          remainingAmount: nextRemaining,
          status: nextStatus,
          nextDueDate: nextRemaining > 0 ? nextDueDateVal : null,
          collections: nextCollections2,
        });
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === invoiceId ? normalizeInvoice(row) : inv))
        );
        addAuditEvent({
          action: 'تحصيل دفعة من فاتورة',
          entityType: 'invoice',
          entityId: invoiceId,
          details: `amount=${applied} method=${payload.method} journal=${savedJournal.id}`,
        });
        return true;
      } catch {
        if (rollbackJournalId) {
          await tryDeleteManualJournal(rollbackJournalId);
          setManualJournalEntries((prev) => prev.filter((e) => e.id !== rollbackJournalId));
        }
        return false;
      }
    }

    setManualJournalEntries((prev) => [journal, ...prev]);
    setInvoices((prev) => prev.map((inv) => {
      if (inv.id !== invoiceId) return inv;
      return {
        ...inv,
        paidAmount: nextPaid,
        remainingAmount: nextRemaining,
        status: nextStatus,
        nextDueDate: nextDueDateVal,
        collections: nextCollections,
      };
    }));
    addAuditEvent({
      action: 'تحصيل دفعة من فاتورة',
      entityType: 'invoice',
      entityId: invoiceId,
      details: `amount=${applied} method=${payload.method} journal=${journal.id}`,
    });
    return true;
  };

  const addExpense = async (expenseData: Omit<Expense, 'id' | 'date' | 'approvalStatus' | 'approvedBy'>): Promise<boolean> => {
    const user = currentUser;
    if (!user || !(user.role === 'محاسب' || user.role === 'مالك' || user.role === 'مدير إنتاج')) {
      toast.error('صلاحية غير كافية لإضافة مصروف');
      return false;
    }
    const titleTrim = String(expenseData.title ?? '').trim();
    if (!titleTrim) {
      toast.error('عنوان المصروف مطلوب');
      return false;
    }
    const amountNum = Number(expenseData.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error('المبلغ مطلوب ويجب أن يكون أكبر من صفر');
      return false;
    }
    const nowIso = new Date().toISOString();
    if (isMonthClosed(getMonthKey(nowIso))) {
      toast.error('الشهر الحالي مقفل محاسبياً ولا يمكن إضافة مصروف جديد');
      return false;
    }
    const vatRate = typeof expenseData.vatRate === 'number' ? expenseData.vatRate : 14;
    const vatAmount = Math.round(amountNum * (vatRate / 100));
    /** طلبات مدير الإنتاج = دائماً بانتظار المالك. المالك يمرّر لسجلاته مباشرة. المحاسب يخضع لسياسة «اعتماد المالك للمصروفات». */
    let approvalStatus: Expense['approvalStatus'];
    let approvedBy: string | undefined;
    if (user.role === 'مدير إنتاج') {
      approvalStatus = 'قيد الاعتماد';
      approvedBy = undefined;
    } else if (user.role === 'مالك') {
      approvalStatus = 'معتمد';
      approvedBy = user.name;
    } else {
      const needOwner = workflowRulesSettings.expenseRequiresOwnerApproval;
      approvalStatus = needOwner ? 'قيد الاعتماد' : 'معتمد';
      approvedBy = needOwner ? undefined : 'اعتماد تلقائي حسب سياسة سير العمل';
    }
    if (isServerDataMode()) {
      try {
        const row = await createExpenseApi({
          ...expenseData,
          title: titleTrim,
          amount: amountNum,
          vatRate,
          vatAmount,
          totalAmount: amountNum + vatAmount,
          costCenter: expenseData.costCenter || 'عام',
          date: nowIso,
          approvalStatus,
          approvedBy,
        });
        const merged: Expense = {
          ...row,
          submittedById: row.submittedById || user.id,
          submittedByName: row.submittedByName || (user.name ? String(user.name).trim() : undefined),
        };
        setExpenses((prev) => [merged, ...prev]);
        addAuditEvent({
          action: 'إضافة مصروف',
          entityType: 'invoice',
          entityId: titleTrim,
          details: `${titleTrim} - ${amountNum} ج.م`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر إضافة المصروف';
        toast.error(msg);
        return false;
      }
    }
    const newExpense: Expense = {
      ...expenseData,
      title: titleTrim,
      amount: amountNum,
      vatRate,
      vatAmount,
      totalAmount: amountNum + vatAmount,
      costCenter: expenseData.costCenter || 'عام',
      id: `EXP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      date: nowIso,
      approvalStatus,
      approvedBy,
      submittedById: user.id,
      submittedByName: (() => {
        const n = user.name ? String(user.name).trim() : '';
        if (n) return n;
        const em = user.email?.trim().toLowerCase();
        if (em && em.includes('@')) return em.slice(0, em.indexOf('@'));
        return undefined;
      })(),
    };
    setExpenses(prev => [newExpense, ...prev]);
    addAuditEvent({
      action: 'إضافة مصروف',
      entityType: 'invoice',
      entityId: newExpense.id,
      details: `${newExpense.title} - ${newExpense.amount} ج.م`,
    });
    return true;
  };

  const updateExpenseStatus = async (
    expenseId: string,
    status: Expense['status'],
    paymentMethod?: Expense['paymentMethod']
  ): Promise<boolean> => {
    if (!(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك')) return false;
    const expense = expenses.find(exp => exp.id === expenseId);
    if (!expense) return false;
    if (isMonthClosed(getMonthKey(expense.date))) return false;
    if (status === 'مدفوع' && expense.approvalStatus !== 'معتمد') return false;
    if (status === 'مدفوع' && paymentMethod !== 'كاش' && paymentMethod !== 'بنك') {
      toast.error('اختر طريقة الدفع: كاش أو بنك قبل تسجيل المصروف كمدفوع');
      return false;
    }
    if (isServerDataMode()) {
      try {
        const patch: Partial<Expense> = { status };
        if (status === 'مدفوع') patch.paymentMethod = paymentMethod;
        else patch.paymentMethod = null;
        const row = await patchExpenseApi(expenseId, patch);
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? row : e)));
        addAuditEvent({
          action: 'تغيير حالة مصروف',
          entityType: 'invoice',
          entityId: expenseId,
          details:
            status === 'مدفوع'
              ? `الحالة: ${status} — ${paymentMethod === 'كاش' ? 'كاش' : 'بنك'}`
              : `الحالة: ${status}`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر تحديث حالة المصروف';
        toast.error(msg);
        return false;
      }
    }
    setExpenses(prev =>
      prev.map(exp =>
        exp.id === expenseId
          ? {
              ...exp,
              status,
              paymentMethod: status === 'مدفوع' ? paymentMethod ?? undefined : undefined,
            }
          : exp
      )
    );
    addAuditEvent({
      action: 'تغيير حالة مصروف',
      entityType: 'invoice',
      entityId: expenseId,
      details:
        status === 'مدفوع'
          ? `الحالة: ${status} — ${paymentMethod === 'كاش' ? 'كاش' : 'بنك'}`
          : `الحالة: ${status}`,
    });
    return true;
  };

  const approveExpense = async (expenseId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const expense = expenses.find(exp => exp.id === expenseId);
    if (!expense) return false;
    if (isMonthClosed(getMonthKey(expense.date))) return false;
    if (isServerDataMode()) {
      try {
        const row = await patchExpenseApi(expenseId, {
          approvalStatus: 'معتمد',
          approvedBy: currentUser.name,
        });
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? row : e)));
        addAuditEvent({
          action: 'اعتماد مصروف',
          entityType: 'invoice',
          entityId: expenseId,
          details: `اعتماد بواسطة ${currentUser.name}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setExpenses(prev => prev.map(exp => exp.id === expenseId ? { ...exp, approvalStatus: 'معتمد', approvedBy: currentUser.name } : exp));
    addAuditEvent({
      action: 'اعتماد مصروف',
      entityType: 'invoice',
      entityId: expenseId,
      details: `اعتماد بواسطة ${currentUser.name}`,
    });
    return true;
  };

  const rejectExpense = async (expenseId: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const expense = expenses.find(exp => exp.id === expenseId);
    if (!expense) return false;
    if (isMonthClosed(getMonthKey(expense.date))) return false;
    if (isServerDataMode()) {
      try {
        const row = await patchExpenseApi(expenseId, {
          approvalStatus: 'مرفوض',
          approvedBy: currentUser.name,
        });
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? row : e)));
        addAuditEvent({
          action: 'رفض مصروف',
          entityType: 'invoice',
          entityId: expenseId,
          details: `رفض بواسطة ${currentUser.name}`,
        });
        return true;
      } catch {
        return false;
      }
    }
    setExpenses(prev => prev.map(exp => exp.id === expenseId ? { ...exp, approvalStatus: 'مرفوض', approvedBy: currentUser.name } : exp));
    addAuditEvent({
      action: 'رفض مصروف',
      entityType: 'invoice',
      entityId: expenseId,
      details: `رفض بواسطة ${currentUser.name}`,
    });
    return true;
  };

  const getRepSnapshots = useCallback((): RepSnapshot[] => {
    const reps = users.filter(u => u.role === 'مندوب');
    const monthKeyNow = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const startOfToday = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const startOfWeek = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const day = d.getDay(); // 0=Sun
      const diff = day === 0 ? 6 : day - 1; // Monday start
      d.setDate(d.getDate() - diff);
      return d.getTime();
    })();

    return reps.map((rep) => {
      const assigned = leads.filter(l => l.assignedTo === rep.id);
      const won = assigned.filter(l => l.status === 'مغلق - فوز');
      const lost = assigned.filter(l => l.status === 'مغلق - خسارة');
      const active = assigned.filter(l => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة');
      const overdue = assigned.filter(l => l.slaStatus === 'حرج' || l.slaStatus === 'متأخر');
      const conversionRate = assigned.length > 0 ? (won.length / assigned.length) * 100 : 0;
      const revenue = won.reduce((sum, l) => sum + l.budget, 0);

      const responseMinsSamples = assigned
        .map((lead) => {
          const firstRepAction = lead.timeline
            .filter(a => a.userId === rep.id)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
          if (!firstRepAction) return null;
          return Math.max(
            0,
            Math.round(
              (new Date(firstRepAction.createdAt).getTime() - new Date(lead.createdAt).getTime()) /
              (1000 * 60)
            )
          );
        })
        .filter((v): v is number => typeof v === 'number');

      const avgResponseMins = responseMinsSamples.length > 0
        ? Math.round(responseMinsSamples.reduce((a, b) => a + b, 0) / responseMinsSamples.length)
        : 0;

      const lastActivityAt = assigned.length > 0
        ? assigned
            .map(l => l.updatedAt)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
        : undefined;
      const target = monthlyTargets.find(t => t.repId === rep.id) || {
        repId: rep.id,
        leadsTarget: 15,
        revenueTarget: 250000,
        callsTarget: 80,
        dailyCallsTarget: 8,
        weeklyCallsTarget: 40,
        commissionPercent: 0,
      };
      const commissionPct = Math.min(100, Math.max(0, Number(target.commissionPercent) || 0));
      const estimatedCommission = Math.round(revenue * (commissionPct / 100));
      const callsCount = assigned.reduce((sum, lead) => {
        const c = lead.timeline.filter(a => {
          if (a.userId !== rep.id) return false;
          const k = getMonthKey(a.createdAt);
          if (k !== monthKeyNow) return false;
          return /(مكالمة|اتصال|واتساب|تواصل|لم يرد)/.test(a.action);
        }).length;
        return sum + c;
      }, 0);
      const callsTarget = target.callsTarget || 80;
      const callActionMatcher = /(مكالمة|اتصال|واتساب|تواصل|لم يرد)/;
      const dailyCallsCount = assigned.reduce((sum, lead) => {
        const c = lead.timeline.filter((a) => a.userId === rep.id && callActionMatcher.test(a.action) && new Date(a.createdAt).getTime() >= startOfToday).length;
        return sum + c;
      }, 0);
      const weeklyCallsCount = assigned.reduce((sum, lead) => {
        const c = lead.timeline.filter((a) => a.userId === rep.id && callActionMatcher.test(a.action) && new Date(a.createdAt).getTime() >= startOfWeek).length;
        return sum + c;
      }, 0);
      const dailyCallsTarget = Math.max(1, Number(target.dailyCallsTarget) || 8);
      const weeklyCallsTarget = Math.max(1, Number(target.weeklyCallsTarget) || 40);
      const isContactAttemptAction = (action: string) => /(مكالمة|اتصال|واتساب|تواصل|لم يرد)/.test(action);
      const isConfirmedContactAction = (action: string) =>
        /(مكالمة تمت|إرسال واتساب متابعة|واتساب|تم التواصل|متابعة مكتملة)/.test(action);
      const hasDocumentedNote = (note?: string) => (note || '').trim().length > 0;
      const repActivitiesThisMonth = assigned.flatMap((lead) =>
        lead.timeline.filter((a) => a.userId === rep.id && getMonthKey(a.createdAt) === monthKeyNow)
      );
      const documentedTouches = repActivitiesThisMonth.filter(
        (a) => isContactAttemptAction(a.action) && hasDocumentedNote(a.note)
      ).length;
      const confirmedContacts = repActivitiesThisMonth.filter(
        (a) => isConfirmedContactAction(a.action) && hasDocumentedNote(a.note)
      ).length;
      const leadsWithConfirmedContact = assigned.filter((lead) =>
        lead.timeline.some(
          (a) =>
            a.userId === rep.id &&
            isConfirmedContactAction(a.action) &&
            hasDocumentedNote(a.note)
        )
      ).length;
      const confirmedContactCoverage = assigned.length > 0
        ? (leadsWithConfirmedContact / assigned.length) * 100
        : 0;
      const documentationQualityScore = callsCount > 0
        ? Math.min(100, (documentedTouches / callsCount) * 100)
        : 0;

      return {
        repId: rep.id,
        repName: rep.name,
        avatar: rep.avatar,
        totalAssigned: assigned.length,
        activeLeads: active.length,
        wonDeals: won.length,
        lostDeals: lost.length,
        conversionRate,
        revenue,
        overdueLeads: overdue.length,
        avgResponseMins,
        lastActivityAt,
        leadsTarget: target.leadsTarget,
        revenueTarget: target.revenueTarget,
        callsTarget,
        callsCount,
        leadsTargetProgress: target.leadsTarget > 0 ? (won.length / target.leadsTarget) * 100 : 0,
        revenueTargetProgress: target.revenueTarget > 0 ? (revenue / target.revenueTarget) * 100 : 0,
        callsTargetProgress: callsTarget > 0 ? (callsCount / callsTarget) * 100 : 0,
        dailyCallsTarget,
        weeklyCallsTarget,
        dailyCallsCount,
        weeklyCallsCount,
        dailyCallsProgress: dailyCallsTarget > 0 ? (dailyCallsCount / dailyCallsTarget) * 100 : 0,
        weeklyCallsProgress: weeklyCallsTarget > 0 ? (weeklyCallsCount / weeklyCallsTarget) * 100 : 0,
        documentedTouches,
        confirmedContacts,
        leadsWithConfirmedContact,
        confirmedContactCoverage,
        documentationQualityScore,
        commissionPercent: commissionPct,
        estimatedCommission,
      };
    });
  }, [users, leads, monthlyTargets]);

  const updateMonthlyTarget = async (repId: string, patch: Partial<Omit<MonthlyTarget, 'repId'>>) => {
    if (isServerDataMode()) {
      const prevTargets = monthlyTargets;
      try {
        const saved = await patchMonthlyTargetApi(repId, patch);
        setMonthlyTargets((prev) => {
          const exists = prev.some((t) => t.repId === repId);
          if (exists) return prev.map((t) => (t.repId === repId ? saved : t));
          return [saved, ...prev];
        });
        addAuditEvent({
          action: 'تحديث هدف شهري',
          entityType: 'user',
          entityId: repId,
          details: `leads=${patch.leadsTarget ?? '-'} revenue=${patch.revenueTarget ?? '-'}`,
        });
      } catch {
        setMonthlyTargets(prevTargets);
      }
    } else {
      setMonthlyTargets((prev) => {
        const exists = prev.some((t) => t.repId === repId);
        const next = exists
          ? prev.map((t) => (t.repId === repId ? { ...t, ...patch } : t))
          : [
              ...prev,
              {
                repId,
                leadsTarget: patch.leadsTarget || 15,
                revenueTarget: patch.revenueTarget || 250000,
                callsTarget: patch.callsTarget || 80,
                dailyCallsTarget: patch.dailyCallsTarget || 8,
                weeklyCallsTarget: patch.weeklyCallsTarget || 40,
                commissionPercent: patch.commissionPercent ?? 0,
              },
            ];
        return next;
      });
      addAuditEvent({
        action: 'تحديث هدف شهري',
        entityType: 'user',
        entityId: repId,
        details: `leads=${patch.leadsTarget ?? '-'} revenue=${patch.revenueTarget ?? '-'}`,
      });
    }
  };

  const getPerformanceAlerts = useCallback((): PerformanceAlert[] => {
    const snapshots = getRepSnapshots();
    const alerts: PerformanceAlert[] = [];
    const now = new Date().toISOString();

    snapshots.forEach((rep) => {
      if (rep.overdueLeads >= 3) {
        alerts.push({
          id: `overdue-${rep.repId}`,
          level: 'high',
          repId: rep.repId,
          message: `${rep.repName} لديه ${rep.overdueLeads} ليدز متأخرة`,
          createdAt: now,
        });
      }
      if (rep.conversionRate < 20 && rep.totalAssigned >= 5) {
        alerts.push({
          id: `conversion-${rep.repId}`,
          level: 'medium',
          repId: rep.repId,
          message: `انخفاض تحويل ${rep.repName} (${rep.conversionRate.toFixed(1)}%)`,
          createdAt: now,
        });
      }
      if (rep.avgResponseMins > 45 && rep.avgResponseMins > 0) {
        alerts.push({
          id: `response-${rep.repId}`,
          level: 'medium',
          repId: rep.repId,
          message: `متوسط الرد لدى ${rep.repName} مرتفع (${rep.avgResponseMins} دقيقة)`,
          createdAt: now,
        });
      }
    });

    if (alerts.length === 0) {
      alerts.push({
        id: 'all-good',
        level: 'low',
        message: 'أداء الفريق مستقر ولا توجد تنبيهات حرجة الآن',
        createdAt: now,
      });
    }

    return alerts;
  }, [getRepSnapshots]);

  const getSlaHeatmap = useCallback((days = 7): SlaHeatmapItem[] => {
    const out: SlaHeatmapItem[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const dayLeads = leads.filter(l => {
        const updated = new Date(l.updatedAt).getTime();
        return updated >= d.getTime() && updated < next.getTime();
      });

      out.push({
        day: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
        stable: dayLeads.filter(l => l.slaStatus === 'مستقر').length,
        late: dayLeads.filter(l => l.slaStatus === 'متأخر').length,
        critical: dayLeads.filter(l => l.slaStatus === 'حرج').length,
      });
    }
    return out;
  }, [leads]);

  const addShootBooking = async (
    booking: Omit<ShootBooking, 'id' | 'repId' | 'repName' | 'createdAt' | 'status'>,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!(currentUser?.role === 'مندوب' || currentUser?.role === 'مدير إنتاج')) {
      return { ok: false, message: 'لا يُسمح لدورك بإنشاء طلب تصوير' };
    }
    const row: ShootBooking = {
      id: `SB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      repId: currentUser.id,
      repName: currentUser.name,
      status: 'قيد المراجعة',
      requestedByRole: currentUser.role,
      financialStatus: currentUser.role === 'مدير إنتاج' ? 'بانتظار_اعتماد_مالك' : 'غير_مطلوب',
      createdAt: new Date().toISOString(),
      ...booking,
    };
    if (isServerDataMode()) {
      try {
        const saved = await createShootBookingApi(row);
        if (!saved || typeof saved !== 'object') {
          return { ok: false, message: 'استجابة غير صالحة من الخادم بعد إنشاء الحجز' };
        }
        setShootBookings((prev) => {
          const next = [saved, ...prev.filter((b) => b.id !== row.id)];
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, next);
          persistLocalBookingMirror(currentUser.id, { shoot: next });
          return next;
        });
        try {
          const fresh = await fetchShootBookingsApi();
          setShootBookings(fresh);
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_SHOOT, fresh);
          persistLocalBookingMirror(currentUser.id, { shoot: fresh });
        } catch {
          /* تجنّب استبدال الواجهة بـ [] عند استجابة غير صالحة أو خطأ شبكة */
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'تعذر الاتصال بالخادم أو رفض الطلب';
        return { ok: false, message: msg };
      }
    } else {
      setShootBookings((prev) => [row, ...prev]);
    }
    addAuditEvent({
      action: 'طلب حجز تصوير',
      entityType: 'system',
      entityId: row.id,
      details: `${row.customerName} - ${row.date} ${row.time}`,
    });
    return { ok: true };
  };

  const addEquipmentBooking = async (booking: Omit<EquipmentBooking, 'id' | 'repId' | 'repName' | 'createdAt' | 'status'>): Promise<boolean> => {
    if (!(currentUser?.role === 'مندوب' || currentUser?.role === 'مدير إنتاج')) return false;
    const equipment = equipmentItems.find(e => e.active && e.name === booking.equipmentName);
    if (!equipment) return false;
    const reqStart = new Date(booking.fromDate).getTime();
    const reqEnd = new Date(booking.toDate).getTime();
    if (!Number.isFinite(reqStart) || !Number.isFinite(reqEnd) || reqStart > reqEnd) return false;
    const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) => startA <= endB && startB <= endA;
    const overlappingQty = equipmentBookings
      .filter(b => b.equipmentName === booking.equipmentName && b.status !== 'مرفوض')
      .filter((b) => {
        const start = new Date(b.fromDate).getTime();
        const end = new Date(b.toDate).getTime();
        return rangesOverlap(reqStart, reqEnd, start, end);
      })
      .reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
    if (overlappingQty + (Number(booking.quantity) || 0) > equipment.totalQuantity) return false;
    const row: EquipmentBooking = {
      id: `EB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      repId: currentUser.id,
      repName: currentUser.name,
      status: 'قيد المراجعة',
      requestedByRole: currentUser.role,
      financialStatus: currentUser.role === 'مدير إنتاج' ? 'بانتظار_اعتماد_مالك' : 'غير_مطلوب',
      createdAt: new Date().toISOString(),
      ...booking,
    };
    if (isServerDataMode()) {
      try {
        const saved = await createEquipmentBookingApi(row);
        setEquipmentBookings((prev) => {
          const next = [saved, ...prev.filter((b) => b.id !== row.id)];
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, next);
          persistLocalBookingMirror(currentUser.id, { equip: next });
          return next;
        });
        try {
          const fresh = await fetchEquipmentBookingsApi();
          setEquipmentBookings(fresh);
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_EQUIP, fresh);
          persistLocalBookingMirror(currentUser.id, { equip: fresh });
        } catch {
          /* keep POST state */
        }
      } catch {
        return false;
      }
    } else {
      setEquipmentBookings((prev) => [row, ...prev]);
    }
    addAuditEvent({
      action: 'طلب حجز معدات',
      entityType: 'system',
      entityId: row.id,
      details: `${row.equipmentName} - ${row.customerName}`,
    });
    return true;
  };

  const addMeetingBooking = async (booking: Omit<MeetingBooking, 'id' | 'repId' | 'repName' | 'createdAt'>): Promise<boolean> => {
    if (!(currentUser?.role === 'مندوب' || currentUser?.role === 'مدير إنتاج')) return false;
    const [hh, mm] = booking.startTime.split(':').map(Number);
    const start = new Date(`${booking.date}T${booking.startTime}:00`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(hh) || !Number.isFinite(mm)) return false;
    const duration = Math.max(15, Number(booking.durationMins) || 60);
    const end = start + duration * 60 * 1000;
    const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
    const hasConflict = meetingBookings.some((m) => {
      if (m.date !== booking.date) return false;
      const mStart = new Date(`${m.date}T${m.startTime}:00`).getTime();
      const mEnd = mStart + (Math.max(15, Number(m.durationMins) || 60) * 60 * 1000);
      return overlap(start, end, mStart, mEnd);
    });
    if (hasConflict) return false;
    const venueType: MeetingBooking['venueType'] = booking.venueType === 'خارج_المقر' ? 'خارج_المقر' : 'داخل_المقر';
    const estimatedCost = Math.max(0, Number(booking.estimatedCost) || 0) || undefined;
    const requiresFinancialClaim =
      workflowRulesSettings.externalMeetingRequiresOwnerApproval &&
      currentUser.role === 'مدير إنتاج' &&
      venueType === 'خارج_المقر' &&
      !!estimatedCost;
    const row: MeetingBooking = {
      id: `MB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      repId: currentUser.id,
      repName: currentUser.name,
      leadId: booking.leadId,
      createdAt: new Date().toISOString(),
      title: booking.title,
      date: booking.date,
      startTime: booking.startTime,
      durationMins: duration,
      venueType,
      location: booking.location,
      notes: booking.notes,
      status: requiresFinancialClaim ? 'قيد المراجعة' : 'معتمد',
      requestedByRole: currentUser.role,
      estimatedCost: venueType === 'خارج_المقر' ? estimatedCost : undefined,
      financialStatus: requiresFinancialClaim ? 'بانتظار_اعتماد_مالك' : 'غير_مطلوب',
    };
    if (isServerDataMode()) {
      try {
        const saved = await createMeetingBookingApi(row);
        setMeetingBookings((prev) => {
          const next = [saved, ...prev.filter((b) => b.id !== row.id)];
          const norm = next.map(normalizeMeetingBooking);
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, norm);
          persistLocalBookingMirror(currentUser.id, { meet: norm });
          return next;
        });
        try {
          const fresh = await fetchMeetingBookingsApi();
          const normalized = fresh.map(normalizeMeetingBooking);
          setMeetingBookings(normalized);
          persistSessionBookingBackup(SESSION_BOOKING_BACKUP_MEET, normalized);
          persistLocalBookingMirror(currentUser.id, { meet: normalized });
        } catch {
          /* keep POST state */
        }
      } catch {
        return false;
      }
    } else {
      setMeetingBookings((prev) => [row, ...prev]);
    }
    addAuditEvent({
      action: 'إضافة اجتماع مندوب',
      entityType: 'system',
      entityId: row.id,
      details: `${row.title} - ${row.date} ${row.startTime}`,
    });
    return true;
  };

  const addOtherBooking = useCallback(
    async (data: { title?: string; statement: string; date?: string }): Promise<boolean> => {
      if (!currentUser) return false;
      const statement = String(data.statement ?? '').trim();
      if (!statement) return false;
      const row: OtherBooking = {
        id: `OB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        title: String(data.title ?? '').trim() || 'حجز آخر',
        statement,
        date: typeof data.date === 'string' && data.date.trim() ? data.date.trim().slice(0, 32) : undefined,
        createdAt: new Date().toISOString(),
        createdById: currentUser.id,
        createdByName: currentUser.name,
      };
      setOtherBookings((prev) => {
        const next = [row, ...prev].slice(0, 400);
        if (isServerDataMode()) void syncWorkspacePatch({ otherBookings: next }, () => setOtherBookings(prev));
        return next;
      });
      addAuditEvent({
        action: 'تسجيل حجز آخر (بيان)',
        entityType: 'system',
        entityId: row.id,
        details: row.title.slice(0, 200),
      });
      return true;
    },
    [currentUser],
  );

  const removeShootBooking = useCallback(
    async (id: string): Promise<boolean> => {
      if (!currentUser) return false;
      const canDelete = currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات' || currentUser.role === 'مدير إنتاج';
      if (!canDelete) return false;
      addDeletedId(LS_DEL_SHOOT, deletedShootIdsRef, id);
      setShootBookings((prev) => prev.filter((b) => b.id !== id));
      if (isServerDataMode()) {
        try { await deleteShootBookingApi(id); } catch { /* keep hidden even if server fails */ }
      }
      addAuditEvent({ action: 'حذف حجز تصوير', entityType: 'system', entityId: id });
      return true;
    },
    [currentUser],
  );

  const removeEquipmentBooking = useCallback(
    async (id: string): Promise<boolean> => {
      if (!currentUser) return false;
      const canDelete = currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات' || currentUser.role === 'مدير إنتاج';
      if (!canDelete) return false;
      addDeletedId(LS_DEL_EQUIP, deletedEquipIdsRef, id);
      setEquipmentBookings((prev) => prev.filter((b) => b.id !== id));
      if (isServerDataMode()) {
        try { await deleteEquipmentBookingApi(id); } catch { /* keep hidden even if server fails */ }
      }
      addAuditEvent({ action: 'حذف حجز معدات', entityType: 'system', entityId: id });
      return true;
    },
    [currentUser],
  );

  const removeMeetingBooking = useCallback(
    async (id: string): Promise<boolean> => {
      if (!currentUser) return false;
      const canDelete = currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات' || currentUser.role === 'مدير إنتاج';
      if (!canDelete) return false;
      addDeletedId(LS_DEL_MEET, deletedMeetIdsRef, id);
      setMeetingBookings((prev) => prev.filter((b) => b.id !== id));
      if (isServerDataMode()) {
        try { await deleteMeetingBookingApi(id); } catch { /* keep hidden even if server fails */ }
      }
      addAuditEvent({ action: 'حذف حجز اجتماع', entityType: 'system', entityId: id });
      return true;
    },
    [currentUser],
  );

  const removeOtherBooking = useCallback(
    async (id: string): Promise<boolean> => {
      if (!currentUser) return false;
      let removed = false;
      setOtherBookings((prev) => {
        const target = prev.find((b) => b.id === id);
        if (!target) return prev;
        const allowed =
          target.createdById === currentUser.id ||
          currentUser.role === 'مالك' ||
          currentUser.role === 'مدير مبيعات';
        if (!allowed) return prev;
        removed = true;
        const next = prev.filter((b) => b.id !== id);
        if (isServerDataMode()) void syncWorkspacePatch({ otherBookings: next }, () => setOtherBookings(prev));
        return next;
      });
      if (removed) {
        addAuditEvent({
          action: 'حذف حجز آخر',
          entityType: 'system',
          entityId: id,
        });
      }
      return removed;
    },
    [currentUser],
  );

  const addEquipmentItem = (item: Omit<EquipmentItem, 'id' | 'createdAt' | 'active'>) => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'محاسب' || currentUser?.role === 'مدير إنتاج')) {
      return false;
    }
    const name = String(item.name || '').trim();
    const category = String(item.category || '').trim();
    if (!name || !category) return false;
    const totalQuantity = Math.max(0, Math.floor(Number(item.totalQuantity) || 0));
    if (equipmentItems.some((e) => e.name.trim().toLowerCase() === name.toLowerCase())) return false;
    const row: EquipmentItem = {
      id: `EQ-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      name,
      category,
      totalQuantity,
      active: true,
      createdAt: new Date().toISOString(),
    };
    setEquipmentItems((prev) => {
      const next = [...prev, row];
      if (isServerDataMode()) void syncWorkspacePatch({ equipmentItems: next }, () => { setEquipmentItems(prev); });
      return next;
    });
    addAuditEvent({
      action: 'إضافة معدة رئيسية للحجوزات',
      entityType: 'system',
      entityId: row.id,
      details: `${name} — ${category} — كمية ${totalQuantity}`,
    });
    return true;
  };

  const removeEquipmentItem = (id: string) => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'محاسب' || currentUser?.role === 'مدير إنتاج')) {
      toast.error('حذف المعدات متاح للمالك أو المحاسب أو مدير الإنتاج فقط');
      return false;
    }
    const target = equipmentItems.find((e) => e.id === id);
    if (!target) {
      toast.error('المعدة غير موجودة');
      return false;
    }
    const name = target.name.trim();
    const hasBlockingBookings = equipmentBookings.some(
      (b) => b.equipmentName.trim() === name && (b.status === 'قيد المراجعة' || b.status === 'معتمد'),
    );
    if (hasBlockingBookings) {
      toast.error('لا يمكن الحذف: توجد حجوزات معتمدة أو قيد المراجعة على هذه المعدة');
      return false;
    }
    setEquipmentItems((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (isServerDataMode()) void syncWorkspacePatch({ equipmentItems: next }, () => { setEquipmentItems(prev); });
      return next;
    });
    addAuditEvent({
      action: 'حذف معدة من قائمة الحجوزات',
      entityType: 'system',
      entityId: id,
      details: name,
    });
    toast.success('تم حذف المعدة');
    return true;
  };

  /** استحقاق مالي بعد اعتماد المالك/المبيعات — يمرّ عبر الإنتاج ثم المحاسب. */
  const createBookingAccrualExpense = async (
    bookingLabel: string,
    bookingId: string,
    titleSuffix: string,
    amountRaw: number,
    category: Expense['category'],
    costCenter: string,
  ): Promise<string | null> => {
    const amount = Math.max(0, Math.round(Number(amountRaw) || 0));
    if (amount <= 0) return null;
    const nowIso = new Date().toISOString();
    if (isMonthClosed(getMonthKey(nowIso))) return null;
    const note = `استحقاق حجز — ${bookingLabel} ${bookingId}. يُسجل بالدفاتر مصروف «قيد الانتظار»؛ بعد بنود وفواتير مدير الإنتاج يتم الدفع المحاسبي على نفس المصروف (${bookingLabel}).`;
    const expensePayload = {
      title: `استحقاق ${bookingLabel} ${bookingId} — ${titleSuffix}`.slice(0, 240),
      category,
      amount,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: amount,
      costCenter,
      status: 'قيد الانتظار' as const,
      approvalStatus: 'معتمد' as const,
      approvedBy: 'اعتماد مالك/مبيعات — حجز تنفيذ إنتاج',
      note,
    };
    if (isServerDataMode()) {
      try {
        const row = await createExpenseApi({
          ...expensePayload,
          date: nowIso,
        });
        setExpenses((prev) => [row, ...prev]);
        return row.id;
      } catch {
        return null;
      }
    }
    const newExpense: Expense = {
      ...expensePayload,
      id: `EXP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      date: nowIso,
    };
    setExpenses((prev) => [newExpense, ...prev]);
    return newExpense.id;
  };

  const resolveNextFinancialAfterOwnerApprove = async (
    targetEstimated: number | undefined,
    bookingLabel: string,
    bookingId: string,
    titleSuffix: string,
    category: Expense['category'],
    costCenter: string,
  ): Promise<{ financialStatus: BookingFinancialStatusPhase; extra: Partial<{ accrualExpenseId: string; spendLines: BookingSpendLine[] }> }> => {
    const cost = Math.max(0, Number(targetEstimated) || 0);
    if (cost > 0) {
      const expId = await createBookingAccrualExpense(bookingLabel, bookingId, titleSuffix, cost, category, costCenter);
      if (!expId) {
        /** فشل إنشاء المصروف = لا اعتماد مالي جزئياً */
        throw new Error('accrual');
      }
      return {
        financialStatus: 'بانتظار_تنفيذ_إنتاج',
        extra: { accrualExpenseId: expId, spendLines: [] },
      };
    }
    return { financialStatus: 'غير_مطلوب', extra: {} };
  };

  const updateShootBookingStatus = async (id: string, status: ShootBooking['status']): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return false;
    const target = shootBookings.find((b) => b.id === id);
    if (!target) return false;
    if (target.requestedByRole === 'مدير إنتاج' && currentUser.role !== 'مالك') return false;
    let patchBody: Partial<ShootBooking> & Pick<ShootBooking, 'status' | 'financialStatus'> = {
      status,
      financialStatus: (target.financialStatus || 'غير_مطلوب') as BookingFinancialStatusPhase,
    };
    try {
      if (target.financialStatus === 'بانتظار_اعتماد_مالك' && status !== 'معتمد') {
        patchBody = { status, financialStatus: 'بانتظار_اعتماد_مالك' };
      } else if (status === 'معتمد' && target.status === 'قيد المراجعة') {
        const cost = Math.max(0, Number(target.estimatedCost) || 0);
        /** استحقاق: طلب اعتماد مالك له تكلفة، أو طلب من مندوب/غير ذلك صُنِّف غير_مطلوب رغم إدخال تكلفة تقديرية */
        const needsAccrual =
          !target.accrualExpenseId &&
          cost > 0 &&
          (target.financialStatus === 'بانتظار_اعتماد_مالك' ||
            target.financialStatus === 'غير_مطلوب' ||
            target.financialStatus === undefined);
        if (needsAccrual) {
          const r = await resolveNextFinancialAfterOwnerApprove(
            target.estimatedCost,
            'تصوير',
            target.id,
            target.customerName,
            'تشغيل',
            'تصوير',
          );
          patchBody = { status, financialStatus: r.financialStatus, ...(r.extra as Partial<ShootBooking>) };
        } else if (target.financialStatus === 'بانتظار_اعتماد_مالك') {
          patchBody = { status, financialStatus: 'غير_مطلوب' };
        }
      }
    } catch {
      return false;
    }

    if (isServerDataMode()) {
      try {
        const saved = await patchShootBookingApi(id, patchBody);
        setShootBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        if (patchBody.accrualExpenseId) {
          void fetchExpensesApi()
            .then((rows) => setExpenses(rows))
            .catch(() => {});
        }
      } catch {
        return false;
      }
    } else {
      setShootBookings((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          return { ...b, ...patchBody };
        })
      );
    }
    addAuditEvent({
      action: 'تحديث حالة حجز تصوير',
      entityType: 'system',
      entityId: id,
      details: `status=${status} financial=${patchBody.financialStatus} accrual=${patchBody.accrualExpenseId || '—'}`,
    });
    return true;
  };

  const productionUpdateWorkOrder = async (
    bookingId: string,
    patch: { workOrderChecklist?: ShootBooking['workOrderChecklist']; notes?: string; markComplete?: boolean },
  ): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج') return false;
    const target = shootBookings.find((b) => b.id === bookingId);
    if (!target?.workOrderFromQuote) return false;
    if (String(target.productionAssignedId || '').trim() !== String(currentUser.id).trim()) return false;
    const body: Partial<ShootBooking> = {};
    if (patch.workOrderChecklist) body.workOrderChecklist = patch.workOrderChecklist;
    if (patch.notes != null) body.notes = patch.notes;
    if (patch.markComplete) body.status = 'مكتمل';
    if (Object.keys(body).length === 0) return false;
    if (isServerDataMode()) {
      try {
        const saved = await patchShootBookingApi(bookingId, body);
        setShootBookings((prev) => prev.map((b) => (b.id === bookingId ? saved : b)));
      } catch {
        return false;
      }
    } else {
      setShootBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, ...body } : b)));
    }
    addAuditEvent({
      action: patch.markComplete ? 'إكمال أمر شغل' : 'تحديث أمر شغل',
      entityType: 'system',
      entityId: bookingId,
      details: target.customerName,
    });
    return true;
  };

  const updateEquipmentBookingStatus = async (id: string, status: EquipmentBooking['status']): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return false;
    const target = equipmentBookings.find(b => b.id === id);
    if (!target) return false;
    if (target.requestedByRole === 'مدير إنتاج' && currentUser.role !== 'مالك') return false;
    if (status === 'معتمد') {
      const equipment = equipmentItems.find(e => e.active && e.name === target.equipmentName);
      if (!equipment) return false;
      const targetStart = new Date(target.fromDate).getTime();
      const targetEnd = new Date(target.toDate).getTime();
      if (!Number.isFinite(targetStart) || !Number.isFinite(targetEnd)) return false;
      const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) => startA <= endB && startB <= endA;
      const reservedQty = equipmentBookings
        .filter(b =>
          b.id !== id &&
          b.equipmentName === target.equipmentName &&
          (b.status === 'معتمد' || b.status === 'تم التسليم')
        )
        .filter((b) => {
          const start = new Date(b.fromDate).getTime();
          const end = new Date(b.toDate).getTime();
          return rangesOverlap(targetStart, targetEnd, start, end);
        })
        .reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
      const availableQty = Math.max(0, equipment.totalQuantity - reservedQty);
      if ((Number(target.quantity) || 0) > availableQty) return false;
    }
    let patchEq: Partial<EquipmentBooking> & Pick<EquipmentBooking, 'status' | 'financialStatus'> = {
      status,
      financialStatus: (target.financialStatus || 'غير_مطلوب') as BookingFinancialStatusPhase,
    };
    try {
      if (target.financialStatus === 'بانتظار_اعتماد_مالك' && status !== 'معتمد') {
        patchEq = { status, financialStatus: 'بانتظار_اعتماد_مالك' };
      } else if (status === 'معتمد' && target.status === 'قيد المراجعة') {
        const cost = Math.max(0, Number(target.estimatedCost) || 0);
        const needsAccrual =
          !target.accrualExpenseId &&
          cost > 0 &&
          (target.financialStatus === 'بانتظار_اعتماد_مالك' ||
            target.financialStatus === 'غير_مطلوب' ||
            target.financialStatus === undefined);
        if (needsAccrual) {
          const r = await resolveNextFinancialAfterOwnerApprove(
            target.estimatedCost,
            'معدات',
            target.id,
            target.equipmentName,
            'معدات',
            'تصوير',
          );
          patchEq = { status, financialStatus: r.financialStatus, ...(r.extra as Partial<EquipmentBooking>) };
        } else if (target.financialStatus === 'بانتظار_اعتماد_مالك') {
          patchEq = { status, financialStatus: 'غير_مطلوب' };
        }
      }
    } catch {
      return false;
    }
    if (isServerDataMode()) {
      try {
        const saved = await patchEquipmentBookingApi(id, patchEq);
        setEquipmentBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        if (patchEq.accrualExpenseId) {
          void fetchExpensesApi()
            .then((rows) => setExpenses(rows))
            .catch(() => {});
        }
      } catch {
        return false;
      }
    } else {
      setEquipmentBookings((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          return { ...b, ...patchEq };
        })
      );
    }
    addAuditEvent({
      action: 'تحديث حالة حجز معدات',
      entityType: 'system',
      entityId: id,
      details: `status=${status}`,
    });
    return true;
  };

  const accountantExecuteShootBookingClaim = async (id: string, method: 'كاش' | 'تحويل'): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const target = shootBookings.find((b) => b.id === id);
    if (!target || target.financialStatus !== 'بانتظار_تنفيذ_محاسب') return false;
    const nowIso = new Date().toISOString();

    /** مسار جديد: استحقاق مُنشَأ مع الاعتماد — لا نُكرِّر مصروفاً، نفس المستند يُسدَّد. */
    if (target.accrualExpenseId) {
      const accrualId = target.accrualExpenseId;
      const accrual = expenses.find((e) => e.id === accrualId);
      if (!accrual) return false;
      if (isMonthClosed(getMonthKey(accrual.date))) return false;
      const noteAppend = `\nسداد حجز تصوير ${id}: ${method} — ${nowIso}`;
      const nextNote = `${accrual.note || ''}${noteAppend}`.trim();
      if (isServerDataMode()) {
        try {
          const updatedExp = await patchExpenseApi(accrualId, { status: 'مدفوع', note: nextNote });
          setExpenses((prev) => prev.map((x) => (x.id === accrualId ? updatedExp : x)));
          const saved = await patchShootBookingApi(id, {
            financialStatus: 'منفذ',
            paymentMethod: method,
            paymentAt: nowIso,
            paymentExpenseId: accrualId,
            status: 'مكتمل',
          });
          setShootBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
          addAuditEvent({
            action: 'سداد استحقاق حجز تصوير (محاسب)',
            entityType: 'invoice',
            entityId: accrualId,
            details: `${id} — ${method}`,
          });
          return true;
        } catch {
          return false;
        }
      }
      setExpenses((prev) =>
        prev.map((x) =>
          x.id === accrualId
            ? {
                ...x,
                status: 'مدفوع',
                note: nextNote,
              }
            : x,
        ),
      );
      setShootBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: accrualId,
                status: 'مكتمل',
              }
            : b,
        ),
      );
      addAuditEvent({
        action: 'سداد استحقاق حجز تصوير (محاسب)',
        entityType: 'invoice',
        entityId: accrualId,
        details: `${id} — ${method}`,
      });
      return true;
    }

    const amount = Math.max(0, Number(target.estimatedCost) || 0);
    if (amount <= 0) return false;
    const expId = `EXP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const autoExpense: Expense = {
      id: expId,
      title: `مطالبة تصوير — ${target.customerName}`,
      category: 'تشغيل',
      amount,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: amount,
      costCenter: 'تصوير',
      status: 'مدفوع',
      approvalStatus: 'معتمد',
      approvedBy: 'اعتماد المالك',
      note: `تنفيذ محاسب (${method}) لطلب تصوير ${target.id}`,
      date: nowIso,
    };
    if (isServerDataMode()) {
      try {
        const exp = await createExpenseApi(autoExpense);
        const saved = await patchShootBookingApi(id, {
          financialStatus: 'منفذ',
          paymentMethod: method,
          paymentAt: nowIso,
          paymentExpenseId: exp.id,
          status: 'مكتمل',
        });
        setExpenses((prev) => [exp, ...prev]);
        setShootBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        addAuditEvent({
          action: 'تنفيذ مطالبة تصوير بواسطة المحاسب',
          entityType: 'invoice',
          entityId: exp.id,
          details: `${target.id} — ${method}`,
        });
        return true;
      } catch {
        return false;
      }
    } else {
      setExpenses((prev) => [autoExpense, ...prev]);
      setShootBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: expId,
                status: 'مكتمل',
              }
            : b
        )
      );
    }
    addAuditEvent({
      action: 'تنفيذ مطالبة تصوير بواسطة المحاسب',
      entityType: 'invoice',
      entityId: expId,
      details: `${target.id} — ${method}`,
    });
    return true;
  };

  const accountantExecuteEquipmentBookingClaim = async (id: string, method: 'كاش' | 'تحويل'): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const target = equipmentBookings.find((b) => b.id === id);
    if (!target || target.financialStatus !== 'بانتظار_تنفيذ_محاسب') return false;
    const nowIso = new Date().toISOString();
    if (target.accrualExpenseId) {
      const accrualId = target.accrualExpenseId;
      const accrual = expenses.find((e) => e.id === accrualId);
      if (!accrual) return false;
      if (isMonthClosed(getMonthKey(accrual.date))) return false;
      const noteAppend = `\nسداد حجز معدات ${id}: ${method} — ${nowIso}`;
      const nextNote = `${accrual.note || ''}${noteAppend}`.trim();
      if (isServerDataMode()) {
        try {
          const updatedExp = await patchExpenseApi(accrualId, { status: 'مدفوع', note: nextNote });
          setExpenses((prev) => prev.map((x) => (x.id === accrualId ? updatedExp : x)));
          const saved = await patchEquipmentBookingApi(id, {
            financialStatus: 'منفذ',
            paymentMethod: method,
            paymentAt: nowIso,
            paymentExpenseId: accrualId,
            status: 'تم التسليم',
          });
          setEquipmentBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
          addAuditEvent({
            action: 'سداد استحقاق حجز معدات (محاسب)',
            entityType: 'invoice',
            entityId: accrualId,
            details: `${id} — ${method}`,
          });
          return true;
        } catch {
          return false;
        }
      }
      setExpenses((prev) =>
        prev.map((x) =>
          x.id === accrualId
            ? {
                ...x,
                status: 'مدفوع',
                note: nextNote,
              }
            : x,
        ),
      );
      setEquipmentBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: accrualId,
                status: 'تم التسليم',
              }
            : b,
        ),
      );
      addAuditEvent({
        action: 'سداد استحقاق حجز معدات (محاسب)',
        entityType: 'invoice',
        entityId: accrualId,
        details: `${id} — ${method}`,
      });
      return true;
    }
    const amount = Math.max(0, Number(target.estimatedCost) || 0);
    if (amount <= 0) return false;
    const expId = `EXP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const autoExpense: Expense = {
      id: expId,
      title: `مطالبة معدات — ${target.equipmentName}`,
      category: 'معدات',
      amount,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: amount,
      costCenter: 'تصوير',
      status: 'مدفوع',
      approvalStatus: 'معتمد',
      approvedBy: 'اعتماد المالك',
      note: `تنفيذ محاسب (${method}) لطلب معدات ${target.id}`,
      date: nowIso,
    };
    if (isServerDataMode()) {
      try {
        const exp = await createExpenseApi(autoExpense);
        const saved = await patchEquipmentBookingApi(id, {
          financialStatus: 'منفذ',
          paymentMethod: method,
          paymentAt: nowIso,
          paymentExpenseId: exp.id,
          status: 'تم التسليم',
        });
        setExpenses((prev) => [exp, ...prev]);
        setEquipmentBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        addAuditEvent({
          action: 'تنفيذ مطالبة معدات بواسطة المحاسب',
          entityType: 'invoice',
          entityId: exp.id,
          details: `${target.id} — ${method}`,
        });
        return true;
      } catch {
        return false;
      }
    } else {
      setExpenses((prev) => [autoExpense, ...prev]);
      setEquipmentBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: expId,
                status: 'تم التسليم',
              }
            : b
        )
      );
    }
    addAuditEvent({
      action: 'تنفيذ مطالبة معدات بواسطة المحاسب',
      entityType: 'invoice',
      entityId: expId,
      details: `${target.id} — ${method}`,
    });
    return true;
  };

  const updateMeetingBookingStatus = async (id: string, status: NonNullable<MeetingBooking['status']>): Promise<boolean> => {
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) return false;
    const target = meetingBookings.find((b) => b.id === id);
    if (!target) return false;
    if (target.requestedByRole === 'مدير إنتاج' && currentUser.role !== 'مالك') return false;
    let patchMeet: Partial<MeetingBooking> & { status: NonNullable<MeetingBooking['status']> } & { financialStatus: BookingFinancialStatusPhase } = {
      status,
      financialStatus: (target.financialStatus || 'غير_مطلوب') as BookingFinancialStatusPhase,
    };
    try {
      if (target.financialStatus === 'بانتظار_اعتماد_مالك' && status !== 'معتمد') {
        patchMeet = { status, financialStatus: 'بانتظار_اعتماد_مالك' };
      } else if (status === 'معتمد' && target.status === 'قيد المراجعة') {
        const cost = Math.max(0, Number(target.estimatedCost) || 0);
        const needsAccrual =
          !target.accrualExpenseId &&
          cost > 0 &&
          (target.financialStatus === 'بانتظار_اعتماد_مالك' ||
            target.financialStatus === 'غير_مطلوب' ||
            target.financialStatus === undefined);
        if (needsAccrual) {
          const r = await resolveNextFinancialAfterOwnerApprove(
            target.estimatedCost,
            'اجتماع',
            target.id,
            target.title,
            'تشغيل',
            'اجتماعات',
          );
          patchMeet = { status, financialStatus: r.financialStatus, ...(r.extra as Partial<MeetingBooking>) };
        } else if (target.financialStatus === 'بانتظار_اعتماد_مالك') {
          patchMeet = { status, financialStatus: 'غير_مطلوب' };
        }
      }
    } catch {
      return false;
    }
    if (isServerDataMode()) {
      try {
        const saved = await patchMeetingBookingApi(id, patchMeet);
        setMeetingBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        if (patchMeet.accrualExpenseId) {
          void fetchExpensesApi()
            .then((rows) => setExpenses(rows))
            .catch(() => {});
        }
      } catch {
        return false;
      }
    } else {
      setMeetingBookings((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          return { ...b, ...patchMeet };
        })
      );
    }
    addAuditEvent({
      action: 'تحديث حالة حجز مكان/اجتماع',
      entityType: 'system',
      entityId: id,
      details: `status=${status}`,
    });
    return true;
  };

  const accountantExecuteMeetingBookingClaim = async (id: string, method: 'كاش' | 'تحويل'): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const target = meetingBookings.find((b) => b.id === id);
    if (!target || target.financialStatus !== 'بانتظار_تنفيذ_محاسب') return false;
    const nowIso = new Date().toISOString();
    if (target.accrualExpenseId) {
      const accrualId = target.accrualExpenseId;
      const accrual = expenses.find((e) => e.id === accrualId);
      if (!accrual) return false;
      if (isMonthClosed(getMonthKey(accrual.date))) return false;
      const noteAppend = `\nسداد حجز اجتماع ${id}: ${method} — ${nowIso}`;
      const nextNote = `${accrual.note || ''}${noteAppend}`.trim();
      if (isServerDataMode()) {
        try {
          const updatedExp = await patchExpenseApi(accrualId, { status: 'مدفوع', note: nextNote });
          setExpenses((prev) => prev.map((x) => (x.id === accrualId ? updatedExp : x)));
          const saved = await patchMeetingBookingApi(id, {
            financialStatus: 'منفذ',
            paymentMethod: method,
            paymentAt: nowIso,
            paymentExpenseId: accrualId,
            status: 'مكتمل',
          });
          setMeetingBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
          addAuditEvent({
            action: 'سداد استحقاق حجز اجتماع (محاسب)',
            entityType: 'invoice',
            entityId: accrualId,
            details: `${id} — ${method}`,
          });
          return true;
        } catch {
          return false;
        }
      }
      setExpenses((prev) =>
        prev.map((x) =>
          x.id === accrualId
            ? {
                ...x,
                status: 'مدفوع',
                note: nextNote,
              }
            : x,
        ),
      );
      setMeetingBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: accrualId,
                status: 'مكتمل',
              }
            : b,
        ),
      );
      addAuditEvent({
        action: 'سداد استحقاق حجز اجتماع (محاسب)',
        entityType: 'invoice',
        entityId: accrualId,
        details: `${id} — ${method}`,
      });
      return true;
    }
    const amount = Math.max(0, Number(target.estimatedCost) || 0);
    if (amount <= 0) return false;
    const expId = `EXP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const autoExpense: Expense = {
      id: expId,
      title: `مطالبة مكان/اجتماع — ${target.title}`,
      category: 'تشغيل',
      amount,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: amount,
      costCenter: 'اجتماعات',
      status: 'مدفوع',
      approvalStatus: 'معتمد',
      approvedBy: 'اعتماد المالك',
      note: `تنفيذ محاسب (${method}) لحجز مكان/اجتماع ${target.id}`,
      date: nowIso,
    };
    if (isServerDataMode()) {
      try {
        const exp = await createExpenseApi(autoExpense);
        const saved = await patchMeetingBookingApi(id, {
          financialStatus: 'منفذ',
          paymentMethod: method,
          paymentAt: nowIso,
          paymentExpenseId: exp.id,
          status: 'مكتمل',
        });
        setExpenses((prev) => [exp, ...prev]);
        setMeetingBookings((prev) => prev.map((b) => (b.id === id ? saved : b)));
        addAuditEvent({
          action: 'تنفيذ مطالبة مكان/اجتماع بواسطة المحاسب',
          entityType: 'invoice',
          entityId: exp.id,
          details: `${target.id} — ${method}`,
        });
        return true;
      } catch {
        return false;
      }
    } else {
      setExpenses((prev) => [autoExpense, ...prev]);
      setMeetingBookings((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                financialStatus: 'منفذ',
                paymentMethod: method,
                paymentAt: nowIso,
                paymentExpenseId: expId,
                status: 'مكتمل',
              }
            : b
        )
      );
    }
    addAuditEvent({
      action: 'تنفيذ مطالبة مكان/اجتماع بواسطة المحاسب',
      entityType: 'invoice',
      entityId: expId,
      details: `${target.id} — ${method}`,
    });
    return true;
  };

  const productionSubmitBookingSpendToAccountant = async (
    kind: 'shoot' | 'equipment' | 'meeting',
    bookingId: string,
    spendLinesDraft: Omit<BookingSpendLine, 'id' | 'createdAt'>[],
  ): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج') return false;
    const nowIso = new Date().toISOString();
    const lines: BookingSpendLine[] = spendLinesDraft
      .map((d) => ({
        id: `BSL-${Math.random().toString(36).slice(2, 10)}`,
        description: String(d.description || '').trim(),
        amount: Math.max(0, Math.round(Number(d.amount) || 0)),
        invoiceRef: d.invoiceRef != null ? String(d.invoiceRef).trim() : undefined,
        vendor: d.vendor != null ? String(d.vendor).trim() : undefined,
        createdAt: nowIso,
      }))
      .filter((l) => l.description.length > 0 && l.amount > 0);
    if (lines.length === 0) return false;

    const patchPayload = {
      spendLines: lines,
      executionSubmittedAt: nowIso,
      financialStatus: 'بانتظار_تنفيذ_محاسب' as const,
    };

    try {
      if (kind === 'shoot') {
        const target = shootBookings.find((b) => b.id === bookingId);
        if (!target || target.financialStatus !== 'بانتظار_تنفيذ_إنتاج') return false;
        const est = Math.max(0, Number(target.estimatedCost) || 0);
        const sumLines = lines.reduce((s, l) => s + l.amount, 0);
        if (est > 0 && sumLines > est * 1.05 + 0.01) return false;
        if (isServerDataMode()) {
          const saved = await patchShootBookingApi(bookingId, patchPayload);
          setShootBookings((prev) => prev.map((b) => (b.id === bookingId ? saved : b)));
          return true;
        }
        setShootBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, ...patchPayload } : b)),
        );
        return true;
      }
      if (kind === 'equipment') {
        const target = equipmentBookings.find((b) => b.id === bookingId);
        if (!target || target.financialStatus !== 'بانتظار_تنفيذ_إنتاج') return false;
        const est = Math.max(0, Number(target.estimatedCost) || 0);
        const sumLines = lines.reduce((s, l) => s + l.amount, 0);
        if (est > 0 && sumLines > est * 1.05 + 0.01) return false;
        if (isServerDataMode()) {
          const saved = await patchEquipmentBookingApi(bookingId, patchPayload);
          setEquipmentBookings((prev) => prev.map((b) => (b.id === bookingId ? saved : b)));
          return true;
        }
        setEquipmentBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, ...patchPayload } : b)),
        );
        return true;
      }
      const target = meetingBookings.find((b) => b.id === bookingId);
      if (!target || target.financialStatus !== 'بانتظار_تنفيذ_إنتاج') return false;
      const est = Math.max(0, Number(target.estimatedCost) || 0);
      const sumLines = lines.reduce((s, l) => s + l.amount, 0);
      if (est > 0 && sumLines > est * 1.05 + 0.01) return false;
      if (isServerDataMode()) {
        const saved = await patchMeetingBookingApi(bookingId, patchPayload);
        setMeetingBookings((prev) => prev.map((b) => (b.id === bookingId ? saved : b)));
        return true;
      }
      setMeetingBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, ...patchPayload } : b)),
      );
      return true;
    } catch {
      return false;
    }
  };

  const applySystemJournalEntry = async (entry: Omit<ManualJournalEntry, 'id'>): Promise<ManualJournalEntry | null> => {
    const entryYear = new Date(entry.date).getFullYear().toString();
    if (closedFiscalYears.includes(entryYear)) return null;
    const monthKey = getMonthKey(`${entry.date}T12:00:00.000Z`);
    if (closedMonths.includes(monthKey)) return null;
    const validAccountCodes = new Set(chartOfAccounts.map((a) => a.code));
    const normalizedLines = entry.lines.map((line) => ({
      ...line,
      accountCode: (line.accountCode || '').trim(),
      costCenter: (line.costCenter || 'عام').trim() || 'عام',
    }));
    if (normalizedLines.length === 0) return null;
    const hasInvalidCode = normalizedLines.some((line) => !line.accountCode || !validAccountCodes.has(line.accountCode));
    if (hasInvalidCode) return null;
    const totalDebit = normalizedLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const totalCredit = normalizedLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    if (totalDebit <= 0 || totalCredit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) return null;
    const newEntry: ManualJournalEntry = {
      ...entry,
      lines: normalizedLines,
      id: `JRN-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    };
    if (isServerDataMode()) {
      try {
        const saved = await createManualJournalApi(newEntry);
        setManualJournalEntries((prev) => [saved, ...prev]);
        addAuditEvent({
          action: 'قيد يومية (عهدة إنتاج)',
          entityType: 'system',
          entityId: saved.id,
          details: saved.description,
        });
        return saved;
      } catch {
        return null;
      }
    }
    setManualJournalEntries((prev) => [newEntry, ...prev]);
    addAuditEvent({
      action: 'قيد يومية (عهدة إنتاج)',
      entityType: 'system',
      entityId: newEntry.id,
      details: newEntry.description,
    });
    return newEntry;
  };

  const resolveCustodyAccountCode = (category: Expense['category']) => {
    const code = custodyAccountByCategory[category] || '5110';
    const exists = chartOfAccounts.some(a => a.code === code);
    return exists ? code : '5110';
  };

  const updateCustodyAccountByCategory = async (patch: Partial<CustodyAccountByCategory>) => {
    if (currentUser?.role !== 'محاسب') return;
    const next = { ...custodyAccountByCategory, ...patch };
    if (isServerDataMode()) {
      const prevSnap = custodyAccountByCategory;
      try {
        const saved = await patchCustodySettingsApi(next);
        setCustodyAccountByCategory((prev) => ({
          ...DEFAULT_CUSTODY_ACCOUNT_BY_CATEGORY,
          ...prev,
          ...saved,
        }));
        addAuditEvent({
          action: 'تحديث تكويد عهدة الإنتاج',
          entityType: 'system',
          details: 'تعديل ربط فئات المصروف بحسابات الدليل',
        });
      } catch {
        setCustodyAccountByCategory(prevSnap);
      }
    } else {
      setCustodyAccountByCategory((prev) => ({ ...prev, ...patch }));
      addAuditEvent({
        action: 'تحديث تكويد عهدة الإنتاج',
        entityType: 'system',
        details: 'تعديل ربط فئات المصروف بحسابات الدليل',
      });
    }
  };

  const custodyAssetCode = () =>
    (chartOfAccounts.some((a) => a.code === CUSTODY_ASSET_ACCOUNT_CODE) ? CUSTODY_ASSET_ACCOUNT_CODE : null);

  const createCustodyRequest = async (data: { title: string; description: string; totalAmount: number }): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج') return false;
    const amt = Math.max(0, Number(data.totalAmount) || 0);
    if (amt <= 0) return false;
    const title = data.title.trim();
    if (!title) return false;
    const row: CustodyFund = {
      id: `CF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title,
      description: (data.description || '').trim(),
      totalAmount: amt,
      status: 'طلب_بانتظار_المالك',
      createdAt: new Date().toISOString(),
      createdById: currentUser.id,
      createdByName: currentUser.name,
      productionManagerId: currentUser.id,
      productionManagerName: currentUser.name,
      spendLines: [],
    };
    if (isServerDataMode()) {
      try {
        const saved = await createCustodyFundApi(row);
        setCustodyFunds((prev) => [saved, ...prev.filter((f) => f.id !== row.id)]);
      } catch {
        return false;
      }
    } else {
      setCustodyFunds((prev) => [row, ...prev]);
    }
    addAuditEvent({
      action: 'طلب عهدة إنتاج (بانتظار المالك)',
      entityType: 'system',
      entityId: row.id,
      details: row.title,
    });
    return true;
  };

  const createCustodyFund = async (data: {
    title: string;
    description: string;
    totalAmount: number;
    productionManagerId: string;
    currency?: CustodyCurrency;
    exchangeRate?: number;
    sendToOwner?: boolean;
  }): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب' && currentUser?.role !== 'مالك') return false;
    const pm = users.find(u => u.id === data.productionManagerId);
    if (!pm || pm.role !== 'مدير إنتاج') return false;
    const amt = Math.max(0, Number(data.totalAmount) || 0);
    if (amt <= 0) return false;
    const title = data.title.trim();
    if (!title) return false;
    const currency: CustodyCurrency = data.currency === 'USD' ? 'USD' : 'EGP';
    const exchangeRate =
      currency === 'USD' ? Math.max(0, Number(data.exchangeRate) || 0) : undefined;
    if (currency === 'USD' && (!exchangeRate || exchangeRate <= 0)) return false;
    const sendToOwner = currentUser.role === 'مالك' ? true : data.sendToOwner !== false;
    const row: CustodyFund = {
      id: `CF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title,
      description: (data.description || '').trim(),
      totalAmount: amt,
      currency,
      exchangeRate: currency === 'USD' ? exchangeRate : undefined,
      status: sendToOwner ? 'طلب_بانتظار_المالك' : 'مسودة',
      createdAt: new Date().toISOString(),
      createdById: currentUser.id,
      createdByName: currentUser.name,
      productionManagerId: pm.id,
      productionManagerName: pm.name,
      spendLines: [],
    };
    if (isServerDataMode()) {
      try {
        const saved = await createCustodyFundApi(row);
        setCustodyFunds((prev) => [saved, ...prev.filter((f) => f.id !== row.id)]);
      } catch {
        return false;
      }
    } else {
      setCustodyFunds((prev) => [row, ...prev]);
    }
    addAuditEvent({
      action: sendToOwner ? 'إنشاء عهدة وإرسالها للمالك' : 'إنشاء عهدة إنتاج (مسودة محاسب)',
      entityType: 'system',
      entityId: row.id,
      details: row.title,
    });
    if (sendToOwner && isServerDataMode()) {
      try {
        const fresh = await fetchCustodyFundsApi();
        setCustodyFunds(fresh.map(migrateCustodyFund));
      } catch {
        /* ignore */
      }
    }
    return true;
  };

  const updateCustodyDraft = async (
    id: string,
    patch: Partial<
      Pick<
        CustodyFund,
        'title' | 'description' | 'totalAmount' | 'productionManagerId' | 'productionManagerName' | 'currency' | 'exchangeRate'
      >
    >
  ): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const beforeFund = custodyFunds.find((f) => f.id === id);
    if (!beforeFund) return false;
    const fullEdit = accountantCanEditCustodyFundFull(beforeFund);
    const limitedEdit = accountantCanEditCustodyFundLimited(beforeFund);
    if (!fullEdit && !limitedEdit) return false;
    let ok = false;
    let synced: CustodyFund | undefined;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (!accountantCanEditCustodyFundFull(f) && !accountantCanEditCustodyFundLimited(f)) return f;
        const isFull = accountantCanEditCustodyFundFull(f);
        const nextCurrency: CustodyCurrency =
          isFull && patch.currency != null ? (patch.currency === 'USD' ? 'USD' : 'EGP') : f.currency || 'EGP';
        const nextExchangeRate =
          nextCurrency === 'USD'
            ? Math.max(
                0,
                Number(
                  isFull && patch.exchangeRate != null ? patch.exchangeRate : patch.exchangeRate ?? f.exchangeRate,
                ) || 0,
              )
            : undefined;
        if (nextCurrency === 'USD' && (!nextExchangeRate || nextExchangeRate <= 0)) return f;
        let nextPmId = f.productionManagerId;
        let nextPmName = f.productionManagerName;
        if (isFull && patch.productionManagerId != null) {
          const pm = users.find((u) => u.id === patch.productionManagerId);
          if (!pm || pm.role !== 'مدير إنتاج') return f;
          nextPmId = pm.id;
          nextPmName = pm.name;
        }
        const totalAmount =
          isFull && patch.totalAmount != null ? Math.max(0, Number(patch.totalAmount) || 0) : f.totalAmount;
        if (isFull && patch.totalAmount != null && totalAmount <= 0) return f;
        ok = true;
        synced = {
          ...f,
          title: isFull && patch.title != null ? patch.title.trim() || f.title : f.title,
          description: patch.description != null ? patch.description.trim() : f.description,
          totalAmount: isFull && patch.totalAmount != null ? totalAmount : f.totalAmount,
          productionManagerId: isFull && patch.productionManagerId != null ? nextPmId : f.productionManagerId,
          productionManagerName: isFull && patch.productionManagerId != null ? nextPmName : f.productionManagerName,
          currency: isFull && patch.currency != null ? nextCurrency : f.currency || 'EGP',
          exchangeRate: nextCurrency === 'USD' ? nextExchangeRate : undefined,
        };
        return synced;
      })
    );
    if (ok && isServerDataMode() && synced) {
      try {
        await putCustodyFundApi(synced);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) {
      addAuditEvent({
        action: 'تعديل مسودة عهدة إنتاج',
        entityType: 'system',
        entityId: id,
        details: '',
      });
    }
    return ok;
  };

  const submitCustodyDraftToOwner = async (id: string): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب' && currentUser?.role !== 'مالك') return false;
    const beforeFund = custodyFunds.find((f) => f.id === id);
    let ok = false;
    let synced: CustodyFund | undefined;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (f.status !== 'مسودة' && f.status !== 'مرفوض_طلب') return f;
        ok = true;
        synced = { ...f, status: 'طلب_بانتظار_المالك' as CustodyFundStatus, requestRejectReason: undefined };
        return synced;
      })
    );
    if (ok && isServerDataMode() && synced) {
      try {
        await putCustodyFundApi(synced);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) {
      addAuditEvent({ action: 'إرسال مسودة عهدة للمالك', entityType: 'system', entityId: id, details: '' });
      if (isServerDataMode()) {
        try {
          const fresh = await fetchCustodyFundsApi();
          setCustodyFunds(fresh.map(migrateCustodyFund));
        } catch {
          /* ignore */
        }
      }
    }
    return ok;
  };

  const submitAllCustodyDraftsToOwner = async (): Promise<number> => {
    if (currentUser?.role !== 'مالك' && currentUser?.role !== 'محاسب') return 0;
    if (!isServerDataMode()) {
      const drafts = custodyFunds.filter((f) => f.status === 'مسودة' || f.status === 'مرفوض_طلب');
      let n = 0;
      for (const f of drafts) {
        if (await submitCustodyDraftToOwner(f.id)) n += 1;
      }
      return n;
    }
    try {
      const promoted = await promoteCustodyDraftsToOwnerApi();
      const fresh = await fetchCustodyFundsApi();
      setCustodyFunds(fresh.map(migrateCustodyFund));
      if (promoted > 0) {
        addAuditEvent({
          action: 'إرسال مسودات عهدة للمالك (دفعة)',
          entityType: 'system',
          details: String(promoted),
        });
      }
      return promoted;
    } catch {
      return 0;
    }
  };

  const ownerApproveCustodyRequest = async (id: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const beforeFund = custodyFunds.find((f) => f.id === id);
    let ok = false;
    let synced: CustodyFund | undefined;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (f.status !== 'طلب_بانتظار_المالك') return f;
        ok = true;
        synced = { ...f, status: 'بانتظار_دفع_محاسب' as CustodyFundStatus, approvedAt: new Date().toISOString() };
        return synced;
      })
    );
    if (ok && isServerDataMode() && synced) {
      try {
        await putCustodyFundApi(synced);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) addAuditEvent({ action: 'اعتماد المالك طلب عهدة — بانتظار دفع المحاسب', entityType: 'system', entityId: id, details: '' });
    return ok;
  };

  const ownerRejectCustodyRequest = async (id: string, reason?: string): Promise<boolean> => {
    if (currentUser?.role !== 'مالك') return false;
    const beforeFund = custodyFunds.find((f) => f.id === id);
    let ok = false;
    let synced: CustodyFund | undefined;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (f.status !== 'طلب_بانتظار_المالك') return f;
        ok = true;
        synced = { ...f, status: 'مرفوض_طلب' as CustodyFundStatus, requestRejectReason: reason };
        return synced;
      })
    );
    if (ok && isServerDataMode() && synced) {
      try {
        await putCustodyFundApi(synced);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) addAuditEvent({ action: 'رفض المالك طلب عهدة', entityType: 'system', entityId: id, details: reason || '' });
    return ok;
  };

  const accountantRecordCustodyPayment = async (id: string, method: 'كاش' | 'تحويل'): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const asset = custodyAssetCode();
    if (!asset) return false;
    const fund = custodyFunds.find((f) => f.id === id);
    if (!fund || fund.status !== 'بانتظار_دفع_محاسب') return false;
    if (fund.currency === 'USD' && (!fund.exchangeRate || fund.exchangeRate <= 0)) return false;
    const T = custodyFundAmountInEgp(fund);
    if (T <= 0) return false;
    const dateStr = new Date().toISOString().slice(0, 10);
    const currencyNote =
      fund.currency === 'USD'
        ? ` (${fund.totalAmount} USD × ${fund.exchangeRate} = ${T} EGP)`
        : '';
    const j = await applySystemJournalEntry({
      date: dateStr,
      description: `صرف عهدة إنتاج — ${fund.title}${currencyNote}`,
      lines: [
        { accountCode: asset, debit: T, credit: 0, costCenter: 'عام', note: 'أمانة عهدة لمدير الإنتاج' },
        { accountCode: method === 'تحويل' ? '1020' : '1010', debit: 0, credit: T, costCenter: 'عام', note: method === 'تحويل' ? 'صرف عبر بنك' : 'صرف نقدي من الصندوق' },
      ],
    });
    if (!j) return false;
    const payAt = new Date().toISOString();
    const updated: CustodyFund = {
      ...fund,
      status: 'جاهزة_للاستلام',
      journalEntryPaymentId: j.id,
      paymentMethod: method,
      paymentAt: payAt,
    };
    setCustodyFunds((prev) => prev.map((f) => (f.id === id ? updated : f)));
    if (isServerDataMode()) {
      try {
        await putCustodyFundApi(updated);
      } catch {
        setCustodyFunds((prev) => prev.map((f) => (f.id === id ? fund : f)));
        await tryDeleteManualJournal(j.id);
        setManualJournalEntries((prev) => prev.filter((e) => e.id !== j.id));
        return false;
      }
    }
    addAuditEvent({ action: 'تسجيل دفع عهدة وقيد صرف', entityType: 'system', entityId: id, details: `${j.id} | ${method}` });
    return true;
  };

  const managerReceiveCustody = async (id: string, note?: string): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج' || !currentUser.id) return false;
    const fund = custodyFunds.find((f) => f.id === id);
    if (!fund || fund.status !== 'جاهزة_للاستلام') return false;
    if (!custodyFundBelongsToProductionManager(fund, currentUser.id, currentUser.name)) return false;
    let ok = false;
    const updated: CustodyFund = {
      ...fund,
      status: 'نشطة',
      productionManagerId: String(fund.productionManagerId || '').trim() || currentUser.id,
      productionManagerName: String(fund.productionManagerName || '').trim() || currentUser.name,
      receivedMethod: fund.paymentMethod || 'كاش',
      receivedAt: new Date().toISOString(),
      receivedNote: note,
    };
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (f.status !== 'جاهزة_للاستلام') return f;
        if (!custodyFundBelongsToProductionManager(f, currentUser.id, currentUser.name)) return f;
        ok = true;
        return updated;
      })
    );
    if (ok && isServerDataMode()) {
      try {
        await putCustodyFundApi(updated);
      } catch {
        setCustodyFunds((prev) => prev.map((f) => (f.id === id ? fund : f)));
        return false;
      }
    }
    if (ok) addAuditEvent({ action: 'استلام مدير إنتاج عهدة', entityType: 'system', entityId: id, details: '' });
    return ok;
  };

  const managerUpdateCustodySpendLines = async (id: string, lines: CustodySpendLine[]): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج' || !currentUser.id) return false;
    const fund = custodyFunds.find((f) => f.id === id);
    const canEditSpend =
      fund &&
      custodyFundBelongsToProductionManager(fund, currentUser.id, currentUser.name) &&
      (fund.status === 'نشطة' || fund.status === 'جاهزة_للاستلام');
    if (!canEditSpend || !fund) return false;
    const updated: CustodyFund = {
      ...fund,
      spendLines: lines,
      productionManagerId: String(fund.productionManagerId || '').trim() || currentUser.id,
      productionManagerName: String(fund.productionManagerName || '').trim() || currentUser.name,
    };
    let ok = false;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (!custodyFundBelongsToProductionManager(f, currentUser.id, currentUser.name)) return f;
        if (f.status !== 'نشطة' && f.status !== 'جاهزة_للاستلام') return f;
        ok = true;
        return updated;
      })
    );
    if (ok && isServerDataMode()) {
      try {
        await putCustodyFundApi(updated);
      } catch {
        if (fund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? fund : f)));
        return false;
      }
    }
    return ok;
  };

  const managerUpdateApprovedExpenseSpendLines = async (expenseId: string, lines: CustodySpendLine[]): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج' || !currentUser.id) return false;
    const expense = expenses.find((e) => e.id === expenseId);
    if (!expense || expense.approvalStatus !== 'معتمد') return false;
    if (!productionExpenseBelongsToManager(expense, currentUser.id, currentUser.name)) return false;
    const normalized = lines.map((l) => migrateCustodySpendLine(l));
    const cap = expense.totalAmount ?? expense.amount;
    const sum = normalized.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if (sum > cap + 0.01) return false;
    if (isServerDataMode()) {
      try {
        const row = await patchExpenseApi(expenseId, {
          productionSpendLines: normalized,
        } as Partial<Expense>);
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? row : e)));
        addAuditEvent({
          action: 'تحديث بنود صرف طلب مصروف إنتاج',
          entityType: 'system',
          entityId: expenseId,
          details: `${normalized.length} بند — ${sum.toLocaleString()} ج.م`,
        });
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'تعذر الحفظ';
        toast.error(msg);
        return false;
      }
    }
    setExpenses((prev) =>
      prev.map((e) => (e.id === expenseId ? { ...e, productionSpendLines: normalized } : e)),
    );
    addAuditEvent({
      action: 'تحديث بنود صرف طلب مصروف إنتاج',
      entityType: 'system',
      entityId: expenseId,
      details: `${normalized.length} بند`,
    });
    return true;
  };

  const managerSubmitCustodySettlement = async (id: string, lines: CustodySpendLine[]): Promise<boolean> => {
    if (currentUser?.role !== 'مدير إنتاج' || !currentUser.id) return false;
    const uid = currentUser.id;
    const uname = currentUser.name;
    const beforeFund = custodyFunds.find((x) => x.id === id);
    let ok = false;
    let submitted: CustodyFund | undefined;
    setCustodyFunds((prev) => {
      const f = prev.find((x) => x.id === id);
      if (!f || !custodyFundBelongsToProductionManager(f, uid, uname) || f.status !== 'نشطة') return prev;
      ok = true;
      submitted = {
        ...f,
        spendLines: lines,
        productionManagerId: String(f.productionManagerId || '').trim() || uid,
        productionManagerName: String(f.productionManagerName || '').trim() || uname,
        status: 'تسوية_بانتظار_محاسب' as CustodyFundStatus,
        settlementSubmittedAt: new Date().toISOString(),
        settlementRejectedReason: undefined,
      };
      return prev.map((x) => (x.id === id ? submitted! : x));
    });
    if (ok && isServerDataMode() && submitted) {
      try {
        await putCustodyFundApi(submitted);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) addAuditEvent({ action: 'إرسال تسوية عهدة للمحاسب', entityType: 'system', entityId: id, details: '' });
    return ok;
  };

  const accountantApproveCustodySettlement = async (id: string): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const asset = custodyAssetCode();
    if (!asset) return false;
    const fund = custodyFunds.find(f => f.id === id);
    if (!fund || fund.status !== 'تسوية_بانتظار_محاسب') return false;
    if (!fund.journalEntryPaymentId) return false;
    if (fund.currency === 'USD' && (!fund.exchangeRate || fund.exchangeRate <= 0)) return false;
    const T = custodyFundAmountInEgp(fund);
    const S = fund.spendLines.reduce((s, l) => s + custodyLineAmountInEgp(Number(l.amount) || 0, fund), 0);
    const diff = Math.round(Math.abs(S - T) * 100) / 100;
    const overspent = S > T + 0.001;   // أنفق أكثر من العهدة
    const underspent = T > S + 0.001;  // أنفق أقل من العهدة
    const dateStr = new Date().toISOString().slice(0, 10);
    const lines: ManualJournalLine[] = [];

    // بنود الصرف الفعلية — مدين مصروفات
    fund.spendLines.forEach((line) => {
      const a = custodyLineAmountInEgp(Number(line.amount) || 0, fund);
      if (a <= 0.001) return;
      lines.push({
        accountCode: resolveCustodyAccountCode(line.category),
        debit: a,
        credit: 0,
        costCenter: line.costCenter || 'عام',
        note: line.title,
      });
    });

    if (underspent) {
      // الموظف يُرجع الفرق نقداً → مدين صندوق
      lines.push({
        accountCode: '1010',
        debit: diff,
        credit: 0,
        costCenter: 'عام',
        note: 'إرجاع باقي العهدة للصندوق',
      });
    } else if (overspent) {
      // الموظف أنفق من جيبه → دائن ذمم دائنة (مستحقات للموظف)
      lines.push({
        accountCode: '2100',
        debit: 0,
        credit: diff,
        costCenter: 'عام',
        note: 'فرق زيادة صرف مستحق للموظف',
      });
    }

    // إقفال حساب أمانة العهدة دائناً بالمبلغ المُسلَّم
    lines.push({
      accountCode: asset,
      debit: 0,
      credit: T,
      costCenter: 'عام',
      note: `إقفال أمانة عهدة: ${fund.title}`,
    });
    const journal = await applySystemJournalEntry({
      date: dateStr,
      description: `إقفال عهدة إنتاج — ${fund.title}`,
      lines,
    });
    if (!journal) return false;
    const closed: CustodyFund = {
      ...fund,
      status: 'مقفلة' as CustodyFundStatus,
      journalEntrySettlementId: journal.id,
      journalEntryId: journal.id,
    };
    setCustodyFunds((prev) => prev.map((f) => (f.id === id ? closed : f)));
    if (isServerDataMode()) {
      try {
        await putCustodyFundApi(closed);
      } catch {
        setCustodyFunds((prev) => prev.map((f) => (f.id === id ? fund : f)));
        await tryDeleteManualJournal(journal.id);
        setManualJournalEntries((prev) => prev.filter((e) => e.id !== journal.id));
        return false;
      }
    }
    addAuditEvent({ action: 'اعتماد محاسب تسوية عهدة وترحيل قيد إقفال', entityType: 'system', entityId: id, details: journal.id });
    return true;
  };

  const accountantRejectCustodySettlement = async (id: string, reason?: string): Promise<boolean> => {
    if (currentUser?.role !== 'محاسب') return false;
    const beforeFund = custodyFunds.find((f) => f.id === id);
    let ok = false;
    let synced: CustodyFund | undefined;
    setCustodyFunds((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        if (f.status !== 'تسوية_بانتظار_محاسب') return f;
        ok = true;
        synced = {
          ...f,
          status: 'نشطة' as CustodyFundStatus,
          settlementRejectedReason: reason,
          settlementSubmittedAt: undefined,
        };
        return synced;
      })
    );
    if (ok && isServerDataMode() && synced) {
      try {
        await putCustodyFundApi(synced);
      } catch {
        if (beforeFund) setCustodyFunds((prev) => prev.map((f) => (f.id === id ? beforeFund : f)));
        return false;
      }
    }
    if (ok) addAuditEvent({ action: 'رفض محاسب تسوية عهدة — إرجاع للتعديل', entityType: 'system', entityId: id, details: reason || '' });
    return ok;
  };

  const hardDeleteCustodyFund = async (id: string): Promise<boolean> => {
    setCustodyFunds((prev) => prev.filter((f) => f.id !== id));
    if (isServerDataMode()) {
      try {
        await deleteCustodyFundApi(id);
      } catch {
        return false;
      }
    }
    return true;
  };

  const hardDeleteExpense = async (id: string): Promise<boolean> => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    if (isServerDataMode()) {
      try {
        await deleteExpenseApi(id);
      } catch {
        return false;
      }
    }
    return true;
  };

  const logout = () => {
    const mirrorUid = currentUser?.id;
    clearBookingMirrorBuckets(mirrorUid);
    authBootstrapEpochRef.current += 1;
    authMeAbortRef.current?.abort();
    authMeAbortRef.current = null;
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('prod_system_force_logout_next', '1');
        window.sessionStorage.setItem('prod_system_skip_welcome_next_load', '1');
        clearSessionBookingBackups();
      }
    } catch {
      /* private mode / blocked storage */
    }
    try {
      localStorage.removeItem('prod_system_jwt');
      localStorage.removeItem('prod_system_current_user');
      localStorage.removeItem('prod_system_supabase');
    } catch {
      /* ignore */
    }
    clearSupabasePersistedAuthFromLocalStorage();
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(SESSION_SIGNED_OUT_KEY, '1');
      }
    } catch {
      /* ignore */
    }
    resetInboundLeadToastState();
    setCurrentUserState(null);
    addAuditEvent({
      action: 'تسجيل خروج',
      entityType: 'system',
      details: 'قام المستخدم بتسجيل الخروج',
    });
    /** خروج صلب: إعادة تحميل الصفحة مع ?_hl=1 — سكربت index.html يمسح التوكن قبل تشغيل React (لا سباق). */
    const navigateHardLogout = () => {
      if (typeof window === 'undefined') return;
      try {
        const sp = new URLSearchParams(window.location.search || '');
        sp.set('_hl', '1');
        const q = sp.toString();
        window.location.replace(`${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash || ''}`);
      } catch {
        /* ignore */
      }
    };
    if (isSupabaseDirectMode()) {
      void (async () => {
        try {
          await getSupabase().auth.signOut({ scope: 'global' });
        } catch {
          /* ignore */
        }
        clearSupabasePersistedAuthFromLocalStorage();
        navigateHardLogout();
      })();
      return;
    }
    navigateHardLogout();
  };

  return (
    <DataContext.Provider value={{ 
      leads, users, manualCustomers, invoices, priceQuotes, accountingPolicy, expenses, currentUser, setCurrentUser: setCurrentUserPublic, addLead, bulkAddLeads, 
      updateLeadStatus, logLeadInteraction, reviewLeadActivity, setLeadFollowUp, assignLead, assignLeadsBulk, deleteLead, deleteLeadsBulk, updateUserSkills, addEmployee, addManualCustomer, updateEmployeeSalary, updateEmployeeProfile, ownerSetEmployeePassword, removeEmployee, getLeadScore, refreshSLA, logout, addInvoice,
      updateInvoiceStatus, recordInvoiceCollection, addPriceQuote, productionPriceQuote, reassignPricingRequest, approvePriceQuote, rejectPriceQuote, ownerReturnPriceQuoteToProduction, repRecordClientAcceptance, repRecordClientRejection, updateAccountingPolicy, addExpense, updateExpenseStatus, approveExpense, rejectExpense,
      getRepSnapshots, monthlyTargets, updateMonthlyTarget, getPerformanceAlerts, getSlaHeatmap,
      closedMonths, closeMonth, reopenMonth, isMonthClosed,
      chartOfAccounts, addChartAccount, removeChartAccount,
      manualJournalEntries, addManualJournalEntry, updateManualJournalEntry, removeManualJournalEntry, getManualJournalModifyBlockReason,
      journalCodingRules, setJournalCodingRules, addJournalCodingRule, removeJournalCodingRule,
      expenseCodingRules, setExpenseCodingRules,
      customerCodePrefix, setCustomerCodePrefix,
      expenseSavedViews, setExpenseSavedViews,
      payrollAutoSendDay, setPayrollAutoSendDay,
      entityComments, setEntityComments,
      expenseEscalations, setExpenseEscalations,
      uiVisualMode, setUiVisualMode,
      personalTodos, setPersonalTodos,
      desktopNotifyWhenVisible, setDesktopNotifyWhenVisible,
      closedFiscalYears, closeFiscalYear, reopenFiscalYear, getOpeningBalances, saveOpeningBalancesForYear, openingBalancesByYear,
      attendanceRecords, logAttendance,
      payrollApprovals, payrollApprovalRequests, payrollSalesDiscounts, addPayrollSalesDiscount, removePayrollSalesDiscount, getPayrollSalesDiscountTotal, financialReopenRequests, approvePayroll, reopenPayroll, isPayrollApproved, requestPayrollApproval, ownerApprovePayrollRequest, ownerRejectPayrollRequest, requestMonthReopen, ownerApproveMonthReopenRequest, ownerRejectMonthReopenRequest, getSystemNotifications, refreshServerWorkspace,
      auditEvents, addAuditEvent,
      shootBookings: shootBookings.filter((b) => !deletedShootIdsRef.current.has(b.id)),
      equipmentBookings: equipmentBookings.filter((b) => !deletedEquipIdsRef.current.has(b.id)),
      meetingBookings: meetingBookings.filter((b) => !deletedMeetIdsRef.current.has(b.id)),
      otherBookings, equipmentItems, addShootBooking, addEquipmentBooking, addMeetingBooking, addOtherBooking, removeOtherBooking, removeShootBooking, removeEquipmentBooking, removeMeetingBooking, addEquipmentItem, removeEquipmentItem, updateShootBookingStatus, productionUpdateWorkOrder, updateEquipmentBookingStatus, updateMeetingBookingStatus, accountantExecuteShootBookingClaim, accountantExecuteEquipmentBookingClaim, accountantExecuteMeetingBookingClaim, productionSubmitBookingSpendToAccountant,
      printBrandingSettings, updatePrintBrandingSettings,
      leadIngestionSettings, updateLeadIngestionSettings,
      slaEscalationSettings, updateSlaEscalationSettings,
      leadDataQualitySettings, updateLeadDataQualitySettings,
      workflowRulesSettings, updateWorkflowRulesSettings,
      integrations, startIntegrationConnect, completeIntegrationConnect, markIntegrationError, disconnectIntegration,
      syncExternalLeads,
      custodyFunds, custodyAccountByCategory, updateCustodyAccountByCategory,
      createCustodyRequest, createCustodyFund, updateCustodyDraft, submitCustodyDraftToOwner, submitAllCustodyDraftsToOwner,
      ownerApproveCustodyRequest, ownerRejectCustodyRequest,
      accountantRecordCustodyPayment,
      managerReceiveCustody, managerUpdateCustodySpendLines, managerUpdateApprovedExpenseSpendLines, managerSubmitCustodySettlement,
      accountantApproveCustodySettlement, accountantRejectCustodySettlement,
      hardDeleteCustodyFund, hardDeleteExpense,
    } as any}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
};
