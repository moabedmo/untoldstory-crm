import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function canAccess(actor) {
  return actor.role === 'محاسب' || actor.role === 'مالك';
}

function rowToJson(row) {
  return {
    id: row.id,
    repId: row.repId,
    type: row.type,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.attendanceRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 4000,
    });
    return res.json({ records: rows.map(rowToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const body = req.body || {};
    const repId = String(body.repId || '').trim();
    const type = body.type === 'out' ? 'out' : 'in';
    const source = body.source === 'manual' ? 'manual' : 'machine';
    if (!repId) return res.status(400).json({ error: 'repId مطلوب' });
    const id = body.id ? String(body.id).trim() : `ATT-${randomUUID().slice(0, 12).toUpperCase()}`;
    const createdAt = body.createdAt ? new Date(String(body.createdAt)) : new Date();
    const row = await prisma.attendanceRecord.create({
      data: {
        id,
        repId,
        type,
        source,
        createdAt,
      },
    });
    return res.status(201).json({ record: rowToJson(row) });
  } catch (e) {
    console.error(e);
    if (e?.code === 'P2002') return res.status(409).json({ error: 'معرّف مسجل' });
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as attendanceRecordsRouter };
