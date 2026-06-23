import { Buffer } from 'node:buffer';

const PRODUCTION_SPEND_MARKER = '\n__PSL_v1__:';

function stripProductionSpendMarkerFromRawNote(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  const idx = s.lastIndexOf(PRODUCTION_SPEND_MARKER);
  if (idx < 0) return s;
  return s.slice(0, idx).trimEnd();
}

function utf8ToB64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

function b64ToUtf8(b64) {
  return Buffer.from(String(b64).trim(), 'base64').toString('utf8');
}

function parseProductionSpendLinesFromRawNote(raw) {
  if (raw == null || raw === '') return [];
  const s = String(raw);
  const idx = s.lastIndexOf(PRODUCTION_SPEND_MARKER);
  if (idx < 0) return [];
  const b64 = s.slice(idx + PRODUCTION_SPEND_MARKER.length).trim();
  if (!b64) return [];
  try {
    const json = b64ToUtf8(b64);
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({
      id: String(x?.id || `CL-${Math.random().toString(36).slice(2, 8)}`),
      title: String(x?.title || ''),
      amount: Math.max(0, Number(x?.amount) || 0),
      category: x?.category || 'تشغيل',
      costCenter: String(x?.costCenter || 'عام'),
      note: typeof x?.note === 'string' ? x.note : undefined,
      attachments: Array.isArray(x?.attachments)
        ? x.attachments.map((a) => ({
            id: String(a?.id || `ATT-${Math.random().toString(36).slice(2, 9)}`),
            fileName: String(a?.fileName || 'مرفق'),
            mimeType: typeof a?.mimeType === 'string' ? a.mimeType : undefined,
            dataBase64: typeof a?.dataBase64 === 'string' ? a.dataBase64 : undefined,
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

export function mergeProductionSpendLinesIntoRawNote(rawNote, lines) {
  const base = stripProductionSpendMarkerFromRawNote(rawNote);
  const payload = utf8ToB64(JSON.stringify(Array.isArray(lines) ? lines : []));
  return `${String(base).trimEnd()}${PRODUCTION_SPEND_MARKER}${payload}`;
}

function stripPayFromNote(s) {
  return String(s).replace(/\n?__pay:(كاش|بنك)__\s*/g, '').trim();
}

/** ملاحظة للعرض (بدون لاحقة بنود الإنتاج ووسوم الدفع/المقدّم) — يتماشى مع mapExpenseFromRow في الواجهة */
function expenseNoteForClient(rawNoteFull) {
  const rawNote = stripProductionSpendMarkerFromRawNote(rawNoteFull);
  if (!rawNote.length) return undefined;
  let cleaned = stripPayFromNote(rawNote);
  if (!cleaned) return undefined;
  if (cleaned.includes('__sb_id:')) {
    const withoutId = cleaned.replace(/\n?__sb_id:[^_\n]+__\s*/g, '');
    const withoutMarker = withoutId.replace(/(?:^|\n)مقدّم الطلب:\s*[^\n]+$/m, '').trim();
    return withoutMarker.length > 0 ? withoutMarker : undefined;
  }
  return cleaned || undefined;
}

export function expenseToJson(row) {
  const rawNote = row.note ?? '';
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    amount: row.amount,
    vatRate: row.vatRate ?? undefined,
    vatAmount: row.vatAmount ?? undefined,
    totalAmount: row.totalAmount ?? undefined,
    costCenter: row.costCenter ?? undefined,
    status: row.status,
    approvalStatus: row.approvalStatus,
    approvedBy: row.approvedBy ?? undefined,
    vendor: row.vendor ?? undefined,
    note: expenseNoteForClient(rawNote),
    submittedById: row.submittedById ?? undefined,
    submittedByName: row.submittedByName ?? undefined,
    paymentMethod: row.paymentMethod ?? undefined,
    date: row.date.toISOString(),
    productionSpendLines: parseProductionSpendLinesFromRawNote(rawNote),
  };
}
