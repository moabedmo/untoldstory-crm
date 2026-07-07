#!/usr/bin/env node
/** يكمل النقل — بدون حذف الصفوف الموجودة */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local']) {
  if (existsSync(join(root, rel))) config({ path: join(root, rel) });
}

const SRC_URL = String(process.env.SRC_SUPABASE_URL || 'https://axkoidcmiqutdtcadfca.supabase.co').replace(/\/+$/, '');
const SRC_ANON = String(process.env.SRC_SUPABASE_ANON_KEY || '').trim();
const DST_URL = String(process.env.NEW_DIRECT_URL || '').trim().replace(/\?.*$/, '');
const EMAIL = String(process.env.SRC_OWNER_EMAIL || 'admin@untold.com');
const PASS = String(process.env.SRC_OWNER_PASSWORD || 'UntoldAccess2026!');

const TABLES = [
  'leads',
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
];

async function token() {
  const r = await fetch(`${SRC_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SRC_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'login fail');
  return j.access_token;
}

async function fetchPage(tok, table, from, size) {
  const res = await fetch(`${SRC_URL}/rest/v1/${table}?select=*`, {
    headers: { apikey: SRC_ANON, Authorization: `Bearer ${tok}`, Range: `${from}-${from + size - 1}` },
  });
  if (!res.ok) throw new Error(`${table} ${res.status}`);
  return res.json();
}

async function insertPage(table, rows) {
  if (!rows.length) return 0;
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DST_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const cols = Object.keys(rows[0]);
    const colSql = cols.map((c) => `"${c}"`).join(', ');
    let n = 0;
    for (const row of rows) {
      const values = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return null;
        if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
        return v;
      });
      const ph = cols
        .map((c, i) => {
          const v = row[c];
          if (v !== null && typeof v === 'object' && !(v instanceof Date)) return `$${i + 1}::jsonb`;
          if (c.endsWith('_at')) return `$${i + 1}::timestamptz`;
          return `$${i + 1}`;
        })
        .join(', ');
      await client.query(
        `INSERT INTO public."${table}" (${colSql}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`,
        values,
      );
      n++;
    }
    return n;
  } finally {
    await client.end().catch(() => {});
  }
}

const tok = await token();
for (const table of TABLES) {
  process.stdout.write(`⏳ ${table}... `);
  let from = 0;
  const size = 100;
  let total = 0;
  try {
    while (true) {
      const batch = await fetchPage(tok, table, from, size);
      if (!Array.isArray(batch) || !batch.length) break;
      total += await insertPage(table, batch);
      from += batch.length;
      if (batch.length < size) break;
      process.stdout.write(`${from}... `);
    }
    console.log(`${total} محاولة إدراج`);
  } catch (e) {
    console.log('فشل:', e instanceof Error ? e.message : e);
  }
}
console.log('تم.');
