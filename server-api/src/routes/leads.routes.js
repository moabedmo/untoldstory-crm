import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { leadToJson } from '../lib/leadSerialize.js';
import { syncMetaLeadAdsForOwner } from '../lib/metaLeadAdsSync.js';
import { syncLinkedInLeadGenForOwner } from '../lib/linkedinLeadSync.js';
import { syncGoogleAdsLeadFormsForOwner } from '../lib/googleAdsLeadSync.js';
import { importLeadsCsvBatch } from '../lib/importLeadsCsv.js';
import { normalizeLeadPhone } from '../lib/leadPhone.js';

const router = Router();

/**
 * POST /api/leads/sync-meta-ads — سحب ليدز حقيقية من نماذج Lead Ads (صفحات فيسبوك/إنستجرام) عبر Graph API.
 * يتطلب ربط فيسبوك مسبقاً (توكن في integration-tokens) وصلاحيات leads_retrieval.
 */
router.post('/sync-meta-ads', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح', code: 'forbidden' });
    }
    const body = req.body || {};
    const routeToManagerId = body.routeToManagerId ? String(body.routeToManagerId).trim() : null;
    const result = await syncMetaLeadAdsForOwner({
      userId: req.authUser.id,
      prisma,
      routeToManagerId: routeToManagerId || null,
      actorUserId: req.authUser.id,
      actorName: req.authUser.name || 'المالك',
      maxLeadsTotal: Math.max(1, Math.min(120, Number(body.max) || 80)),
    });
    const status = result.ok === false && result.code === 'no_token' ? 400 : 200;
    return res.status(status).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'خطأ في الخادم', messageAr: String(e?.message || e) });
  }
});

/**
 * POST /api/leads/sync-linkedin-leads — سحب ليدز حقيقية من نماذج Lead Gen (LinkedIn Marketing API).
 */
router.post('/sync-linkedin-leads', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح', code: 'forbidden' });
    }
    const body = req.body || {};
    const routeToManagerId = body.routeToManagerId ? String(body.routeToManagerId).trim() : null;
    const result = await syncLinkedInLeadGenForOwner({
      userId: req.authUser.id,
      prisma,
      routeToManagerId: routeToManagerId || null,
      actorUserId: req.authUser.id,
      actorName: req.authUser.name || 'المالك',
      maxLeadsTotal: Math.max(1, Math.min(120, Number(body.max) || 80)),
    });
    const status = result.ok === false && result.code === 'no_token' ? 400 : 200;
    return res.status(status).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'خطأ في الخادم', messageAr: String(e?.message || e) });
  }
});

/**
 * POST /api/leads/sync-google-ads-leads — سحب ليدز حقيقية من Lead Form Extension (Google Ads API).
 */
router.post('/sync-google-ads-leads', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح', code: 'forbidden' });
    }
    const body = req.body || {};
    const routeToManagerId = body.routeToManagerId ? String(body.routeToManagerId).trim() : null;
    const result = await syncGoogleAdsLeadFormsForOwner({
      userId: req.authUser.id,
      prisma,
      routeToManagerId: routeToManagerId || null,
      actorUserId: req.authUser.id,
      actorName: req.authUser.name || 'المالك',
      maxLeadsTotal: Math.max(1, Math.min(120, Number(body.max) || 80)),
    });
    const status =
      result.ok === false && (result.code === 'no_token' || result.code === 'no_dev_token') ? 400 : 200;
    return res.status(status).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'خطأ في الخادم', messageAr: String(e?.message || e) });
  }
});

