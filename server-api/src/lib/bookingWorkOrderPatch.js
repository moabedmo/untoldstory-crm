/** صلاحية مدير الإنتاج على أمر شغل من عرض سعر معتمد */

export const WORK_ORDER_PATCH_KEYS = ['status', 'notes', 'workOrderChecklist'];

/**
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown>} cur
 * @param {string} actorId
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateProductionWorkOrderPatch(patch, cur, actorId) {
  if (cur.workOrderFromQuote !== true) {
    return { ok: false, reason: 'ليس أمر شغل من عرض سعر' };
  }
  const assigned = String(cur.productionAssignedId || '').trim();
  if (!assigned || assigned !== String(actorId || '').trim()) {
    return { ok: false, reason: 'أمر الشغل غير مخصص لك' };
  }
  const keys = Object.keys(patch || {});
  if (keys.length === 0) return { ok: false, reason: 'فارغ' };
  if (!keys.every((k) => WORK_ORDER_PATCH_KEYS.includes(k))) {
    return { ok: false, reason: 'حقول غير مسموحة' };
  }
  if (patch.status != null) {
    const next = String(patch.status).trim();
    if (next !== 'مكتمل') return { ok: false, reason: 'يمكن إغلاق أمر الشغل فقط بحالة «مكتمل»' };
    const curStatus = String(cur.status || '').trim();
    if (curStatus === 'مكتمل') return { ok: false, reason: 'أمر الشغل مكتمل مسبقاً' };
  }
  if (patch.workOrderChecklist != null) {
    if (!Array.isArray(patch.workOrderChecklist)) {
      return { ok: false, reason: 'قائمة المهام غير صالحة' };
    }
    for (const item of patch.workOrderChecklist) {
      if (!item || typeof item !== 'object') return { ok: false, reason: 'بند مهمة غير صالح' };
      if (!String(item.label || '').trim()) return { ok: false, reason: 'وصف المهمة مطلوب' };
    }
  }
  return { ok: true };
}
