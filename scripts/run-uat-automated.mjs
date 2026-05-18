#!/usr/bin/env node
/**
 * فحص UAT آلي (بناء + سيناريوهات نظام + typecheck).
 * السيناريوهات اليدوية 1–17 تبقى في UAT_CHECKLIST_AR.md.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log('\n▶', cmd, args.join(' '));
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('=== UAT آلي — Untold Story ===\n');
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'check:system']);
run('npm', ['run', 'build']);
console.log('\n✅ الفحص الآلي اكتمل. نفّذ السيناريوهات 1–17 يدوياً من UAT_CHECKLIST_AR.md');
