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

  return ascii || `col_${t.slice(0, 12)}`;
}

function sheetMatrixToObjects(matrix: string[][]): Record<string, string>[] {
  if (matrix.length < 1) return [];
  const headerRow = matrix[0];
  const keys = headerRow.map((h) => mapSpreadsheetHeaderKey(h));
  const out: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line.some((c) => String(c ?? '').trim() !== '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < keys.length; c++) {
      const key = keys[c];
      if (!key) continue;
      const val = String(line[c] ?? '').trim();
      if (val) obj[key] = obj[key] ? `${obj[key]} ${val}` : val;
    }
    out.push(obj);
  }
  return out;
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
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim()),
  );
}

export function parseSpreadsheetObjects(objects: Record<string, string>[]): SpreadsheetLeadsParseResult {
  const rows: SpreadsheetLeadRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  objects.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const first = pick(raw, ['first_name']);
    const last = pick(raw, ['last_name']);
    let name = pick(raw, ['name']);
    if (!name) name = [first, last].filter(Boolean).join(' ').trim();

    let email = pick(raw, ['email']).toLowerCase();
    let phone = pick(raw, ['phone']).replace(/\s+/g, ' ').trim();
    let company = pick(raw, ['company']);
    const jobTitle = pick(raw, ['job_title']);
    if (!company && jobTitle) company = jobTitle;

    if (!name) name = company || `عميل صف ${rowNum}`;
    if (!company) company = '—';

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
      category: parseCategory(pick(raw, ['category'])),
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
    return parseSpreadsheetObjects(sheetMatrixToObjects(matrix));
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const matrix = matrixFromWorkbook(buffer);
    const objects = sheetMatrixToObjects(matrix);
    return parseSpreadsheetObjects(objects);
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
