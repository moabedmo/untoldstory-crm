#!/usr/bin/env node
// يطبّق فقط ملفات SQL الجديدة لهذه الدفعة (إضافية/آمنة لإعادة التشغيل).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadDbUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const p = join(root, 'server-api', '.env');
  if (existsSync(p)) {
    const m = readFileSync(p, 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (m) { let v = m[1].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v = v.slice(1,-1); return v; }
  }
  return '';
}
const FILES = [
  'add_lead_last_call.sql',
  'add_deduction_fields.sql',
  'add_project_fields.sql',
  'add_project_updates.sql',
  'add_avatar_storage.sql',
];
let url = loadDbUrl();
if (!url) { console.error('❌ DATABASE_URL غير موجود'); process.exit(1); }
// أزل sslmode من الرابط (pg الحديث يعامل require كـ verify-full فيرفض شهادة Supabase)
url = url.replace(/([?&])sslmode=[^&]*/i, '$1').replace(/[?&]$/,'').replace(/&&/,'&');
const pg = (await import('pg')).default;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
let ok = 0, fail = 0;
try {
  await client.connect();
  console.log('🔌 متصل\n');
  for (const f of FILES) {
    const path = join(root, 'supabase', 'sql', f);
    process.stdout.write(`⏳ ${f} … `);
    try { await client.query(readFileSync(path, 'utf8')); ok++; console.log('✅'); }
    catch (e) { fail++; console.log('❌ ' + (e?.message || e)); }
  }
  console.log(`\n📊 ${ok} نجح، ${fail} فشل.`);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) { console.error('❌ اتصال:', e?.message || e); process.exit(1); }
finally { await client.end().catch(() => {}); }
