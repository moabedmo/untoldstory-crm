import { config } from 'dotenv';
config({ path: '.env.migrate' });
import pg from 'pg';
const connStr = process.env.NEW_DIRECT_URL.replace(/\?.*$/, '');
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`SELECT id, email, name, role FROM public.users ORDER BY name`);
console.log(JSON.stringify(rows, null, 2));
await client.end();
