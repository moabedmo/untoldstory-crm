/**
 * المالك يدير حسابات دخول الموظفين في Supabase Auth:
 * - تعيين/تحديث كلمة المرور
 * - تحديث البريد (مزامنة Auth + public.users)
 *
 * انشر: supabase functions deploy set-employee-password
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRealEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith('@staff.internal');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: 'إعدادات الدالة ناقصة على الخادم' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'غير مصرح — سجّل الدخول كمالك' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    const actorEmail = authData.user?.email?.trim().toLowerCase();
    if (authErr || !actorEmail) {
      return json({ error: 'غير مصرح — جلسة غير صالحة' }, 401);
    }

    const { data: actorRow, error: actorErr } = await userClient
      .from('users')
      .select('id,role')
      .eq('email', actorEmail)
      .maybeSingle();
    const actorRole = actorRow?.role as string | undefined;
    if (actorErr || !actorRow || (actorRole !== 'مالك' && actorRole !== 'مدير مبيعات')) {
      return json({ error: 'إدارة حسابات الدخول متاحة للمالك ومدير المبيعات فقط' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const targetUserId = String(body.targetUserId || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const newEmail = String(body.newEmail || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const isSelf = targetUserId === String(actorRow.id);

    if (!targetUserId || !email) {
      return json({ error: 'معرّف الموظف والبريد الحالي مطلوبان' }, 400);
    }
    if (password && password.length < 8) {
      return json({ error: 'كلمة المرور ٨ أحرف أو أكثر' }, 400);
    }
    if (newEmail && !isRealEmail(newEmail)) {
      return json({ error: 'البريد الجديد غير صالح (يجب أن يكون بريداً حقيقياً)' }, 400);
    }
    if (!password && !newEmail) {
      return json({ error: 'أرسل كلمة مرور جديدة أو بريداً جديداً' }, 400);
    }
    if (!isRealEmail(email) && !newEmail) {
      return json({ error: 'عيّن بريداً حقيقياً للموظف أولاً ثم كلمة المرور' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: targetRow, error: targetErr } = await admin
      .from('users')
      .select('id,email,role')
      .eq('id', targetUserId)
      .maybeSingle();
    if (targetErr || !targetRow) {
      return json({ error: 'الموظف غير موجود' }, 404);
    }
    if (!isSelf && String(targetRow.role) === 'مالك') {
      return json({ error: 'لا يمكن تعديل حساب مالك آخر من هنا' }, 400);
    }
    if (actorRole === 'مدير مبيعات' && String(targetRow.role) !== 'مندوب') {
      return json({ error: 'مدير المبيعات يستطيع تغيير كلمة مرور المندوبين فقط' }, 403);
    }
    if (String(targetRow.email || '').trim().toLowerCase() !== email) {
      return json({ error: 'البريد الحالي لا يطابق سجل الموظف — حدّث الصفحة وأعد المحاولة' }, 400);
    }

    const loginEmail = newEmail || email;
    const { data: clash } = await admin
      .from('users')
      .select('id')
      .eq('email', loginEmail)
      .neq('id', targetUserId)
      .maybeSingle();
    if (clash) {
      return json({ error: 'البريد الجديد مستخدم لموظف آخر' }, 400);
    }

    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    if (listErr) {
      return json({ error: listErr.message || 'تعذر البحث في حسابات الدخول' }, 500);
    }
    const users = listData?.users ?? [];
    let authUser = users.find((u) => String(u.email || '').toLowerCase() === email);
    if (!authUser && newEmail) {
      authUser = users.find((u) => String(u.email || '').toLowerCase() === loginEmail);
    }

    if (!authUser && (password || newEmail)) {
      if (!isRealEmail(loginEmail)) {
        return json({ error: 'لا يمكن إنشاء حساب دخول لبريد داخلي — عيّن بريداً حقيقياً أولاً' }, 400);
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: loginEmail,
        password: password || undefined,
        email_confirm: true,
      });
      if (createErr) {
        return json({ error: createErr.message || 'تعذر إنشاء حساب الدخول' }, 400);
      }
      authUser = created.user;
    } else if (authUser) {
      const authPatch: { password?: string; email?: string; email_confirm?: boolean } = {
        email_confirm: true,
      };
      if (password) authPatch.password = password;
      if (newEmail && newEmail !== email) authPatch.email = newEmail;
      const { error: updateErr } = await admin.auth.admin.updateUserById(authUser.id, authPatch);
      if (updateErr) {
        return json({ error: updateErr.message || 'تعذر تحديث حساب الدخول' }, 400);
      }
    }

    if (newEmail && newEmail !== email) {
      const { error: rowErr } = await admin
        .from('users')
        .update({ email: newEmail, updated_at: new Date().toISOString() })
        .eq('id', targetUserId);
      if (rowErr) {
        return json({ error: rowErr.message || 'تعذر تحديث بريد الموظف في قاعدة البيانات' }, 400);
      }
    }

    return json({ ok: true, authUserId: authUser?.id ?? null, email: loginEmail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
    return json({ error: msg }, 500);
  }
});
