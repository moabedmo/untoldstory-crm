import { getApiBaseUrl } from '@/config/api';
import { isSupabaseDirectMode } from '@/config/supabaseMode';
import {
  fetchUsersSb,
  createUserSb,
  patchUserSb,
  deleteUserSb,
} from '@/lib/supabase/directApiSb';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('prod_system_jwt');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function fetchUsersApi(): Promise<import('@/app/context/DataContext').User[]> {
  if (isSupabaseDirectMode()) return fetchUsersSb();
  const r = await fetch(`${getApiBaseUrl()}/api/users`, { headers: authHeaders() });
  if (!r.ok) throw new Error('fetch users');
  const data = await r.json();
  return Array.isArray(data.users) ? data.users : [];
}

export async function createUserApi(payload: {
  name: string;
  role: string;
  email?: string;
  password?: string;
  avatar?: string;
  baseSalary?: number;
  skills?: string[];
}): Promise<{ user: import('@/app/context/DataContext').User; tempPassword?: string }> {
  if (isSupabaseDirectMode()) return createUserSb(payload);
  const r = await fetch(`${getApiBaseUrl()}/api/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'create user');
  return {
    user: data.user as import('@/app/context/DataContext').User,
    ...(typeof data.tempPassword === 'string' ? { tempPassword: data.tempPassword } : {}),
  };
}

export async function patchUserApi(
  id: string,
  patch: Partial<{
    name: string;
    email: string;
    role: import('@/app/context/DataContext').User['role'];
    avatar: string | null;
    skills: import('@/app/context/DataContext').LeadCategory[];
    baseSalary: number;
    stats: import('@/app/context/DataContext').User['stats'];
    /** تعيين كلمة مرور جديدة (خادم Express + Prisma) — المالك فقط؛ ٨ أحرف فأكثر */
    newPassword: string;
  }>
): Promise<import('@/app/context/DataContext').User> {
  if (isSupabaseDirectMode()) return patchUserSb(id, patch);
  const r = await fetch(`${getApiBaseUrl()}/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'patch user');
  return data.user as import('@/app/context/DataContext').User;
}

export async function deleteUserApi(id: string): Promise<void> {
  if (isSupabaseDirectMode()) return deleteUserSb(id);
  const r = await fetch(`${getApiBaseUrl()}/api/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === 'string' ? data.error : 'delete user');
}
