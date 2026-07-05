import { getSupabase } from '@/lib/supabase/client';

export type SupabaseActor = {
  id: string;
  name: string;
  role: string;
  isTeamLeader: boolean;
};

/** مستخدم التطبيق الحالي من جدول `users` حسب بريد جلسة Supabase Auth */
export async function getSupabaseActor(): Promise<SupabaseActor> {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) throw new Error('غير مسجل');
  const emailNorm = user.email.trim().toLowerCase();
  const { data: row, error } = await sb
    .from('users')
    .select('id,name,role,is_team_leader')
    .eq('email', emailNorm)
    .maybeSingle();
  if (error || !row) throw new Error('مستخدم غير موجود في جدول users');
  const raw =
    row.name != null && String(row.name).trim() !== '' && String(row.name).trim() !== 'null'
      ? String(row.name).trim()
      : '';
  const at = emailNorm.indexOf('@');
  const local = at > 0 ? emailNorm.slice(0, at) : emailNorm;
  const name = raw || local || 'مستخدم';
  return {
    id: String(row.id),
    name,
    role: String(row.role),
    isTeamLeader: Boolean(row.is_team_leader),
  };
}
