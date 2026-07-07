#!/usr/bin/env node
/** إنشاء حساب Auth على المشروع الجديد (بعد نقل public.users) */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local']) {
  const p = join(root, rel);
  if (existsSync(p)) config({ path: p });
}

const base = String(process.env.NEW_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const anon = String(process.env.NEW_SUPABASE_ANON_KEY || '').trim();
const email = String(process.env.SRC_OWNER_EMAIL || 'admin@untold.com').trim().toLowerCase();
const password = String(process.env.SRC_OWNER_PASSWORD || 'UntoldAccess2026!').trim();

if (!base || !anon) {
  console.error('❌ NEW_SUPABASE_URL و NEW_SUPABASE_ANON_KEY مطلوبان في .env.migrate');
  process.exit(1);
}

const res = await fetch(`${base}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, data: { name: 'المالك' } }),
});
const j = await res.json().catch(() => ({}));
if (!res.ok && !/already|registered/i.test(JSON.stringify(j))) {
  console.error('❌ signup:', j.error_description || j.msg || j.message || res.status);
  process.exit(1);
}
console.log(`✓ حساب Auth على الجديد: ${email}`);
console.log('جرّب الدخول على untoldstory.click بعد تحديث Vercel');
