async function resolveGoogleAdsAuth() {
  const sd = $getWorkflowStaticData('global');
  let accessToken = '';
  let devTok = String(sd.googleAdsDeveloperToken || '').trim();
  let loginCustomerId = String(sd.googleAdsLoginCustomerId || '').replace(/\D/g, '');
  let forcedCustomerId = String(sd.googleAdsCustomerId || '').replace(/\D/g, '');
  try {
    const g = await this.getCredentials('googleAdsOAuth2Api');
    accessToken = String(g.oauthTokenData?.access_token || g.accessToken || g.access_token || '').trim();
    devTok = devTok || String(g.developerToken || g.developer_token || '').trim();
    const cid = g.customerId || g.customer_id || g.loginCustomerId;
    if (cid && !forcedCustomerId) forcedCustomerId = String(cid).replace(/\D/g, '');
    const login = g.loginCustomerId || g.managerCustomerId;
    if (login && !loginCustomerId) loginCustomerId = String(login).replace(/\D/g, '');
  } catch (_) {}
  return { accessToken, devTok, loginCustomerId, forcedCustomerId };
}

const { accessToken, devTok, loginCustomerId, forcedCustomerId } = await resolveGoogleAdsAuth.call(this);
const sd = $getWorkflowStaticData('global');
const ver = String(sd.googleAdsApiVersion || 'v17').trim();
const MAX = Math.min(100, Math.max(1, Number(sd.googleAdsMaxPerRun || 80)));

if (!accessToken) {
  throw new Error('ربط Google Ads: Credentials → Google Ads OAuth2 API على عقدة Fetch ثم Connect');
}
if (!devTok) {
  throw new Error('أضف Developer Token في Credential أو في Workflow Static Data: googleAdsDeveloperToken');
}

if (!Array.isArray(sd.processedGoogleAdsIds)) sd.processedGoogleAdsIds = [];
const processed = new Set(sd.processedGoogleAdsIds);

function adsHeaders(token) {
  const h = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'developer-token': devTok,
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}

async function adsGet(url, token) {
  return await this.helpers.httpRequest({
    method: 'GET',
    url,
    headers: adsHeaders(token),
    json: true,
    timeout: 60000,
  });
}

async function adsSearch(customerId, token) {
  const query = `
    SELECT
      lead_form_submission_data.resource_name,
      lead_form_submission_data.id,
      lead_form_submission_data.campaign,
      lead_form_submission_data.submission_date_time,
      lead_form_submission_data.lead_form_submission_fields
    FROM lead_form_submission_data
    ORDER BY lead_form_submission_data.submission_date_time DESC
    LIMIT ${MAX + 30}
  `
    .replace(/\s+/g, ' ')
    .trim();
  return await this.helpers.httpRequest({
    method: 'POST',
    url: `https://googleads.googleapis.com/${ver}/customers/${customerId}/googleAds:search`,
    headers: adsHeaders(token),
    body: { query, pageSize: MAX + 30 },
    json: true,
    timeout: 90000,
  });
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
      push(f.fieldName || f.field_name || f.question || f.name, f.fieldValue || f.field_value || f.answer || f.value);
    }
  }
  const email = map.email || map.work_email || map.business_email || map.email_address || '';
  const phone = map.phone_number || map.phone || map.mobile || map.mobile_phone || '';
  const fullName = map.full_name || map.name || map.first_name || '';
  const company = map.company_name || map.company || map.business_name || '';
  return { email, phone, fullName, company };
}

let customerIds = [];
if (forcedCustomerId) {
  customerIds = [forcedCustomerId];
} else {
  const listData = await adsGet.call(
    this,
    `https://googleads.googleapis.com/${ver}/customers:listAccessibleCustomers`,
    accessToken,
  );
  const names = Array.isArray(listData.resourceNames) ? listData.resourceNames : [];
  customerIds = names
    .map((rn) => String(rn).replace(/^customers\//i, '').replace(/\D/g, ''))
    .filter(Boolean)
    .slice(0, 8);
}

const out = [];
let apiErrors = 0;

for (const cid of customerIds) {
  let searchRes;
  try {
    searchRes = await adsSearch.call(this, cid, accessToken);
  } catch {
    apiErrors += 1;
    continue;
  }
  const results = Array.isArray(searchRes?.results) ? searchRes.results : [];
  for (const row of results) {
    if (out.length >= MAX) break;
    const payload = row.leadFormSubmissionData || row.lead_form_submission_data || row;
    const sid = payload?.id != null ? String(payload.id) : '';
    const dedupeKey = sid ? `${cid}-${sid}` : '';
    if (dedupeKey && processed.has(dedupeKey)) continue;

    const fields = payload?.leadFormSubmissionFields || payload?.lead_form_submission_fields || [];
    const parsed = parseSubmissionFields(fields);
    let email = (parsed.email || '').toLowerCase().trim();
    let phone = (parsed.phone || '').replace(/\s+/g, '').trim();
    const name = ((parsed.fullName || '').trim() || 'عميل Google Ads').slice(0, 200);
    const company = ((parsed.company || `Google Ads — ${cid}`).trim() || '—').slice(0, 200);
    if (!email && !phone) email = `lead-${sid || Date.now()}@google-ads-lead.local`;
    if (!phone) phone = '01000000000';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = `lead-${sid || Date.now()}@google-ads-lead.local`;

    const subTime = payload?.submissionDateTime || payload?.submission_date_time;
    const createdAt = subTime ? new Date(String(subTime)).toISOString() : new Date().toISOString();
    const campaign = String(payload?.campaign || '').slice(0, 120);

    out.push({
      google_ads_submission_id: dedupeKey || sid,
      google_ads_customer_id: cid,
      name,
      company,
      phone,
      email,
      source: 'google',
      campaign,
      created_time: createdAt,
    });
    if (dedupeKey) processed.add(dedupeKey);
  }
  if (out.length >= MAX) break;
}

sd.processedGoogleAdsIds = Array.from(processed).slice(-3000);

if (out.length === 0) {
  return [
    {
      json: {
        _summary: true,
        fetched: 0,
        customers: customerIds.length,
        api_errors: apiErrors,
        message:
          customerIds.length === 0
            ? 'No accessible Google Ads customers. Check OAuth + Developer Token.'
            : 'No new lead form submissions (or all already processed).',
      },
    },
  ];
}

return out.map((item) => ({ json: item }));
