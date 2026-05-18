#!/usr/bin/env node
/**
 * يطبّق SQL المعلّق: عمولة المندوبين + سياسات RLS
 * يقرأ DATABASE_URL من api/.env أو متغير البيئة
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const envPath = join(root, 'api', '.env');
  if (!existsSync(envPath)) return '';
  const text = readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) return '';
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

const url = loadDatabaseUrl();
if (!url || /USER:PASSWORD|xxxx/i.test(url)) {
  console.error('❌ DATABASE_URL غير معيّن في api/.env');
  process.exit(1);
}

let pg;
try {
  const mod = await import('pg');
  pg = mod.default;
} catch {
  console.error('❌ ثبّت: npm install pg --save-dev');
  process.exit(1);
}

const files = [
  join(root, 'supabase', 'sql', 'add_monthly_target_commission.sql'),
  join(root, 'supabase', 'sql', 'role_based_rls_policies.sql'),
];

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    console.log('⏳', f.replace(root, '.'));
    try {
      await client.query(sql);
      console.log('✅', f.split(/[/\\]/).pop());
    } catch (e) {
      const msg = String(e?.message || e);
      if (f.includes('role_based_rls') && /already exists/i.test(msg)) {
        console.log('⚠️', f.split(/[/\\]/).pop(), '— السياسات مطبّقة مسبقاً (تخطي)');
        continue;
      }
      throw e;
    }
  }
  console.log('\n✅ اكتمل تطبيق SQL على قاعدة البيانات.');
} catch (e) {
  console.error('❌', e?.message || e);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
