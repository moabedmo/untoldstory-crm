import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sanitizeDocJson } from '../lib/jsonDocSanitize.js';
import { bookingRouteCatchBody } from '../lib/bookingMutationErrors.js';
import { validateProductionManagerSpendPatch } from '../lib/bookingProductionSpendPatch.js';

const router = Router();

function canCreate(actor) {
  return actor.role === 'مندوب' || actor.role === 'مدير إنتاج';
}

function canApprove(actor) {
  return actor.role === 'مالك' || actor.role === 'مدير مبيعات';
}

function canPatch(actor) {
  return canApprove(actor) || actor.role === 'محاسب';
}

router.get('/', requireAuth(), async (_req, res) => {
  try {
    const rows = await prisma.equipmentBookingDoc.findMany({ orderBy: { updatedAt: 'desc' } });
    return res.json({ bookings: rows.map((r) => r.docJson).filter(Boolean) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    if (!canCreate(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const b = req.body || {};
    const id = String(b.id || `EB-${randomUUID().slice(0, 8).toUpperCase()}`).trim();
    const qty = Math.max(1, Math.round(Number(b.quantity) || 1));
    const est = Number(b.estimatedCost);
    const estimatedCost = Number.isFinite(est) && est > 0 ? est : undefined;

    const docRaw = {
      id,
      repId: req.authUser.id,
      repName: String(req.authUser.name || '').trim() || 'مستخدم',
      requestedByRole: req.authUser.role,
      customerName: String(b.customerName || '').trim(),
      equipmentName: String(b.equipmentName || '').trim(),
      quantity: qty,
      fromDate: String(b.fromDate || '').trim(),
      toDate: String(b.toDate || '').trim(),
      status: String(b.status || 'قيد المراجعة').trim(),
      createdAt: typeof b.createdAt === 'string' ? b.createdAt.trim() || new Date().toISOString() : new Date().toISOString(),
    };
    if (b.leadId != null && String(b.leadId).trim()) docRaw.leadId = String(b.leadId).trim();
    if (b.notes != null && String(b.notes).trim()) docRaw.notes = String(b.notes).trim();
    if (estimatedCost != null) docRaw.estimatedCost = estimatedCost;
    if (typeof b.financialStatus === 'string' && b.financialStatus.trim()) {
      docRaw.financialStatus = b.financialStatus.trim();
    }
    if (b.paymentMethod === 'كاش' || b.paymentMethod === 'تحويل') docRaw.paymentMethod = b.paymentMethod;

    const doc = sanitizeDocJson(docRaw);
    if (!doc.customerName || !doc.equipmentName || !doc.fromDate || !doc.toDate) {
      return res.status(400).json({ error: 'حقول مطلوبة ناقصة' });
    }
    const row = await prisma.equipmentBookingDoc.create({
      data: { id, docJson: doc },
    });
    return res.status(201).json({ booking: row.docJson });
  } catch (e) {
    console.error('[equipment-bookings POST]', e);
    const { status, body } = bookingRouteCatchBody(e);
    return res.status(status).json(body);
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    if (!canPatch(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const id = String(req.params.id || '').trim();
    const existing = await prisma.equipmentBookingDoc.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    const cur = existing.docJson && typeof existing.docJson === 'object' ? existing.docJson : {};
    const patch = req.body || {};

    const accountantOnlyKeys = ['financialStatus', 'paymentMethod', 'paymentAt', 'paymentExpenseId', 'status'];
    if (req.authUser.role === 'محاسب') {
      const keys = Object.keys(patch);
      if (keys.some((k) => !accountantOnlyKeys.includes(k))) {
        return res.status(403).json({ error: 'غير مصرح' });
      }
    } else if (req.authUser.role === 'مدير إنتاج') {
      const v = validateProductionManagerSpendPatch(patch, cur);
      if (!v.ok) return res.status(403).json({ error: v.reason || 'غير مصرح' });
    } else if (patch.status != null || patch.financialStatus != null) {
      if (cur.requestedByRole === 'مدير إنتاج' && req.authUser.role !== 'مالك') {
        return res.status(403).json({ error: 'طلب مدير الإنتاج يعتمد من المالك فقط' });
      }
    }

    const merged = { ...cur, ...patch, id };
    const row = await prisma.equipmentBookingDoc.update({
      where: { id },
      data: { docJson: merged },
    });
    return res.json({ booking: row.docJson });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as equipmentBookingsRouter };
