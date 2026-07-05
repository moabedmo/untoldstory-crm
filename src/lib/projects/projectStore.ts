import { isSupabaseDirectMode } from '@/config/supabaseMode';
import { getSupabase } from '@/lib/supabase/client';
import type { Project, ProjectRevenue, ProjectExpense, ProjectCustody, ProjectsData } from './projectTypes';

const STORAGE_KEY = 'crm_projects_data';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function useSb(): boolean {
  try { return isSupabaseDirectMode(); } catch { return false; }
}

// ============== In-memory cache to reduce Supabase requests ==============
let cachedData: ProjectsData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedOrNull(): ProjectsData | null {
  if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cachedData;
  return null;
}
function setCache(data: ProjectsData) {
  cachedData = data;
  cacheTimestamp = Date.now();
}
function invalidateCache() {
  cachedData = null;
  cacheTimestamp = 0;
}

// ============== localStorage fallback ==============
function loadLocal(): ProjectsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { projects: [], revenues: [], expenses: [], custodies: [] };
}
function saveLocal(data: ProjectsData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ============== Supabase helpers ==============
function sb() { return getSupabase(); }

function mapProject(r: Record<string, unknown>): Project {
  return {
    id: String(r.id), name: String(r.name), code: String(r.code),
    clientName: String(r.client_name), startDate: String(r.start_date),
    status: String(r.status) as Project['status'], notes: String(r.notes || ''),
    createdAt: String(r.created_at),
  };
}
function mapRevenue(r: Record<string, unknown>): ProjectRevenue {
  return {
    id: String(r.id), projectCode: String(r.project_code), amount: Number(r.amount),
    date: String(r.date), status: String(r.status) as ProjectRevenue['status'],
    collectionMethod: String(r.collection_method || ''), notes: String(r.notes || ''),
    createdAt: String(r.created_at),
  };
}
function mapExpense(r: Record<string, unknown>): ProjectExpense {
  return {
    id: String(r.id), projectCode: String(r.project_code), expenseCode: String(r.expense_code),
    expenseType: String(r.expense_type), description: String(r.description || ''),
    date: String(r.date), amount: Number(r.amount), source: String(r.source) as ProjectExpense['source'],
    custodyId: r.custody_id ? String(r.custody_id) : undefined, notes: String(r.notes || ''),
    createdAt: String(r.created_at),
  };
}
function mapCustody(r: Record<string, unknown>): ProjectCustody {
  return {
    id: String(r.id), code: String(r.code), projectCode: String(r.project_code),
    holderName: String(r.holder_name), amount: Number(r.amount),
    openDate: String(r.open_date), description: String(r.description || ''),
    status: String(r.status) as ProjectCustody['status'], notes: String(r.notes || ''),
    settlementItems: [], createdAt: String(r.created_at),
  };
}

// ============== Public API ==============

async function waitForSupabaseSession(maxMs = 2500): Promise<boolean> {
  const s = sb();
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const { data } = await s.auth.getSession();
    if (data.session?.access_token) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

function mapProjectsFetchError(message: string): string {
  const m = String(message || '').toLowerCase();
  if (m.includes('jwt') || m.includes('not authenticated') || m.includes('permission denied')) {
    return 'انتهت الجلسة — أعد تسجيل الدخول ثم حاول مرة أخرى';
  }
  return message || 'تعذر تحميل الشغلانات';
}

export async function getProjectsDataAsync(): Promise<ProjectsData> {
  if (!useSb()) return loadLocal();
  const cached = getCachedOrNull();
  if (cached) return cached;

  const localFallback = loadLocal();
  const hasSession = await waitForSupabaseSession();
  if (!hasSession) {
    if (localFallback.projects.length > 0) return localFallback;
    throw new Error('يجب تسجيل الدخول لعرض الشغلانات');
  }

  const s = sb();
  const [pRes, rRes, eRes, cRes] = await Promise.all([
    s.from('projects').select('*').order('created_at', { ascending: false }),
    s.from('project_revenues').select('*').order('created_at', { ascending: false }),
    s.from('project_expenses').select('*').order('created_at', { ascending: false }),
    s.from('project_custodies').select('*').order('created_at', { ascending: false }),
  ]);
  if (pRes.error) throw new Error(mapProjectsFetchError(pRes.error.message));
  if (rRes.error) throw new Error(mapProjectsFetchError(rRes.error.message));
  if (eRes.error) throw new Error(mapProjectsFetchError(eRes.error.message));
  if (cRes.error) throw new Error(mapProjectsFetchError(cRes.error.message));

  const projects = (pRes.data || []).map((r) => mapProject(r as Record<string, unknown>));
  const revenues = (rRes.data || []).map((r) => mapRevenue(r as Record<string, unknown>));
  const allExpenses = (eRes.data || []).map((r) => mapExpense(r as Record<string, unknown>));
  const custodies = (cRes.data || []).map((r) => {
    const c = mapCustody(r as Record<string, unknown>);
    c.settlementItems = allExpenses.filter((e) => e.custodyId === c.id);
    return c;
  });
  const result = { projects, revenues, expenses: allExpenses, custodies };
  setCache(result);
  saveLocal(result);
  return result;
}

export function getProjectsData(): ProjectsData {
  return loadLocal();
}

export async function addProject(p: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
  invalidateCache();
  const id = newId('prj');
  const now = new Date().toISOString();
  if (useSb()) {
    const nowIso = new Date().toISOString();
    const { data, error } = await sb().from('projects').insert({
      id, name: p.name, code: p.code, client_name: p.clientName,
      start_date: p.startDate, status: p.status, notes: p.notes,
      updated_at: nowIso,
    }).select('*').single();
    if (error) {
      if (error.code === '23505') throw new Error('كود الشغلانة مستخدم مسبقاً');
      throw new Error(mapProjectsFetchError(error.message));
    }
    const local = loadLocal();
    const proj = mapProject(data as Record<string, unknown>);
    local.projects.unshift(proj);
    saveLocal(local);
    return proj;
  }
  const data = loadLocal();
  if (data.projects.some((x) => x.code === p.code)) throw new Error('كود الشغلانة مستخدم مسبقاً');
  const project: Project = { ...p, id, createdAt: now };
  data.projects.unshift(project);
  saveLocal(data);
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  invalidateCache();
  if (useSb()) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.name != null) dbPatch.name = patch.name;
    if (patch.status != null) dbPatch.status = patch.status;
    if (patch.clientName != null) dbPatch.client_name = patch.clientName;
    if (patch.notes != null) dbPatch.notes = patch.notes;
    dbPatch.updated_at = new Date().toISOString();
    const { data, error } = await sb().from('projects').update(dbPatch).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    const proj = mapProject(data as Record<string, unknown>);
    const local = loadLocal();
    const idx = local.projects.findIndex((p) => p.id === id);
    if (idx >= 0) local.projects[idx] = proj;
    saveLocal(local);
    return proj;
  }
  const data = loadLocal();
  const idx = data.projects.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error('الشغلانة غير موجودة');
  data.projects[idx] = { ...data.projects[idx], ...patch };
  saveLocal(data);
  return data.projects[idx];
}

