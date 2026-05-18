-- نسبة عمولة المندوب (%) — شغّل بعد جدول monthly_targets
ALTER TABLE public.monthly_targets
  ADD COLUMN IF NOT EXISTS commission_percent DOUBLE PRECISION NOT NULL DEFAULT 0;
