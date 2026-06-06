-- إصلاح: المحاسب (وباقي الأدوار) كانوا يقرأون workspace_state لكن RLS يمنع الكتابة إلا للمالك.
-- النتيجة: أكواد دليل الحسابات / دليل الأكواد تختفي فور الإضافة لأن الحفظ يفشل بصمت.
-- التطبيق يتحقق من المفاتيح المسموحة لكل دور في workspaceStateSb / API.

DROP POLICY IF EXISTS workspace_state_role ON public.workspace_state;
DROP POLICY IF EXISTS app_authenticated_all_workspace_state ON public.workspace_state;

CREATE POLICY workspace_state_role ON public.workspace_state
  FOR ALL TO authenticated
  USING (public.app_is_role(ARRAY['مالك', 'مدير مبيعات', 'محاسب', 'مدير إنتاج', 'مندوب']))
  WITH CHECK (public.app_is_role(ARRAY['مالك', 'مدير مبيعات', 'محاسب', 'مدير إنتاج', 'مندوب']));

-- تصحيح chartOfAccounts / journalCodebook إن كانا مخزّنين كـ object {} بدلاً من array []
UPDATE public.workspace_state
SET doc_json = jsonb_set(
  doc_json,
  '{journalCodebook}',
  CASE
    WHEN jsonb_typeof(doc_json->'journalCodebook') = 'array' THEN doc_json->'journalCodebook'
    WHEN jsonb_typeof(doc_json->'journalCodebook') = 'object' THEN COALESCE(
      (SELECT jsonb_agg(value) FROM jsonb_each(doc_json->'journalCodebook')),
      '[]'::jsonb
    )
    ELSE '[]'::jsonb
  END,
  true
)
WHERE id = 'default'
  AND doc_json ? 'journalCodebook'
  AND jsonb_typeof(doc_json->'journalCodebook') <> 'array';

UPDATE public.workspace_state
SET doc_json = jsonb_set(
  doc_json,
  '{chartOfAccounts}',
  CASE
    WHEN jsonb_typeof(doc_json->'chartOfAccounts') = 'array' THEN doc_json->'chartOfAccounts'
    WHEN jsonb_typeof(doc_json->'chartOfAccounts') = 'object' THEN COALESCE(
      (SELECT jsonb_agg(value) FROM jsonb_each(doc_json->'chartOfAccounts')),
      '[]'::jsonb
    )
    ELSE '[]'::jsonb
  END,
  true
)
WHERE id = 'default'
  AND doc_json ? 'chartOfAccounts'
  AND jsonb_typeof(doc_json->'chartOfAccounts') <> 'array';
