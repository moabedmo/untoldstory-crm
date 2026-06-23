import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { userToJson, userToDirectoryJson } from '../lib/userSerialize.js';
import { normalizeUserRole } from '../lib/normalizeUserRole.js';

const router = Router();

function makePlaceholderEmail(name) {
  const base = String(name || 'staff')
    .replace(/[^\w\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'staff';
  return `${base}-${crypto.randomBytes(5).toString('hex')}@staff.internal`.toLowerCase();
}

/** قائمة المستخدمين — بيانات كاملة للمالك/مدير المبيعات/المحاسب/مدير الإنتاج؛ دفتر مختصر للمندوب */
router.get('/', requireAuth(), async (req, res) => {
  try {
    const role = req.authUser.role;
    const fullDirectory = role === 'مالك' || role === 'مدير مبيعات' || role === 'محاسب' || role === 'مدير إنتاج';
    const rows = await prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
    const users = rows.map((r) => (fullDirectory ? userToJson(r) : userToDirectoryJson(r)));
    return res.json({ users });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/**
 * POST /api/users — إضافة موظف (المالك أو المحاسب). بدون بريد/كلمة مرور يُولَّدان تلقائياً.
 * المحاسب لا يمكنه إنشاء حساب بدور «مالك».
 */
router.post('/', requireAuth(), async (req, res) => {
  try {
    const actorRole = req.authUser.role;
    if (actorRole !== 'مالك' && actorRole !== 'محاسب') {
      return res.status(403).json({ error: 'غير مصرح: إضافة الموظفين للمالك أو المحاسب فقط' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const role = String(body.role || '').trim();
    const allowed = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
    if (!name || !allowed.includes(role)) {
      return res.status(400).json({ error: 'الاسم والدور مطلوبان' });
    }
    if (actorRole === 'محاسب' && role === 'مالك') {
      return res.status(403).json({ error: 'المحاسب لا يمكنه إنشاء حساب مالك' });
    }
    let email = String(body.email || '')
      .trim()
      .toLowerCase();
    let password = String(body.password || '');
    let tempPassword;
    if (!email) {
      email = makePlaceholderEmail(name);
      while (await prisma.user.findUnique({ where: { email } })) {
        email = makePlaceholderEmail(name);
      }
    }
    if (!password || password.length < 8) {
      tempPassword = crypto.randomBytes(12).toString('base64url').slice(0, 14);
      password = tempPassword;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'البريد مستخدم مسبقاً' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const skills = Array.isArray(body.skills) ? body.skills : [];
    const payrollRolesForSalary = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];
    const baseSalary =
      actorRole === 'مالك'
        ? Math.max(0, Math.round(Number(body.baseSalary) || 0))
        : payrollRolesForSalary.includes(role)
          ? Math.max(0, Math.round(Number(body.baseSalary) || 0))
          : null;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        avatar: body.avatar ? String(body.avatar).trim() || null : null,
        baseSalary,
        skillsJson: skills,
        statsJson: {},
      },
    });
    return res.status(201).json({
      user: userToJson(user),
      ...(tempPassword ? { tempPassword } : {}),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** PATCH /api/users/:id */
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.authUser;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const canOwner = actor.role === 'مالك';
    const isSelf = actor.id === existing.id;
    const existingRoleN = normalizeUserRole(existing.role);
    const canSalesSkills =
      actor.role === 'مدير مبيعات' && existingRoleN === 'مندوب';
    const payrollRolesForSalary = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];
    const canAccountingSalary =
      (actor.role === 'محاسب' || actor.role === 'مالك') && payrollRolesForSalary.includes(existingRoleN);

    const patch = req.body || {};
    const data = {};

    if (patch.name != null && String(patch.name).trim()) {
      if (!canOwner && !isSelf) return res.status(403).json({ error: 'غير مصرح' });
      data.name = String(patch.name).trim();
    }
    if (patch.email !== undefined && patch.email !== null) {
      if (!canOwner) return res.status(403).json({ error: 'غير مصرح بتعديل البريد' });
      if (existingRoleN === 'مالك' && existing.id !== actor.id) {
        return res.status(403).json({ error: 'لا يمكن تغيير بريد حساب مالك آخر من هنا' });
      }
      const email = String(patch.email || '')
        .trim()
        .toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'صيغة البريد غير صالحة' });
      }
      const taken = await prisma.user.findFirst({
        where: { email, NOT: { id } },
      });
      if (taken) return res.status(409).json({ error: 'البريد مستخدم لمستخدم آخر' });
      data.email = email;
    }
    if (patch.role != null) {
      if (!canOwner) return res.status(403).json({ error: 'غير مصرح' });
      const r = String(patch.role).trim();
      const allowed = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
      if (!allowed.includes(r)) return res.status(400).json({ error: 'دور غير صالح' });
      data.role = r;
    }
    if (patch.avatar !== undefined) {
      if (!canOwner && !isSelf) return res.status(403).json({ error: 'غير مصرح' });
      data.avatar = patch.avatar ? String(patch.avatar).trim() : null;
    }
    if (patch.skills != null) {
      if (!(canOwner || canSalesSkills)) return res.status(403).json({ error: 'غير مصرح' });
      data.skillsJson = Array.isArray(patch.skills) ? patch.skills : [];
    }
    if (patch.baseSalary != null) {
      if (existingRoleN === 'مالك' && existing.id !== actor.id) {
        return res.status(403).json({ error: 'لا يمكن تعديل راتب مالك آخر' });
      }
      if (canOwner) {
        data.baseSalary = Math.max(0, Math.round(Number(patch.baseSalary) || 0));
      } else {
        if (!canAccountingSalary) return res.status(403).json({ error: 'غير مصرح' });
        if (!payrollRolesForSalary.includes(existingRoleN) && !(existingRoleN === 'مالك' && existing.id === actor.id)) {
          return res.status(400).json({ error: 'لا يُخزَّن راتب أساسي لهذا الدور' });
        }
        data.baseSalary = Math.max(0, Math.round(Number(patch.baseSalary) || 0));
      }
    }
    if (patch.stats != null && typeof patch.stats === 'object') {
      if (!canOwner) return res.status(403).json({ error: 'غير مصرح' });
      data.statsJson = patch.stats;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'newPassword')) {
      if (!canOwner) return res.status(403).json({ error: 'غير مصرح' });
      if (id === actor.id) {
        return res.status(400).json({
          error: 'استخدم مسار «كلمة مرور حساب المالك» في الإعدادات لتغيير باسوردك الحالي',
        });
      }
      if (existingRoleN === 'مالك') {
        return res.status(400).json({ error: 'لا يمكن تغيير كلمة مرور حساب مالك آخر من هنا' });
      }
      const np = String(patch.newPassword ?? '').trim();
      if (np.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف' });
      }
      data.passwordHash = await bcrypt.hash(np, 10);
    }

    if (Object.keys(data).length === 0) {
      return res.json({ user: userToJson(existing) });
    }

    const row = await prisma.user.update({ where: { id }, data });
    return res.json({ user: userToJson(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** DELETE /api/users/:id — مالك فقط؛ لا يحذف المالك أو النفس */
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    if (req.authUser.role !== 'مالك') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { id } = req.params;
    if (id === req.authUser.id) {
      return res.status(400).json({ error: 'لا يمكن حذف حسابك الحالي' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (normalizeUserRole(target.role) === 'مالك') {
      return res.status(400).json({ error: 'لا يمكن حذف حساب مالك' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.monthlyTarget.deleteMany({ where: { repId: id } });
      await tx.attendanceRecord.deleteMany({ where: { repId: id } });
      await tx.lead.updateMany({
        where: { assignedToId: id },
        data: { assignedToId: null },
      });
      await tx.user.delete({ where: { id } });
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as usersRouter };
