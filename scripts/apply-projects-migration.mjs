#!/usr/bin/env node
/** تشغيل migration جداول المشاريع على Supabase الجديد */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local', 'server-api/.env']) {
  const p = join(root, rel);
  if (existsSync(p)) config({ path: p });
}

const url = String(process.env.NEW_DIRECT_URL || process.env.DATABASE_URL || '').replace(/\?.*$/, '');
if (!url) {
  console.error('❌ NEW_DIRECT_URL أو DATABASE_URL مطلوب');
  process.exit(1);
}

const sqlPath = join(root, 'supabase/migrations/20260629_projects_system.sql');
const raw = readFileSync(sqlPath, 'utf8');

// policies قد تكون موجودة — اجعلها idempotent
const sql = raw
  .replace(
    /CREATE POLICY "authenticated_all" ON (\w+)/g,
    'DROP POLICY IF EXISTS "authenticated_all" ON $1;\nCREATE POLICY "authenticated_all" ON $1',
  );

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  const tables = [
    'projects', 'project_revenues', 'project_expenses',
    'project_custodies', 'estimated_assets', 'employee_deductions',
  ];
  for (const t of tables) {
    const r = await client.query(`SELECT COUNT(*)::int c FROM public."${t}"`);
    console.log(`✓ ${t} — جدول موجود (${r.rows[0].c} صف)`);
  }
  console.log('تم تطبيق migration المشاريع.');
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await client.end();
}
