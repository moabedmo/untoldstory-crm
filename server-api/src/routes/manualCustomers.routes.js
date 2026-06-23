import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { manualCustomerToJson } from '../lib/manualCustomerSerialize.js';

const router = Router();

function canAccess(actor) {
  return ['مالك', 'محاسب', 'مدير مبيعات', 'مندوب'].includes(actor.role);
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.manualCustomer.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ customers: rows.map(manualCustomerToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    const role = req.authUser.role;
    if (role !== 'مالك' && role !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    const row = await prisma.manualCustomer.create({
      data: {
        name,
        customerCode: body.customerCode ? String(body.customerCode).trim() : null,
        company: body.company ? String(body.company).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        email: body.email ? String(body.email).trim().toLowerCase() : null,
        sourceLabel: body.sourceLabel ? String(body.sourceLabel).trim() : 'يدوي',
        createdById: req.authUser.id,
        createdByName: req.authUser.name,
        createdByRole: req.authUser.role,
      },
    });
    return res.status(201).json({ customer: manualCustomerToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك' && req.authUser.role !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { id } = req.params;
    const existing = await prisma.manualCustomer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    const patch = req.body || {};
    const data = {};
    if (patch.name != null) data.name = String(patch.name).trim();
    if (patch.company !== undefined) data.company = patch.company ? String(patch.company).trim() : null;
    if (patch.phone !== undefined) data.phone = patch.phone ? String(patch.phone).trim() : null;
    if (patch.email !== undefined) data.email = patch.email ? String(patch.email).trim().toLowerCase() : null;
    if (patch.sourceLabel !== undefined) data.sourceLabel = patch.sourceLabel ? String(patch.sourceLabel).trim() : null;
    if (patch.customerCode !== undefined) data.customerCode = patch.customerCode ? String(patch.customerCode).trim() : null;
    if (Object.keys(data).length === 0) {
      return res.json({ customer: manualCustomerToJson(existing) });
    }
    const row = await prisma.manualCustomer.update({ where: { id }, data });
    return res.json({ customer: manualCustomerToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك' && req.authUser.role !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { id } = req.params;
    const row = await prisma.manualCustomer.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'غير موجود' });
    await prisma.manualCustomer.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as manualCustomersRouter };
