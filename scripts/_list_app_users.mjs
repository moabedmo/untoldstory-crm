import { config } from 'dotenv';
config({ path: '.env.migrate' });
import pg from 'pg';
const connStr = process.env.NEW_DIRECT_URL.replace(/\?.*$/, '');
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`SELECT id, name, email, login_email, role FROM public.users ORDER BY name`).catch(async () => {
  const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'`);
  console.log('columns:', cols.rows.map(r => r.column_name).join(', '));
  return { rows: [] };
});
console.log(rows);
await client.end();
