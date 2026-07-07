import pg from 'pg';

const pwd = encodeURIComponent('12805Moh@meddd');
const refs = [
  ['OLD-hfbn', 'hfbnysvmrqglccxswqfm'],
  ['NEW', 'hpvxqwkyxklyurzxnoga'],
  ['axkoid', 'axkoidcmiqutdtcadfca'],
];
const hosts = [];
for (const prefix of ['aws-0', 'aws-1']) {
  for (const region of ['eu-west-1', 'eu-central-1', 'eu-west-2', 'us-east-1', 'us-west-1', 'ap-southeast-1']) {
    hosts.push(`${prefix}-${region}.pooler.supabase.com`);
  }
}

async function tryUrl(label, u) {
  const c = new pg.Client({ connectionString: u, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  try {
    await c.connect();
    const r = await c.query("SELECT COUNT(*)::int c FROM information_schema.tables WHERE table_schema='public'");
    let leads = null;
    try {
      const l = await c.query('SELECT COUNT(*)::int c FROM public.leads');
      leads = l.rows[0].c;
    } catch { /* */ }
    await c.end();
    return { ok: true, tables: r.rows[0].c, leads, label, u };
  } catch (e) {
    await c.end().catch(() => {});
    return { ok: false, label, err: String(e.message).slice(0, 100) };
  }
}

for (const [name, ref] of refs) {
  let best = null;
  for (const host of hosts) {
    for (const port of [5432, 6543]) {
      const u = `postgresql://postgres.${ref}:${pwd}@${host}:${port}/postgres`;
      const r = await tryUrl(`${name}:${host}:${port}`, u);
      if (r.ok) {
        best = r;
        break;
      }
    }
    if (best) break;
  }
  if (best) console.log('WIN', best.label, 'tables', best.tables, 'leads', best.leads, best.u.replace(pwd, '***'));
  else console.log('FAIL', name);
}
