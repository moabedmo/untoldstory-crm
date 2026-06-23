/**
 * Pull real Lead Ads submissions from Meta Graph API (Facebook / Instagram forms on Pages).
 * Requires OAuth token stored after owner connects Facebook + scopes including leads_retrieval.
 */
import fs from 'node:fs';
import { getIntegrationTokenStorePath } from './integrationTokenPath.js';
import { leadToJson } from './leadSerialize.js';
import { normalizeLeadPhone } from './leadPhone.js';

const GRAPH = () => process.env.META_GRAPH_VERSION || 'v21.0';

function readFacebookUserAccessToken(userId) {
  const p = getIntegrationTokenStorePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const all = JSON.parse(raw);
    return (
      all[userId]?.facebook?.access_token ||
      all[userId]?.instagram?.access_token ||
      null
    );
  } catch {
    return null;
  }
}

async function graphGet(url) {
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.error_user_msg || `graph_${res.status}`;
    const err = new Error(msg);
    err.graph = data?.error;
    throw err;
  }
  return data;
}

/** field_data: [{ name, values: [string] }, ...] */
export function parseLeadgenFieldData(fieldData) {
  const map = {};
  if (!Array.isArray(fieldData)) return map;
  for (const row of fieldData) {
    const n = String(row?.name || '').toLowerCase().replace(/\s+/g, '_');
    const v = Array.isArray(row?.values) && row.values[0] != null ? String(row.values[0]).trim() : '';
    if (n && v) map[n] = v;
  }
  const email =
    map.email ||
    map.work_email ||
    map.business_email ||
    map['e-mail'] ||
    '';
  const phone =
    map.phone_number ||
    map.phone ||
    map.mobile ||
    map.mobile_phone ||
    map.work_phone ||
    '';
  const fullName =
    map.full_name ||
    (map.first_name || map.last_name
      ? `${map.first_name || ''} ${map.last_name || ''}`.trim()
      : '') ||
    map.name ||
    '';
  const company = map.company_name || map.company || map.business_name || map.organization || '';
  return { email, phone, fullName, company, raw: map };
}

/** @returns {'facebook'|'instagram'} */
export function resolveMetaLeadSource(platform, formName, pageName) {
  const p = String(platform || '').toLowerCase();
  if (p === 'ig' || p === 'instagram' || p.includes('instagram')) return 'instagram';
  if (p === 'fb' || p === 'facebook') return 'facebook';
  const blob = `${pageName || ''} ${formName || ''}`.toLowerCase();
  if (/instagram|\binsta\b|\big\b/.test(blob)) return 'instagram';
  return 'facebook';
}

/**
 * @param {object} opts
 * @param {string} opts.userId - JWT sub / owner id (token file key)
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {string | null} [opts.routeToManagerId]
 * @param {string} [opts.actorUserId]
 * @param {string} [opts.actorName]
 * @param {number} [opts.maxLeadsTotal] default 80
 */
