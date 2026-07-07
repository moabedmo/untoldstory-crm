#!/usr/bin/env node
/**
 * إعادة ضبط كلمات مرور Supabase Auth لكل الموظفين (ما عدا المالك)
 * يستخدم Edge Function set-employee-password — نفس مسار التطبيق.
 *
 * الاستخدام:
 *   node scripts/reset-all-employee-passwords.mjs
 *   TEMP_PASSWORD='MyPass@2026!' node scripts/reset-all-employee-passwords.mjs
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.local', '.env.migrate']) {
  if (existsSync(join(root, rel))) config({ path: join(root, rel) });
}

const URL = String(process.env.VITE_SUPABASE_URL || process.env.NEW_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEW_SUPABASE_ANON_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'admin@untold.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'UntoldAccess2026!';
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || 'Untold@2026!';

if (!URL || !ANON) {
  console.error('❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY غير معيّنين في .env.local');
  process.exit(1);
}

async function login(email, pwd) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pwd }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error_code || j.msg || 'login failed');
  return j.access_token;
}

async function resetPassword(ownerTok, user, password) {
  const r = await fetch(`${URL}/functions/v1/set-employee-password`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ownerTok}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetUserId: user.id, email: user.email, password }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
}

console.log('المشروع:', URL);
console.log('كلمة المرور المؤقتة:', TEMP_PASSWORD);
console.log('');

const ownerTok = await login(OWNER_EMAIL, OWNER_PASSWORD);
const users = await fetch(`${URL}/rest/v1/users?select=id,email,name,role&order=email`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ownerTok}` },
}).then((r) => r.json());

const targets = users.filter((u) => u.role !== 'مالك' && String(u.email || '').includes('@'));
let ok = 0;
let fail = 0;

for (const u of targets) {
  const email = String(u.email).trim().toLowerCase();
  try {
    await resetPassword(ownerTok, { id: u.id, email }, TEMP_PASSWORD);
    const check = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEMP_PASSWORD }),
    });
    if (!check.ok) throw new Error('login check failed after reset');
    ok++;
    console.log(`✅ ${u.name} <${email}>`);
  } catch (e) {
    fail++;
    console.log(`❌ ${u.name} <${email}> — ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${ok} نجح / ${fail} فشل`);
console.log('\nأبلغ كل موظف:');
console.log(`  • البريد: نفس الإيميل في جدول الموظفين (حروف صغيرة)`);
console.log(`  • كلمة المرور: ${TEMP_PASSWORD}`);
