import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { priceQuoteToJson } from '../lib/priceQuoteSerialize.js';

const router = Router();

function canList(actor) {
  return ['مالك', 'مدير مبيعات', 'محاسب', 'مندوب', 'مدير إنتاج'].includes(actor.role);
}

function canCreate(actor) {
  return actor.role === 'مندوب' || actor.role === 'مدير مبيعات' || actor.role === 'مدير إنتاج';
}

/** من يُسمح له بتعديل صف عرض السعر (الواجهة تفرض القواعد؛ هنا الحد الأدنى للسلامة) */
function canPatchQuote(actor, existing) {
  if (actor.role === 'مالك') return true;
  if (actor.role === 'مدير مبيعات') return true;
  if (actor.role === 'مندوب' && existing.createdById === actor.id) return true;
  if (actor.role === 'مدير إنتاج' && existing.productionAssignedId === actor.id) return true;
  return false;
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canList(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { role, id: userId } = req.authUser;
    let where = {};
    if (role === 'مندوب') {
      where = { createdById: userId };
    } else if (role === 'مدير إنتاج') {
      where = { productionAssignedId: userId };
    }
    const rows = await prisma.priceQuote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ quotes: rows.map(priceQuoteToJson) });
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
    const body = req.body || {};
    const id = body.id ? String(body.id).trim() : undefined;
    const leadId = String(body.leadId || '').trim();
    const customerName = String(body.customerName || '').trim();
    const title = String(body.title || '').trim();
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    const productionAssignedId = body.productionAssignedId ? String(body.productionAssignedId).trim() : null;
    const productionAssignedName = body.productionAssignedName ? String(body.productionAssignedName).trim() : null;
    const routedToProduction = Boolean(productionAssignedId);
    if (!leadId || !customerName || !title || !routedToProduction) {
      return res.status(400).json({ error: 'يجب تحديد مدير إنتاج للتسعير قبل الإرسال' });
    }
    const vatRate = typeof body.vatRate === 'number' ? body.vatRate : 14;
    const vatAmount =
      typeof body.vatAmount === 'number'
        ? Math.round(body.vatAmount)
        : amount > 0
          ? Math.round(amount * (vatRate / 100))
          : 0;
    const totalAmount =
      typeof body.totalAmount === 'number' ? Math.round(body.totalAmount) : amount > 0 ? amount + vatAmount : 0;
    const stRaw = String(body.status || '').trim();
    const status = 'بانتظار التسعير';
    const row = await prisma.priceQuote.create({
      data: {
        ...(id ? { id } : {}),
        leadId,
        customerName,
        title,
        amount,
        vatRate,
        vatAmount,
        totalAmount,
        costCenter: body.costCenter ? String(body.costCenter).trim() : 'عام',
        note: body.note ? String(body.note).trim() : null,
        createdById: req.authUser.id,
        createdByName: req.authUser.name,
        status,
        productionAssignedId,
        productionAssignedName,
        pricingNote: body.pricingNote ? String(body.pricingNote).trim() : null,
      },
    });
    return res.status(201).json({ quote: priceQuoteToJson(row) });
  } catch (e) {
    console.error(e);
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'معرّف عرض السعر مستخدم' });
    }
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.authUser;
    const existing = await prisma.priceQuote.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'غير موجود' });

    if (!canPatchQuote(actor, existing)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    const patch = req.body || {};
    const data = {};

    if (patch.status != null) {
      const st = String(patch.status).trim();
      if (st === 'مرفوض') {
        if (actor.role !== 'مالك') {
          return res.status(403).json({ error: 'غير مصرح' });
        }
        if (existing.status !== 'قيد اعتماد المالك') {
          return res.status(400).json({ error: 'عرض السعر ليس قيد اعتماد المالك' });
        }
        data.status = 'مرفوض';
        data.approvedBy = actor.name;
        data.approvedAt = new Date();
      } else if (st === 'معتمد') {
        if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') {
          return res.status(403).json({ error: 'غير مصرح' });
        }
        if (existing.status !== 'قيد اعتماد المالك') {
          return res.status(400).json({ error: 'عرض السعر ليس قيد اعتماد المالك' });
        }
        data.status = 'معتمد';
        if (patch.approvedBy) data.approvedBy = String(patch.approvedBy);
        else data.approvedBy = actor.name;
        data.approvedAt = patch.approvedAt ? new Date(patch.approvedAt) : new Date();
        if (patch.invoiceId) data.invoiceId = String(patch.invoiceId).trim();
        if (patch.paymentSchedule != null) data.paymentScheduleJson = patch.paymentSchedule;
        if (patch.initialPayment != null) data.initialPayment = Math.round(Number(patch.initialPayment) || 0);
      } else if (st === 'قيد اعتماد المالك' && existing.status === 'بانتظار التسعير') {
        data.status = 'قيد اعتماد المالك';
      } else if (st === 'مكتمل' || st === 'مغلق - رفض العميل') {
        data.status = st;
      } else if (st === 'بانتظار التسعير') {
        /** إرجاع للإنتاج بعد طلب تعديل من المالك — كان العرض «قيد اعتماد المالك» */
        if (actor.role !== 'مالك') {
          return res.status(403).json({ error: 'إرجاع التسعير للإنتاج للمالك فقط' });
        }
        if (existing.status !== 'قيد اعتماد المالك') {
          return res.status(400).json({ error: 'لا يُرجَع للإنتاج إلا من حالة قيد اعتماد المالك' });
        }
        if (!existing.productionAssignedId && !existing.pricedById) {
          return res.status(400).json({ error: 'لا يوجد مسار إنتاج مرتبط بهذا العرض' });
        }
        data.status = 'بانتظار التسعير';
        data.approvedBy = null;
        data.approvedAt = null;
        if (!existing.productionAssignedId && existing.pricedById) {
          data.productionAssignedId = existing.pricedById;
          data.productionAssignedName = existing.pricedByName || null;
        }
      } else {
        return res.status(400).json({ error: 'حالة غير صالحة' });
      }
    }

    if (patch.amount != null) data.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
    if (patch.vatRate != null) data.vatRate = Number(patch.vatRate);
    if (patch.vatAmount != null) data.vatAmount = Math.round(Number(patch.vatAmount) || 0);
    if (patch.totalAmount != null) data.totalAmount = Math.round(Number(patch.totalAmount) || 0);
    if (patch.costCenter != null) data.costCenter = String(patch.costCenter).trim() || 'عام';
    if (patch.note !== undefined) data.note = patch.note ? String(patch.note).trim() : null;

    if (patch.productionAssignedId !== undefined) {
      data.productionAssignedId = patch.productionAssignedId ? String(patch.productionAssignedId).trim() : null;
    }
    if (patch.productionAssignedName !== undefined) {
      data.productionAssignedName = patch.productionAssignedName ? String(patch.productionAssignedName).trim() : null;
    }
    if (patch.pricedById != null) data.pricedById = String(patch.pricedById).trim();
    if (patch.pricedByName != null) data.pricedByName = String(patch.pricedByName).trim();
    if (patch.pricedAt != null) data.pricedAt = new Date(patch.pricedAt);
    if (patch.pricingNote !== undefined) data.pricingNote = patch.pricingNote ? String(patch.pricingNote).trim() : null;
    if (patch.paymentSchedule != null) data.paymentScheduleJson = patch.paymentSchedule;
    if (patch.initialPayment != null) data.initialPayment = Math.round(Number(patch.initialPayment) || 0);
    if (patch.clientPayments != null) data.clientPaymentsJson = patch.clientPayments;
    if (patch.clientAcceptedAt != null) data.clientAcceptedAt = new Date(patch.clientAcceptedAt);
    if (patch.clientRejectedAt != null) data.clientRejectedAt = new Date(patch.clientRejectedAt);
    if (patch.clientRejectionNote !== undefined) {
      data.clientRejectionNote = patch.clientRejectionNote ? String(patch.clientRejectionNote).trim() : null;
    }
    if (patch.companyMarginPercent !== undefined) {
      data.companyMarginPercent = Math.min(100, Math.max(0, Number(patch.companyMarginPercent) || 0));
    }
    if (patch.productionCostAmount !== undefined) {
      data.productionCostAmount = Math.round(Number(patch.productionCostAmount) || 0);
    }
    if (patch.invoiceId !== undefined && patch.invoiceId != null) {
      data.invoiceId = String(patch.invoiceId).trim();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'لا يوجد تحديث' });
    }

    if (data.status === 'معتمد' || data.status === 'مرفوض') {
      if (existing.status !== 'قيد اعتماد المالك') {
        return res.status(400).json({ error: 'عرض السعر ليس قيد الاعتماد' });
      }
    }

    const row = await prisma.priceQuote.update({ where: { id }, data });
    return res.json({ quote: priceQuoteToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as priceQuotesRouter };
