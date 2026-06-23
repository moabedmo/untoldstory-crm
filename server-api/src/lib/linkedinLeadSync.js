/**
 * Pull Lead Gen Form responses from LinkedIn Marketing API (v2).
 * Requires OAuth token (integration-tokens.json) with scopes including r_ads_reporting.
 */
import fs from 'node:fs';
import { getIntegrationTokenStorePath } from './integrationTokenPath.js';
import { persistTokens } from './integrationsOAuthEngine.js';
import { leadToJson } from './leadSerialize.js';
import { normalizeLeadPhone } from './leadPhone.js';

function readLinkedInBundle(userId) {
  const p = getIntegrationTokenStorePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const all = JSON.parse(raw);
    return all[userId]?.linkedin || null;
  } catch {
    return null;
  }
}

async function linkedinRefreshAccessToken(userId, bundle) {
  if (!bundle?.refresh_token) return bundle?.access_token || null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: bundle.refresh_token,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return bundle.access_token || null;
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || bundle.refresh_token,
    expires_in: data.expires_in ?? null,
  };
  persistTokens(getIntegrationTokenStorePath(), userId, 'linkedin', next);
  return data.access_token;
}

async function liGet(accessToken, url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || data.errorDetail || `linkedin_${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractStringsFromLeadResponse(el) {
  const out = [];
  function walk(n, depth) {
    if (depth > 12 || n == null) return;
    if (typeof n === 'string') {
      const t = n.trim();
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(n)) {
      for (const x of n) walk(x, depth + 1);
      return;
    }
    if (typeof n !== 'object') return;
    if (typeof n.textAnswer === 'string') walk(n.textAnswer, depth + 1);
    if (typeof n.emailAddress === 'string') walk(n.emailAddress, depth + 1);
    if (typeof n.phoneNumber === 'string') walk(n.phoneNumber, depth + 1);
    if (typeof n.answer === 'string') walk(n.answer, depth + 1);
    for (const v of Object.values(n)) {
      if (v && (typeof v === 'object' || typeof v === 'string')) walk(v, depth + 1);
    }
  }
  walk(el, 0);
  return out;
}

function parseLinkedInStrings(strings) {
  let email = '';
  let phone = '';
  let fullName = '';
  const joined = strings.join(' | ');
  for (const s of strings) {
    const low = s.toLowerCase();
    if (!email && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) email = s.trim().toLowerCase();
    else if (!phone && /^[\d+\-\s().]{7,}$/.test(s.replace(/\s/g, ''))) phone = s.replace(/\s+/g, '').trim();
    else if (!fullName && s.length > 2 && !/^\d+$/.test(s) && !s.includes('@')) fullName = s.trim();
  }
  if (!fullName && strings[0]) fullName = strings[0].trim();
  return { email, phone, fullName, joined };
}

async function persistLinkedInImportedLead(opts) {
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
      score: 55,
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
    action: 'استيراد حقيقي من لينكد إن (Lead Gen)',
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
export async function syncLinkedInLeadGenForOwner(opts) {
  const { userId, prisma, routeToManagerId = null, actorUserId = 'sys', actorName = 'المالك', maxLeadsTotal = 80 } = opts;
  let bundle = readLinkedInBundle(userId);
  let accessToken = bundle?.access_token || null;
  if (!accessToken) {
    return {
      ok: false,
      code: 'no_token',
      created: 0,
      leads: [],
      messageAr: 'لم يُعثر على توكن لينكد إن. اربط لينكد إن من الإعدادات ثم أعد المحاولة.',
    };
  }

  let accountsRes;
  try {
    accountsRes = await liGet(
      accessToken,
      'https://api.linkedin.com/v2/adAccountsV2?q=search&search.type=ENTERPRISE&search.status=ACTIVE&count=15',
    );
  } catch (e) {
    if (e.status === 401 && bundle?.refresh_token) {
      accessToken = await linkedinRefreshAccessToken(userId, bundle);
      bundle = readLinkedInBundle(userId);
      if (accessToken) {
        try {
          accountsRes = await liGet(
            accessToken,
            'https://api.linkedin.com/v2/adAccountsV2?q=search&search.type=ENTERPRISE&search.status=ACTIVE&count=15',
          );
        } catch (e2) {
          return {
            ok: false,
            code: 'linkedin_api',
            created: 0,
            leads: [],
            messageAr: `تعذر قراءة حسابات الإعلانات على لينكد إن: ${e2.message}`,
          };
        }
      }
    }
    if (!accountsRes) {
      return {
        ok: false,
        code: 'linkedin_api',
        created: 0,
        leads: [],
        messageAr: `تعذر قراءة حسابات الإعلانات على لينكد إن: ${e.message}. تأكد من صلاحية r_ads_reporting وربط حساب إعلانات.`,
      };
    }
  }

  const accountElements = Array.isArray(accountsRes?.elements) ? accountsRes.elements : [];
  if (accountElements.length === 0) {
    return {
      ok: true,
      code: 'no_accounts',
      created: 0,
      leads: [],
      messageAr: 'لا توجد حسابات إعلانات نشطة مرتبطة بالتوكن. افتح Campaign Manager وتأكد من الصلاحيات.',
    };
  }

  const leadsOut = [];
  let created = 0;
  let skippedDuplicates = 0;
  let apiErrors = 0;

  outer: for (const acct of accountElements.slice(0, 8)) {
    const acctId = acct.id != null ? String(acct.id) : null;
    const acctName = acct.name || acct.localizedName || acctId || 'حساب إعلانات';
    if (!acctId) continue;
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${acctId}`);

    let formsRes;
    try {
      formsRes = await liGet(
        accessToken,
        `https://api.linkedin.com/v2/adLeadGenForms?q=account&account=${accountUrn}&count=25`,
      );
    } catch {
      apiErrors += 1;
      continue;
    }

    const forms = Array.isArray(formsRes?.elements) ? formsRes.elements : [];
    for (const form of forms.slice(0, 20)) {
      const formId = form.id != null ? String(form.id) : null;
      const formName = form.name || form.localizedName || formId || 'نموذج';
      if (!formId) continue;
      const formUrn = encodeURIComponent(`urn:li:leadGenForm:${formId}`);

      let respRes;
      try {
        respRes = await liGet(
          accessToken,
          `https://api.linkedin.com/v2/adLeadGenResponses?q=form&form=${formUrn}&count=50`,
        );
      } catch {
        apiErrors += 1;
        continue;
      }

      const rows = Array.isArray(respRes?.elements) ? respRes.elements : [];
      for (const row of rows) {
        if (created >= maxLeadsTotal) break outer;
        const rowId = row.id != null ? String(row.id) : `${formId}-${created}`;
        const strings = extractStringsFromLeadResponse(row);
        const parsed = parseLinkedInStrings(strings);
        let email = (parsed.email || '').toLowerCase().trim();
        let phone = normalizeLeadPhone((parsed.phone || '').replace(/\s+/g, '').trim());
        const name = (parsed.fullName || 'عميل إعلان').trim().slice(0, 200) || 'عميل إعلان';
        const company = (acctName || '—').trim().slice(0, 200) || '—';
        if (!email && !phone) {
          email = `lead-${rowId}@linkedin-lead.local`.toLowerCase();
        }
        if (!phone) phone = '01000000000';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          email = `lead-${rowId}@linkedin-lead.local`.toLowerCase();
        }

        const dup = await prisma.lead.findFirst({
          where: { OR: [{ email }, { phone }] },
        });
        if (dup) {
          skippedDuplicates += 1;
          continue;
        }

        const submittedAt = row.submittedAt != null ? new Date(Number(row.submittedAt)).toISOString() : new Date().toISOString();
        const sourceLine = `لينكد إن Lead Gen — ${String(acctName).slice(0, 80)} — ${String(formName).slice(0, 80)}`;
        const refNote = `حساب: ${acctName} — نموذج: ${formName} — Response ID: ${rowId}`;

        const json = await persistLinkedInImportedLead({
          prisma,
          routeToManagerId,
          actorUserId,
          actorName,
          name,
          company,
          phone,
          email,
          sourceLine,
          nowIso: submittedAt,
          refNote,
        });
        leadsOut.push(json);
        created += 1;
      }
    }
  }

  return {
    ok: true,
    code: 'linkedin_graph',
    created,
    skippedDuplicates,
    graphErrors: apiErrors,
    leads: leadsOut,
    messageAr:
      created > 0
        ? `تم استيراد ${created} ليد حقيقي من لينكد إن (Lead Gen).`
        : apiErrors > 0
          ? 'لم يُستورد ليد جديد. تحقق من صلاحيات الإعلانات أو عدم تكرار البيانات.'
          : 'لا توجد ردود جديدة على نماذج Lead Gen (أو كلها مكررة).',
  };
}
