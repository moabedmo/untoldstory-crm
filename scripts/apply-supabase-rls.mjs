#!/usr/bin/env node
/**
 * يطبّق سياسات RLS من supabase/sql/role_based_rls_policies.sql
 * يتطلب DATABASE_URL (اتصال Postgres مباشر — من Supabase → Settings → Database).
 *
 * الاستخدام: node scripts/apply-supabase-rls.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = join(root, 'supabase', 'sql', 'role_based_rls_policies.sql');

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
if (!url.trim()) {
  console.error('❌ عيّن DATABASE_URL أو SUPABASE_DB_URL (رابط Postgres المباشر من Supabase).');
  process.exit(1);
}

let pg;
try {
  const mod = await import('pg');
  pg = mod.default;
} catch {
  console.error('❌ ثبّت الحزمة: npm install pg --save-dev');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString: url.trim() });

try {
  await client.connect();
  console.log('⏳ تطبيق', sqlPath);
  await client.query(sql);
  console.log('✅ تم تطبيق سياسات RLS بنجاح.');
} catch (e) {
  console.error('❌ فشل التطبيق:', e?.message || e);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
