#!/usr/bin/env node
/**
 * نسخ auth.users + auth.identities من مشروع Supabase قديم إلى جديد (نفس كلمات المرور).
 * يتطلب OLD_DIRECT_URL و NEW_DIRECT_URL في .env.migrate
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const rel of ['.env.migrate', '.env.local']) {
  const p = join(root, rel);
  if (existsSync(p)) config({ path: p });
}

const OLD_URL = String(process.env.OLD_DIRECT_URL || '').trim();
const NEW_URL = String(process.env.NEW_DIRECT_URL || '').trim();
const CONFIRM = String(process.env.CONFIRM_MIGRATE || '').trim() === 'YES';

if (!OLD_URL || !NEW_URL) {
  console.error('❌ عيّن OLD_DIRECT_URL و NEW_DIRECT_URL في .env.migrate');
  process.exit(1);
}
if (!CONFIRM) {
  console.error('❌ CONFIRM_MIGRATE=YES مطلوب');
  process.exit(1);
}

const { default: pg } = await import('pg');
const oldClient = new pg.Client({ connectionString: OLD_URL });
const newClient = new pg.Client({ connectionString: NEW_URL });

const USER_COLS = [
  'instance_id',
  'id',
  'aud',
  'role',
  'email',
  'encrypted_password',
  'email_confirmed_at',
  'invited_at',
  'confirmation_token',
  'confirmation_sent_at',
  'recovery_token',
  'recovery_sent_at',
  'email_change_token_new',
  'email_change',
  'email_change_sent_at',
  'last_sign_in_at',
  'raw_app_meta_data',
  'raw_user_meta_data',
  'is_super_admin',
  'created_at',
  'updated_at',
  'phone',
  'phone_confirmed_at',
  'phone_change',
  'phone_change_token',
  'phone_change_sent_at',
  'email_change_token_current',
  'email_change_confirm_status',
  'banned_until',
  'reauthentication_token',
  'reauthentication_sent_at',
  'is_sso_user',
  'deleted_at',
  'is_anonymous',
];

try {
  await oldClient.connect();
  await newClient.connect();

  const { rows: users } = await oldClient.query(
    `SELECT ${USER_COLS.map((c) => `"${c}"`).join(', ')} FROM auth.users WHERE deleted_at IS NULL`,
  );
  console.log(`⏳ نسخ ${users.length} مستخدم Auth ...`);

  await newClient.query('SET session_replication_role = replica');
  let copied = 0;
  for (const u of users) {
    const cols = USER_COLS.filter((c) => u[c] !== undefined);
    const vals = cols.map((c) => u[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colSql = cols.map((c) => `"${c}"`).join(', ');
    try {
      await newClient.query(
        `INSERT INTO auth.users (${colSql}) VALUES (${ph})
         ON CONFLICT (id) DO UPDATE SET
           encrypted_password = EXCLUDED.encrypted_password,
           email = EXCLUDED.email,
           email_confirmed_at = COALESCE(EXCLUDED.email_confirmed_at, auth.users.email_confirmed_at),
           updated_at = EXCLUDED.updated_at`,
        vals,
      );
      copied++;
    } catch (e) {
      console.warn(`  ⚠ تخطي ${u.email}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const { rows: identities } = await oldClient.query(`SELECT * FROM auth.identities`);
  let idCopied = 0;
  for (const id of identities) {
    const cols = Object.keys(id);
    const vals = cols.map((c) => id[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colSql = cols.map((c) => `"${c}"`).join(', ');
    try {
      await newClient.query(
        `INSERT INTO auth.identities (${colSql}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
        vals,
      );
      idCopied++;
    } catch {
      /* skip */
    }
  }
  await newClient.query('SET session_replication_role = DEFAULT');

  console.log(`✓ Auth users: ${copied}/${users.length}`);
  console.log(`✓ Auth identities: ${idCopied}/${identities.length}`);
  console.log('\nجرّب الدخول بنفس البريد وكلمة المرور القديمة (مثلاً admin@untold.com).');
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await oldClient.end().catch(() => {});
  await newClient.end().catch(() => {});
}
