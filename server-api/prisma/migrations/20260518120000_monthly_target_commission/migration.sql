-- نسبة عمولة المندوب على الإيراد المحقق (للتقارير فقط)
ALTER TABLE "monthly_targets" ADD COLUMN IF NOT EXISTS "commission_percent" DOUBLE PRECISION NOT NULL DEFAULT 0;
