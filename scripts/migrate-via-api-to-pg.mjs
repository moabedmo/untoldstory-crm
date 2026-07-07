#!/usr/bin/env node
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local', 'server-api/.env']) {
  if (existsSync(join(root, rel))) config({ path: join(root, rel) });
}

const SRC_URL = String(process.env.SRC_SUPABASE_URL || 'https://axkoidcmiqutdtcadfca.supabase.co').replace(/\/+$/, '');
const SRC_ANON = String(process.env.SRC_SUPABASE_ANON_KEY || '').trim();
const SRC_EMAIL = String(process.env.SRC_OWNER_EMAIL || 'admin@untold.com').trim();
const SRC_PASSWORD = String(process.env.SRC_OWNER_PASSWORD || 'UntoldAccess2026!').trim();
const DST_URL = String(process.env.NEW_DIRECT_URL || '').trim().replace(/\?.*$/, '');
const STRIP_AVATAR = String(process.env.STRIP_AVATAR_BASE64 || '1') === '1';

const TABLES = [
  'users',
  'workspace_state',
  'accounting_policy',
  'custody_settings',
  'closed_months',
  'manual_customers',
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

async function login() {
  const res = await fetch(`${SRC_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SRC_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SRC_EMAIL, password: SRC_PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description || j.msg || `login ${res.status}`);
  return j.access_token;
}

async function fetchAll(token, table) {
  const rows = [];
  const page = 200;
  let from = 0;
  while (true) {
    const res = await fetch(`${SRC_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: SRC_ANON, Authorization: `Bearer ${token}`, Range: `${from}-${from + page - 1}` },
    });
    if (!res.ok) throw new Error(`${table} ${res.status} ${(await res.text()).slice(0, 150)}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

function pgClient() {
  const { default: pg } = globalThis.__pg;
  return new pg.Client({ connectionString: DST_URL, ssl: { rejectUnauthorized: false } });
}

async function insertRows(table, rows) {
  if (!rows.length) return 0;
  const { default: pg } = await import('pg');
  globalThis.__pg = { default: pg };
  const client = pgClient();
  await client.connect();
  try {
    const cols = Object.keys(rows[0]);
    const colSql = cols.map((c) => `"${c}"`).join(', ');
    await client.query('SET session_replication_role = replica');
    await client.query(`DELETE FROM public."${table}"`);
    let n = 0;
    for (const row of rows) {
      const values = cols.map((c) => {
        let v = row[c];
        if (v === null || v === undefined) return table === 'users' && c === 'password_hash' ? '' : null;
        if (STRIP_AVATAR && table === 'users' && c === 'avatar' && typeof v === 'string' && v.startsWith('data:image')) return null;
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
      await client.query(`INSERT INTO public."${table}" (${colSql}) VALUES (${ph})`, values);
      n++;
    }
    await client.query('SET session_replication_role = DEFAULT');
    return n;
  } finally {
    await client.end().catch(() => {});
  }
}

const token = await login();
console.log('✓ مصدر:', SRC_URL);

for (const table of TABLES) {
  process.stdout.write(`⏳ ${table}... `);
  try {
    const rows = await fetchAll(token, table);
    const n = await insertRows(table, rows);
    console.log(`${n} صف`);
  } catch (e) {
    console.log('فشل:', e instanceof Error ? e.message : e);
  }
}

console.log('تم.');
