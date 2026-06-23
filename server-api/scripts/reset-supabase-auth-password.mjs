/**
 * Reset Supabase Authentication password (Admin API).
 * Requires service_role key — NOT the anon key.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   node scripts/reset-supabase-auth-password.mjs admin@untold.com "Mohamed123456"
 *
 * Or add SUPABASE_SERVICE_ROLE_KEY to api/.env
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

for (const rel of ['.env.local', 'server-api/.env', '.env']) {
  const p = resolve(root, rel);
  if (existsSync(p)) dotenv.config({ path: p });
}

const email = String(process.argv[2] || 'admin@untold.com').trim().toLowerCase();
const password = String(process.argv[3] || '').trim();
const supabaseUrl = String(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
).replace(/\/$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!password || password.length < 8) {
  console.error('Usage: node scripts/reset-supabase-auth-password.mjs <email> "<password min 8>"');
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Get service_role from Supabase → Project Settings → API Keys → service_role (secret).',
  );
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function listUsers() {
  const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.msg || data.message || data.error_description || `list users HTTP ${r.status}`);
  }
  return Array.isArray(data.users) ? data.users : [];
}

async function createUser() {
  const r = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: 'المالك' },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.msg || data.message || data.error_description || `create user HTTP ${r.status}`);
  }
  return data;
}

async function updatePassword(userId) {
  const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.msg || data.message || data.error_description || `update user HTTP ${r.status}`);
  }
  return data;
}

try {
  const users = await listUsers();
  const match = users.find((u) => String(u.email || '').toLowerCase() === email);
  if (match?.id) {
    await updatePassword(match.id);
    console.log(`Supabase Auth password updated for: ${email} (id: ${match.id})`);
  } else {
    const created = await createUser();
    console.log(`Supabase Auth user created for: ${email} (id: ${created.id || created.user?.id || 'ok'})`);
    console.log('Ensure public.users has a row with the same email and role مالك.');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
