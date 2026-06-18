/**
 * ينفّذ build ثم ينسخ للرفع على Hostinger فقط:
 * index.html + assets/ + .htaccess
 * (يتجاهل محتوى public الضخم مثل globaluntoldstory في dist)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'hostinger-dist');

/** Avoid fs.cpSync on some Windows paths (can crash with non-ASCII directories). */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

process.chdir(root);
const skipBuild = process.argv.includes('--skip-build');
if (!skipBuild) {
  execSync('npm run build', { stdio: 'inherit' });
} else if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[pack-hostinger] --skip-build but dist/index.html is missing');
  process.exit(1);
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[pack-hostinger] dist/index.html missing after build');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

fs.copyFileSync(path.join(dist, 'index.html'), path.join(out, 'index.html'));
copyDirRecursive(path.join(dist, 'assets'), path.join(out, 'assets'));

const ht = path.join(dist, '.htaccess');
if (fs.existsSync(ht)) {
  fs.copyFileSync(ht, path.join(out, '.htaccess'));
}

console.log('[pack-hostinger] Ready:', out);
console.log('  Upload everything inside hostinger-dist/ to public_html (or site root).');
