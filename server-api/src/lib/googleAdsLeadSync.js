/**
 * Pull Lead Form Extension submissions via Google Ads API (googleAds:search).
 * Requires: OAuth (google_ads in integration-tokens), GOOGLE_ADS_DEVELOPER_TOKEN,
 * and optionally GOOGLE_ADS_LOGIN_CUSTOMER_ID for MCC.
 */
import fs from 'node:fs';
import { getIntegrationTokenStorePath } from './integrationTokenPath.js';
import { persistTokens } from './integrationsOAuthEngine.js';
import { leadToJson } from './leadSerialize.js';
import { normalizeLeadPhone } from './leadPhone.js';

const API_VER = () => process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v17';

function readGoogleAdsBundle(userId) {
  const p = getIntegrationTokenStorePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const all = JSON.parse(raw);
    return all[userId]?.google_ads || null;
  } catch {
    return null;
  }
}

async function ensureFreshGoogleAccessToken(userId, bundle) {
  if (!bundle?.refresh_token) return bundle?.access_token || null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: bundle.refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return bundle.access_token || null;
  persistTokens(getIntegrationTokenStorePath(), userId, 'google_ads', {
    access_token: data.access_token,
    refresh_token: bundle.refresh_token,
    expires_in: data.expires_in ?? null,
  });
  return data.access_token;
}

function googleAdsHeaders(accessToken, loginCustomerId) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || '',
  };
  if (loginCustomerId) h['login-customer-id'] = String(loginCustomerId).replace(/\D/g, '');
  return h;
}

