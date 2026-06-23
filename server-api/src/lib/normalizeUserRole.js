/**
 * توحيد نص الدور بين العربية وأشكال إنجليزية شائعة.
 * يتماشى مع الواجهة: إذا كان حقل الدور في قاعدة البيانات **فارغاً** تصبح الواجهة تعرض «مندوب» افتراضياً؛
 * فيجب أن يفهم الخادم ذلك أيضاً. أما نص دور غريب غير فارغ فيُمرَّر كما هو (فصلاحيات لا تُخمَّن افتراضياً).
 */
export function normalizeUserRole(raw) {
  const s = String(raw ?? '').trim();
  const lower = s.toLowerCase();
  /** @type {Map<string, string>} */
  const map = new Map([
    ['مالك', 'مالك'],
    ['المالك', 'مالك'],
    ['owner', 'مالك'],
    ['مدير مبيعات', 'مدير مبيعات'],
    ['sales manager', 'مدير مبيعات'],
    ['sales-manager', 'مدير مبيعات'],
    ['salesmanager', 'مدير مبيعات'],
    ['مندوب', 'مندوب'],
    ['sales rep', 'مندوب'],
    ['sales-rep', 'مندوب'],
    ['salesrep', 'مندوب'],
    ['rep', 'مندوب'],
    ['محاسب', 'محاسب'],
    ['accountant', 'محاسب'],
    ['مدير إنتاج', 'مدير إنتاج'],
    ['production manager', 'مدير إنتاج'],
    ['production-manager', 'مدير إنتاج'],
    ['productionmanager', 'مدير إنتاج'],
  ]);
  const mapped = map.get(s) ?? map.get(lower);
  if (mapped !== undefined) return mapped;
  return s === '' ? 'مندوب' : s;
}
