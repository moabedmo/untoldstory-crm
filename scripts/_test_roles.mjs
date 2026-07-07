import { config } from 'dotenv';
config({ path: '.env.migrate' });
import pg from 'pg';

const URL = process.env.NEW_SUPABASE_URL;
const ANON = process.env.NEW_SUPABASE_ANON_KEY;
const SVC = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;

// 1) جيب كل الموظفين مع أدوارهم
const connStr = process.env.NEW_DIRECT_URL.replace(/\?.*$/, '');
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: users } = await client.query(`SELECT id, name, email, role FROM public.users ORDER BY role`);
await client.end();

console.log('=== الموظفون حسب الدور ===');
for (const u of users) console.log(u.role.padEnd(16), u.name.padEnd(20), u.email);

// 2) سجّل دخول كل دور واختبر صلاحياته
const passwords = { 'admin@untold.com': 'UntoldAccess2026!' };
const defaultPwd = 'Untold@2026!';

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: passwords[email] || defaultPwd }),
  });
  const j = await r.json();
  return r.ok ? j.access_token : null;
}

async function get(token, table, params = 'select=id&limit=5') {
  const r = await fetch(`${URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
  });
  const count = r.headers.get('content-range')?.split('/')[1] || '?';
  const j = await r.json();
  return { status: r.status, count, rows: Array.isArray(j) ? j.length : 0, error: j?.message || j?.error };
}

async function patch(token, table, id, body) {
  const r = await fetch(`${URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return r.status;
}

// اختبر بحساب من كل دور
const roleTests = {};
for (const role of ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج']) {
  const u = users.find(x => x.role === role);
  if (!u) { roleTests[role] = 'لا يوجد موظف بهذا الدور'; continue; }

  const token = await login(u.email);
  if (!token) { roleTests[role] = `فشل تسجيل الدخول (${u.email})`; continue; }

  const leads = await get(token, 'leads', 'select=id,assigned_to_id&limit=1');
  const users2 = await get(token, 'users', 'select=id,name,role&limit=1');
  const invoices = await get(token, 'invoices', 'select=id&limit=1');
  const expenses = await get(token, 'expenses', 'select=id&limit=1');
  const priceQuotes = await get(token, 'price_quotes', 'select=id&limit=1');

  // اختبر توزيع ليد (UPDATE assigned_to_id) لأول ليد متاح
  let assignTest = 'لا يوجد ليد للاختبار';
  if (leads.rows > 0) {
    const leadsData = await fetch(`${URL}/rest/v1/leads?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` }
    }).then(r => r.json());
    if (leadsData[0]) {
      const s = await patch(token, 'leads', leadsData[0].id, { assigned_to_id: u.id });
      assignTest = s === 204 ? 'مسموح ✅' : s === 200 ? 'مسموح ✅' : `مرفوض (${s})`;
    }
  }

  roleTests[role] = {
    user: `${u.name} (${u.email})`,
    leads: leads.status === 200 ? `✅ (${leads.count} ليد)` : `❌ ${leads.status} ${leads.error||''}`,
    users: users2.status === 200 ? `✅` : `❌ ${users2.status}`,
    invoices: invoices.status === 200 ? `✅` : `❌ ${invoices.status}`,
    expenses: expenses.status === 200 ? `✅` : `❌ ${expenses.status}`,
    priceQuotes: priceQuotes.status === 200 ? `✅` : `❌ ${priceQuotes.status}`,
    assignLead: assignTest,
  };
}

console.log('\n=== نتائج اختبار الأدوار ===');
for (const [role, result] of Object.entries(roleTests)) {
  console.log(`\n── ${role} ──`);
  if (typeof result === 'string') { console.log('  ', result); continue; }
  console.log('  الحساب:', result.user);
  console.log('  الليدز:', result.leads);
  console.log('  الموظفون:', result.users);
  console.log('  الفواتير:', result.invoices);
  console.log('  المصروفات:', result.expenses);
  console.log('  عروض الأسعار:', result.priceQuotes);
  console.log('  توزيع ليد:', result.assignLead);
}
