import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local' });

const URL = process.env.VITE_SUPABASE_URL.replace(/\/+$/, '');
const ANON = process.env.VITE_SUPABASE_ANON_KEY;

async function login(email, pwd) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pwd }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${email}: ${j.error_code || j.msg}`);
  return j.access_token;
}

const conn =
  'postgresql://postgres.hpvxqwkyxklyurzxnoga:12805Moh%40meddd@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';
const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: cols } = await c.query(`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='projects'
  ORDER BY ordinal_position
`);
console.log('projects columns:', cols);

const { rows: policies } = await c.query(`
  SELECT policyname, cmd, qual, with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='projects'
`);
console.log('RLS policies:', policies);

const { rows: users } = await c.query(`
  SELECT email, name, role FROM public.users
  WHERE role IN ('مدير إنتاج', 'محاسب') ORDER BY role, email
`);
console.log('users:', users);
await c.end();

for (const u of users) {
  const em = u.email.toLowerCase();
  console.log(`\n--- ${u.name} (${u.role}) <${em}> ---`);
  let tok;
  try {
    tok = await login(em, 'Untold@2026!');
    console.log('login: OK');
  } catch (e) {
    console.log('login FAIL:', e.message);
    continue;
  }

  const testCode = `X${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const body = {
    id: `prj_test_${Date.now()}`,
    name: 'Test Shoglana',
    code: testCode,
    client_name: 'Test Client',
    start_date: '2026-07-06',
    status: 'مفتوحة',
    notes: '',
  };

  // Same as projectStore.addProject insert
  const ins = await fetch(`${URL}/rest/v1/projects`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await ins.text();
  console.log('insert project:', ins.status, text.slice(0, 200));

  const sel = await fetch(`${URL}/rest/v1/projects?select=id,code,name&order=created_at.desc&limit=3`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tok}` },
  });
  console.log('list projects:', sel.status, (await sel.text()).slice(0, 200));
}
