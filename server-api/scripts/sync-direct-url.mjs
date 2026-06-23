/**
 * إذا لم يكن DIRECT_URL موجوداً، ينسخ قيمة DATABASE_URL (سطر واحد في .env).
 * مع Supabase: بعد التشغيل استبدل DIRECT_URL برابط "Direct connection" من الموقع (انظر دليل-ربط-قاعدة-البيانات.md).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('لا يوجد ملف server-api/.env');
  process.exit(1);
}

let raw = fs.readFileSync(envPath, 'utf8');
if (/^\s*DIRECT_URL=/m.test(raw)) {
  process.exit(0);
}

const m = raw.match(/^DATABASE_URL=(.*)$/m);
if (!m) {
  console.error('لا يوجد DATABASE_URL في .env');
  process.exit(1);
}

let v = m[1].trim();
if (
  (v.startsWith('"') && v.endsWith('"')) ||
  (v.startsWith("'") && v.endsWith("'"))
) {
  v = v.slice(1, -1);
}

raw +=
  '\n# مُولَّد تلقائياً — إن كنت تستخدم Supabase غيّر السطر التالي إلى «Direct connection» من لوحة الموقع\n' +
  `DIRECT_URL="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;

fs.writeFileSync(envPath, raw);
console.log('تمت إضافة DIRECT_URL بنسخ DATABASE_URL. لو عندك Supabase افتح دليل-ربط-قاعدة-البيانات.md وعدّل DIRECT_URL.\n');
