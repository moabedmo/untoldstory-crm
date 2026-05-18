#!/usr/bin/env node
/**
 * استيراد workflow إشعار العميل إلى n8n عبر REST API (إن وُجدت بيانات الاتصال).
 *
 * المتغيرات (من .env.local أو البيئة):
 * - N8N_BASE_URL  مثل https://n8n.example.com
 * - N8N_API_KEY   مفتاح API من n8n → Settings → API
 *
 * بعد الاستيراد: فعّل الـ workflow وانسخ Production URL من عقدة Webhook
 * إلى VITE_CLIENT_NOTIFY_WEBHOOK_URL أو إعدادات النظام.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(relPath) {
  const p = join(root, relPath);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const local = loadEnvFile('.env.local');
const base = (process.env.N8N_BASE_URL || local.N8N_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.N8N_API_KEY || local.N8N_API_KEY || '';

if (!base || !apiKey) {
  console.log('[n8n] N8N_BASE_URL أو N8N_API_KEY غير معيّن — استورد يدوياً:');
  console.log('  n8n → Workflows → Import → n8n/client-notify.workflow.json');
  console.log('  ثم فعّل الـ workflow وانسخ رابط Production webhook إلى .env.local:');
  console.log('  VITE_CLIENT_NOTIFY_WEBHOOK_URL=https://YOUR_N8N/webhook/client-notify');
  process.exit(0);
}

const workflowPath = join(root, 'n8n', 'client-notify.workflow.json');
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'));

const res = await fetch(`${base}/api/v1/workflows`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  },
  body: JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
    staticData: workflow.staticData || null,
  }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('[n8n] فشل الاستيراد:', res.status, data.message || data);
  process.exit(1);
}

const id = data.id;
if (id) {
  await fetch(`${base}/api/v1/workflows/${id}/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': apiKey },
  }).catch(() => {});
}

console.log('[n8n] ✅ تم استيراد workflow:', workflow.name);
console.log('[n8n] Webhook (Production):', `${base}/webhook/client-notify`);
console.log('[n8n] أضف إلى .env.local → VITE_CLIENT_NOTIFY_WEBHOOK_URL=' + `${base}/webhook/client-notify`);
