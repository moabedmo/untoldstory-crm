import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function rowToJson(row) {
  return {
    repId: row.repId,
    leadsTarget: row.leadsTarget,
    revenueTarget: row.revenueTarget,
    callsTarget: row.callsTarget,
    dailyCallsTarget: row.dailyCallsTarget,
    weeklyCallsTarget: row.weeklyCallsTarget,
    commissionPercent: Number(row.commissionPercent) || 0,
  };
}

function canEdit(actor) {
  return actor.role === 'مالك' || actor.role === 'مدير مبيعات';
}

router.get('/', requireAuth(), async (_req, res) => {
  try {
    const rows = await prisma.monthlyTarget.findMany();
    return res.json({ targets: rows.map(rowToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:repId', requireAuth(), async (req, res) => {
  try {
    if (!canEdit(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const repId = String(req.params.repId || '').trim();
    if (!repId) return res.status(400).json({ error: 'rep_id مطلوب' });
    const patch = req.body || {};
    const existing = await prisma.monthlyTarget.findUnique({ where: { repId } });
    const base = existing || {
      repId,
      leadsTarget: 15,
      revenueTarget: 250000,
      callsTarget: 80,
      dailyCallsTarget: 8,
      weeklyCallsTarget: 40,
      commissionPercent: 0,
    };
    const data = {
      leadsTarget:
        patch.leadsTarget != null ? Math.max(0, Math.round(Number(patch.leadsTarget) || 0)) : base.leadsTarget,
      revenueTarget:
        patch.revenueTarget != null
          ? Math.max(0, Math.round(Number(patch.revenueTarget) || 0))
          : base.revenueTarget,
      callsTarget:
        patch.callsTarget != null ? Math.max(0, Math.round(Number(patch.callsTarget) || 0)) : base.callsTarget,
      dailyCallsTarget:
        patch.dailyCallsTarget != null
          ? Math.max(0, Math.round(Number(patch.dailyCallsTarget) || 0))
          : base.dailyCallsTarget,
      weeklyCallsTarget:
        patch.weeklyCallsTarget != null
          ? Math.max(0, Math.round(Number(patch.weeklyCallsTarget) || 0))
          : base.weeklyCallsTarget,
      commissionPercent:
        patch.commissionPercent != null
          ? Math.min(100, Math.max(0, Number(patch.commissionPercent) || 0))
          : base.commissionPercent,
    };
    const row = await prisma.monthlyTarget.upsert({
      where: { repId },
      create: { repId, ...data },
      update: data,
    });
    return res.json({ target: rowToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as monthlyTargetsRouter };