export async function syncMetaLeadAdsForOwner(opts) {
  const { userId, prisma, routeToManagerId = null, actorUserId = 'sys', actorName = 'تكامل Meta', maxLeadsTotal = 80 } = opts;
  const userToken = readFacebookUserAccessToken(userId);
  if (!userToken) {
    return { ok: false, code: 'no_token', created: 0, leads: [], messageAr: 'لم يُعثر على توكن فيسبوك. اربط فيسبوك من الإعدادات ثم أعد المحاولة.' };
  }

  const version = GRAPH();
  let pages;
  try {
    pages = await graphGet(
      `https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(userToken)}`,
    );
  } catch (e) {
    return {
      ok: false,
      code: 'graph_pages',
      created: 0,
      leads: [],
      messageAr: `تعذر قراءة صفحات فيسبوك: ${e.message}`,
    };
  }

  const pageList = Array.isArray(pages?.data) ? pages.data : [];
  if (pageList.length === 0) {
    return {
      ok: true,
      code: 'no_pages',
      created: 0,
      leads: [],
      messageAr: 'لا توجد صفحات مرتبطة بالحساب. تأكد من منح صلاحيات الصفحات عند الربط.',
    };
  }

  const leadsOut = [];
  let created = 0;
  let skippedDuplicates = 0;
  let graphErrors = 0;

  outer: for (const page of pageList) {
    const pageId = page.id;
    const pageName = page.name || pageId;
    const pageToken = page.access_token;
    if (!pageToken) continue;

    let formsRes;
    try {
      formsRes = await graphGet(
        `https://graph.facebook.com/${version}/${pageId}/leadgen_forms?fields=id,name,status&limit=40&access_token=${encodeURIComponent(pageToken)}`,
      );
    } catch {
      graphErrors += 1;
      continue;
    }

    const forms = Array.isArray(formsRes?.data) ? formsRes.data : [];
    for (const form of forms) {
      const formId = form.id;
      const formName = form.name || formId;
      let leadsRes;
      try {
        leadsRes = await graphGet(
          `https://graph.facebook.com/${version}/${formId}/leads?fields=id,created_time,field_data,platform&limit=50&access_token=${encodeURIComponent(pageToken)}`,
        );
      } catch {
        graphErrors += 1;
        continue;
      }

      const rows = Array.isArray(leadsRes?.data) ? leadsRes.data : [];
      for (const row of rows) {
        if (created >= maxLeadsTotal) break outer;
        const parsed = parseLeadgenFieldData(row.field_data);
        let email = (parsed.email || '').toLowerCase().trim();
        let phone = normalizeLeadPhone((parsed.phone || '').replace(/\s+/g, '').trim());
        const name = (parsed.fullName || 'عميل إعلان').trim().slice(0, 200) || 'عميل إعلان';
        const company = (parsed.company || pageName || '—').trim().slice(0, 200) || '—';
        if (!email && !phone) {
          email = `lead-${String(row.id)}@meta-lead.local`.toLowerCase();
        }
        if (!phone) {
          phone = '01000000000';
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          email = `lead-${String(row.id)}@meta-lead.local`.toLowerCase();
        }

        const dup = await prisma.lead.findFirst({
          where: { OR: [{ email }, { phone }] },
        });
        if (dup) {
          skippedDuplicates += 1;
          continue;
        }

        const sourceLine = resolveMetaLeadSource(row.platform, formName, pageName);
        const nowIso = row.created_time ? new Date(row.created_time).toISOString() : new Date().toISOString();
        const budget = 0;
        const category = 'إعلانات';
        const companySize = 'صغير';
        const score = 55;

        const createdRow = await prisma.lead.create({
          data: {
            customerCode: null,
            name,
            company,
            phone,
            email,
            status: 'جديد',
            budget,
            companySize,
            source: sourceLine,
            category,
            score,
            slaStatus: 'مستقر',
            assignedToId: routeToManagerId || null,
            timelineJson: [],
          },
        });

        const importedEvents = [];
        if (routeToManagerId) {
          const mu = await prisma.user.findUnique({ where: { id: routeToManagerId } });
          const managerName = mu?.name ? String(mu.name) : 'مدير المبيعات';
          importedEvents.push({
            id: `ev-r-${createdRow.id}`,
            leadId: createdRow.id,
            action: `تحويل تلقائي إلى ${managerName}`,
            userId: 'sys',
            userName: 'تكامل المصادر',
            createdAt: nowIso,
          });
        }
        importedEvents.push({
          id: `ev-s-${createdRow.id}`,
          leadId: createdRow.id,
          action: `استيراد حقيقي من إعلان ميتا (Lead ID: ${row.id})`,
          note: `الصفحة: ${pageName} — النموذج: ${formName}`,
          userId: 'sys',
          userName: 'تكامل المصادر',
          createdAt: nowIso,
        });
        const firstActivity = {
          id: `a-${createdRow.id}`,
          leadId: createdRow.id,
          action: 'إضافة الليد إلى النظام',
          userId: actorUserId,
          userName: actorName,
          createdAt: new Date().toISOString(),
        };
        const timelineJson = [...importedEvents, firstActivity];
        const updated = await prisma.lead.update({
          where: { id: createdRow.id },
          data: { timelineJson },
        });

        leadsOut.push(leadToJson(updated));
        created += 1;
      }
    }
  }

  return {
    ok: true,
    code: 'meta_graph',
    created,
    skippedDuplicates,
    graphErrors,
    leads: leadsOut,
    messageAr:
      created > 0
        ? `تم استيراد ${created} ليد حقيقي من إعلانات ميتا (فيسبوك/إنستجرام).`
        : graphErrors > 0
          ? 'لم يُستورد ليد جديد. تحقق من صلاحيات النموذج أو عدم تكرار البيانات.'
          : 'لا توجد ليدز جديدة من النماذج (أو كلها مكررة).',
  };
}
