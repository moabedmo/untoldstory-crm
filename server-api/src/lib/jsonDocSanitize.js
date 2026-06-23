/**
 * يجهّز كائناً لتخزينه في عمود Json/JSONB بدون حقول undefined
 * (بعض إصدارات Prisma ترفض undefined داخل حقول Json).
 */
export function sanitizeDocJson(doc) {
  return JSON.parse(JSON.stringify(doc ?? {}));
}
