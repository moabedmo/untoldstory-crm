/**
 * Vercel Hobby: static SPA only (Express lives in server-api/, not /api).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.chdir(root);

execSync('npm run pack:hostinger', { stdio: 'inherit', env: process.env });

if (!fs.existsSync(path.join(root, 'hostinger-dist', 'index.html'))) {
  console.error('[vercel-build] hostinger-dist/index.html missing');
  process.exit(1);
}

console.log('[vercel-build] OK — static bundle in hostinger-dist/');
