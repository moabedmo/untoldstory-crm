/**
 * فحص جدول custody_funds في Postgres (Supabase) — للتشخيص فقط.
 * الاستخدام: node scripts/inspect-custody-db.mjs
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
config({ path: path.join(root, 'server-api', '.env') });
config({ path: path.join(root, '.env.local') });

const prisma = new PrismaClient();

try {
  const rows = await prisma.custodyFundDoc.findMany({ orderBy: { updatedAt: 'desc' } });
  const byStatus = {};
  const list = [];
  for (const r of rows) {
    const doc = r.docJson && typeof r.docJson === 'object' ? r.docJson : {};
    const st = String(doc.status ?? '(no status)');
    byStatus[st] = (byStatus[st] || 0) + 1;
    list.push({
      id: r.id,
      status: st,
      title: String(doc.title ?? '').slice(0, 80),
      amount: doc.totalAmount ?? doc.total_amount ?? null,
      currency: doc.currency ?? 'EGP',
      createdBy: doc.createdByName ?? doc.created_by_name ?? doc.createdById ?? '',
      productionManager: doc.productionManagerName ?? doc.production_manager_name ?? '',
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    });
  }
  console.log(JSON.stringify({ total: rows.length, byStatus, rows: list }, null, 2));
} catch (e) {
  console.error('DB_ERROR:', e?.message || String(e));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
