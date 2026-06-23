/**
 * رسائل وأكواد حالة موحدة لمسارات الحجوزات عند فشل create/update بسبب Prisma أو قاعدة البيانات.
 */
export function bookingRouteCatchBody(e, { dev = process.env.NODE_ENV !== 'production' } = {}) {
  const msg = String(e?.message ?? e ?? '');

  if (
    /Cannot read properties of undefined \(reading 'create'\)/.test(msg) ||
    (/Cannot read properties of undefined/i.test(msg) && /\bcreate\b/.test(msg))
  ) {
    return {
      status: 503,
      body: {
        error:
          'نسخة عميل Prisma (@prisma/client) غير متزامنة مع المخطط — نموذج الحجوزات غير مُعرّف في العميل المثبت. أوقف خادم الـAPI، ثم من مجلد api نفّذ: npx prisma generate ثم أعد التشغيل. على ويندوز إذا ظهر EPERM أثناء التوليد، أغلق أي عملية node تعيق الملفات.',
        code: 'PRISMA_CLIENT_STALE',
      },
    };
  }

  if (e?.code === 'P2002') {
    return { status: 409, body: { error: 'المعرّف مستخدم' } };
  }

  if (e?.code === 'P2021' || /does not exist|relation/i.test(msg)) {
    return {
      status: 503,
      body: {
        error:
          'جدول الحجوزات غير جاهز في قاعدة البيانات. على الخادم نفّذ: npm run db:migrate (أو db:push)',
        code: 'DB_TABLE_MISSING',
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'خطأ في الخادم',
      ...(dev && { detail: msg, prismaCode: e?.code }),
    },
  };
}
