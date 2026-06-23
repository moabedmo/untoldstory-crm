import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function canAccess(actor) {
  return ['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role);
}

function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return { ...raw, id };
}

function canProductionManagerAccessCustodyDoc(doc, user) {
  if (!doc || typeof doc !== 'object') return false;
  const pm = String(doc.productionManagerId ?? doc.production_manager_id ?? '').trim();
  if (pm === user.id) return true;
  if (pm) return false;
  const pname = String(doc.productionManagerName ?? doc.production_manager_name ?? '').trim();
  const uname = String(user.name || '').trim();
  if (pname && uname && pname === uname) return true;
  const st = String(doc.status || '');
  const creator = String(doc.createdById ?? doc.created_by_id ?? '').trim();
  if ((st === 'طلب_بانتظار_المالك' || st === 'مرفوض_طلب') && creator === user.id) return true;
  return false;
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.custodyFundDoc.findMany({ orderBy: { updatedAt: 'desc' } });
    let funds = rows.map((r) => r.docJson).filter(Boolean);
    if (req.authUser.role === 'مدير إنتاج') {
      funds = funds.filter((doc) => canProductionManagerAccessCustodyDoc(doc, req.authUser));
    }
    return res.json({ funds });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/actions/promote-drafts-to-owner', requireAuth(), async (req, res) => {
  try {
    const actor = req.authUser;
    if (actor.role !== 'مالك' && actor.role !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.custodyFundDoc.findMany();
    let promoted = 0;
    for (const row of rows) {
      const doc = row.docJson;
      if (!doc || typeof doc !== 'object') continue;
      const st = String(doc.status || '');
      if (st !== 'مسودة' && st !== 'مرفوض_طلب') continue;
      await prisma.custodyFundDoc.update({
        where: { id: row.id },
        data: {
          docJson: {
            ...doc,
            status: 'طلب_بانتظار_المالك',
            requestRejectReason: undefined,
          },
        },
      });
      promoted += 1;
    }
    return res.json({ promoted });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    const actor = req.authUser;
    const raw = req.body?.doc != null ? req.body.doc : req.body;
    const doc = normalizeDoc({ ...raw, id: raw?.id || `CF-${randomUUID().slice(0, 10).toUpperCase()}` });
    if (!doc) return res.status(400).json({ error: 'بيانات غير صالحة' });

    if (actor.role === 'مدير إنتاج') {
      if (String(doc.createdById) !== actor.id) {
        return res.status(403).json({ error: 'غير مصرح' });
      }
    } else if (actor.role === 'محاسب') {
      /* مسودة محاسب */
    } else if (actor.role === 'مالك') {
      doc.status = 'طلب_بانتظار_المالك';
    } else {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    const row = await prisma.custodyFundDoc.create({
      data: { id: doc.id, docJson: doc },
    });
    return res.status(201).json({ fund: row.docJson });
  } catch (e) {
    console.error(e);
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'المعرّف مستخدم' });
    }
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.put('/:id', requireAuth(), async (req, res) => {
  try {
    const actor = req.authUser;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'معرّف مطلوب' });

    const raw = req.body?.doc != null ? req.body.doc : req.body;
    const doc = normalizeDoc({ ...raw, id });
    if (!doc) return res.status(400).json({ error: 'بيانات غير صالحة' });

    if (!['محاسب', 'مالك', 'مدير إنتاج'].includes(actor.role)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    if (actor.role === 'مدير إنتاج' && !canProductionManagerAccessCustodyDoc(doc, actor)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    const existing = await prisma.custodyFundDoc.findUnique({ where: { id } });
    if (!existing) {
      const row = await prisma.custodyFundDoc.create({ data: { id, docJson: doc } });
      return res.json({ fund: row.docJson });
    }
    const row = await prisma.custodyFundDoc.update({
      where: { id },
      data: { docJson: doc },
    });
    return res.json({ fund: row.docJson });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as custodyFundsRouter };
