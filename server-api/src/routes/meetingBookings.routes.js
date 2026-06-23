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
    const rows = await prisma.meetingBookingDoc.findMany({ orderBy: { updatedAt: 'desc' } });
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
    const id = String(b.id || `MB-${randomUUID().slice(0, 8).toUpperCase()}`).trim();
    const durationMins = Math.max(15, Math.round(Number(b.durationMins) || 60));
    const venueType = b.venueType === 'خارج_المقر' ? 'خارج_المقر' : 'داخل_المقر';
    const estimatedCost = Math.max(0, Math.round(Number(b.estimatedCost) || 0)) || undefined;
    const doc = {
      ...b,
      id,
      repId: req.authUser.id,
      repName: req.authUser.name,
      requestedByRole: req.authUser.role,
      title: String(b.title || '').trim(),
      date: String(b.date || '').trim(),
      startTime: String(b.startTime || '').trim(),
      durationMins,
      venueType,
      location: b.location != null ? String(b.location) : undefined,
      notes: b.notes != null ? String(b.notes) : undefined,
      leadId: b.leadId != null ? String(b.leadId) : undefined,
      estimatedCost: venueType === 'خارج_المقر' ? estimatedCost : undefined,
      status: String(b.status || 'قيد المراجعة').trim(),
      financialStatus:
        typeof b.financialStatus === 'string'
          ? b.financialStatus
          : b.financialStatus != null
            ? String(b.financialStatus)
            : 'غير_مطلوب',
      createdAt: b.createdAt || new Date().toISOString(),
    };
    if (!doc.title || !doc.date || !doc.startTime) {
      return res.status(400).json({ error: 'حقول مطلوبة ناقصة' });
    }
    const row = await prisma.meetingBookingDoc.create({
      data: { id, docJson: doc },
    });
    return res.status(201).json({ booking: row.docJson });
  } catch (e) {
    console.error('[meeting-bookings POST]', e);
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
    const existing = await prisma.meetingBookingDoc.findUnique({ where: { id } });
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
    const row = await prisma.meetingBookingDoc.update({
      where: { id },
      data: { docJson: merged },
    });
    return res.json({ booking: row.docJson });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as meetingBookingsRouter };
