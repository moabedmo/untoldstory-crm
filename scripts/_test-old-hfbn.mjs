import pg from 'pg';

const pwd = encodeURIComponent('12805Moh@meddd');
const ref = 'hfbnysvmrqglccxswqfm';
const tries = [
  'aws-1-eu-west-1.pooler.supabase.com:5432',
  'aws-0-eu-west-1.pooler.supabase.com:5432',
  'aws-1-eu-central-1.pooler.supabase.com:5432',
  'aws-0-eu-central-1.pooler.supabase.com:5432',
];

for (const hp of tries) {
  const [host, port] = hp.split(':');
  const u = `postgresql://postgres.${ref}:${pwd}@${host}:${port}/postgres`;
  const c = new pg.Client({
    connectionString: u,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 45000,
  });
  try {
    await c.connect();
    const t = await c.query(
      "SELECT COUNT(*)::int c FROM information_schema.tables WHERE table_schema='public'",
    );
    let l = null;
    try {
      const x = await c.query('SELECT COUNT(*)::int c FROM public.leads');
      l = x.rows[0].c;
    } catch { /* */ }
    console.log('OK', hp, 'tables', t.rows[0].c, 'leads', l);
    await c.end();
  } catch (e) {
    console.log('FAIL', hp, String(e.message).slice(0, 100));
    await c.end().catch(() => {});
  }
}
