/**
 * One-off: reset owner (مالك) password in Prisma DB.
 * Usage: node scripts/reset-owner-password.mjs "NewPasswordHere"
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { normalizeUserRole } from '../src/lib/normalizeUserRole.js';

const newPassword = String(process.argv[2] || '').trim();
if (!newPassword || newPassword.length < 8) {
  console.error('Usage: node scripts/reset-owner-password.mjs "<password min 8 chars>"');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const all = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
  });
  const owners = all.filter((u) => normalizeUserRole(u.role) === 'مالك');
  if (owners.length === 0) {
    console.error('No owner (مالك) user found in database.');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  for (const o of owners) {
    await prisma.user.update({ where: { id: o.id }, data: { passwordHash } });
    console.log(`Updated password for: ${o.email} (${o.name})`);
  }
} finally {
  await prisma.$disconnect();
}