export async function addRevenue(r: Omit<ProjectRevenue, 'id' | 'createdAt'>): Promise<ProjectRevenue> {
  invalidateCache();
  const id = newId('rev');
  if (useSb()) {
    const { data, error } = await sb().from('project_revenues').insert({
      id, project_code: r.projectCode, amount: r.amount, date: r.date,
      status: r.status, collection_method: r.collectionMethod, notes: r.notes,
    }).select('*').single();
    if (error) throw new Error(error.message);
    const rev = mapRevenue(data as Record<string, unknown>);
    const local = loadLocal();
    local.revenues.unshift(rev);
    saveLocal(local);
    return rev;
  }
  const data = loadLocal();
  const rev: ProjectRevenue = { ...r, id, createdAt: new Date().toISOString() };
  data.revenues.unshift(rev);
  saveLocal(data);
  return rev;
}

export async function updateRevenue(id: string, patch: Partial<ProjectRevenue>): Promise<ProjectRevenue> {
  invalidateCache();
  if (useSb()) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status != null) dbPatch.status = patch.status;
    if (patch.collectionMethod != null) dbPatch.collection_method = patch.collectionMethod;
    if (patch.notes != null) dbPatch.notes = patch.notes;
    const { data, error } = await sb().from('project_revenues').update(dbPatch).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    const rev = mapRevenue(data as Record<string, unknown>);
    const local = loadLocal();
    const idx = local.revenues.findIndex((r) => r.id === id);
    if (idx >= 0) local.revenues[idx] = rev;
    saveLocal(local);
    return rev;
  }
  const data = loadLocal();
  const idx = data.revenues.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error('الإيراد غير موجود');
  data.revenues[idx] = { ...data.revenues[idx], ...patch };
  saveLocal(data);
  return data.revenues[idx];
}

