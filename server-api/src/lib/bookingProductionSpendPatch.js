/** صلاحية مدير الإنتاج: حفظ بنود المصروف وإرسال الحجز للمحاسب للدفع. */

export const PRODUCTION_BOOKING_PATCH_KEYS = ['spendLines', 'executionSubmittedAt', 'financialStatus'];

/**
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown>} cur
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateProductionManagerSpendPatch(patch, cur) {
  const keys = Object.keys(patch || {});
  if (keys.length === 0) return { ok: false, reason: 'فارغ' };
  if (!keys.every((k) => PRODUCTION_BOOKING_PATCH_KEYS.includes(k))) {
    return { ok: false, reason: 'حقول غير مسموحة لمدير الإنتاج' };
  }
  const curFs = typeof cur.financialStatus === 'string' ? cur.financialStatus.trim() : '';
  if (curFs !== 'بانتظار_تنفيذ_إنتاج') {
    return { ok: false, reason: 'الحالة الحالية لا تسمح بتعديل تنفيذ الإنتاج على هذا الحجز' };
  }
  const nextFs =
    patch.financialStatus !== undefined ? String(patch.financialStatus).trim() : undefined;
  if (nextFs != null && nextFs !== 'بانتظار_تنفيذ_محاسب') {
    return { ok: false, reason: 'انتقال مالي غير مسموح من مدير الإنتاج' };
  }
  if (nextFs === 'بانتظار_تنفيذ_محاسب') {
    const lines = patch.spendLines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return { ok: false, reason: 'أضف بنوداً مع أرقام فواتير قبل الإرسال للمحاسب' };
    }
    let sum = 0;
    for (const ln of lines) {
      sum += Math.max(0, Math.round(Number(ln?.amount) || 0));
    }
    if (sum <= 0) return { ok: false, reason: 'مجموع المبالغ غير صالح' };
  }
  return { ok: true };
}
