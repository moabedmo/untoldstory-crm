-- شعار الشركة وتعريفات الطباعة — bucket عام للقراءة، رفع للمالك فقط
-- نفّذ من SQL Editor في مشروع Supabase إن لم يكن الـ bucket موجوداً
-- يعتمد على دوال app_user_role() من role_based_rls_policies.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-assets',
  'workspace-assets',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS workspace_assets_public_read ON storage.objects;
CREATE POLICY workspace_assets_public_read
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'workspace-assets');

DROP POLICY IF EXISTS workspace_assets_owner_insert ON storage.objects;
CREATE POLICY workspace_assets_owner_insert
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-assets'
  AND public.app_user_role() = 'مالك'
);

DROP POLICY IF EXISTS workspace_assets_owner_update ON storage.objects;
CREATE POLICY workspace_assets_owner_update
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-assets'
  AND public.app_user_role() = 'مالك'
);

DROP POLICY IF EXISTS workspace_assets_owner_delete ON storage.objects;
CREATE POLICY workspace_assets_owner_delete
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'workspace-assets'
  AND public.app_user_role() = 'مالك'
);
