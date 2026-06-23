/**
 * تشغيل prisma generate بعد npm install؛ على ويندوز قد يفشل بـ EPERM إذا كان
 * query_engine لا يزال مستخدماً من عملية node (خادم الـAPI) — لا نفسد كل التثبيت.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const r = spawnSync('npx', ['prisma', 'generate'], {
  cwd: root,
  shell: win,
  encoding: 'utf8',
});

if (r.status === 0) process.exit(0);
const combined = `${r.stderr || ''}\n${r.stdout || ''}\n${r.error?.message || ''}`;
if (/EPERM|operation not permitted/i.test(combined)) {
  console.warn(
    '[api/postinstall] تعذّر prisma generate لأن ملفاً مقفولاً (غالباً خادم الـAPI شغّال). أوقف node ثم نفّذ من مجلد api: npx prisma generate'
  );
  process.exit(0);
}
if (combined.trim()) console.error(combined.trim());
process.exit(r.status ?? 1);
