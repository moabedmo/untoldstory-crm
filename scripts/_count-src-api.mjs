#!/usr/bin/env node
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
const EMAIL = process.env.SRC_OWNER_EMAIL || 'admin@untold.com';
const PASS = process.env.SRC_OWNER_PASSWORD || 'UntoldAccess2026!';

const TABLES = [
  'leads', 'price_quotes', 'invoices', 'expenses', 'manual_journal_entries',
  'monthly_targets', 'attendance_records', 'audit_events', 'custody_funds',
  'shoot_bookings', 'equipment_bookings', 'meeting_bookings', 'manual_customers', 'closed_months',
];

const r = await fetch(`${SRC_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SRC_ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const { access_token: tok } = await r.json();

for (const t of TABLES) {
  const res = await fetch(`${SRC_URL}/rest/v1/${t}?select=id`, {
    method: 'HEAD',
    headers: { apikey: SRC_ANON, Authorization: `Bearer ${tok}`, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range');
  const count = range ? range.split('/')[1] : '?';
  console.log(t, count, res.status);
}
