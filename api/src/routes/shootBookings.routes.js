import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sanitizeDocJson } from '../lib/jsonDocSanitize.js';
import { bookingRouteCatchBody } from '../lib/bookingMutationErrors.js';
import { validateProductionManagerSpendPatch } from '../lib/bookingProductionSpendPatch.js';
import { validateProductionWorkOrderPatch } from '../lib/bookingWorkOrderPatch.js';

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
    const rows = await prisma.shootBookingDoc.findMany({ orderBy: { updatedAt: 'desc' } });
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
    const id = String(b.id || `SB-${randomUUID().slice(0, 8).toUpperCase()}`).trim();
    const est = Number(b.estimatedCost);
    const estimatedCost = Number.isFinite(est) && est > 0 ? est : undefined;

    /** لا نستخدم ...b لتجنّب حقول غريبة أو قيم لا يقبلها عمود Json */
    const docRaw = {
      id,
      repId: req.authUser.id,
      repName: String(req.authUser.name || '').trim() || 'مستخدم',
      requestedByRole: req.authUser.role,
      customerName: String(b.customerName || '').trim(),
      date: String(b.date || '').trim(),
      time: String(b.time || '').trim(),
      location: String(b.location || '').trim(),
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
    if (typeof b.paymentAt === 'string' && b.paymentAt.trim()) docRaw.paymentAt = b.paymentAt.trim();
    if (typeof b.paymentExpenseId === 'string' && b.paymentExpenseId.trim())
      docRaw.paymentExpenseId = b.paymentExpenseId.trim();
    if (b.workOrderFromQuote === true) docRaw.workOrderFromQuote = true;
    if (b.priceQuoteId != null && String(b.priceQuoteId).trim()) docRaw.priceQuoteId = String(b.priceQuoteId).trim();
    if (b.productionAssignedId != null && String(b.productionAssignedId).trim())
      docRaw.productionAssignedId = String(b.productionAssignedId).trim();
    if (b.productionAssignedName != null && String(b.productionAssignedName).trim())
      docRaw.productionAssignedName = String(b.productionAssignedName).trim();
    if (Array.isArray(b.workOrderChecklist) && b.workOrderChecklist.length > 0)
      docRaw.workOrderChecklist = b.workOrderChecklist;

    const doc = sanitizeDocJson(docRaw);
    if (!doc.customerName || !doc.date || !doc.time || !doc.location) {
      return res.status(400).json({ error: 'حقول مطلوبة ناقصة' });
    }
    const row = await prisma.shootBookingDoc.create({
      data: { id, docJson: doc },
    });
    return res.status(201).json({ booking: row.docJson });
  } catch (e) {
    console.error('[shoot-bookings POST]', e);
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
    const existing = await prisma.shootBookingDoc.findUnique({ where: { id } });
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
      const isWorkOrder = cur.workOrderFromQuote === true;
      const isAssigned = String(cur.productionAssignedId || '').trim() === String(req.authUser.id || '').trim();
      if (isWorkOrder && isAssigned) {
        const v = validateProductionWorkOrderPatch(patch, cur, req.authUser.id);
        if (!v.ok) return res.status(403).json({ error: v.reason || 'غير مصرح' });
      } else {
        const v = validateProductionManagerSpendPatch(patch, cur);
        if (!v.ok) return res.status(403).json({ error: v.reason || 'غير مصرح' });
      }
    } else if (patch.status != null || patch.financialStatus != null) {
      if (cur.requestedByRole === 'مدير إنتاج' && req.authUser.role !== 'مالك') {
        return res.status(403).json({ error: 'طلب مدير الإنتاج يعتمد من المالك فقط' });
      }
    }

    const merged = { ...cur, ...patch, id };
    const row = await prisma.shootBookingDoc.update({
      where: { id },
      data: { docJson: merged },
    });
    return res.json({ booking: row.docJson });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as shootBookingsRouter };
