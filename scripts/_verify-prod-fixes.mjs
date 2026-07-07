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
  if (!r.ok) return { ok: false, err: j.error_description || j.msg || j.error_code };
  return { ok: true, token: j.access_token };
}

async function ownerResetPassword(ownerTok, targetUserId, email, password) {
  const r = await fetch(`${URL}/functions/v1/set-employee-password`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ownerTok}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetUserId, email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

const conn =
  'postgresql://postgres.hpvxqwkyxklyurzxnoga:12805Moh%40meddd@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';
const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log('=== 1) Live bundle has session-wait fix ===');
const html = await fetch('https://untoldstory.click/').then((r) => r.text());
const bundleMatch = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
const bundle = bundleMatch ? bundleMatch[0] : null;
if (bundle) {
  const js = await fetch(`https://untoldstory.click/${bundle}`).then((r) => r.text());
  console.log('bundle:', bundle);
  console.log('  waitForSupabaseSession:', js.includes('waitForSupabaseSession') || js.includes('يجب تسجيل الدخول لعرض الشغلانات'));
  console.log('  password toast description:', js.includes('البريد للدخول'));
}

console.log('\n=== 2) Auth vs public.users email mismatches ===');
const mism = await c.query(`
  SELECT p.id, p.email AS profile_email, p.name, p.role,
         u.email AS auth_email,
         u.email_confirmed_at IS NOT NULL AS confirmed,
         u.last_sign_in_at
  FROM public.users p
  LEFT JOIN auth.users u ON lower(u.email) = lower(p.email)
  WHERE p.email NOT LIKE '%@staff.internal'
  ORDER BY p.role, p.email
`);
const noAuth = mism.rows.filter((r) => !r.auth_email);
const unconfirmed = mism.rows.filter((r) => r.auth_email && !r.confirmed);
console.log('employees with real email:', mism.rows.length);
console.log('  NO auth account:', noAuth.length, noAuth.map((r) => r.profile_email));
console.log('  unconfirmed auth:', unconfirmed.length, unconfirmed.map((r) => r.profile_email));

console.log('\n=== 3) Owner password reset E2E ===');
const owner = await login('admin@untold.com', 'UntoldAccess2026!');
if (!owner.ok) {
  console.log('OWNER LOGIN FAIL:', owner.err);
} else {
  const target = mism.rows.find((r) => r.role === 'مندوب' && r.auth_email);
  if (!target) {
    console.log('no rep target');
  } else {
    const testPwd = 'TestFix@2026!';
    const em = String(target.profile_email).trim().toLowerCase();
    const reset = await ownerResetPassword(owner.token, target.id, em, testPwd);
    console.log('reset', target.name, em, '→', reset.status, reset.body.error || reset.body.ok);
    const verify = await login(em, testPwd);
    console.log('login with new pwd:', verify.ok ? 'OK' : verify.err);
    // restore
    const restore = await ownerResetPassword(owner.token, target.id, em, 'Untold@2026!');
    console.log('restore Untold@2026!:', restore.status, restore.body.error || 'OK');
  }
}

console.log('\n=== 4) Project insert (accountant + PM) ===');
for (const [email, role] of [
  ['abdelrahmanelhelaly@globaluntoldstory.com', 'محاسب'],
  ['kamalel-menshawe@globaluntoldstory.com', 'مدير إنتاج'],
]) {
  const ses = await login(email, 'Untold@2026!');
  if (!ses.ok) {
    console.log(`${role} ${email}: LOGIN FAIL ${ses.err}`);
    continue;
  }
  const code = `V${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const ins = await fetch(`${URL}/rest/v1/projects`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ses.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: `prj_v_${Date.now()}`,
      name: 'Verify Project',
      code,
      client_name: 'Verify Client',
      start_date: '2026-07-06',
      status: 'مفتوحة',
      notes: '',
    }),
  });
  console.log(`${role}: insert ${ins.status}`, ins.ok ? code : (await ins.text()).slice(0, 120));
}

await c.end();
