/**
 * Shared OAuth logic for Meta / Google / LinkedIn (used by Express API and optional standalone oauth-server).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROVIDERS = new Set(['meta-facebook', 'meta-instagram', 'google-ads', 'meta-whatsapp', 'linkedin']);

export function mapProviderToClient(provider) {
  const map = {
    'meta-facebook': 'facebook',
    'meta-instagram': 'instagram',
    'google-ads': 'google_ads',
    'meta-whatsapp': 'whatsapp',
    linkedin: 'linkedin',
  };
  return map[provider] || provider;
}

function base64UrlToBuffer(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4;
  if (pad) b += '='.repeat(4 - pad);
  return Buffer.from(b, 'base64');
}

export function verifyJwtHs256(token, secret) {
  if (!token || !secret || secret.length < 16) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    if (expected !== sig) return null;
    const payload = JSON.parse(base64UrlToBuffer(p).toString('utf8'));
    if (payload.exp && Number(payload.exp) * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

export function pruneStates(stateStore, ttlMs = 15 * 60 * 1000) {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) {
    if (now - v.created > ttlMs) stateStore.delete(k);
  }
}

export function oauthConfigured(provider) {
  const meta = !!(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
  const google = !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  const linkedin = !!(process.env.LINKEDIN_CLIENT_ID?.trim() && process.env.LINKEDIN_CLIENT_SECRET?.trim());
  if (provider === 'meta-facebook' || provider === 'meta-instagram' || provider === 'meta-whatsapp') return meta;
  if (provider === 'google-ads') return google;
  if (provider === 'linkedin') return linkedin;
  return false;
}

export function missingEnvMessage(provider) {
  if (provider === 'meta-facebook' || provider === 'meta-instagram' || provider === 'meta-whatsapp') {
    return 'ضبط META_APP_ID و META_APP_SECRET في البيئة (تطبيق Meta للمطورين).';
  }
  if (provider === 'google-ads') return 'ضبط GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET (Google Cloud Console).';
  if (provider === 'linkedin') return 'ضبط LINKEDIN_CLIENT_ID و LINKEDIN_CLIENT_SECRET (LinkedIn Developers).';
  return 'مفاتيح OAuth غير مضبوطة لهذا المزود.';
}

export function redirectToSpa(callbackBase, params) {
  const u = new URL(callbackBase);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function persistTokens(tokenStorePath, userKey, providerForClient, payload) {
  let all = {};
  try {
    const raw = fs.readFileSync(tokenStorePath, 'utf8');
    all = JSON.parse(raw);
  } catch {
    all = {};
  }
  if (!all[userKey]) all[userKey] = {};
  all[userKey][providerForClient] = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(tokenStorePath), { recursive: true });
  fs.writeFileSync(tokenStorePath, JSON.stringify(all, null, 2), 'utf8');
}

const META_GRAPH_VERSION = () => process.env.META_GRAPH_VERSION || 'v21.0';

export function buildAuthorizeUrl(provider, state, redirectUri) {
  if (provider === 'meta-facebook') {
    const scopes =
      process.env.META_OAUTH_SCOPES_FACEBOOK?.trim() ||
      'pages_show_list,pages_read_engagement,ads_read,leads_retrieval,business_management';
    const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth`);
    u.searchParams.set('client_id', process.env.META_APP_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes);
    return u.toString();
  }

  if (provider === 'meta-instagram') {
    const scopes =
      process.env.META_OAUTH_SCOPES_INSTAGRAM?.trim() ||
      'instagram_basic,instagram_manage_insights,pages_show_list,ads_read,leads_retrieval,business_management';
    const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth`);
    u.searchParams.set('client_id', process.env.META_APP_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes);
    return u.toString();
  }

  if (provider === 'meta-whatsapp') {
    const scopes =
      process.env.META_OAUTH_SCOPES_WHATSAPP?.trim() ||
      'whatsapp_business_management,business_management';
    const u = new URL(`https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth`);
    u.searchParams.set('client_id', process.env.META_APP_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes);
    return u.toString();
  }

  if (provider === 'google-ads') {
    const scope = (
      process.env.GOOGLE_OAUTH_SCOPES?.trim() ||
      [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/adwords',
      ].join(' ')
    ).trim();
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scope);
    u.searchParams.set('state', state);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    return u.toString();
  }

  if (provider === 'linkedin') {
    const scopes =
      process.env.LINKEDIN_OAUTH_SCOPES?.trim() || 'openid profile email r_ads_reporting';
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('scope', scopes);
    return u.toString();
  }

  return null;
}

async function exchangeMetaCode(redirectUri, code) {
  const u = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION()}/oauth/access_token`);
  u.searchParams.set('client_id', process.env.META_APP_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('client_secret', process.env.META_APP_SECRET);
  u.searchParams.set('code', code);
  const res = await fetch(u.toString(), { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error_description || `meta_token_${res.status}`);
  }
  if (!data.access_token) throw new Error('meta_token_missing_access_token');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: data.expires_in,
  };
}

async function exchangeGoogleCode(redirectUri, code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `google_token_${res.status}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: data.expires_in,
  };
}

async function exchangeLinkedInCode(redirectUri, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `linkedin_token_${res.status}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: data.expires_in,
  };
}

async function metaAccountLabel(accessToken) {
  const u = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION()}/me`);
  u.searchParams.set('fields', 'id,name');
  u.searchParams.set('access_token', accessToken);
  const res = await fetch(u.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'meta_me_failed');
  return data.name || data.id || 'meta-connected';
}

async function googleAccountLabel(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'google_userinfo_failed');
  return data.email || data.name || data.id || 'google-connected';
}

async function linkedinAccountLabel(accessToken) {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'linkedin_userinfo_failed');
  return data.name || data.email || data.sub || 'linkedin-connected';
}

export async function exchangeAndLabel(provider, redirectUri, code) {
  if (provider === 'meta-facebook' || provider === 'meta-instagram' || provider === 'meta-whatsapp') {
    const tok = await exchangeMetaCode(redirectUri, code);
    const label = await metaAccountLabel(tok.access_token);
    return { ...tok, label };
  }
  if (provider === 'google-ads') {
    const tok = await exchangeGoogleCode(redirectUri, code);
    const label = await googleAccountLabel(tok.access_token);
    return { ...tok, label };
  }
  if (provider === 'linkedin') {
    const tok = await exchangeLinkedInCode(redirectUri, code);
    const label = await linkedinAccountLabel(tok.access_token);
    return { ...tok, label };
  }
  throw new Error('unknown_provider');
}

/** Derive public API base URL for OAuth redirect_uri (Express: trust X-Forwarded-* behind reverse proxy). */
export function oauthPublicBaseFromExpressReq(req) {
  const forced = process.env.OAUTH_PUBLIC_BASE_URL?.trim();
  if (forced) return forced.replace(/\/+$/, '');
  const xfProto = req.get('x-forwarded-proto');
  const xfHost = req.get('x-forwarded-host');
  const proto = (xfProto || req.protocol || 'http').split(',')[0].trim();
  const host = (xfHost || req.get('host') || '').split(',')[0].trim();
  if (!host) return 'http://127.0.0.1:4000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * @param {{
 *   method: string;
 *   pathname: string;
 *   searchParams: URLSearchParams;
 *   oauthPublicBase: string;
 *   appOrigin: string;
 *   stateStore: Map<string, { callback: string; provider: string; providerForClient: string; jwtSub: string | null; created: number }>;
 *   tokenStorePath: string;
 * }} ctx
 * @returns {Promise<{ kind: 'redirect'; location: string } | { kind: 'json'; status: number; body: object }>}
 */
