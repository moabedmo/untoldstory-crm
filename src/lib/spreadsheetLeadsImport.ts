import * as XLSX from 'xlsx';
import { parseCsvText } from '@/lib/csv/parseCsvText';
import type { ImportCsvLeadInput } from '@/lib/api/leadsApi';
import type { LeadCategory } from '@/app/context/DataContext';

export type SpreadsheetLeadRow = ImportCsvLeadInput & {
  source: 'excel';
  status: 'جديد';
  companySize: 'صغير' | 'متوسط' | 'كبير';
  category: LeadCategory;
  fileRowIndex: number;
};

export type SpreadsheetLeadsParseResult = {
  rows: SpreadsheetLeadRow[];
  skipped: number;
  errors: string[];
};

const LEAD_CATEGORIES: LeadCategory[] = [
  'إنجليزي',
  'شركات كبرى',
  'شركات صغيرة',
  'إعلانات',
  'سوشيال ميديا',
];

function normalizeAsciiHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** يحوّل عنوان العمود (عربي/إنجليزي) إلى مفتاح موحّد */
export function mapSpreadsheetHeaderKey(raw: string): string {
  const t = String(raw || '').trim();
  const lower = t.toLowerCase();
  const ascii = normalizeAsciiHeader(t);

  if (/^(الاسم|اسم|اسم_العميل|اسم العميل|العميل)$/.test(t) || /^(name|full_name|fullname|lead_name|contact_name)$/.test(ascii)) {
    return 'name';
  }
  if (/^(الشركة|شركة|اسم الشركة|المنشأة)$/.test(t) || /^(company|company_name|organization|business_name|account_name)$/.test(ascii)) {
    return 'company';
  }
  if (/^(الموبايل|الجوال|الهاتف|موبايل|جوال|تليفون|تلفون|رقم)$/.test(t) || /^(phone|mobile|phone_number|mobile_phone|work_phone|phonenumber)$/.test(ascii)) {
    return 'phone';
  }
  if (/^(البريد|الإيميل|ايميل|إيميل|بريد)$/.test(t) || /^(email|email_address|work_email|business_email|emailaddress)$/.test(ascii)) {
    return 'email';
  }
  if (/^(الميزانية|ميزانية|المبلغ|مبلغ)$/.test(t) || /^(budget|amount|deal_value|value)$/.test(ascii)) {
    return 'budget';
  }
  if (/^(التصنيف|تصنيف|الفئة|فئة|القطاع)$/.test(t) || /^(category|segment|lead_category)$/.test(ascii)) {
    return 'category';
  }
  if (/^(حجم|حجم الشركة|حجم_الشركة)$/.test(t) || /^(company_size|companysize|size)$/.test(ascii)) {
    return 'company_size';
  }
  if (/^(الاسم الأول|الاسم_الأول)$/.test(t) || /^(first_name|firstname|first|given_name)$/.test(ascii)) {
    return 'first_name';
  }
  if (/^(اسم العائلة|اللقب|الاسم الأخير)$/.test(t) || /^(last_name|lastname|last|family_name|surname)$/.test(ascii)) {
    return 'last_name';
  }
  if (/^(المسمى|الوظيفة|المسمى الوظيفي)$/.test(t) || /^(job_title|title|position)$/.test(ascii)) {
    return 'job_title';
  }
  if (/^(الاهتمام|اهتمام|الموديل|موديل|السيارة|سيارة|المنتج)$/.test(t) || /^(interest|product|model|car|vehicle)$/.test(ascii)) {
    return 'interest';
  }

  return ascii || `col_${t.slice(0, 12)}`;
}

/** يحافظ على صفر بداية أرقام الجوال بعد قراءة Excel كرقم */
export function normalizeSpreadsheetPhone(raw: string | number): string {
  let s = String(raw ?? '')
    .trim()
    .replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+20')) s = '0' + s.slice(3);
  else if (s.startsWith('20') && s.length === 12) s = '0' + s.slice(2);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('1')) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('01')) return digits;
  if (digits.length >= 9 && digits.length <= 15) return digits;
  return digits;
}

