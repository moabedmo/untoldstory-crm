import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { manualJournalToJson } from '../lib/manualJournalSerialize.js';
import { validateManualJournalLines } from '../lib/validateManualJournalLines.js';

const router = Router();

function canAccess(actor) {
  return actor.role === 'محاسب' || actor.role === 'مالك';
}

router.get('/', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const rows = await prisma.manualJournalEntry.findMany({
      orderBy: { date: 'desc' },
      take: 500,
    });
    return res.json({ journals: rows.map(manualJournalToJson) });
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
    const id = body.id ? String(body.id).trim() : undefined;
    const description = String(body.description || '').trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!description || lines.length === 0) {
      return res.status(400).json({ error: 'الوصف والبنود مطلوبان' });
    }
    const journalCheck = validateManualJournalLines(lines);
    if (!journalCheck.ok) {
      return res.status(400).json({ error: journalCheck.error });
    }
    const dateIso = body.date ? String(body.date) : new Date().toISOString();
    const row = await prisma.manualJournalEntry.create({
      data: {
        ...(id ? { id } : {}),
        date: new Date(dateIso),
        description,
        linesJson: journalCheck.lines,
      },
    });
    return res.status(201).json({ journal: manualJournalToJson(row) });
  } catch (e) {
    console.error(e);
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'معرّف القيد مستخدم' });
    }
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'معرّف مطلوب' });
    const existing = await prisma.manualJournalEntry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'القيد غير موجود' });
    const body = req.body || {};
    const description = String(body.description || '').trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!description || lines.length === 0) {
      return res.status(400).json({ error: 'الوصف والبنود مطلوبان' });
    }
    const journalCheck = validateManualJournalLines(lines);
    if (!journalCheck.ok) {
      return res.status(400).json({ error: journalCheck.error });
    }
    const dateIso = body.date ? String(body.date) : existing.date.toISOString();
    const row = await prisma.manualJournalEntry.update({
      where: { id },
      data: {
        date: new Date(dateIso),
        description,
        linesJson: journalCheck.lines,
      },
    });
    return res.json({ journal: manualJournalToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    if (!canAccess(req.authUser)) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'معرّف مطلوب' });
    const existing = await prisma.manualJournalEntry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'القيد غير موجود' });
    await prisma.manualJournalEntry.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as manualJournalsRouter };
