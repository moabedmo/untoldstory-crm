import pg from 'pg';

const passwords = ['12805Moh@meddd', '12805Sh@mss'];
const ref = 'axkoidcmiqutdtcadfca';
const hosts = ['aws-1-eu-central-1.pooler.supabase.com', 'aws-0-eu-central-1.pooler.supabase.com', 'aws-0-eu-west-1.pooler.supabase.com'];

for (const raw of passwords) {
  const pwd = encodeURIComponent(raw);
  for (const host of hosts) {
    const u = `postgresql://postgres.${ref}:${pwd}@${host}:5432/postgres`;
    const c = new pg.Client({ connectionString: u, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });
    try {
      await c.connect();
      const l = await c.query('SELECT COUNT(*)::int c FROM public.leads');
      console.log('OK', host, 'pwd', raw, 'leads', l.rows[0].c);
      await c.end();
    } catch (e) {
      console.log('FAIL', host, raw, String(e.message).slice(0, 70));
      await c.end().catch(() => {});
    }
  }
}
