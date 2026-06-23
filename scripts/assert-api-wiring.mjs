/**
 * تأكيد أن كل mount في api/src/index.js له ملف frontend في src/lib/api يستخدم نفس بادئة المسار.
 * لا يحتاج خادماً أو قاعدة بيانات.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'server-api', 'src', 'index.js');
const apiSrcDir = path.join(root, 'src', 'lib', 'api');

const indexContent = fs.readFileSync(indexPath, 'utf8');
/** @type {string[]} */
const mounts = [...indexContent.matchAll(/app\.use\('(\/api\/[^']+)'/g)].map((m) => m[1]);

/** Mounts opened by the browser / redirects — no fetch() client module required */
const wiringSkipMounts = new Set(['/api/integrations']);

/** map path prefix → expected substring in any .ts fetch string */
const pathToNeedle = (p) =>
  ({
    '/api/leads': '/api/leads',
    '/api/users': '/api/users',
    '/api/manual-customers': '/api/manual-customers',
    '/api/invoices': '/api/invoices',
    '/api/expenses': '/api/expenses',
    '/api/price-quotes': '/api/price-quotes',
    '/api/manual-journals': '/api/manual-journals',
    '/api/accounting-policy': '/api/accounting-policy',
    '/api/closed-months': '/api/closed-months',
    '/api/monthly-targets': '/api/monthly-targets',
    '/api/custody-settings': '/api/custody-settings',
    '/api/audit-events': '/api/audit-events',
    '/api/custody-funds': '/api/custody-funds',
    '/api/shoot-bookings': '/api/shoot-bookings',
    '/api/equipment-bookings': '/api/equipment-bookings',
    '/api/meeting-bookings': '/api/meeting-bookings',
    '/api/workspace-state': '/api/workspace-state',
    '/api/attendance-records': '/api/attendance-records',
  }[p]);

const tsFiles = fs.readdirSync(apiSrcDir).filter((f) => f.endsWith('.ts'));
const blobs = {};
for (const f of tsFiles) {
  blobs[f] = fs.readFileSync(path.join(apiSrcDir, f), 'utf8');
}

let failed = false;
for (const mount of mounts) {
  if (wiringSkipMounts.has(mount)) {
    console.log(`[wiring] OK ${mount} (browser OAuth — no src/lib/api client)`);
    continue;
  }
  const needle = pathToNeedle(mount);
  if (!needle) {
    console.error(`[wiring] مسار غير مُعرّف في الخريطة: ${mount}`);
    failed = true;
    continue;
  }
  let hitFile = '';
  for (const [file, blob] of Object.entries(blobs)) {
    if (blob.includes(needle)) {
      hitFile = file;
      break;
    }
  }
  if (!hitFile) {
    console.error(`[wiring] لم يُعثر على أي استدعاء واجهة لـ ${mount} ضمن src/lib/api/*.ts`);
    failed = true;
  } else {
    console.log(`[wiring] OK ${mount} ← ${hitFile}`);
  }
}

const pathsInFront = new Set();
for (const blob of Object.values(blobs)) {
  for (const m of blob.matchAll(/\/api\/[a-z0-9-/]+/g)) {
    let seg = m[0].replace(/\/+$/, '');
    pathsInFront.add(seg);
  }
}
for (const p of pathsInFront) {
  const hit = mounts.some((m) => p === m || p.startsWith(`${m}/`));
  if (!hit) console.warn(`[wiring] ⚠ استدعاء واجهة لـ «${p}» لا يبدأ من مسار mount معروف`);
}

process.exit(failed ? 1 : 0);
