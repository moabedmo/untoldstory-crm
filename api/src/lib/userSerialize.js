/** تحويل مستخدم Prisma إلى شكل الواجهة */

import { normalizeUserRole } from './normalizeUserRole.js';

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop';

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val || (Array.isArray(fallback) ? '[]' : '{}'));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function userToJson(row) {
  const skills = parseJson(row.skillsJson, []);
  const stats = parseJson(row.statsJson, {});
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeUserRole(row.role),
    authSource: 'database',
    avatar: row.avatar || DEFAULT_AVATAR,
    skills: Array.isArray(skills) ? skills : [],
    baseSalary: (() => {
      const v = row.baseSalary;
      if (v == null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    })(),
    stats: {
      dealsWon: Number(stats.dealsWon) || 0,
      points: Number(stats.points) || 0,
      avgResponseTime:
        typeof stats.avgResponseTime === 'string' ? stats.avgResponseTime : '0 min',
      revenue: typeof stats.revenue === 'number' ? stats.revenue : undefined,
    },
  };
}

/** دفتر موظفين بدون بريد/راتب — للمندوبين وغيرهم غير المصرّح لهم ببيانات حساسة */
export function userToDirectoryJson(row) {
  const j = userToJson(row);
  delete j.email;
  delete j.baseSalary;
  return j;
}
