import { config } from 'dotenv';
config({ path: '.env.migrate' });

const URL = process.env.NEW_SUPABASE_URL;
const ANON = process.env.NEW_SUPABASE_ANON_KEY;

const accounts = [
  ["admin@untold.com", "UntoldAccess2026!"],
  ["abdelrahmanelhelaly@globaluntoldstory.com", "Untold@2026!"],
  ["abdelrahmansayed@globaluntoldstory.com", "Untold@2026!"],
  ["alyalaa@globaluntoldstory.com", "Untold@2026!"],
  ["amin@globaluntoldstory.com", "Untold@2026!"],
  ["dohaelkhabery@globaluntoldstory.com", "Untold@2026!"],
  ["hatim@globaluntoldstory.com", "Untold@2026!"],
  ["kamalel-menshawe@globaluntoldstory.com", "Untold@2026!"],
  ["mohamed_amr@globaluntoldstory.com", "Untold@2026!"],
  ["omar@globaluntoldstory.com", "Untold@2026!"],
  ["yousraborham@untold.com", "Untold@2026!"],
  ["zainaabdelhamid@globalyntoldstory.com", "Untold@2026!"],
  ["ziad_reda@globaluntoldstory.com", "Untold@2026!"],
];

let ok = 0, fail = 0;
for (const [email, password] of accounts) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (r.ok) { ok++; console.log(email, '-> OK'); }
  else { fail++; console.log(email, '-> FAIL', j.error_code || j.msg); }
}
console.log(`\n${ok} نجح / ${fail} فشل`);
