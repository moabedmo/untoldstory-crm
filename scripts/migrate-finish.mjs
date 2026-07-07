#!/usr/bin/env node
/** إكمال leads المتبقية + جداول بدون عمود id */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local']) {
  if (existsSync(join(root, rel))) config({ path: join(root, rel) });
}

const SRC_URL = String(process.env.SRC_SUPABASE_URL).replace(/\/+$/, '');
const SRC_ANON = process.env.SRC_SUPABASE_ANON_KEY;
const DST_URL = String(process.env.NEW_DIRECT_URL).replace(/\?.*$/, '');
const EMAIL = process.env.SRC_OWNER_EMAIL || 'admin@untold.com';
const PASS = process.env.SRC_OWNER_PASSWORD || 'UntoldAccess2026!';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${SRC_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SRC_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASS }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error_description || 'login');
      return j.access_token;
    } catch (e) {
      if (i === 4) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

async function fetchPage(tok, table, from, size) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${SRC_URL}/rest/v1/${table}?select=*`, {
        headers: { apikey: SRC_ANON, Authorization: `Bearer ${tok}`, Range: `${from}-${from + size - 1}` },
      });
      if (!res.ok) throw new Error(`${table} HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

function buildInsert(table, row, conflictCol) {
  const cols = Object.keys(row);
  const colSql = cols.map((c) => `"${c}"`).join(', ');
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
  const sql = conflictCol
    ? `INSERT INTO public."${table}" (${colSql}) VALUES (${ph}) ON CONFLICT ("${conflictCol}") DO NOTHING`
    : `INSERT INTO public."${table}" (${colSql}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`;
  return { sql, values };
}

async function migrateTable(client, tok, table, { conflictCol = 'id', startOffset = 0, pageSize = 50 } = {}) {
  let from = startOffset;
  let inserted = 0;
  let skipped = 0;
  while (true) {
    const batch = await fetchPage(tok, table, from, pageSize);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const row of batch) {
      const { sql, values } = buildInsert(table, row, conflictCol);
      try {
        const r = await client.query(sql, values);
        if (r.rowCount) inserted++;
        else skipped++;
      } catch (e) {
        console.error(`  صف فشل في ${table}:`, e instanceof Error ? e.message : e);
      }
    }
    from += batch.length;
    process.stdout.write(`  ${from}... `);
    if (batch.length < pageSize) break;
    await sleep(100);
  }
  return { from, inserted, skipped };
}

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: DST_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const existing = await client.query('SELECT COUNT(*)::int c FROM public.leads');
const leadOffset = existing.rows[0].c;
console.log(`leads موجودة: ${leadOffset} — نكمل من هنا`);

const tok = await token();

console.log('⏳ leads');
const leads = await migrateTable(client, tok, 'leads', { startOffset: leadOffset, pageSize: 50 });
console.log(`\n  انتهى عند ${leads.from} — أُدرج ${leads.inserted} جديد`);

for (const [table, conflictCol] of [
  ['monthly_targets', 'rep_id'],
  ['closed_months', 'month_key'],
]) {
  console.log(`⏳ ${table}`);
  const r = await migrateTable(client, tok, table, { conflictCol, pageSize: 100 });
  console.log(`\n  أُدرج ${r.inserted}`);
}

const final = await client.query('SELECT COUNT(*)::int c FROM public.leads');
console.log(`\nإجمالي leads الآن: ${final.rows[0].c}`);
await client.end();
console.log('تم.');
