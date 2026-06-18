import { getSupabase } from '@/lib/supabase/client';
import { getSupabaseActor } from '@/lib/supabase/getActor';
import type { PrintBrandingSettings } from '@/app/context/DataContext';

const BUCKET = 'workspace-assets';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** مصدر اللوجو للعرض والطباعة — رابط التخزين أولاً ثم base64 المحلي */
export function getPrintBrandingLogoSrc(settings: PrintBrandingSettings): string {
  const url = (settings.logoUrl || '').trim();
  if (url) return url;
  return (settings.logoDataUrl || '').trim();
}

/** رفع لوجو الشركة إلى Supabase Storage (لا يُخزَّن base64 في workspace_state) */
export async function uploadCompanyLogoSb(file: File): Promise<string> {
  const actor = await getSupabaseActor();
  if (actor.role !== 'مالك') {
    throw new Error('غير مصرح برفع شعار الشركة');
  }
  const ext = MIME_EXT[file.type] || 'png';
  const path = `branding/company-logo.${ext}`;
  const sb = getSupabase();
  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || `image/${ext}`,
    cacheControl: '3600',
  });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl?.trim();
  if (!publicUrl) throw new Error('تعذّر الحصول على رابط الشعار');
  return `${publicUrl}?v=${Date.now()}`;
}
