import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { accountingPolicyToJson } from '../lib/accountingPolicySerialize.js';

const router = Router();
const SINGLE_ID = 'default';

function canAccess(actor) {
  return actor.role === 'محاسب' || actor.role === 'مالك';
}

async function ensureRow() {
  let row = await prisma.accountingPolicy.findUnique({ where: { id: SINGLE_ID } });
  if (!row) {
    row = await prisma.accountingPolicy.create({
      data: {
        id: SINGLE_ID,
        policyNotes: '',
        allowedCostCentersJson: [],
        minAmountHighlight: 0,
      },
    });
  }
  return row;
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const row = await ensureRow();
    return res.json({ policy: accountingPolicyToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    await ensureRow();
    const patch = req.body || {};
    const data = {};
    if (patch.policyNotes !== undefined) data.policyNotes = String(patch.policyNotes || '');
    if (patch.allowedCostCentersForQuotes != null) {
      data.allowedCostCentersJson = Array.isArray(patch.allowedCostCentersForQuotes)
        ? patch.allowedCostCentersForQuotes
        : [];
    }
    if (patch.minAmountHighlight != null) {
      data.minAmountHighlight = Math.max(0, Math.round(Number(patch.minAmountHighlight) || 0));
    }
    const row = await prisma.accountingPolicy.update({
      where: { id: SINGLE_ID },
      data,
    });
    return res.json({ policy: accountingPolicyToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as accountingPolicyRouter };