async function googlePostJson(url, headers, bodyObj) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.details?.[0]?.errors?.[0]?.message ||
      data?.error?.status ||
      `google_ads_${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function parseSubmissionFields(fields) {
  const map = {};
  const push = (name, val) => {
    const n = String(name || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    const v = String(val || '').trim();
    if (n && v) map[n] = v;
  };

  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (!f || typeof f !== 'object') continue;
      const name = f.fieldName || f.field_name || f.question || f.name || '';
      const val = f.fieldValue || f.field_value || f.answer || f.value || '';
      push(name, val);
    }
  } else if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields)) {
      push(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  const email =
    map.email ||
    map.work_email ||
    map.business_email ||
    map['e-mail'] ||
    map.email_address ||
    '';
  const phone =
    map.phone_number ||
    map.phone ||
    map.mobile ||
    map.mobile_phone ||
    map.phone_number_with_country_code ||
    '';
  const fullName =
    map.full_name ||
    map.name ||
    map.first_name ||
    (map.first_name && map.last_name ? `${map.first_name} ${map.last_name}`.trim() : '') ||
    '';
  const company = map.company_name || map.company || map.business_name || map.organization || '';
  return { email, phone, fullName, company, raw: map };
}

function submissionRowId(row) {
  const d = row.leadFormSubmissionData || row.lead_form_submission_data || row;
  const id = d?.id ?? d?.resourceName?.split('/')?.pop?.() ?? '';
  return id ? String(id) : '';
}

function submissionPayload(row) {
  return row.leadFormSubmissionData || row.lead_form_submission_data || row;
}

async function persistGoogleImportedLead(opts) {
  const {
    prisma,
    routeToManagerId,
    actorUserId,
    actorName,
    name,
    company,
    phone,
    email,
    sourceLine,
    nowIso,
    refNote,
  } = opts;

  const createdRow = await prisma.lead.create({
    data: {
      customerCode: null,
      name,
      company,
      phone,
      email,
      status: 'جديد',
      budget: 0,
      companySize: 'صغير',
      source: sourceLine,
      category: 'إعلانات',
      score: 58,
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
    action: 'استيراد حقيقي من Google Ads (Lead Form)',
    note: refNote,
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
  return leadToJson(updated);
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {string | null} [opts.routeToManagerId]
 * @param {string} [opts.actorUserId]
 * @param {string} [opts.actorName]
 * @param {number} [opts.maxLeadsTotal]
 */
export async function syncGoogleAdsLeadFormsForOwner(opts) {
  const { userId, prisma, routeToManagerId = null, actorUserId = 'sys', actorName = 'المالك', maxLeadsTotal = 80 } = opts;
  const devTok = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!devTok) {
    return {
      ok: false,
      code: 'no_dev_token',
      created: 0,
      leads: [],
      messageAr: 'لم يُضبط GOOGLE_ADS_DEVELOPER_TOKEN في بيئة الخادم (مطلوب لـ Google Ads API).',
    };
  }

  let bundle = readGoogleAdsBundle(userId);
  if (!bundle?.access_token && !bundle?.refresh_token) {
    return {
      ok: false,
      code: 'no_token',
      created: 0,
      leads: [],
      messageAr: 'لم يُعثر على توكن Google Ads. اربط Google Ads من الإعدادات ثم أعد المحاولة.',
    };
  }

  let accessToken = await ensureFreshGoogleAccessToken(userId, bundle);
  if (!accessToken) accessToken = bundle.access_token;
  if (!accessToken) {
    return {
      ok: false,
      code: 'no_token',
      created: 0,
      leads: [],
      messageAr: 'تعذر تجديد توكن Google. أعد ربط Google Ads من الإعدادات.',
    };
  }

  bundle = readGoogleAdsBundle(userId) || bundle;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || '';
  const headers = googleAdsHeaders(accessToken, loginCustomerId);
  const ver = API_VER();

  let customerIds = [];
  const forced = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim();
  if (forced) {
    customerIds = [forced.replace(/^customers\//i, '').replace(/\D/g, '')].filter(Boolean);
  } else {
    let listRes;
    try {
      listRes = await fetch(`https://googleads.googleapis.com/${ver}/customers:listAccessibleCustomers`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': devTok,
          ...(loginCustomerId ? { 'login-customer-id': loginCustomerId.replace(/\D/g, '') } : {}),
        },
      });
      const listData = await listRes.json().catch(() => ({}));
      if (!listRes.ok) {
        return {
          ok: false,
          code: 'google_ads_customers',
          created: 0,
          leads: [],
          messageAr: `تعذر قراءة حسابات Google Ads: ${listData?.error?.message || listRes.status}`,
        };
      }
      const names = Array.isArray(listData.resourceNames) ? listData.resourceNames : [];
      customerIds = names
        .map((rn) => String(rn).replace(/^customers\//i, '').replace(/\D/g, ''))
        .filter(Boolean)
        .slice(0, 5);
    } catch (e) {
      return {
        ok: false,
        code: 'google_ads_customers',
        created: 0,
        leads: [],
        messageAr: `تعذر قراءة حسابات Google Ads: ${e.message}`,
      };
    }
  }

  if (customerIds.length === 0) {
    return {
      ok: true,
      code: 'no_customers',
      created: 0,
      leads: [],
      messageAr: 'لا توجد حسابات Google Ads يمكن الوصول إليها بهذا التوكن.',
    };
  }

  const query = `
    SELECT
      lead_form_submission_data.resource_name,
      lead_form_submission_data.id,
      lead_form_submission_data.campaign,
      lead_form_submission_data.submission_date_time,
      lead_form_submission_data.lead_form_submission_fields
    FROM lead_form_submission_data
    ORDER BY lead_form_submission_data.submission_date_time DESC
    LIMIT ${Math.max(1, Math.min(100, maxLeadsTotal + 20))}
  `
    .replace(/\s+/g, ' ')
    .trim();

  const leadsOut = [];
  let created = 0;
  let skippedDuplicates = 0;
  let apiErrors = 0;

  outer: for (const cid of customerIds) {
    let searchRes;
    try {
      searchRes = await googlePostJson(
        `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`,
        headers,
        { query, pageSize: Math.min(100, maxLeadsTotal + 20) },
      );
    } catch (e) {
      if (e.status === 401) {
        const refreshed = await ensureFreshGoogleAccessToken(userId, readGoogleAdsBundle(userId) || bundle);
        if (refreshed) {
          const h2 = googleAdsHeaders(refreshed, loginCustomerId);
          try {
            searchRes = await googlePostJson(
              `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`,
              h2,
              { query, pageSize: Math.min(100, maxLeadsTotal + 20) },
            );
          } catch {
            apiErrors += 1;
            continue;
          }
        } else {
          apiErrors += 1;
          continue;
        }
      } else {
        apiErrors += 1;
        continue;
      }
    }

    const results = Array.isArray(searchRes?.results) ? searchRes.results : [];
    for (const row of results) {
      if (created >= maxLeadsTotal) break outer;
      const payload = submissionPayload(row);
      const sid = submissionRowId(row);
      const fields =
        payload?.leadFormSubmissionFields ||
        payload?.lead_form_submission_fields ||
        payload?.customLeadFormSubmissionFields ||
        [];
      const parsed = parseSubmissionFields(fields);
      let email = (parsed.email || '').toLowerCase().trim();
      let phone = normalizeLeadPhone((parsed.phone || '').replace(/\s+/g, '').trim());
      const name = (parsed.fullName || 'عميل إعلان').trim().slice(0, 200) || 'عميل إعلان';
      const company = (parsed.company || `Google Ads — ${cid}` || '—').trim().slice(0, 200) || '—';
      if (!email && !phone) {
        email = `lead-${sid || created}@google-ads-lead.local`.toLowerCase();
      }
      if (!phone) phone = '01000000000';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        email = `lead-${sid || created}@google-ads-lead.local`.toLowerCase();
      }

      const dup = await prisma.lead.findFirst({
        where: { OR: [{ email }, { phone }] },
      });
      if (dup) {
        skippedDuplicates += 1;
        continue;
      }

      const subTime = payload?.submissionDateTime || payload?.submission_date_time;
      const nowIso = subTime ? new Date(String(subTime).replace(/\+00:00$/, 'Z')).toISOString() : new Date().toISOString();
      const campaign = payload?.campaign || payload?.campaignResourceName || '';
      const sourceLine = `Google Ads Lead Form — حساب ${cid}`;
      const refNote = `Customer: ${cid} — Submission: ${sid || '—'} — Campaign: ${String(campaign).slice(0, 120)}`;

      const json = await persistGoogleImportedLead({
        prisma,
        routeToManagerId,
        actorUserId,
        actorName,
        name,
        company,
        phone,
        email,
        sourceLine,
        nowIso,
        refNote,
      });
      leadsOut.push(json);
      created += 1;
    }
  }

  return {
    ok: true,
    code: 'google_ads',
    created,
    skippedDuplicates,
    graphErrors: apiErrors,
    leads: leadsOut,
    messageAr:
      created > 0
        ? `تم استيراد ${created} ليد حقيقي من Google Ads (Lead Form).`
        : apiErrors > 0
          ? 'لم يُستورد ليد جديد. تحقق من Developer Token أو صلاحيات الحساب أو عدم تكرار البيانات.'
          : 'لا توجد إرساليات Lead Form جديدة في الحساب (أو كلها مكررة).',
  };
}
