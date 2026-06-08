-- تفعيل Realtime على جداول النظام — شغّل مرة واحدة في SQL Editor بلوحة Supabase
-- يجعل التعديلات تظهر فوراً عند كل المستخدمين بدون refresh

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'leads',
    'users',
    'manual_customers',
    'invoices',
    'expenses',
    'price_quotes',
    'manual_journal_entries',
    'closed_months',
    'monthly_targets',
    'custody_settings',
    'audit_events',
    'custody_funds',
    'shoot_bookings',
    'equipment_bookings',
    'meeting_bookings',
    'workspace_state',
    'attendance_records',
    'accounting_policy'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
