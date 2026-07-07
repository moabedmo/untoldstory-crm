import pg from 'pg';

const conn =
  'postgresql://postgres.hpvxqwkyxklyurzxnoga:12805Moh%40meddd@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';
const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await c.connect();

const authOnly = await c.query(`
  SELECT u.email, u.email_confirmed_at IS NOT NULL AS confirmed, u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.users p ON lower(p.email) = lower(u.email)
  WHERE p.id IS NULL
  ORDER BY u.email
`);
console.log('Auth accounts WITHOUT employee profile:', authOnly.rows.length);
authOnly.rows.forEach((r) => console.log(' ', r.email, 'confirmed:', r.confirmed));

const profileOnly = await c.query(`
  SELECT p.email, p.name, p.role
  FROM public.users p
  LEFT JOIN auth.users u ON lower(u.email) = lower(p.email)
  WHERE u.id IS NULL AND p.email NOT LIKE '%@staff.internal'
`);
console.log('\nProfiles WITHOUT auth:', profileOnly.rows.length);
profileOnly.rows.forEach((r) => console.log(' ', r.email, r.name, r.role));

const dupAuth = await c.query(`
  SELECT lower(email) AS em, count(*)::int AS n
  FROM auth.users
  GROUP BY lower(email)
  HAVING count(*) > 1
`);
console.log('\nDuplicate auth emails:', dupAuth.rows);

const loginTest = await c.query(`
  SELECT p.email, p.name, p.role,
         u.email_confirmed_at IS NOT NULL AS confirmed
  FROM public.users p
  JOIN auth.users u ON lower(u.email) = lower(p.email)
  WHERE p.email NOT LIKE '%@staff.internal'
  ORDER BY p.role, p.email
`);
console.log('\nAll employees auth status:');
loginTest.rows.forEach((r) => console.log(` ${r.role.padEnd(12)} ${r.email} confirmed=${r.confirmed}`));

await c.end();
