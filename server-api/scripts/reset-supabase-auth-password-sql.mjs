/**
 * Reset Supabase Auth password via direct SQL (same DB as Prisma).
 * Use when VITE_USE_SUPABASE=1 — Prisma password_hash is NOT used for login.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = String(process.argv[2] || 'admin@untold.com').trim().toLowerCase();
const password = String(process.argv[3] || '').trim();

if (!password || password.length < 8) {
  console.error('Usage: node scripts/reset-supabase-auth-password-sql.mjs <email> "<password>"');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const hash = await bcrypt.hash(password, 10);
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE auth.users
     SET encrypted_password = $1,
         updated_at = now()
     WHERE email = $2`,
    hash,
    email,
  );
  if (Number(updated) === 0) {
    console.error(`No auth.users row for: ${email}`);
    process.exit(1);
  }
  console.log(`Supabase Auth password set for: ${email}`);

  const profile = await prisma.$queryRawUnsafe(
    `SELECT id, email, name, role FROM public.users WHERE email = $1 LIMIT 1`,
    email,
  );
  if (!Array.isArray(profile) || profile.length === 0) {
    console.warn('Warning: no public.users profile row for this email — login may fail after Auth.');
  } else {
    console.log('public.users profile:', profile[0]);
  }
} finally {
  await prisma.$disconnect();
}