/** أنشطة أولية عند الاستيراد (مزامنة مصادر خارجية) — تُربط بمعرّف الليد بعد الإنشاء */
function sanitizeImportedTimeline(leadId, raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const max = 30;
  const out = [];
  for (let i = 0; i < Math.min(raw.length, max); i++) {
    const t = raw[i];
    if (!t || typeof t !== 'object') continue;
    const action = String(t.action || '').trim();
    if (!action) continue;
    out.push({
      id: String(t.id || `ev-${Date.now()}-${i}`).slice(0, 80),
      leadId,
      action: action.slice(0, 500),
      note: t.note != null ? String(t.note).slice(0, 2000) : undefined,
      userId: String(t.userId || 'sys').slice(0, 80),
      userName: String(t.userName || 'النظام').slice(0, 120),
      createdAt:
        typeof t.createdAt === 'string' && t.createdAt ? t.createdAt : new Date().toISOString(),
      channelType:
        t.channelType === 'call' || t.channelType === 'chat' || t.channelType === 'other'
          ? t.channelType
          : undefined,
      evidenceType:
        t.evidenceType === 'recording' ||
        t.evidenceType === 'chat_export' ||
        t.evidenceType === 'link' ||
        t.evidenceType === 'note_only'
          ? t.evidenceType
          : undefined,
      evidenceRef: t.evidenceRef != null ? String(t.evidenceRef).slice(0, 2000) : undefined,
      durationSeconds:
        typeof t.durationSeconds === 'number' && Number.isFinite(t.durationSeconds)
          ? Math.max(0, Math.min(86400, Math.floor(t.durationSeconds)))
          : undefined,
      qaStatus:
        t.qaStatus === 'pending' || t.qaStatus === 'approved' || t.qaStatus === 'rejected'
          ? t.qaStatus
          : undefined,
      qaReviewedById: t.qaReviewedById != null ? String(t.qaReviewedById).slice(0, 80) : undefined,
      qaReviewedByName: t.qaReviewedByName != null ? String(t.qaReviewedByName).slice(0, 120) : undefined,
      qaReviewedAt: typeof t.qaReviewedAt === 'string' ? t.qaReviewedAt : undefined,
      qaComment: t.qaComment != null ? String(t.qaComment).slice(0, 2000) : undefined,
    });
  }
  return out;
}

