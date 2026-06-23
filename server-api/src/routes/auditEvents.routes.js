import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

const ENTITY_TYPES = new Set(['lead', 'invoice', 'user', 'system']);

function rowToJson(row) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId || undefined,
    actorId: row.actorId,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    details: row.details || undefined,
  };
}

router.get('/', requireAuth(), async (_req, res) => {
  try {
    const rows = await prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return res.json({ events: rows.map(rowToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', requireAuth(), async (req, res) => {
  try {
    const body = req.body || {};
    const action = String(body.action || '').trim();
    if (!action) return res.status(400).json({ error: 'الإجراء مطلوب' });
    let entityType = String(body.entityType || 'system').trim();
    if (!ENTITY_TYPES.has(entityType)) entityType = 'system';
    const entityId = body.entityId != null ? String(body.entityId).trim() || null : null;
    const details = body.details != null ? String(body.details) : null;
    const id = body.id ? String(body.id).trim() : randomUUID().replace(/-/g, '').slice(0, 12);
    const row = await prisma.auditEvent.create({
      data: {
        id,
        action,
        entityType,
        entityId,
        actorId: req.authUser.id,
        actorName: req.authUser.name,
        details,
      },
    });
    return res.status(201).json({ event: rowToJson(row) });
  } catch (e) {
    console.error(e);
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'معرّف الحدث مستخدم' });
    }
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as auditEventsRouter };
