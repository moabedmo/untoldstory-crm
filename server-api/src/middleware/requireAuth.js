import { prisma } from '../prisma.js';
import { verifyAccessToken } from '../lib/authTokens.js';
import { normalizeUserRole } from '../lib/normalizeUserRole.js';

/** يضيف req.authUser { id, email, name, role } أو 401 */
export function requireAuth() {
  return async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });
    }
    const payload = verifyAccessToken(auth.slice(7));
    if (!payload?.sub) {
      return res.status(401).json({ error: 'جلسة غير صالحة' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: 'المستخدم غير موجود' });
    }
    req.authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: normalizeUserRole(user.role),
    };
    next();
  };
}
