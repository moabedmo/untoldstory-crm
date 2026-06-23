import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
const SINGLE_ID = 'default';

async function ensureRow() {
  let row = await prisma.custodySettings.findUnique({ where: { id: SINGLE_ID } });
  if (!row) {
    row = await prisma.custodySettings.create({
      data: { id: SINGLE_ID, custodyAccountMapJson: {} },
    });
  }
  return row;
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(req.authUser.role)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const row = await ensureRow();
    const map = row.custodyAccountMapJson;
    return res.json({
      custodyAccountByCategory: typeof map === 'object' && map !== null && !Array.isArray(map) ? map : {},
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    await ensureRow();
    const body = req.body || {};
    const incoming = body.custodyAccountByCategory ?? body.map;
    const next =
      typeof incoming === 'object' && incoming !== null && !Array.isArray(incoming) ? incoming : {};
    const row = await prisma.custodySettings.update({
      where: { id: SINGLE_ID },
      data: { custodyAccountMapJson: next },
    });
    const map = row.custodyAccountMapJson;
    return res.json({
      custodyAccountByCategory: typeof map === 'object' && map !== null && !Array.isArray(map) ? map : {},
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as custodySettingsRouter };
