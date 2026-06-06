export interface CachedChartAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isSystem?: boolean;
}

export interface CachedJournalRule {
  id: string;
  title: string;
  accountCode: string;
  costCenter: string;
}

const CHART_CACHE_KEY = 'prod_system_chart_of_accounts';
const JOURNAL_CACHE_KEY = 'prod_system_journal_codebook';

function parseSafe<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** {} أو object قديم → مصفوفة قبل normalize */
export function coerceAccountingWorkspaceArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  return [];
}

export function readCachedChartOfAccounts(): CachedChartAccount[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = parseSafe<unknown>(localStorage.getItem(CHART_CACHE_KEY));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is CachedChartAccount =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as CachedChartAccount).code === 'string' &&
      typeof (x as CachedChartAccount).name === 'string',
  );
}

export function readCachedJournalCodebook(): CachedJournalRule[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = parseSafe<unknown>(localStorage.getItem(JOURNAL_CACHE_KEY));
  const arr = coerceAccountingWorkspaceArray(raw);
  return arr.filter(
    (x): x is CachedJournalRule =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as CachedJournalRule).title === 'string' &&
      typeof (x as CachedJournalRule).accountCode === 'string',
  );
}

export function writeAccountingCache(chart: CachedChartAccount[], journal: CachedJournalRule[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CHART_CACHE_KEY, JSON.stringify(chart));
    localStorage.setItem(JOURNAL_CACHE_KEY, JSON.stringify(journal));
  } catch {
    /* quota / private mode */
  }
}

export function mergeChartOfAccountsLists<T extends CachedChartAccount>(...sources: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of sources) {
    for (const acc of list) {
      const code = String(acc?.code || '').trim();
      if (!code) continue;
      map.set(code, { ...acc, code, name: String(acc.name || '').trim() } as T);
    }
  }
  return [...map.values()];
}

export function mergeJournalCodingRulesLists<T extends CachedJournalRule>(...sources: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of sources) {
    for (const rule of list) {
      const id = String(rule?.id || '').trim();
      const title = String(rule?.title || '').trim();
      const accountCode = String(rule?.accountCode || '').trim();
      if (!title || !accountCode) continue;
      map.set(id || `${title}:${accountCode}`, {
        ...rule,
        id: id || `jr-${title}-${accountCode}`,
        title,
        accountCode,
        costCenter: String(rule.costCenter || 'عام').trim() || 'عام',
      } as T);
    }
  }
  return [...map.values()];
}

export function accountingSaveErrorHint(message: string): string {
  const m = String(message || '');
  if (/غير مصرح|permission|policy|RLS|42501|403/i.test(m)) {
    return `${m} — إن كنت محاسباً: نفّذ supabase/sql/fix_workspace_state_rls_accountant.sql على Supabase مرة واحدة.`;
  }
  return m;
}