function cellLooksLikePhone(val: string): boolean {
  const digits = val.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const cells = row.map((c) => String(c ?? '').trim().toLowerCase());
  const headerHints = [
    'name',
    'phone',
    'mobile',
    'email',
    'company',
    'interest',
    'الاسم',
    'الجوال',
    'الموبايل',
    'البريد',
    'الشركة',
    'رقم',
    'الاهتمام',
    'الموديل',
  ];
  let hits = 0;
  for (const c of cells) {
    if (c && headerHints.some((h) => c.includes(h))) hits += 1;
  }
  if (hits >= 2) return true;
  if (hits === 1 && cells.filter(Boolean).length >= 3) return true;

  const name = String(row[0] ?? '').trim();
  const phone = findPhoneInRow(row);
  if (name && phone && !headerHints.some((h) => name.toLowerCase() === h)) return false;
  return hits > 0;
}

function findPhoneInRow(line: string[]): string {
  for (let i = line.length - 1; i >= 0; i--) {
    const raw = String(line[i] ?? '').trim();
    if (!raw) continue;
    if (cellLooksLikePhone(raw)) return normalizeSpreadsheetPhone(raw);
  }
  return '';
}

function findInterestInRow(line: string[]): string {
  for (let i = 1; i < line.length; i++) {
    const v = String(line[i] ?? '').trim();
    if (!v || cellLooksLikePhone(v)) continue;
    return v;
  }
  return '';
}

/** تنسيق بدون عناوين: A=الاسم، C=الاهتمام/الموديل، D=الجوال (B فارغ) */
function positionalMatrixToObjects(matrix: string[][]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let r = 0; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line.some((c) => String(c ?? '').trim() !== '')) continue;

    const name = String(line[0] ?? '').trim();
    const phone = findPhoneInRow(line) || normalizeSpreadsheetPhone(line[3] ?? line[2] ?? '');
    const interest =
      String(line[2] ?? '').trim() && !cellLooksLikePhone(String(line[2] ?? ''))
        ? String(line[2] ?? '').trim()
        : findInterestInRow(line);

    if (!name && !phone) continue;

    out.push({
      name,
      phone,
      ...(interest ? { interest } : {}),
      _fileRow: String(r + 1),
    });
  }
  return out;
}

function sheetMatrixToObjects(matrix: string[][]): Record<string, string>[] {
  if (matrix.length < 1) return [];
  const headerRow = matrix[0];
  const keys = headerRow.map((h) => mapSpreadsheetHeaderKey(h));
  const out: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line.some((c) => String(c ?? '').trim() !== '')) continue;
    const obj: Record<string, string> = { _fileRow: String(r + 1) };
    for (let c = 0; c < keys.length; c++) {
      const key = keys[c];
      if (!key) continue;
      const val = String(line[c] ?? '').trim();
      if (val) obj[key] = obj[key] ? `${obj[key]} ${val}` : val;
    }
    if (obj.phone) obj.phone = normalizeSpreadsheetPhone(obj.phone);
    out.push(obj);
  }
  return out;
}

