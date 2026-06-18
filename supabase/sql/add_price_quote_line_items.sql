-- بنود عرض السعر (جدول تفصيلي للطباعة)
ALTER TABLE public.price_quotes
  ADD COLUMN IF NOT EXISTS line_items_json JSONB;

-- مدير الإنتاج: إنشاء عروض أسعار مُسعَّرة + رؤية ما أنشأه
DROP POLICY IF EXISTS price_quotes_insert_role ON public.price_quotes;
CREATE POLICY price_quotes_insert_role ON public.price_quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_role(ARRAY['مندوب', 'مدير مبيعات'])
    OR (
      public.app_user_role() = 'مدير إنتاج'
      AND production_assigned_id = public.app_user_id()
      AND created_by_id = public.app_user_id()
    )
  );

DROP POLICY IF EXISTS price_quotes_select_role ON public.price_quotes;
CREATE POLICY price_quotes_select_role ON public.price_quotes
  FOR SELECT TO authenticated
  USING (
    public.app_is_role(ARRAY['مالك', 'مدير مبيعات', 'محاسب'])
    OR (public.app_user_role() = 'مندوب' AND created_by_id = public.app_user_id())
    OR (
      public.app_user_role() = 'مدير إنتاج'
      AND (
        production_assigned_id = public.app_user_id()
        OR priced_by_id = public.app_user_id()
        OR created_by_id = public.app_user_id()
      )
    )
  );

DROP POLICY IF EXISTS price_quotes_update_role ON public.price_quotes;
CREATE POLICY price_quotes_update_role ON public.price_quotes
  FOR UPDATE TO authenticated
  USING (
    public.app_is_role(ARRAY['مالك', 'مدير مبيعات'])
    OR (public.app_user_role() = 'مندوب' AND created_by_id = public.app_user_id())
    OR (
      public.app_user_role() = 'مدير إنتاج'
      AND (
        production_assigned_id = public.app_user_id()
        OR created_by_id = public.app_user_id()
      )
    )
  )
  WITH CHECK (
    public.app_is_role(ARRAY['مالك', 'مدير مبيعات'])
    OR (public.app_user_role() = 'مندوب' AND created_by_id = public.app_user_id())
    OR (
      public.app_user_role() = 'مدير إنتاج'
      AND (
        production_assigned_id = public.app_user_id()
        OR created_by_id = public.app_user_id()
      )
    )
  );
