import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { expenseToJson, mergeProductionSpendLinesIntoRawNote } from '../lib/expenseSerialize.js';

const router = Router();

function canView(actor) {
  return ['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role);
}

function canEdit(actor) {
  return (
    actor.role === 'محاسب' ||
    actor.role === 'مالك' ||
    actor.role === 'مدير إنتاج' ||
    actor.role === 'مدير مبيعات'
  );
}

function pmOwnsProductionExpenseRow(exp, actor) {
  const sid = exp.submittedById != null ? String(exp.submittedById).trim() : '';
  if (sid && sid === String(actor.id || '').trim()) return true;
  const vendor = (exp.vendor || '').trim();
  if (vendor !== 'طلب مدير الإنتاج') return false;
  const sname = (exp.submittedByName || '').trim();
  const uname = (actor.name || '').trim();
  return !!(uname && sname === uname);
}

function normalizeProductionSpendLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => ({
    id: String(x?.id || `CL-${Math.random().toString(36).slice(2, 8)}`),
    title: String(x?.title || ''),
    amount: Math.max(0, Math.round(Number(x?.amount) || 0)),
    category: String(x?.category || 'تشغيل').trim(),
    costCenter: String(x?.costCenter || 'عام').trim(),
    note: typeof x?.note === 'string' ? x.note : undefined,
    attachments: Array.isArray(x?.attachments)
      ? x.attachments.map((a) => ({
          id: String(a?.id || `ATT-${Math.random().toString(36).slice(2, 9)}`),
          fileName: String(a?.fileName || 'مرفق'),
          mimeType: typeof a?.mimeType === 'string' ? a.mimeType : undefined,
          dataBase64: typeof a?.dataBase64 === 'string' ? a.dataBase64 : undefined,
        }))
      : [],
  }));
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canView(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.expense.findMany({
      orderBy: { date: 'desc' },
    });
    return res.json({ expenses: rows.map(expenseToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    if (!canEdit(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
    const category = String(body.category || 'أخرى').trim();
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    const vatRate = typeof body.vatRate === 'number' ? body.vatRate : 14;
    const vatAmount =
      typeof body.vatAmount === 'number'
        ? Math.round(body.vatAmount)
        : Math.round(amount * (vatRate / 100));
    const totalAmount =
      typeof body.totalAmount === 'number' ? Math.round(body.totalAmount) : amount + vatAmount;
    const dateIso = body.date ? String(body.date) : new Date().toISOString();
    const approvalStatus =
      body.approvalStatus != null && String(body.approvalStatus).trim() !== ''
        ? String(body.approvalStatus).trim()
        : 'قيد الاعتماد';
    const row = await prisma.expense.create({
      data: {
        ...(body.id ? { id: String(body.id).trim() } : {}),
        title,
        category,
        amount,
        vatRate,
        vatAmount,
        totalAmount,
        costCenter: body.costCenter ? String(body.costCenter).trim() : 'عام',
        status: String(body.status || 'قيد الانتظار').trim(),
        approvalStatus,
        approvedBy: body.approvedBy ? String(body.approvedBy).trim() : null,
        vendor: body.vendor ? String(body.vendor).trim() : null,
        note: body.note ? String(body.note).trim() : null,
        submittedById: req.authUser.id,
        submittedByName: (() => {
          const n = req.authUser.name ? String(req.authUser.name).trim() : '';
          if (n && n !== 'null') return n;
          const em = req.authUser.email ? String(req.authUser.email).trim().toLowerCase() : '';
          if (em.includes('@')) return em.slice(0, em.indexOf('@'));
          return 'مستخدم';
        })(),
        date: new Date(dateIso),
      },
    });
    return res.status(201).json({ expense: expenseToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const actor = req.authUser;
    const { id } = req.params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'غير موجود' });

    const patch = req.body || {};
    const canApprove = actor.role === 'مالك';
    const hasSpendLinesPatch = Object.prototype.hasOwnProperty.call(patch, 'productionSpendLines');

    if (patch.approvalStatus != null || patch.approvedBy !== undefined) {
      if (!canApprove) return res.status(403).json({ error: 'غير مصرح باعتماد المصروفات' });
    } else if (!canEdit(actor)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    if (hasSpendLinesPatch) {
      if (patch.approvalStatus != null || patch.approvedBy !== undefined) {
        return res.status(400).json({ error: 'افصل تحديث بنود الصرف عن اعتماد المالك' });
      }
      const allowedSpendPatchKeys = new Set(['productionSpendLines', 'note']);
      const unknownKeys = Object.keys(patch).filter((k) => !allowedSpendPatchKeys.has(k));
      if (unknownKeys.length) {
        return res
          .status(400)
          .json({ error: 'مع تحديث البنود يُسمح بإرسال productionSpendLines أو note فقط' });
      }
      if (actor.role !== 'مدير إنتاج') {
        return res.status(403).json({ error: 'فقط مدير الإنتاج يحدّث بنود صرف طلب التمويل' });
      }
      if (String(existing.approvalStatus || '').trim() !== 'معتمد') {
        return res.status(400).json({ error: 'بنود الصرف متاحة بعد اعتماد المالك فقط' });
      }
      if (!pmOwnsProductionExpenseRow(existing, actor)) {
        return res.status(403).json({ error: 'هذا الطلب لا يخصك' });
      }
      const lines = normalizeProductionSpendLines(patch.productionSpendLines);
      const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const cap = Number(existing.totalAmount ?? existing.amount) || 0;
      if (sum > cap + 0.01) {
        return res.status(400).json({ error: 'مجموع البنود يتجاوز مبلغ الطلب المعتمد' });
      }
      const baseNote = patch.note !== undefined ? String(patch.note ?? '') : String(existing.note ?? '');
      const mergedNote = mergeProductionSpendLinesIntoRawNote(baseNote, lines);
      const row = await prisma.expense.update({
        where: { id },
        data: { note: mergedNote },
      });
      return res.json({ expense: expenseToJson(row) });
    }

    const data = {};
    if (patch.title != null) data.title = String(patch.title).trim();
    if (patch.category != null) data.category = String(patch.category).trim();
    if (patch.amount != null) data.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
    if (patch.vatRate != null) data.vatRate = Number(patch.vatRate);
    if (patch.vatAmount != null) data.vatAmount = Math.round(Number(patch.vatAmount) || 0);
    if (patch.totalAmount != null) data.totalAmount = Math.round(Number(patch.totalAmount) || 0);
    if (patch.costCenter != null) data.costCenter = String(patch.costCenter).trim();
    if (patch.status != null) data.status = String(patch.status).trim();
    if (patch.date != null) data.date = new Date(patch.date);
    if (patch.vendor !== undefined) data.vendor = patch.vendor ? String(patch.vendor).trim() : null;
    if (patch.note !== undefined) data.note = patch.note ? String(patch.note).trim() : null;
    if (patch.approvalStatus != null) data.approvalStatus = String(patch.approvalStatus).trim();
    if (patch.approvedBy !== undefined) data.approvedBy = patch.approvedBy ? String(patch.approvedBy).trim() : null;
    if (patch.paymentMethod !== undefined) {
      const pm = patch.paymentMethod;
      if (pm === null || pm === '') data.paymentMethod = null;
      else if (pm === 'كاش' || pm === 'بنك') data.paymentMethod = pm;
      else return res.status(400).json({ error: 'طريقة الدفع يجب أن تكون كاش أو بنك' });
    }
    if (patch.status != null) {
      const st = String(patch.status).trim();
      if (st === 'قيد الانتظار') data.paymentMethod = null;
      if (st === 'مدفوع' && existing.status !== 'مدفوع') {
        if (patch.paymentMethod !== 'كاش' && patch.paymentMethod !== 'بنك') {
          return res.status(400).json({ error: 'حدد طريقة الدفع: كاش أو بنك' });
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return res.json({ expense: expenseToJson(existing) });
    }
    const row = await prisma.expense.update({ where: { id }, data });
    return res.json({ expense: expenseToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as expensesRouter };
