/**
 * يتحقق من وجود DATABASE_URL و DIRECT_URL قبل أوامر Prisma (رسائل بالعربي).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('\n❌ ملف server-api/.env غير موجود.\n   انسخ server-api/.env.example إلى server-api/.env واملأه (انظر: دليل-ربط-قاعدة-البيانات.md)\n');
  process.exit(1);
}

const poolUrl = process.env.DATABASE_URL || '';
if (!poolUrl.trim()) {
  console.error('\n❌ ناقص سطر DATABASE_URL في ملف server-api/.env\n');
  process.exit(1);
}

const db = process.env.DIRECT_URL;
if (!db || !String(db).trim()) {
  console.error('\n❌ ناقص سطر DIRECT_URL في ملف server-api/.env\n');
  console.error('   من Supabase: إعدادات المشروع → Database → انسخ "Direct connection".\n');
  console.error('   لو قاعدة البيانات على جهازك بدون Supabase: انسخ نفس رابط DATABASE_URL في DIRECT_URL (سطرين زي بعض).\n');
  console.error('   شرح مفصل: دليل-ربط-قاعدة-البيانات.md\n');
  process.exit(1);
}

if (/pooler|6543/i.test(poolUrl) && poolUrl.trim() === db.trim()) {
  console.warn(
    '\n⚠️  تنبيه: DIRECT_URL نفس رابط الـ pooler (6543).\n' +
      '   أوامر مثل «تحديث الجداول» (db:migrate) غالباً هتفشل أو تعلق.\n' +
      '   افتح Supabase → Database → انسخ "Direct connection" واستبدل DIRECT_URL في server-api/.env\n' +
      '   (الشرح في الملف: دليل-ربط-قاعدة-البيانات.md)\n'
  );
} else {
  console.log('✓ إعداد قاعدة البيانات في .env يبدو صحيحاً (DATABASE_URL + DIRECT_URL).\n');
}

process.exit(0);
