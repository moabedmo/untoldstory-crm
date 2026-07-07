import pg from 'pg';
const c = new pg.Client({
  connectionString:
    'postgresql://postgres.hpvxqwkyxklyurzxnoga:12805Moh%40meddd@aws-1-eu-central-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const tables = [
  'users', 'workspace_state', 'accounting_policy', 'custody_settings', 'closed_months',
  'manual_customers', 'leads', 'price_quotes', 'invoices', 'expenses', 'manual_journal_entries',
  'monthly_targets', 'attendance_records', 'audit_events', 'custody_funds',
  'shoot_bookings', 'equipment_bookings', 'meeting_bookings',
];
for (const t of tables) {
  try {
    const r = await c.query(`SELECT COUNT(*)::int c FROM public."${t}"`);
    console.log(t, r.rows[0].c);
  } catch {
    console.log(t, 'missing');
  }
}
await c.end();
