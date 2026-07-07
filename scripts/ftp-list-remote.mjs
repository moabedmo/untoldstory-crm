import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'basic-ftp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnvDeploy() {
  const f = path.join(root, '.env.deploy');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvDeploy();

const client = new Client(60_000);
await client.access({
  host: process.env.FTP_SERVER.trim(),
  user: process.env.FTP_USERNAME.trim(),
  password: process.env.FTP_PASSWORD.trim(),
  secure: true,
  secureOptions: { rejectUnauthorized: false },
});

async function walk(dir, depth = 0) {
  if (depth > 4) return;
  console.log('\n' + '  '.repeat(depth) + dir + '/');
  await client.cd(dir);
  for (const e of await client.list()) {
    if (e.name === '.' || e.name === '..') continue;
    const mark = e.isDirectory ? '/' : '';
    console.log('  '.repeat(depth + 1) + e.name + mark + (e.size ? ` (${e.size}b)` : ''));
    if (e.isDirectory && depth < 3 && !e.name.startsWith('.')) {
      try {
        await walk(e.name, depth + 1);
        await client.cd('..');
      } catch {
        /* skip */
      }
    }
  }
}

console.log('pwd:', await client.pwd());
try {
  await walk('.');
} catch (e) {
  console.error(e.message);
}
client.close();
