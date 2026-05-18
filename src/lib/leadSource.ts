export type LeadSourceFilter =
  | 'all'
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'linkedin'
  | 'email'
  | 'manual';

/** Canonical slug stored in DB (facebook, instagram, google, …). */
export function normalizeLeadSource(source: string | null | undefined): string {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return 'other';
  if (s === 'facebook' || s === 'fb') return 'facebook';
  if (s === 'instagram' || s === 'ig') return 'instagram';
  if (s === 'google') return 'google';
  if (s === 'linkedin') return 'linkedin';
  if (s === 'email') return 'email';
  if (s === 'يدوي' || s === 'manual') return 'manual';
  if (/فيسبوك|facebook|lead\s*ads|meta-lead|facebook\s*leads/.test(s)) return 'facebook';
  if (/إنستجرام|instagram|\binsta\b/.test(s)) return 'instagram';
  if (/google|جوجل|google\s*ads|google\s*sheet/.test(s)) return 'google';
  if (/linkedin|لينكد/.test(s)) return 'linkedin';
  if (/email|gmail|بريد|inbox|leads\s*inbox/.test(s)) return 'email';
  if (/excel|xlsx|رفع\s*ملف|spreadsheet|شيت/.test(s)) return 'manual';
  return s;
}

export function leadMatchesSourceFilter(
  source: string | null | undefined,
  filter: LeadSourceFilter,
): boolean {
  if (filter === 'all') return true;
  return normalizeLeadSource(source) === filter;
}

export function leadSourceDisplayLabel(source: string | null | undefined): string {
  const n = normalizeLeadSource(source);
  switch (n) {
    case 'facebook':
      return 'Facebook';
    case 'instagram':
      return 'Instagram';
    case 'google':
      return 'Google';
    case 'linkedin':
      return 'LinkedIn';
    case 'email':
      return 'Email / Gmail';
    case 'manual':
      return 'يدوي';
    default:
      return source?.trim() || '—';
  }
}

export function isAutoImportedLeadSource(source: string | null | undefined): boolean {
  const n = normalizeLeadSource(source);
  return n === 'facebook' || n === 'instagram' || n === 'google' || n === 'linkedin' || n === 'email';
}

/** قنوات الاستيراد التلقائي (n8n / Meta / Sheets / Gmail …) */
export const INBOUND_CHANNEL_SOURCES = [
  'facebook',
  'instagram',
  'google',
  'linkedin',
  'email',
] as const satisfies readonly LeadSourceFilter[];

export function inboundChannelLabel(source: LeadSourceFilter): string {
  switch (source) {
    case 'facebook':
      return 'Facebook';
    case 'instagram':
      return 'Instagram';
    case 'google':
      return 'Google';
    case 'linkedin':
      return 'LinkedIn';
    case 'email':
      return 'Email / Gmail';
    default:
      return source;
  }
}

export function leadSourceBadgeClass(source: string | null | undefined): string {
  const n = normalizeLeadSource(source);
  switch (n) {
    case 'facebook':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'instagram':
      return 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30';
    case 'google':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'linkedin':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'email':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  }
}
