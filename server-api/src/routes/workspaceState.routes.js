import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

function coerceAccountingArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

function sanitizeAccountingDoc(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const out = { ...doc };
  if (Object.prototype.hasOwnProperty.call(out, 'chartOfAccounts')) {
    out.chartOfAccounts = coerceAccountingArray(out.chartOfAccounts);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'journalCodebook')) {
    out.journalCodebook = coerceAccountingArray(out.journalCodebook);
  }
  return out;
}

const router = Router();
const SINGLE_ID = 'default';

/** مفاتيح يعدّلها المالك فقط */
const OWNER_KEYS = new Set([
  'closedFiscalYears',
  'printBranding',
  'leadIngestion',
  'slaEscalation',
  'leadDataQuality',
  'workflowRules',
  'integrations',
  /** تعليقات المالك على كيانات الاعتماد (مصروفات/حجوزات) */
  'entityComments',
  /** وضع الواجهة: premium | classic */
  'uiVisualMode',
  /** تخزين وحدة SEO (مشاريع، كلمات، تدقيق، محتوى، باك لينك) كـ JSON */
  'seoIntelligenceStore',
]);

/** مفاتيح المحاسب أو المالك */
const ACCOUNTING_KEYS = new Set([
  'chartOfAccounts',
  'payrollApprovals',
  'payrollApprovalRequests',
  'financialReopenRequests',
  /** أرصدة افتتاحية لكل سنة مالية (محاسب/مالك) */
  'openingBalancesByYear',
  /** أكواد اليومية المحفوظة (محاسب/مالك) */
  'journalCodebook',
  /** بادئة كود العميل اليدوي (CUS-0001) */
  'customerCodePrefix',
  /** قواعد تكويد المصروفات حسب الفئة */
  'expenseCodebook',
  /** عروض فلترة المصروفات المحفوظة (اسم + شهر + كود + كلمة) */
  'expenseSavedViews',
  /** يوم الشهر (1–28) لإرسال طلب اعتماد الرواتب تلقائياً، أو null للتعطيل */
  'payrollAutoSendDay',
  /** حالة تصعيد مصروفات (تخزين مستقبلي/تكامل) */
  'expenseEscalations',
]);

/** خصومات يدوية على مندوبي المبيعات — مالك ومدير إنتاج */
const PAYROLL_SALES_DISCOUNT_KEYS = new Set(['payrollSalesDiscounts']);

const EQUIPMENT_KEYS = new Set(['equipmentItems']);

/** حجوزات عامة ببيان حر — يشاركها الجميع (حتى وجود مسار REST مخصص) */
const BOOKING_MISC_KEYS = new Set(['otherBookings']);

/** مهام شخصية لكل مستخدم — يُحدّث المرسل حسابه فقط (المالك يمكنه الكل) */
const PERSONAL_KEYS = new Set(['personalTodosByUserId', 'notifyForegroundByUserId']);

const ALL_ROLES = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];

