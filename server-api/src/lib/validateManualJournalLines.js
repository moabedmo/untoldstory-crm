/**
 * تحقق double-entry للقيود اليدوية (متّسق مع منطق الواجهة في App.tsx).
 * @param {unknown} lines
 * @returns {{ ok: true, lines: object[] } | { ok: false, error: string }}
 */
export function validateManualJournalLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, error: 'يُشترط سطران على الأقل في القيد' };
  }
  let debitSum = 0;
  let creditSum = 0;
  const normalized = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== 'object') {
      return { ok: false, error: `بند ${i + 1}: شكل غير صالح` };
    }
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit < 0 || credit < 0) {
      return { ok: false, error: `بند ${i + 1}: لا تُسمح بالمبالغ السالبة` };
    }
    if (debit > 0 && credit > 0) {
      return { ok: false, error: `بند ${i + 1}: إما مدين أو دائن في نفس السطر` };
    }
    if (debit === 0 && credit === 0) {
      return { ok: false, error: `بند ${i + 1}: مبلغ فارغ` };
    }
    debitSum += debit;
    creditSum += credit;
    normalized.push(line);
  }
  if (debitSum <= 0 || creditSum <= 0) {
    return { ok: false, error: 'إجمالي المدين والدائن يجب أن يكون موجباً' };
  }
  if (Math.abs(debitSum - creditSum) > 0.01) {
    return { ok: false, error: 'القيد غير متزن (المدين يجب أن يساوي الدائن)' };
  }
  return { ok: true, lines: normalized };
}
