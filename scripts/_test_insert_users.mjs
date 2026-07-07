import { config } from 'dotenv';
config({ path: '.env.migrate' });
import pg from 'pg';
const connStr = process.env.NEW_DIRECT_URL.replace(/\?.*$/, '');
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`INSERT INTO public.users (id, email, password_hash, name, role, avatar, base_salary, skills_json, stats_json, created_at, updated_at)
  VALUES ('test_tmp_1','test_tmp_1@example.com', NULL, 'test', 'مندوب', NULL, 0, '[]'::jsonb, '{}'::jsonb, now(), now())`);
console.log('insert OK');
await client.query(`DELETE FROM public.users WHERE id='test_tmp_1'`);
console.log('cleanup OK');
await client.end();
