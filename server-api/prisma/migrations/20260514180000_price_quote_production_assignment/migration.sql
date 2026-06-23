-- عروض الأسعار: حقول مسار الإنتاج والتسعير وموافقة العميل (متطابقة مع Supabase / الواجهة)
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "production_assigned_id" TEXT;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "production_assigned_name" TEXT;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "priced_by_id" TEXT;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "priced_by_name" TEXT;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "priced_at" TIMESTAMP(3);
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "pricing_note" TEXT;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "payment_schedule_json" JSONB;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "initial_payment" INTEGER;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "client_payments_json" JSONB;
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "client_accepted_at" TIMESTAMP(3);
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "client_rejected_at" TIMESTAMP(3);
ALTER TABLE "price_quotes" ADD COLUMN IF NOT EXISTS "client_rejection_note" TEXT;

CREATE INDEX IF NOT EXISTS "price_quotes_production_assigned_id_idx" ON "price_quotes"("production_assigned_id");