function matrixToRowObjects(matrix: string[][]): Record<string, string>[] {
  if (matrix.length === 0) return [];
  if (looksLikeHeaderRow(matrix[0])) return sheetMatrixToObjects(matrix);
  return positionalMatrixToObjects(matrix);
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function parseBudget(raw: string): number {
  const n = Number(String(raw || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function parseCategory(raw: string): LeadCategory {
  const t = String(raw || '').trim();
  if (!t) return 'إعلانات';
  const hit = LEAD_CATEGORIES.find((c) => c === t || t.includes(c));
  if (hit) return hit;
  if (/إنجليز|english|en\b/i.test(t)) return 'إنجليزي';
  if (/كبر|enterprise|large/i.test(t)) return 'شركات كبرى';
  if (/صغير|small|smb/i.test(t)) return 'شركات صغيرة';
  if (/سوشيال|social|media/i.test(t)) return 'سوشيال ميديا';
  if (/إعلان|ads|ad\b/i.test(t)) return 'إعلانات';
  return 'إعلانات';
}

function parseCompanySize(raw: string): 'صغير' | 'متوسط' | 'كبير' {
  const t = String(raw || '').trim().toLowerCase();
  if (/كبير|large|enterprise/.test(t)) return 'كبير';
  if (/متوسط|medium|mid/.test(t)) return 'متوسط';
  if (/صغير|small|smb/.test(t)) return 'صغير';
  return 'متوسط';
}

function matrixFromWorkbook(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  return raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => formatWorkbookCell(cell)),
  );
}

function formatWorkbookCell(cell: unknown): string {
  if (cell == null || cell === '') return '';
  if (typeof cell === 'number') {
    if (cell >= 1e8 && cell < 2e11) return normalizeSpreadsheetPhone(cell);
    return String(cell).trim();
  }
  return String(cell).trim();
}

export function parseSpreadsheetObjects(objects: Record<string, string>[]): SpreadsheetLeadsParseResult {
  const rows: SpreadsheetLeadRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  objects.forEach((raw, idx) => {
    const rowNum = Number(raw._fileRow) || idx + 2;
    const first = pick(raw, ['first_name']);
    const last = pick(raw, ['last_name']);
    let name = pick(raw, ['name']);
    if (!name) name = [first, last].filter(Boolean).join(' ').trim();

    let email = pick(raw, ['email']).toLowerCase();
    let phone = normalizeSpreadsheetPhone(pick(raw, ['phone']));
    const interest = pick(raw, ['interest', 'product', 'model']);
    let company = pick(raw, ['company']);
    const jobTitle = pick(raw, ['job_title']);
    if (!company && interest) company = interest;
    if (!company && jobTitle) company = jobTitle;

    if (!name) name = company || `عميل صف ${rowNum}`;
    if (!company) company = '—';

    let category = parseCategory(pick(raw, ['category']));
    if (category === 'إعلانات' && /^[a-zA-Z\s.'-]+$/i.test(name) && !/[\u0600-\u06FF]/.test(name)) {
      category = 'إنجليزي';
    }

    if (!email && !phone) {
      skipped += 1;
      errors.push(`صف ${rowNum}: لا يوجد بريد أو جوال — تم تخطيه`);
      return;
    }

    if (!email) email = `excel-row-${rowNum}@lead.local`;
    if (!phone) phone = '01000000000';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      email = `excel-row-${rowNum}@lead.local`;
    }

    rows.push({
      name: name.slice(0, 200),
      company: company.slice(0, 200),
      phone,
      email,
      source: 'excel',
      status: 'جديد',
      budget: parseBudget(pick(raw, ['budget'])),
      companySize: parseCompanySize(pick(raw, ['company_size'])),
      category,
      fileRowIndex: rowNum,
    });
  });

  return { rows, skipped, errors };
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetLeadsParseResult> {
  const name = file.name.toLowerCase();
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { rows: [], skipped: 0, errors: ['الحد الأقصى لحجم الملف 10MB'] };
  }

  if (name.endsWith('.csv')) {
    const text = await file.text();
    const matrix = parseCsvText(text);
    return parseSpreadsheetObjects(matrixToRowObjects(matrix));
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const matrix = matrixFromWorkbook(buffer);
    return parseSpreadsheetObjects(matrixToRowObjects(matrix));
  }

  return {
    rows: [],
    skipped: 0,
    errors: ['صيغة غير مدعومة — استخدم .xlsx أو .xls أو .csv'],
  };
}

export function spreadsheetRowsToBulkLeads(
  rows: SpreadsheetLeadRow[],
): Omit<
  import('@/app/context/DataContext').Lead,
  'id' | 'createdAt' | 'updatedAt' | 'score' | 'slaStatus' | 'timeline'
>[] {
  return rows.map((r) => ({
    name: r.name,
    company: r.company,
    phone: r.phone,
    email: r.email,
    status: 'جديد' as const,
    budget: r.budget ?? 0,
    companySize: r.companySize,
    source: 'رفع ملف',
    category: r.category,
  }));
}
