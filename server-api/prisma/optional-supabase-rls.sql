-- اختياري — تشغيل يدوي من SQL Editor في Supabase عند الحاجة.
-- اتصال Prisma التقليدي بمستخدم postgres غالباً يتجاوز RLS؛ هذا الملف للدفاع إذا
-- فُعّل الوصول بمفاتيح anon/authenticated من العميل مباشرة.
--
-- مثال (جدول واحد): تفعيل RLS ثم سياسة تمنع القراءة لدور authenticated
-- بدون منح صريح — راجع توثيق Supabase قبل التطبيق على الإنتاج.

-- ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
