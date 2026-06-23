import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/', requireAuth(), async (_req, res) => {
  try {
    const rows = await prisma.closedMonth.findMany({
      orderBy: { monthKey: 'desc' },
    });
    return res.json({ closedMonths: rows.map((r) => r.monthKey) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/close', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const monthKey = String(req.body?.monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'month_key غير صالح' });
    }
    await prisma.closedMonth.upsert({
      where: { monthKey },
      create: { monthKey },
      update: {},
    });
    const rows = await prisma.closedMonth.findMany({ orderBy: { monthKey: 'desc' } });
    return res.json({ closedMonths: rows.map((r) => r.monthKey) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/reopen', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const monthKey = String(req.body?.monthKey || '').trim();
    if (!monthKey) return res.status(400).json({ error: 'month_key مطلوب' });
    await prisma.closedMonth.deleteMany({ where: { monthKey } });
    const rows = await prisma.closedMonth.findMany({ orderBy: { monthKey: 'desc' } });
    return res.json({ closedMonths: rows.map((r) => r.monthKey) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as closedMonthsRouter };