export async function processIntegrationsOAuthRequest(ctx) {
  const { method, pathname, searchParams, oauthPublicBase, appOrigin, stateStore, tokenStorePath } = ctx;
  const methodU = (method || 'GET').toUpperCase();

  if (methodU === 'GET' && pathname === '/api/integrations/health') {
    return {
      kind: 'json',
      status: 200,
      body: { ok: true, service: 'integrations-oauth', at: new Date().toISOString(), publicBase: oauthPublicBase },
    };
  }

  const authMatch = pathname.match(/^\/api\/integrations\/auth\/([^/]+)\/start$/);
  if (methodU === 'GET' && authMatch) {
    pruneStates(stateStore);
    const provider = authMatch[1];
    if (!PROVIDERS.has(provider)) {
      return { kind: 'json', status: 404, body: { ok: false, error: 'unknown_provider' } };
    }

    const callback = searchParams.get('callback') || `${appOrigin}/`;
    const integrationJwt = searchParams.get('integration_jwt');
    let jwtSub = null;
    const jwtSecret = process.env.JWT_SECRET;
    if (integrationJwt && jwtSecret) {
      const payload = verifyJwtHs256(integrationJwt, jwtSecret);
      jwtSub = payload?.sub ? String(payload.sub) : null;
    }

    const providerForClient = mapProviderToClient(provider);

    if (!oauthConfigured(provider)) {
      const loc = redirectToSpa(callback, {
        integration_provider: providerForClient,
        integration_status: 'error',
        integration_error: missingEnvMessage(provider),
      });
      return { kind: 'redirect', location: loc };
    }

    const state = randomState();
    const redirectUri = `${oauthPublicBase}/api/integrations/auth/${provider}/callback`;
    stateStore.set(state, {
      callback,
      provider,
      providerForClient,
      jwtSub,
      created: Date.now(),
    });

    const authUrl = buildAuthorizeUrl(provider, state, redirectUri);
    if (!authUrl) return { kind: 'json', status: 500, body: { ok: false, error: 'authorize_url_failed' } };
    return { kind: 'redirect', location: authUrl };
  }

  const callbackMatch = pathname.match(/^\/api\/integrations\/auth\/([^/]+)\/callback$/);
  if (methodU === 'GET' && callbackMatch) {
    pruneStates(stateStore);
    const provider = callbackMatch[1];
    if (!PROVIDERS.has(provider)) {
      return { kind: 'json', status: 404, body: { ok: false, error: 'unknown_provider' } };
    }

    const err = searchParams.get('error');
    const errDesc = searchParams.get('error_description') || searchParams.get('error_reason');
    const state = searchParams.get('state');
    const code = searchParams.get('code');

    const st = state ? stateStore.get(state) : null;
    const fallbackCallback = `${appOrigin}/`;
    const callback = st?.callback || fallbackCallback;
    const providerForClient = st?.providerForClient || mapProviderToClient(provider);

    if (err) {
      const loc = redirectToSpa(callback, {
        integration_provider: providerForClient,
        integration_status: 'error',
        integration_error: errDesc || err,
      });
      if (state) stateStore.delete(state);
      return { kind: 'redirect', location: loc };
    }

    if (!st || !code) {
      const loc = redirectToSpa(callback, {
        integration_provider: providerForClient,
        integration_status: 'error',
        integration_error: 'oauth_state_or_code_missing',
      });
      return { kind: 'redirect', location: loc };
    }

    stateStore.delete(state);

    const redirectUri = `${oauthPublicBase}/api/integrations/auth/${provider}/callback`;

    try {
      const bundle = await exchangeAndLabel(provider, redirectUri, code);
      const userKey = st.jwtSub || 'anonymous';
      persistTokens(tokenStorePath, userKey, providerForClient, {
        access_token: bundle.access_token,
        refresh_token: bundle.refresh_token,
        expires_in: bundle.expires_in ?? null,
      });

      const expiresAt =
        bundle.expires_in != null
          ? new Date(Date.now() + Number(bundle.expires_in) * 1000).toISOString()
          : new Date(Date.now() + 1000 * 60 * 60 * 24 * 55).toISOString();

      const loc = redirectToSpa(st.callback, {
        integration_provider: providerForClient,
        integration_status: 'success',
        integration_account: bundle.label,
        integration_expires_at: expiresAt,
      });
      return { kind: 'redirect', location: loc };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'token_exchange_failed';
      const loc = redirectToSpa(st.callback, {
        integration_provider: providerForClient,
        integration_status: 'error',
        integration_error: msg,
      });
      return { kind: 'redirect', location: loc };
    }
  }

  const webhookSecret = String(process.env.INTEGRATION_WEBHOOK_SECRET || '').trim();
  const verifyIntegrationWebhook = () => {
    if (!webhookSecret) {
      return process.env.NODE_ENV !== 'production';
    }
    const hdr =
      String(req.headers['x-webhook-secret'] || req.headers['x-integration-secret'] || '').trim() ||
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    return hdr === webhookSecret;
  };

  if (methodU === 'POST' && pathname === '/api/integrations/webhooks/meta') {
    if (!verifyIntegrationWebhook()) {
      return { kind: 'json', status: 401, body: { ok: false, error: 'unauthorized_webhook' } };
    }
    return { kind: 'json', status: 200, body: { ok: true, message: 'Meta webhook received' } };
  }
  if (methodU === 'POST' && pathname === '/api/integrations/webhooks/google-ads') {
    if (!verifyIntegrationWebhook()) {
      return { kind: 'json', status: 401, body: { ok: false, error: 'unauthorized_webhook' } };
    }
    return { kind: 'json', status: 200, body: { ok: true, message: 'Google Ads webhook received' } };
  }
  if (methodU === 'POST' && pathname === '/api/integrations/webhooks/linkedin') {
    if (!verifyIntegrationWebhook()) {
      return { kind: 'json', status: 401, body: { ok: false, error: 'unauthorized_webhook' } };
    }
    return { kind: 'json', status: 200, body: { ok: true, message: 'LinkedIn webhook received' } };
  }
  if (methodU === 'POST' && pathname === '/api/integrations/webhooks/whatsapp') {
    if (!verifyIntegrationWebhook()) {
      return { kind: 'json', status: 401, body: { ok: false, error: 'unauthorized_webhook' } };
    }
    return { kind: 'json', status: 200, body: { ok: true, message: 'WhatsApp webhook received' } };
  }

  return { kind: 'json', status: 404, body: { ok: false, error: 'not_found', path: pathname } };
}