function canPatchKey(key, role) {
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
const STR = (x) => (typeof x === 'string' ? x : '');

/** @param {unknown} val */
function normalizeOtherBookingsPatch(val) {
  if (!Array.isArray(val)) return null;
  const out = [];
  for (const item of val.slice(0, OTHER_BOOKINGS_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const id = STR(item.id).trim().slice(0, 120);
    const title = STR(item.title).trim().slice(0, 200);
    const statement = STR(item.statement).trim().slice(0, 4000);
    if (!id || !statement) continue;
    out.push({
      id,
      title: title || 'حجز آخر',
      statement,
      date: typeof item.date === 'string' && item.date.trim() ? item.date.trim().slice(0, 32) : undefined,
      createdAt:
        typeof item.createdAt === 'string' && item.createdAt.trim()
          ? item.createdAt.trim().slice(0, 40)
          : new Date().toISOString(),
      createdById: STR(item.createdById).trim().slice(0, 120),
      createdByName: STR(item.createdByName).trim().slice(0, 160),
    });
  }
  return out;
}

async function ensureRow() {
  let row = await prisma.workspaceState.findUnique({ where: { id: SINGLE_ID } });
  if (!row) {
    row = await prisma.workspaceState.create({
      data: { id: SINGLE_ID, docJson: {} },
    });
  }
  return row;
}

function deepMergeDoc(base, patch) {
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (k === 'chartOfAccounts' || k === 'journalCodebook') {
      out[k] = coerceAccountingArray(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

router.get('/', requireAuth(), async (_req, res) => {
  try {
    const row = await ensureRow();
    const doc = sanitizeAccountingDoc(row.docJson && typeof row.docJson === 'object' ? row.docJson : {});
    return res.json({ workspace: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/', requireAuth(), async (req, res) => {
  try {
    const actor = req.authUser;
    const patch = req.body || {};
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (keys.length === 0) {
      const row = await ensureRow();
      const doc = sanitizeAccountingDoc(row.docJson && typeof row.docJson === 'object' ? row.docJson : {});
      return res.json({ workspace: doc });
    }
    for (const k of keys) {
      if (
        !OWNER_KEYS.has(k) &&
        !ACCOUNTING_KEYS.has(k) &&
        !EQUIPMENT_KEYS.has(k) &&
        !PERSONAL_KEYS.has(k) &&
        !BOOKING_MISC_KEYS.has(k)
      ) {
        return res.status(400).json({ error: `مفتاح غير مدعوم: ${k}` });
      }
      if (!canPatchKey(k, actor.role)) {
        return res.status(403).json({ error: `غير مصرح بتعديل: ${k}` });
      }
    }
    const row = await ensureRow();
    const cur = sanitizeAccountingDoc(row.docJson && typeof row.docJson === 'object' ? row.docJson : {});
    let patchForMerge = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'otherBookings')) {
      const norm = normalizeOtherBookingsPatch(patch.otherBookings);
      if (norm === null) {
        return res.status(400).json({ error: 'otherBookings غير صالح' });
      }
      patchForMerge = { ...patchForMerge, otherBookings: norm };
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'personalTodosByUserId')) {
      const inc = patch.personalTodosByUserId;
      if (inc !== null && typeof inc !== 'object') {
        return res.status(400).json({ error: 'personalTodosByUserId غير صالح' });
      }
      const incoming = inc || {};
      if (actor.role !== 'مالك') {
        for (const uid of Object.keys(incoming)) {
          if (uid !== actor.id) {
            return res.status(403).json({ error: 'يمكن تحديث مهامك الشخصية فقط' });
          }
        }
      }
      for (const [, arr] of Object.entries(incoming)) {
        if (!Array.isArray(arr)) {
          return res.status(400).json({ error: 'قائمة مهام غير صالحة' });
        }
      }
      const base =
        cur.personalTodosByUserId && typeof cur.personalTodosByUserId === 'object'
          ? cur.personalTodosByUserId
          : {};
      patchForMerge = {
        ...patchForMerge,
        personalTodosByUserId: { ...base, ...incoming },
      };
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notifyForegroundByUserId')) {
      const inc = patch.notifyForegroundByUserId;
      if (inc !== null && typeof inc !== 'object') {
        return res.status(400).json({ error: 'notifyForegroundByUserId غير صالح' });
      }
      const incoming = inc || {};
      if (actor.role !== 'مالك') {
        for (const uid of Object.keys(incoming)) {
          if (uid !== actor.id) {
            return res.status(403).json({ error: 'يمكن تحديث إعداد إشعارك فقط' });
          }
        }
      }
      for (const [, val] of Object.entries(incoming)) {
        if (typeof val !== 'boolean') {
          return res.status(400).json({ error: 'قيمة notifyForegroundByUserId غير صالحة' });
        }
      }
      const base =
        cur.notifyForegroundByUserId && typeof cur.notifyForegroundByUserId === 'object'
          ? cur.notifyForegroundByUserId
          : {};
      patchForMerge = {
        ...patchForMerge,
        notifyForegroundByUserId: { ...base, ...incoming },
      };
    }
    const next = deepMergeDoc(cur, patchForMerge);
    const updated = await prisma.workspaceState.update({
      where: { id: SINGLE_ID },
      data: { docJson: next },
    });
    const doc = sanitizeAccountingDoc(updated.docJson && typeof updated.docJson === 'object' ? updated.docJson : {});
    return res.json({ workspace: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as workspaceStateRouter };