export async function addExpense(e: Omit<ProjectExpense, 'id' | 'createdAt'>): Promise<ProjectExpense> {
  invalidateCache();
  const id = newId('exp');
  if (useSb()) {
    const { data, error } = await sb().from('project_expenses').insert({
      id, project_code: e.projectCode, expense_code: e.expenseCode,
      expense_type: e.expenseType, description: e.description, date: e.date,
      amount: e.amount, source: e.source, custody_id: e.custodyId || null, notes: e.notes,
    }).select('*').single();
    if (error) throw new Error(error.message);
    const exp = mapExpense(data as Record<string, unknown>);
    const local = loadLocal();
    local.expenses.unshift(exp);
    saveLocal(local);
    return exp;
  }
  const data = loadLocal();
  const exp: ProjectExpense = { ...e, id, createdAt: new Date().toISOString() };
  data.expenses.unshift(exp);
  saveLocal(data);
  return exp;
}

export async function addCustody(c: Omit<ProjectCustody, 'id' | 'createdAt' | 'settlementItems'>): Promise<ProjectCustody> {
  invalidateCache();
  const id = newId('cst');
  if (useSb()) {
    const { data, error } = await sb().from('project_custodies').insert({
      id, code: c.code, project_code: c.projectCode, holder_name: c.holderName,
      amount: c.amount, open_date: c.openDate, description: c.description,
      status: c.status, notes: c.notes,
    }).select('*').single();
    if (error) throw new Error(error.message);
    const cust = mapCustody(data as Record<string, unknown>);
    const local = loadLocal();
    local.custodies.unshift(cust);
    saveLocal(local);
    return cust;
  }
  const data = loadLocal();
  const custody: ProjectCustody = { ...c, id, settlementItems: [], createdAt: new Date().toISOString() };
  data.custodies.unshift(custody);
  saveLocal(data);
  return custody;
}

export async function settleCustody(
  custodyId: string,
  items: Omit<ProjectExpense, 'id' | 'createdAt' | 'source' | 'custodyId'>[],
): Promise<{ custody: ProjectCustody; expenses: ProjectExpense[] }> {
  invalidateCache();
  const newExpenses: ProjectExpense[] = [];

  for (const item of items) {
    const exp = await addExpense({
      ...item,
      source: 'تسوية عهدة',
      custodyId,
    });
    newExpenses.push(exp);
  }

  if (useSb()) {
    await sb().from('project_custodies').update({ status: 'تم تسويتها' }).eq('id', custodyId);
  }

  const data = loadLocal();
  const idx = data.custodies.findIndex((c) => c.id === custodyId);
  if (idx >= 0) {
    data.custodies[idx].status = 'تم تسويتها';
    data.custodies[idx].settlementItems = [...data.custodies[idx].settlementItems, ...newExpenses];
    saveLocal(data);
    return { custody: data.custodies[idx], expenses: newExpenses };
  }

  return { custody: { id: custodyId, code: '', projectCode: '', holderName: '', amount: 0, openDate: '', description: '', status: 'تم تسويتها', notes: '', settlementItems: newExpenses, createdAt: '' }, expenses: newExpenses };
}

export async function updateCustodyStatus(custodyId: string, status: ProjectCustody['status']) {
  invalidateCache();
  if (useSb()) {
    const { data, error } = await sb().from('project_custodies').update({ status }).eq('id', custodyId).select('*').single();
    if (error) throw new Error(error.message);
    const cust = mapCustody(data as Record<string, unknown>);
    const local = loadLocal();
    const idx = local.custodies.findIndex((c) => c.id === custodyId);
    if (idx >= 0) { local.custodies[idx] = { ...local.custodies[idx], status: cust.status }; saveLocal(local); }
    return cust;
  }
  const data = loadLocal();
  const idx = data.custodies.findIndex((c) => c.id === custodyId);
  if (idx < 0) throw new Error('العهدة غير موجودة');
  data.custodies[idx].status = status;
  saveLocal(data);
  return data.custodies[idx];
}

