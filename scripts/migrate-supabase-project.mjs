#!/usr/bin/env node
/**
 * نقل public.* من مشروع Supabase إلى مشروع جديد.
 *
 * 1) أنشئ مشروع Supabase جديد
 * 2) انسخ .env.migrate.example → .env.migrate واملأ OLD/NEW Direct URLs
 * 3) جهّز الجداول على الجديد:
 *      cd server-api
 *      set DATABASE_URL / DIRECT_URL للمشروع الجديد في .env
 *      npm run db:push
 * 4) من جذر المشروع:
 *      node scripts/migrate-supabase-project.mjs
 * 5) انقل Auth:
 *      node scripts/migrate-supabase-auth.mjs
 * 6) شغّل SQL ما بعد النقل (RLS، realtime، …) — انظر supabase/sql/post_migrate_setup.sql
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local', 'server-api/.env']) {
  const p = join(root, rel);
  if (existsSync(p)) config({ path: p });
}

const OLD_URL = String(process.env.OLD_DIRECT_URL || process.env.OLD_DATABASE_URL || '').trim();
const NEW_URL = String(process.env.NEW_DIRECT_URL || process.env.NEW_DATABASE_URL || '').trim();
const CONFIRM = String(process.env.CONFIRM_MIGRATE || '').trim() === 'YES';
const STRIP_AVATAR = String(process.env.STRIP_AVATAR_BASE64 || '1').trim() === '1';

const SKIP_TABLES = new Set(['_prisma_migrations', 'schema_migrations']);

if (!OLD_URL || !NEW_URL) {
  console.error('❌ عيّن OLD_DIRECT_URL و NEW_DIRECT_URL في .env.migrate');
  process.exit(1);
}
if (!CONFIRM) {
  console.error('❌ للتشغيل الفعلي: CONFIRM_MIGRATE=YES في .env.migrate');
  process.exit(1);
}

const { default: pg } = await import('pg');

async function fetchColumnMeta(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return {
    columns: rows.map((r) => r.column_name),
    types: Object.fromEntries(rows.map((r) => [r.column_name, r.udt_name])),
  };
}

function placeholderFor(udtName, index) {
  const slot = `$${index}`;
  if (udtName === 'jsonb' || udtName === 'json') return `${slot}::jsonb`;
  if (udtName === 'timestamptz') return `${slot}::timestamptz`;
  if (udtName === 'timestamp') return `${slot}::timestamp`;
  if (udtName === 'uuid') return `${slot}::uuid`;
  if (udtName === 'bool') return `${slot}::boolean`;
  return slot;
}

function serializeValue(val, col, table) {
  if (val === null || val === undefined) {
    if (table === 'users' && col === 'password_hash') return '';
    return null;
  }
  if (STRIP_AVATAR && table === 'users' && col === 'avatar' && typeof val === 'string' && val.startsWith('data:image')) {
    return null;
  }
  if (typeof val === 'object' && !(val instanceof Date) && !Buffer.isBuffer(val)) {
    return JSON.stringify(val);
  }
  return val;
}

async function listPublicTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.has(t));
}

async function countRows(client, table) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM public."${table}"`);
  return rows[0]?.c ?? 0;
}

async function copyTable(oldClient, newClient, table) {
  const oldMeta = await fetchColumnMeta(oldClient, table);
  const newMeta = await fetchColumnMeta(newClient, table);
  if (!oldMeta.columns.length) return { table, copied: 0, skipped: 'no columns on source' };
  if (!newMeta.columns.length) return { table, copied: 0, skipped: 'table missing on target — run db:push first' };

  const columns = oldMeta.columns.filter((c) => newMeta.columns.includes(c));
  if (!columns.length) return { table, copied: 0, skipped: 'no matching columns' };

  const srcCount = await countRows(oldClient, table);
  if (srcCount === 0) return { table, copied: 0, skipped: 'empty source' };

  const colList = columns.map((c) => `"${c}"`).join(', ');
  const { rows } = await oldClient.query(`SELECT ${colList} FROM public."${table}"`);
  if (!rows.length) return { table, copied: 0, skipped: 'empty' };

  await newClient.query('SET session_replication_role = replica');
  try {
    await newClient.query(`DELETE FROM public."${table}"`);
    const batchSize = 200;
    let copied = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const row of batch) {
        const values = columns.map((c) => serializeValue(row[c], c, table));
        const ph = columns.map((c, idx) => placeholderFor(newMeta.types[c], idx + 1)).join(', ');
        await newClient.query(
          `INSERT INTO public."${table}" (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
          values,
        );
        copied++;
      }
    }
    return { table, copied, source: srcCount };
  } finally {
    await newClient.query('SET session_replication_role = DEFAULT');
  }
}

const oldClient = new pg.Client({ connectionString: OLD_URL });
const newClient = new pg.Client({ connectionString: NEW_URL });

try {
  await oldClient.connect();
  await newClient.connect();
  console.log('⏳ جاري نسخ جداول public.* ...');

  const tables = await listPublicTables(oldClient);
  const priority = [
    'users',
    'workspace_state',
    'accounting_policy',
    'custody_settings',
    'closed_months',
    'leads',
    'manual_customers',
    'price_quotes',
    'invoices',
    'expenses',
    'manual_journal_entries',
    'monthly_targets',
    'attendance_records',
    'audit_events',
    'custody_funds',
    'shoot_bookings',
    'equipment_bookings',
    'meeting_bookings',
    'projects',
    'project_revenues',
    'project_expenses',
    'project_custodies',
    'estimated_assets',
    'employee_deductions',
  ];
  const ordered = [
    ...priority.filter((t) => tables.includes(t)),
    ...tables.filter((t) => !priority.includes(t)),
  ];

  const results = [];
  for (const table of ordered) {
    process.stdout.write(`  → ${table} ... `);
    try {
      const r = await copyTable(oldClient, newClient, table);
      results.push(r);
      if (r.skipped) console.log(`تخطي (${r.skipped})`);
      else console.log(`${r.copied} صف`);
    } catch (e) {
      console.log(`فشل: ${e instanceof Error ? e.message : e}`);
      results.push({ table, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log('\n=== ملخص النقل ===');
  for (const r of results) {
    if (r.error) console.log(`❌ ${r.table}: ${r.error}`);
    else if (r.skipped) console.log(`⏭ ${r.table}: ${r.skipped}`);
    else console.log(`✓ ${r.table}: ${r.copied} صف`);
  }

  const leads = results.find((r) => r.table === 'leads');
  const users = results.find((r) => r.table === 'users');
  console.log('\nالتالي:');
  console.log('  1) node scripts/migrate-supabase-auth.mjs');
  console.log('  2) شغّل ملفات SQL في supabase/sql/post_migrate_setup.sql');
  console.log('  3) حدّث Vercel / GitHub Secrets بالمشروع الجديد');
  if (users?.copied) console.log(`\n✓ مستخدمون: ${users.copied}`);
  if (leads?.copied) console.log(`✓ ليدز: ${leads.copied}`);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await oldClient.end().catch(() => {});
  await newClient.end().catch(() => {});
}
