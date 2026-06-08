-- ⚠️ استخدم بدلاً منه: enable_workspace_realtime.sql (يشمل leads + كل الجداول)
-- تفعيل Realtime على جدول leads — شغّل مرة واحدة في SQL Editor بلوحة Supabase
-- يسمح بظهور إضافات/تعديلات الليدز فوراً عند المالك ومدير المبيعات بدون refresh

ALTER TABLE IF EXISTS public.leads REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
  END IF;
END $$;
