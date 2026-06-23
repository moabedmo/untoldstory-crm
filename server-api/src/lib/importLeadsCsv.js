import { leadToJson } from './leadSerialize.js';
import { normalizeLeadPhone, leadPhoneDigitsKey } from './leadPhone.js';

function normPhone(p) {
  return leadPhoneDigitsKey(p);
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function parseLeadDateIso(raw) {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function placeholderImportEmail(rowKey) {
  const key = String(rowKey || 'row').replace(/[^\w-]/g, '').slice(0, 40);
  return `import-${key}-${Math.random().toString(36).slice(2, 8)}@lead.local`;
}

function placeholderImportPhone(rowKey) {
  const digits = String(rowKey || '0').replace(/\D/g, '').slice(-6).padStart(6, '0');
  const rnd = Math.floor(Math.random() * 90 + 10);
  return `0199${digits}${rnd}`.slice(0, 11);
}

/**
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {Array<object>} opts.rows
 * @param {string} opts.source e.g. linkedin
 * @param {string} opts.actorUserId
 * @param {string} opts.actorName
 * @param {string | null} [opts.routeToManagerId]
 */
export async function importLeadsCsvBatch(opts) {
  const { prisma, rows, source, actorUserId, actorName, routeToManagerId = null } = opts;
  const leadsOut = [];
  let created = 0;
  let skippedDuplicates = 0;
  let failed = 0;

  let managerName = 'مدير المبيعات';
  if (routeToManagerId) {
    const mu = await prisma.user.findUnique({ where: { id: routeToManagerId } });
    if (mu?.name) managerName = String(mu.name);
  }

  for (const row of rows) {
    let name = String(row.name || '').trim().slice(0, 200);
    const company = String(row.company || '—').trim().slice(0, 200);
    let phone = normalizeLeadPhone(String(row.phone || '').trim());
    let email = normEmail(row.email);
    const rowKey = row.linkedinRowIndex || name || company;
    if (!name) {
      name = company && company !== '—' ? company : 'عميل مستورد';
    }
    if (!name) {
      failed += 1;
      continue;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      email = placeholderImportEmail(rowKey);
    }
    if (!phone) {
      phone = placeholderImportPhone(rowKey);
    }

    const np = normPhone(phone);
    const ne = normEmail(email);
    const dup = await prisma.lead.findFirst({
      where: {
        OR: [
          ...(ne ? [{ email: ne }] : []),
          ...(np ? [{ phone }] : []),
        ],
      },
    });
    if (dup) {
      skippedDuplicates += 1;
      continue;
    }

    const leadDateIso = parseLeadDateIso(row.leadDate);
    const nowIso = leadDateIso || new Date().toISOString();
    const timeline = [];

    if (routeToManagerId) {
      timeline.push({
        id: `ev-r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        leadId: 'pending',
        action: `تحويل تلقائي إلى ${managerName}`,
        userId: 'sys',
        userName: 'استيراد CSV',
        createdAt: nowIso,
      });
    }

    timeline.push({
      id: `ev-csv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      leadId: 'pending',
      action: `استيراد CSV (${source})`,
      note: row.linkedinRowIndex ? `صف الملف: ${row.linkedinRowIndex}` : undefined,
      userId: actorUserId || 'sys',
      userName: actorName || 'استيراد CSV',
      createdAt: nowIso,
    });

    try {
      const createdRow = await prisma.lead.create({
        data: {
          customerCode: null,
          name,
          company,
          phone,
          email: ne,
          status: String(row.status || 'جديد'),
          budget: Math.max(0, Number(row.budget) || 0),
          companySize: String(row.companySize || 'صغير'),
          source: String(source || 'linkedin'),
          category: String(row.category || 'إعلانات'),
          score: Math.max(0, Math.min(100, Number(row.score) || 50)),
          slaStatus: 'مستقر',
          assignedToId: routeToManagerId || null,
          timelineJson: [],
          ...(leadDateIso ? { createdAt: new Date(leadDateIso), updatedAt: new Date(leadDateIso) } : {}),
        },
      });

      const fixedTimeline = timeline.map((t) => ({ ...t, leadId: createdRow.id }));
      fixedTimeline.push({
        id: `a-${createdRow.id}`,
        leadId: createdRow.id,
        action: 'إضافة الليد إلى النظام',
        userId: actorUserId || 'sys',
        userName: actorName || 'استيراد CSV',
        createdAt: new Date().toISOString(),
      });

      const updated = await prisma.lead.update({
        where: { id: createdRow.id },
        data: { timelineJson: fixedTimeline },
      });

      leadsOut.push(leadToJson(updated));
      created += 1;
    } catch {
      failed += 1;
    }
  }

  return { ok: true, created, skippedDuplicates, failed, leads: leadsOut };
}