// ============== Estimated Assets ==============
const ASSETS_KEY = 'crm_estimated_assets';

export interface EstimatedAsset {
  id: string; name: string; type: string; value: number; date: string; notes: string; status: string;
}

export async function getEstimatedAssets(): Promise<EstimatedAsset[]> {
  if (useSb()) {
    const { data } = await sb().from('estimated_assets').select('*').order('created_at', { ascending: false });
    return (data || []).map((r: Record<string, unknown>) => ({
      id: String(r.id), name: String(r.name), type: String(r.type),
      value: Number(r.value), date: String(r.date), notes: String(r.notes || ''),
      status: String(r.status || 'نشط'),
    }));
  }
  try { const raw = localStorage.getItem(ASSETS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export async function addEstimatedAsset(a: Omit<EstimatedAsset, 'id'>): Promise<EstimatedAsset> {
  const id = newId('ast');
  if (useSb()) {
    const { data, error } = await sb().from('estimated_assets').insert({ id, ...a }).select('*').single();
    if (error) throw new Error(error.message);
    return { id: String(data.id), name: String(data.name), type: String(data.type), value: Number(data.value), date: String(data.date), notes: String(data.notes || ''), status: String(data.status || 'نشط') };
  }
  const asset: EstimatedAsset = { ...a, id };
  const all = await getEstimatedAssets();
  all.unshift(asset);
  localStorage.setItem(ASSETS_KEY, JSON.stringify(all));
  return asset;
}

export async function removeEstimatedAsset(id: string): Promise<void> {
  if (useSb()) {
    await sb().from('estimated_assets').delete().eq('id', id);
    return;
  }
  const all = await getEstimatedAssets();
  localStorage.setItem(ASSETS_KEY, JSON.stringify(all.filter((a) => a.id !== id)));
}

// ============== Employee Deductions ==============
export interface EmployeeDeduction {
  id: string; userId: string; monthKey: string; type: string; amount: number; reason: string; date: string;
}

export async function getEmployeeDeductions(userId: string, monthKey: string): Promise<EmployeeDeduction[]> {
  if (useSb()) {
    const { data } = await sb().from('employee_deductions').select('*').eq('user_id', userId).eq('month_key', monthKey);
    return (data || []).map((r: Record<string, unknown>) => ({
      id: String(r.id), userId: String(r.user_id), monthKey: String(r.month_key),
      type: String(r.type), amount: Number(r.amount), reason: String(r.reason), date: String(r.date),
    }));
  }
  try { const raw = localStorage.getItem(`emp_deductions_${userId}_${monthKey}`); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export async function addEmployeeDeduction(d: Omit<EmployeeDeduction, 'id'>): Promise<EmployeeDeduction> {
  const id = newId('ded');
  if (useSb()) {
    const { data, error } = await sb().from('employee_deductions').insert({
      id, user_id: d.userId, month_key: d.monthKey, type: d.type, amount: d.amount, reason: d.reason, date: d.date,
    }).select('*').single();
    if (error) throw new Error(error.message);
    return { id: String(data.id), userId: String(data.user_id), monthKey: String(data.month_key), type: String(data.type), amount: Number(data.amount), reason: String(data.reason), date: String(data.date) };
  }
  const entry: EmployeeDeduction = { ...d, id };
  const all = await getEmployeeDeductions(d.userId, d.monthKey);
  all.push(entry);
  localStorage.setItem(`emp_deductions_${d.userId}_${d.monthKey}`, JSON.stringify(all));
  return entry;
}

export async function removeEmployeeDeduction(id: string, userId: string, monthKey: string): Promise<void> {
  if (useSb()) {
    await sb().from('employee_deductions').delete().eq('id', id);
    return;
  }
  const all = await getEmployeeDeductions(userId, monthKey);
  localStorage.setItem(`emp_deductions_${userId}_${monthKey}`, JSON.stringify(all.filter((d) => d.id !== id)));
}
