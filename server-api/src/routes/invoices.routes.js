import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { invoiceToJson } from '../lib/invoiceSerialize.js';

const router = Router();

function canAccounting(actor) {
  return actor.role === 'محاسب' || actor.role === 'مالك';
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccounting(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.invoice.findMany({
      orderBy: { date: 'desc' },
    });
    return res.json({ invoices: rows.map(invoiceToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccounting(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const body = req.body || {};
    const customerName = String(body.customerName || '').trim();
    if (!customerName) return res.status(400).json({ error: 'اسم العميل مطلوب' });
    const status = String(body.status || 'قيد الانتظار').trim();
    const amount = Math.max(0, Math.round(Number(body.amount) || 0));
    const vatRate = typeof body.vatRate === 'number' ? body.vatRate : 14;
    const vatAmount =
      typeof body.vatAmount === 'number'
        ? Math.round(body.vatAmount)
        : Math.round(amount * (vatRate / 100));
    const totalAmount =
      typeof body.totalAmount === 'number'
        ? Math.round(body.totalAmount)
        : amount + vatAmount;
    const dateIso = body.date ? String(body.date) : new Date().toISOString();
    const date = new Date(dateIso);
    const collections = Array.isArray(body.collections) ? body.collections : [];
    const row = await prisma.invoice.create({
      data: {
        ...(body.id ? { id: String(body.id).trim() } : {}),
        customerCode: body.customerCode ? String(body.customerCode).trim() : null,
        leadId: body.leadId ? String(body.leadId).trim() : null,
        customerName,
        amount,
        vatRate,
        vatAmount,
        totalAmount,
        costCenter: body.costCenter ? String(body.costCenter).trim() : 'عام',
        status,
        date,
        recordOrigin: body.recordOrigin ? String(body.recordOrigin) : 'يدوي_محاسب',
        priceQuoteId: body.priceQuoteId ? String(body.priceQuoteId).trim() : null,
        paidAmount:
          typeof body.paidAmount === 'number' ? Math.round(body.paidAmount) : status === 'مدفوع' ? totalAmount : 0,
        remainingAmount:
          typeof body.remainingAmount === 'number'
            ? Math.round(body.remainingAmount)
            : Math.max(0, totalAmount - (typeof body.paidAmount === 'number' ? body.paidAmount : 0)),
        nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : null,
        collectionsJson: collections,
      },
    });
    return res.status(201).json({ invoice: invoiceToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    if (!canAccounting(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { id } = req.params;
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    const patch = req.body || {};
    const data = {};
    if (patch.customerName != null) data.customerName = String(patch.customerName).trim();
    if (patch.amount != null) data.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
    if (patch.vatRate != null) data.vatRate = Number(patch.vatRate);
    if (patch.vatAmount != null) data.vatAmount = Math.round(Number(patch.vatAmount) || 0);
    if (patch.totalAmount != null) data.totalAmount = Math.round(Number(patch.totalAmount) || 0);
    if (patch.costCenter != null) data.costCenter = String(patch.costCenter).trim();
    if (patch.status != null) data.status = String(patch.status).trim();
    if (patch.date != null) data.date = new Date(patch.date);
    if (patch.recordOrigin !== undefined) data.recordOrigin = patch.recordOrigin ? String(patch.recordOrigin) : null;
    if (patch.leadId !== undefined) data.leadId = patch.leadId ? String(patch.leadId).trim() : null;
    if (patch.customerCode !== undefined) data.customerCode = patch.customerCode ? String(patch.customerCode).trim() : null;
    if (patch.priceQuoteId !== undefined) data.priceQuoteId = patch.priceQuoteId ? String(patch.priceQuoteId).trim() : null;
    if (patch.paidAmount != null) data.paidAmount = Math.round(Number(patch.paidAmount) || 0);
    if (patch.remainingAmount != null) data.remainingAmount = Math.round(Number(patch.remainingAmount) || 0);
    if ('nextDueDate' in patch) {
      data.nextDueDate = patch.nextDueDate ? new Date(patch.nextDueDate) : null;
    }
    if (patch.collections != null) data.collectionsJson = Array.isArray(patch.collections) ? patch.collections : [];
    if (Object.keys(data).length === 0) {
      return res.json({ invoice: invoiceToJson(existing) });
    }
    const row = await prisma.invoice.update({ where: { id }, data });
    return res.json({ invoice: invoiceToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as invoicesRouter };
