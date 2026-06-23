#!/usr/bin/env node
/** اختبار مسار الإدراج (نفس شكل n8n) عبر Postgres + قراءة REST */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const api = loadEnv('server-api/.env');
const local = loadEnv('.env.local');
const url = api.DATABASE_URL;
const supabaseUrl = (local.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = local.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error('DATABASE_URL or VITE_SUPABASE_ANON_KEY missing');
  process.exit(1);
}

const { default: pg } = await import('pg');
const id = `lead_n8n_test_${Date.now()}`;
const phone = `0199${String(Date.now()).slice(-8)}`;
const email = `n8n-test-${Date.now()}@verify.local`;
const now = new Date().toISOString();
const assigned = 'u_5a2729fab2ec4aae';

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  `INSERT INTO leads (
    id, name, company, phone, email, status, assigned_to_id,
    budget, company_size, source, category, score, sla_status,
    timeline_json, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16
  )`,
  [
    id,
    'اختبار n8n',
    'شركة تجريبية',
    phone,
    email,
    'جديد',
    assigned,
    0,
    'صغير',
    'email',
    'إعلانات',
    55,
    'مستقر',
    JSON.stringify([
      {
        id: `ev-${id}`,
        leadId: id,
        action: 'استيراد من n8n (email)',
        userId: 'n8n',
        userName: 'تكامل',
        createdAt: now,
      },
    ]),
    now,
    now,
  ],
);
await client.end();
console.log('✅ INSERT عبر Postgres (نفس بنية n8n):', id);

const res = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&select=id,name,source,assigned_to_id`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}` },
});
const rows = await res.json();
if (res.ok && Array.isArray(rows) && rows[0]) {
  console.log('✅ قراءة عبر REST (anon):', rows[0]);
} else {
  console.log('⚠️  REST read:', res.status, rows);
}

const c2 = new pg.Client({ connectionString: url });
await c2.connect();
await c2.query('DELETE FROM leads WHERE id = $1', [id]);
await c2.end();
console.log('✅ حُذف السجل التجريبي');