/** قائمة الليدز — حسب الصلاحيات */
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { role, id: userId } = req.authUser;
    const where =
      role === 'مندوب'
        ? { assignedToId: userId }
        : {};
    const rows = await prisma.lead.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    return res.json({ leads: rows.map(leadToJson) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** لقطة كاملة لليد واحد — للتفاصيل في الواجهة */
router.get('/:id', requireAuth(), async (req, res) => {
  try {
    const leadId = String(req.params.id || '').trim();
    if (!leadId) return res.status(400).json({ error: 'معرّف الليد مطلوب' });
    const { role, id: userId } = req.authUser;
    const row = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!row) return res.status(404).json({ error: 'الليد غير موجود' });
    if (role === 'مندوب' && row.assignedToId !== userId) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    return res.json({ lead: leadToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** إنشاء ليد */
router.post('/', requireAuth(), async (req, res) => {
  try {
    const role = req.authUser.role;
    if (role !== 'مالك' && role !== 'مدير مبيعات') {
      return res.status(403).json({ error: 'غير مصرح بإضافة ليد' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const company = String(body.company || '').trim();
    const phone = normalizeLeadPhone(String(body.phone || '').trim());
    const email = String(body.email || '').trim().toLowerCase();
    const status = String(body.status || 'جديد').trim();
    const budget = Math.max(0, Number(body.budget) || 0);
    const companySize = String(body.companySize || 'صغير').trim();
    const source = String(body.source || '').trim();
    const category = String(body.category || '').trim();
    const score = Math.max(0, Math.min(100, Number(body.score) || 0));
    if (!name || !company || !phone || !email) {
      return res.status(400).json({ error: 'بيانات الليد ناقصة' });
    }
    const row = await prisma.lead.create({
      data: {
        customerCode: body.customerCode ? String(body.customerCode) : null,
        name,
        company,
        phone,
        email,
        status,
        budget,
        companySize,
        source,
        category,
        score,
        slaStatus: String(body.slaStatus || 'مستقر'),
        assignedToId: body.assignedTo || null,
        followUpAt: body.followUpAt ? new Date(body.followUpAt) : null,
        lossReasonCode: body.lossReasonCode || null,
        timelineJson: [],
      },
    });
    const imported = sanitizeImportedTimeline(row.id, body.timeline);
    const firstActivity = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      leadId: row.id,
      action: 'إضافة الليد إلى النظام',
      userId: req.authUser.id,
      userName: req.authUser.name,
      createdAt: new Date().toISOString(),
    };
    const timelineJson = imported.length > 0 ? [...imported, firstActivity] : [firstActivity];
    const updated = await prisma.lead.update({
      where: { id: row.id },
      data: { timelineJson },
    });
    return res.status(201).json({ lead: leadToJson(updated) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/**
 * POST /api/leads/import-csv — استيراد ليدز من CSV (مثلاً تصدير LinkedIn Lead Gen).
 * Body: { source: 'linkedin', leads: [...], routeToManagerId? }
 */
router.post('/import-csv', requireAuth(), async (req, res) => {
  try {
    const role = req.authUser.role;
    if (role !== 'مالك' && role !== 'مدير مبيعات') {
      return res.status(403).json({ error: 'غير مصرح باستيراد الليدز' });
    }
    const body = req.body || {};
    const source = String(body.source || 'linkedin').trim().toLowerCase();
    const allowedSources = ['linkedin', 'google', 'email', 'facebook', 'instagram', 'excel'];
    if (!allowedSources.includes(source)) {
      return res.status(400).json({ error: 'مصدر غير مدعوم' });
    }
    const rows = Array.isArray(body.leads) ? body.leads : [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'لا توجد صفوف للاستيراد' });
    }
    if (rows.length > 500) {
      return res.status(400).json({ error: 'الحد الأقصى 500 صف لكل طلب' });
    }
    const routeToManagerId = body.routeToManagerId ? String(body.routeToManagerId).trim() : null;
    const result = await importLeadsCsvBatch({
      prisma,
      rows,
      source,
      actorUserId: req.authUser.id,
      actorName: req.authUser.name || 'استيراد CSV',
      routeToManagerId: routeToManagerId || null,
    });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'خطأ في الخادم', messageAr: String(e?.message || e) });
  }
});

/**
 * POST /api/leads/demo-channel-ingest — Demo-only bulk lead creation (single round-trip).
 *
 * - Auth: owner (مالك) only.
 * - Body: { channel: 'facebook'|'linkedin'|'google'|'email', count?: 1–50, routeToManagerId?, accountRef? }
 * - Response: { demo: true, created, skippedDuplicates, leads[], noticeAr } — NOT a live Meta/Google/Email sync.
 * - Production: replace this handler with real provider webhooks/cron or keep behind a feature flag.
 *
 * استيراد تجريبي من قناة خارجية — مسار HTTP واحد. لا يستدعي واجهات Meta/Google/البريد الحقيقية.
 */
router.post('/demo-channel-ingest', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح بمزامنة القنوات' });
    }
    const body = req.body || {};
    const channel = String(body.channel || '').trim();
    const allowed = ['facebook', 'linkedin', 'google', 'email'];
    if (!allowed.includes(channel)) {
      return res.status(400).json({ error: 'قناة غير مدعومة' });
    }
    const count = Math.max(1, Math.min(50, Number(body.count) || 3));
    const routeToManagerId = body.routeToManagerId ? String(body.routeToManagerId).trim() : null;
    const accountRef = body.accountRef != null ? String(body.accountRef).trim() : '';
    const channelLabel =
      channel === 'facebook'
        ? 'Facebook'
        : channel === 'linkedin'
          ? 'LinkedIn'
          : channel === 'google'
            ? 'Google Ads'
            : 'Email';
    const sourceLabel =
      channel === 'facebook'
        ? 'facebook'
        : channel === 'linkedin'
          ? 'linkedin'
          : channel === 'google'
            ? 'google'
            : 'email';
    const sourceDisplay =
      typeof body.sourceDisplay === 'string' && body.sourceDisplay.trim()
        ? body.sourceDisplay.trim()
        : null;
    const sourceLine = sourceDisplay || sourceLabel;
    const categoryPool =
      channel === 'linkedin'
        ? ['شركات كبرى', 'إنجليزي', 'إعلانات']
        : channel === 'facebook'
          ? ['سوشيال ميديا', 'إعلانات', 'شركات صغيرة']
          : channel === 'google'
            ? ['شركات صغيرة', 'إعلانات', 'سوشيال ميديا']
            : ['إنجليزي', 'شركات كبرى', 'سوشيال ميديا'];
    const sizePool = ['صغير', 'متوسط', 'كبير'];

    let managerName = 'مدير المبيعات';
    if (routeToManagerId) {
      const mu = await prisma.user.findUnique({ where: { id: routeToManagerId } });
      if (mu?.name) managerName = String(mu.name);
    }

    const leadsOut = [];
    let skippedDuplicates = 0;

    for (let idx = 0; idx < count; idx++) {
      const unique = `${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 9)}`;
      const name = `عميل ${channelLabel} ${Math.floor(Math.random() * 900 + 100)}`;
      const company = `${channelLabel} Prospect ${Math.floor(Math.random() * 900 + 100)}`;
      const phone = `01${String(Math.floor(100000000 + Math.random() * 899999999))}`;
      const email =
        channel === 'email'
          ? `inbox.${unique}@mail.leads`.toLowerCase()
          : `lead.${unique}@${channel}.auto`.toLowerCase();

      const dup = await prisma.lead.findFirst({
        where: { OR: [{ email }, { phone }] },
      });
      if (dup) {
        skippedDuplicates += 1;
        continue;
      }

      const category = categoryPool[Math.floor(Math.random() * categoryPool.length)];
      const companySize = sizePool[Math.floor(Math.random() * sizePool.length)];
      const budget = Math.floor(8000 + Math.random() * 120000);
      const score = Math.max(0, Math.min(100, Math.floor(40 + Math.random() * 45)));
      const nowIso = new Date(Date.now() - idx * 15000).toISOString();

      const row = await prisma.lead.create({
        data: {
          customerCode: null,
          name,
          company,
          phone,
          email,
          status: 'جديد',
          budget,
          companySize,
          source: sourceLine,
          category,
          score,
          slaStatus: 'مستقر',
          assignedToId: routeToManagerId || null,
          timelineJson: [],
        },
      });

      const importedEvents = [];
      if (routeToManagerId) {
        importedEvents.push({
          id: `ev-r-${unique}`,
          leadId: row.id,
          action: `تحويل تلقائي إلى ${managerName}`,
          userId: 'sys',
          userName: 'تكامل المصادر',
          createdAt: nowIso,
        });
      }
      importedEvents.push({
        id: `ev-s-${unique}`,
        leadId: row.id,
        action: `استيراد تلقائي — ${sourceLine}`,
        note: accountRef ? `مرجع الحساب: ${accountRef.slice(0, 200)}` : undefined,
        userId: 'sys',
        userName: 'تكامل المصادر',
        createdAt: nowIso,
      });
      const firstActivity = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        leadId: row.id,
        action: 'إضافة الليد إلى النظام',
        userId: req.authUser.id,
        userName: req.authUser.name,
        createdAt: new Date().toISOString(),
      };
      const timelineJson = [...importedEvents, firstActivity];
      const updated = await prisma.lead.update({
        where: { id: row.id },
        data: { timelineJson },
      });
      leadsOut.push(leadToJson(updated));
    }

    return res.status(201).json({
      demo: true,
      noticeAr:
        'تم تسجيل الليدز مع ذكر المصدر في الحقل «المصدر». عند تفعيل Webhooks من المنصات ستصل بيانات حقيقية من الإعلانات تلقائياً.',
      created: leadsOut.length,
      skippedDuplicates,
      leads: leadsOut,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** تحديث ليد (حالة، ملاحظات، تعيين…) */
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'الليد غير موجود' });

    const { role, id: userId, name: actorName } = req.authUser;
    const canEdit =
      role === 'مالك' ||
      role === 'مدير مبيعات' ||
      (role === 'مندوب' && existing.assignedToId === userId);
    if (!canEdit) {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    const patch = req.body || {};
    const data = {};
    if (patch.status != null) data.status = String(patch.status);
    if (patch.assignedTo !== undefined) {
      data.assignedToId = patch.assignedTo || null;
    }
    if (patch.followUpAt !== undefined) {
      data.followUpAt = patch.followUpAt ? new Date(patch.followUpAt) : null;
    }
    if (patch.lossReasonCode !== undefined) {
      data.lossReasonCode = patch.lossReasonCode ? String(patch.lossReasonCode) : null;
    }
    if (patch.budget != null) data.budget = Math.max(0, Number(patch.budget) || 0);
    if (patch.slaStatus != null) data.slaStatus = String(patch.slaStatus);
    if (patch.score != null) {
      data.score = Math.max(0, Math.min(100, Number(patch.score) || 0));
    }

    let timeline = Array.isArray(existing.timelineJson)
      ? [...existing.timelineJson]
      : [];

    if (patch.reviewActivity) {
      if (role !== 'مالك' && role !== 'مدير مبيعات') {
        return res.status(403).json({ error: 'غير مصرح بمراجعة النشاط' });
      }
      const ra = patch.reviewActivity;
      const activityId = String(ra.activityId || '').trim();
      const decision = ra.decision === 'rejected' ? 'rejected' : 'approved';
      if (!activityId) {
        return res.status(400).json({ error: 'معرّف النشاط ناقص' });
      }
      const idx = timeline.findIndex((a) => a && a.id === activityId);
      if (idx < 0) {
        return res.status(404).json({ error: 'النشاط غير موجود' });
      }
      const prev = timeline[idx];
      timeline[idx] = {
        ...prev,
        qaStatus: decision,
        qaReviewedAt: new Date().toISOString(),
        qaReviewedById: userId,
        qaReviewedByName: actorName,
        qaComment: ra.comment != null && String(ra.comment).trim()
          ? String(ra.comment).trim()
          : undefined,
      };
      data.timelineJson = timeline;
    } else if (patch.status != null && patch.status !== existing.status) {
      timeline = [
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          leadId: id,
          action: `تغيير الحالة إلى ${patch.status}`,
          userId,
          userName: actorName,
          createdAt: new Date().toISOString(),
          note: patch.note || undefined,
        },
        ...timeline,
      ];
      data.timelineJson = timeline;
    } else if (patch.appendActivity) {
      const app = patch.appendActivity;
      const entry = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        leadId: id,
        action: String(app.action || 'نشاط'),
        userId,
        userName: actorName,
        createdAt: new Date().toISOString(),
      };
      if (app.note != null && String(app.note).trim()) entry.note = String(app.note).trim();
      if (app.channelType) entry.channelType = app.channelType;
      if (app.evidenceType) entry.evidenceType = app.evidenceType;
      if (app.evidenceRef != null && String(app.evidenceRef).trim()) {
        entry.evidenceRef = String(app.evidenceRef).trim();
      }
      if (typeof app.durationSeconds === 'number' && !Number.isNaN(app.durationSeconds)) {
        entry.durationSeconds = Math.max(0, Math.round(app.durationSeconds));
      }
      if (entry.evidenceRef || app.qaStatus === 'pending') {
        entry.qaStatus = 'pending';
      }
      timeline = [entry, ...timeline];
      data.timelineJson = timeline;
    }

    if (Object.keys(data).length === 0) {
      return res.json({ lead: leadToJson(existing) });
    }

    const row = await prisma.lead.update({
      where: { id },
      data,
    });
    return res.json({ lead: leadToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** حذف ليد — المالك أو مدير المبيعات فقط */
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const role = req.authUser.role;
    if (role !== 'مالك' && role !== 'مدير مبيعات') {
      return res.status(403).json({ error: 'غير مصرح بحذف الليد' });
    }
    const { id } = req.params;
    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'الليد غير موجود' });
    const [invCount, pqCount] = await Promise.all([
      prisma.invoice.count({ where: { leadId: id } }),
      prisma.priceQuote.count({ where: { leadId: id } }),
    ]);
    if (invCount > 0 || pqCount > 0) {
      return res.status(409).json({
        error: 'لا يمكن حذف الليد: توجد فواتير أو عروض أسعار مرتبطة به',
      });
    }
    await prisma.lead.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as leadsRouter };
