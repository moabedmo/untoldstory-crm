/**
 * Standalone OAuth listener (dev). Same logic as Express route `api/src/routes/integrationsOAuth.routes.js`.
 * Prefer in production: mount API only and set VITE_API_URL / OAUTH_PUBLIC_BASE_URL on the server.
 */
import dotenv from 'dotenv';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { processIntegrationsOAuthRequest } from '../server-api/src/lib/integrationsOAuthEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

for (const p of [
  path.join(PROJECT_ROOT, '.env'),
  path.join(PROJECT_ROOT, 'server-api', '.env'),
  path.join(PROJECT_ROOT, '.env.local'),
]) {
  try {
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  } catch {
    /* ignore */
  }
}

const PORT = Number(process.env.OAUTH_SERVER_PORT || 8787);
const HOST = process.env.OAUTH_SERVER_HOST || '127.0.0.1';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';
const OAUTH_PUBLIC_BASE_URL = (
  process.env.OAUTH_PUBLIC_BASE_URL?.trim() || `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`
).replace(/\/+$/, '');

const TOKEN_STORE = path.join(__dirname, '.integration-tokens.json');
const stateStore = new Map();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'oauth-server',
        at: new Date().toISOString(),
        publicBase: OAUTH_PUBLIC_BASE_URL,
      }),
    );
    return;
  }
  const out = await processIntegrationsOAuthRequest({
    method: req.method,
    pathname: u.pathname,
    searchParams: u.searchParams,
    oauthPublicBase: OAUTH_PUBLIC_BASE_URL,
    appOrigin: APP_ORIGIN,
    stateStore,
    tokenStorePath: TOKEN_STORE,
  });

  if (out.kind === 'redirect') {
    res.writeHead(302, { Location: out.location });
    res.end();
    return;
  }
  res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out.body));
});

server.listen(PORT, HOST, () => {
  console.log(`[oauth-server] listening on http://${HOST}:${PORT}`);
  console.log(`[oauth-server] public OAuth base (redirect_uri): ${OAUTH_PUBLIC_BASE_URL}`);
  console.log(`[oauth-server] SPA callback default APP_ORIGIN: ${APP_ORIGIN}`);
  console.log(`[oauth-server] token file: ${TOKEN_STORE}`);
});
