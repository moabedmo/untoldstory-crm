import pg from 'pg';
const c = new pg.Client({
  connectionString:
    'postgresql://postgres.hpvxqwkyxklyurzxnoga:12805Moh%40meddd@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: users } = await fetch(
  'https://axkoidcmiqutdtcadfca.supabase.co/rest/v1/users?select=*&limit=2',
  {
    headers: {
      apikey:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4a29pZGNtaXF1dGR0Y2FkZmNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTc0NTksImV4cCI6MjA5NzczMzQ1OX0.68PqW3TCT3GDZJ0Z7IcUYwrVzzbgAKlTuoCS-xNYeVs',
      Authorization: `Bearer ${await (async () => {
        const r = await fetch(
          'https://axkoidcmiqutdtcadfca.supabase.co/auth/v1/token?grant_type=password',
          {
            method: 'POST',
            headers: {
              apikey:
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4a29pZGNtaXF1dGR0Y2FkZmNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTc0NTksImV4cCI6MjA5NzczMzQ1OX0.68PqW3TCT3GDZJ0Z7IcUYwrVzzbgAKlTuoCS-xNYeVs',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: 'admin@untold.com', password: 'UntoldAccess2026!' }),
          },
        );
        return (await r.json()).access_token;
      })()}`,
    },
  },
).then((r) => r.json());
console.log('fetched users', users.length);
for (const u of users) {
  await c.query(
    `INSERT INTO users (id,email,password_hash,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz,$11::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [
      u.id,
      u.email,
      u.password_hash || '',
      u.name,
      u.role,
      u.avatar,
      u.base_salary,
      JSON.stringify(u.skills_json || []),
      JSON.stringify(u.stats_json || {}),
      u.created_at,
      u.updated_at,
    ],
  );
}
const r = await c.query('SELECT COUNT(*)::int c FROM users');
console.log('inserted total users', r.rows[0].c);
await c.end();
