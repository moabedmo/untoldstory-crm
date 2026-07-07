/**
 * Package dist/ for `vercel deploy --prebuilt` (build on GitHub, skip Vercel npm build).
 * Requires VERCEL_ORG_ID + VERCEL_PROJECT_ID (same project that owns untoldstory.click).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, '.vercel', 'output');
const staticDir = path.join(out, 'static');
const orgId = String(process.env.VERCEL_ORG_ID || '').trim();
const projectId = String(process.env.VERCEL_PROJECT_ID || '').trim();

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[vercel-prebuilt] dist/index.html missing — run npm run build first');
  process.exit(1);
}

if (!orgId || !projectId) {
  console.error('[vercel-prebuilt] Missing VERCEL_ORG_ID or VERCEL_PROJECT_ID');
  process.exit(1);
}

const vercelDir = path.join(root, '.vercel');
fs.mkdirSync(vercelDir, { recursive: true });
fs.writeFileSync(
  path.join(vercelDir, 'project.json'),
  JSON.stringify({ orgId, projectId }, null, 2),
);
console.log('[vercel-prebuilt] project.json → orgId=%s projectId=%s', orgId, projectId);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(staticDir, { recursive: true });

for (const name of fs.readdirSync(dist)) {
  const from = path.join(dist, name);
  const to = path.join(staticDir, name);
  fs.cpSync(from, to, { recursive: true });
}

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log('[vercel-prebuilt] Ready:', out);
