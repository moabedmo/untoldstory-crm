/**
 * تحقّق سريع من سلامة المشروع قبل النشر أو بعد تغييرات كبيرة.
 * لا يعتمد على قاعدة بيانات (عدا prisma validate الذي يقرأ المخطط فقط).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

console.log('[verify] prisma validate …');
run('npm exec prisma validate', path.join(root, 'server-api'));
console.log('[verify] done.');
