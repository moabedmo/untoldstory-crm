-- طريقة دفع المصروف (كاش / بنك) للمحاسبة
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
