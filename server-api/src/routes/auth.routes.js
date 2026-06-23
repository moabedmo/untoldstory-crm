import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signAccessToken, verifyAccessToken } from '../lib/authTokens.js';
import { userToJson } from '../lib/userSerialize.js';
import { normalizeUserRole } from '../lib/normalizeUserRole.js';

const router = Router();

const ALLOWED_ROLES = new Set([
  'مالك',
  'مدير مبيعات',
  'مندوب',
  'محاسب',
  'مدير إنتاج',
]);

function sanitizeRole(role) {
  const r = String(role || '').trim();
  if (ALLOWED_ROLES.has(r)) return r;
  return null;
}

async function canCreateUsers(req) {
  const adminKey = process.env.ADMIN_API_KEY;
  const headerKey = req.headers['x-admin-key'];
  if (adminKey && headerKey && headerKey === adminKey) return true;

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const payload = verifyAccessToken(token);
  if (!payload?.sub) return false;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  return normalizeUserRole(user?.role) === 'مالك';
}

export function attachAuthUser() {
  return async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    const payload = verifyAccessToken(auth.slice(7));
    if (!payload?.sub) {
      req.user = null;
      return next();
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    req.user = user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          role: normalizeUserRole(user.role),
        }
      : null;
    next();
  };
}

/** POST /auth/bootstrap-first — أول مستخدم فقط (بدون مفاتيح)؛ يُغلق تلقائياً بعد إنشاء أي حساب */
router.post('/bootstrap-first', async (req, res) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res
        .status(403)
        .type('html')
        .send(
          `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>غير متاح</title></head><body style="font-family:sans-serif;padding:2rem">يوجد مستخدمون مسبقاً. <a href="http://localhost:5173">تسجيل الدخول</a></body></html>`
        );
    }
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const role = sanitizeRole(req.body?.role);
    if (!email || !password || !name || !role) {
      return res.status(400).send('بيانات ناقصة أو دور غير صحيح');
    }
    if (password.length < 8) {
      return res.status(400).send('كلمة المرور يجب ألا تقل عن 8 أحرف');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        skillsJson: [],
        statsJson: {},
      },
    });
    return res
      .type('html')
      .send(
        `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>تم</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center">
<h1 style="color:#16a34a">تم إنشاء الحساب</h1>
<p>ارجع لتطبيق الواجهة وسجّل الدخول بنفس البريد وكلمة المرور.</p>
<p><a href="http://localhost:5173" style="color:#2563eb">فتح تسجيل الدخول</a></p>
</body></html>`
      );
  } catch (e) {
    console.error(e);
    return res.status(500).send(e instanceof Error ? e.message : 'خطأ');
  }
});

/** POST /auth/login */
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }
    let token;
    try {
      token = signAccessToken({ sub: user.id, email: user.email });
    } catch (err) {
      console.error(err);
      return res.status(503).json({
        error: 'الخادم غير مهيأ: أضف JWT_SECRET قوياً في ملف .env',
      });
    }
    return res.json({
      token,
      user: userToJson(user),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** POST /auth/users — إضافة موظف (مالك أو مفتاح المسؤول) */
router.post('/users', async (req, res) => {
  try {
    if (!(await canCreateUsers(req))) {
      return res.status(403).json({
        error: 'غير مصرح: يجب تمرير X-Admin-Key الصحيح أو تسجيل دخول كمالك',
      });
    }
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const role = sanitizeRole(req.body?.role);
    if (!email || !password || !name || !role) {
      return res.status(400).json({
        error: 'يجب إرسال email, password, name, role بقيمة دور صحيحة',
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'البريد مستخدم مسبقاً' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const skills = Array.isArray(req.body?.skills) ? req.body.skills : [];
    const baseSalaryRaw = req.body?.baseSalary;
    const roleSanitized = role;
    const baseSalary =
      roleSanitized === 'مندوب'
        ? Math.max(0, Math.round(Number(baseSalaryRaw) || 0))
        : null;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        avatar: req.body?.avatar ? String(req.body.avatar).trim() || null : null,
        baseSalary,
        skillsJson: skills,
        statsJson: {},
      },
    });
    return res.status(201).json({
      user: userToJson(user),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

/** GET /auth/me */
router.get('/me', attachAuthUser(), async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
  return res.json({
    user: userToJson(user),
  });
});

/** PATCH /auth/me/password — المالك فقط؛ يتطلب كلمة المرور الحالية */
router.patch('/me/password', attachAuthUser(), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'غير مصرح' });
    }
    if (normalizeUserRole(req.user.role) !== 'مالك') {
      return res.status(403).json({ error: 'يُقتصر تغيير كلمة المرور من هنا على حساب المالك' });
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'كلمة المرور الحالية والجديدة مطلوبتان',
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

export { router as authRouter };
