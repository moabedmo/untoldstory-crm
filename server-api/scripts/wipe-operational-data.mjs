/**
 * مسح بيانات التجربة من قاعدة البيانات — يبقي حسابات الموظفين (users) وإعدادات المالك.
 *
 * الاستخدام:
 *   node api/scripts/wipe-operational-data.mjs --dry-run
 *   CONFIRM_WIPE=YES node api/scripts/wipe-operational-data.mjs
 *   CONFIRM_WIPE=YES node api/scripts/wipe-operational-data.mjs --scope=finance
 *
 * --scope=finance  → فقط المالية (افتراضي): فواتير، مصروفات، قيود، عهد، عروض أسعار، أشهر مقفلة
 * --scope=all      → المالية + ليدز + عملاء + حجوزات + حضور + سجل تدقيق (يتطلب --include-leads)
 * --include-leads  → مطلوب صراحةً مع --scope=all لمسح الليدز
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
config({ path: path.join(apiRoot, '.env') });

const prisma = new PrismaClient();

const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: '1010', name: 'الصندوق/البنك', type: 'asset', isSystem: true },
  { code: '1150', name: 'عهدة إنتاج (أمانة)', type: 'asset', isSystem: true },
  { code: '1120', name: 'العملاء (ذمم مدينة)', type: 'asset', isSystem: true },
  { code: '2110', name: 'الموردون (ذمم دائنة)', type: 'liability', isSystem: true },
  { code: '2210', name: 'ضريبة قيمة مضافة مخرجات', type: 'liability', isSystem: true },
  { code: '1220', name: 'ضريبة قيمة مضافة مدخلات', type: 'asset', isSystem: true },
  { code: '4110', name: 'إيراد خدمات', type: 'revenue', isSystem: true },
  { code: '5110', name: 'مصروف تشغيل', type: 'expense', isSystem: true },
];

const DEFAULT_CUSTODY_MAP = {
  رواتب: '5110',
  إيجارات: '5110',
  معدات: '5110',
  تسويق: '5110',
  تشغيل: '5110',
  ضيافة: '5110',
  نثريات: '5110',
  أخرى: '5110',
};

const FINANCE_WORKSPACE_RESET = {
  chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
  payrollApprovals: [],
  payrollApprovalRequests: [],
  financialReopenRequests: [],
  closedFiscalYears: [],
  openingBalancesByYear: {},
  payrollSalesDiscounts: [],
  expenseSavedViews: [],
  entityComments: {},
  expenseEscalations: [],
  journalCodebook: [],
  expenseCodebook: [],
  otherBookings: [],
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const scopeArg = args.find((a) => a.startsWith('--scope='));
const scopeRaw = scopeArg?.split('=')[1] || 'finance';
const includeLeads = args.includes('--include-leads');
const scope = scopeRaw === 'all' ? 'all' : 'finance';

async function counts() {
  const [
    users,
    leads,
    manualCustomers,
    invoices,
    expenses,
    priceQuotes,
    journals,
    custodyFunds,
    closedMonths,
    auditEvents,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    attendanceRecords,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.lead.count(),
    prisma.manualCustomer.count(),
    prisma.invoice.count(),
    prisma.expense.count(),
    prisma.priceQuote.count(),
    prisma.manualJournalEntry.count(),
    prisma.custodyFundDoc.count(),
    prisma.closedMonth.count(),
    prisma.auditEvent.count(),
    prisma.shootBookingDoc.count(),
    prisma.equipmentBookingDoc.count(),
    prisma.meetingBookingDoc.count(),
    prisma.attendanceRecord.count(),
  ]);
  return {
    users,
    leads,
    manualCustomers,
    invoices,
    expenses,
    priceQuotes,
    journals,
    custodyFunds,
    closedMonths,
    auditEvents,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    attendanceRecords,
  };
}

async function resetWorkspaceFinance(doc) {
  const base = doc && typeof doc === 'object' ? { ...doc } : {};
  for (const [k, v] of Object.entries(FINANCE_WORKSPACE_RESET)) {
    base[k] = v;
  }
  return base;
}

async function wipeFinance(tx) {
  await tx.$executeRawUnsafe('UPDATE price_quotes SET invoice_id = NULL WHERE invoice_id IS NOT NULL');
  await tx.$executeRawUnsafe('UPDATE invoices SET price_quote_id = NULL WHERE price_quote_id IS NOT NULL');
  const invoices = await tx.invoice.deleteMany();
  const quotes = await tx.priceQuote.deleteMany();
  const expenses = await tx.expense.deleteMany();
  const journals = await tx.manualJournalEntry.deleteMany();
  const custody = await tx.custodyFundDoc.deleteMany();
  const closed = await tx.closedMonth.deleteMany();
  return { invoices, quotes, expenses, journals, custody, closed };
}

async function wipeAllOperational(tx) {
  const finance = await wipeFinance(tx);
  const leads = await tx.lead.deleteMany();
  const customers = await tx.manualCustomer.deleteMany();
  const audit = await tx.auditEvent.deleteMany();
  const shoot = await tx.shootBookingDoc.deleteMany();
  const equip = await tx.equipmentBookingDoc.deleteMany();
  const meet = await tx.meetingBookingDoc.deleteMany();
  const attendance = await tx.attendanceRecord.deleteMany();
  return { ...finance, leads, customers, audit, shoot, equip, meet, attendance };
}

try {
  const before = await counts();
  console.log(JSON.stringify({ phase: 'before', scope, includeLeads, counts: before }, null, 2));

  if (dryRun) {
    console.log('\n[dry-run] لم يُحذف شيء. للتنفيذ: CONFIRM_WIPE=YES node api/scripts/wipe-operational-data.mjs');
    process.exit(0);
  }

  if (process.env.CONFIRM_WIPE !== 'YES') {
    console.error('\n⚠️  عملية خطيرة. أعد التشغيل مع: CONFIRM_WIPE=YES');
    console.error('   معاينة: node api/scripts/wipe-operational-data.mjs --dry-run');
    process.exit(1);
  }

  if (scope === 'all' && !includeLeads) {
    console.error('\n⚠️  --scope=all يمسح الليدز والحجوزات. للتأكيد أضف: --include-leads');
    console.error('   لمسح الحسابات/المالية فقط (بدون ليدز): node api/scripts/wipe-operational-data.mjs');
    console.error('   أو: CONFIRM_WIPE=YES node api/scripts/wipe-operational-data.mjs --scope=finance');
    process.exit(1);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const result =
      scope === 'finance' ? await wipeFinance(tx) : await wipeAllOperational(tx);

    const ws = await tx.workspaceState.findUnique({ where: { id: 'default' } });
    const nextDoc = await resetWorkspaceFinance(ws?.docJson);
    await tx.workspaceState.upsert({
      where: { id: 'default' },
      create: { id: 'default', docJson: nextDoc },
      update: { docJson: nextDoc },
    });

    await tx.accountingPolicy.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        policyNotes: '',
        allowedCostCentersJson: [],
        minAmountHighlight: 0,
      },
      update: {
        policyNotes: '',
        allowedCostCentersJson: [],
        minAmountHighlight: 0,
      },
    });

    await tx.custodySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', custodyAccountMapJson: DEFAULT_CUSTODY_MAP },
      update: { custodyAccountMapJson: DEFAULT_CUSTODY_MAP },
    });

    return result;
  });

  const after = await counts();
  console.log(JSON.stringify({ phase: 'done', scope, deleted, countsAfter: after }, null, 2));
  console.log('\n✓ تم المسح. حدّث الموقع (Refresh from server) وامسح كاش المتصفح إن لزم.');
  if (scope === 'finance') {
    console.log('  تم الإبقاء على: الليدز + حسابات الموظفين + إعدادات المالك.');
  } else {
    console.log('  ما زال موجوداً: حسابات الموظفين (users) + أهداف المبيعات (monthly_targets) + إعدادات المالك في workspace.');
  }
} catch (e) {
  console.error('WIPE_ERROR:', e?.message || String(e));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
