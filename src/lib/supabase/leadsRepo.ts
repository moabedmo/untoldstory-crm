import { getSupabase } from '@/lib/supabase/client';
import type { Lead, Activity } from '@/app/context/DataContext';
import { mapLeadFromRow } from '@/lib/supabase/postgrestMappers';
import { getSupabaseActor } from '@/lib/supabase/getActor';
import { canTeamLeaderPatchLead, fetchTeamMemberIds } from '@/lib/supabase/teamLeaderLeads';
import { normalizeLeadPhone, leadPhoneDigitsKey } from '@/lib/leadPhone';

async function getActor(): Promise<{ id: string; name: string; role: string }> {
  return getSupabaseActor();
}

function parseTimeline(existing: unknown): Activity[] {
  if (Array.isArray(existing)) return [...existing] as Activity[];
  return [];
}

export async function supabaseCreateLead(payload: {
  name: string;
  company: string;
  phone: string;
  email: string;
  status: string;
  budget: number;
  companySize: string;
  source: string;
  category: string;
  score: number;
  slaStatus: string;
  customerCode?: string;
  assignedTo?: string;
  followUpAt?: string;
  lossReasonCode?: string;
  timeline?: Activity[];
}): Promise<Lead> {
  const actor = await getActor();
  if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') {
    throw new Error('غير مصرح بإضافة ليد');
  }
  const sb = getSupabase();
  const id = `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const insert = {
    id,
    customer_code: payload.customerCode ?? null,
    name: payload.name.trim(),
    company: payload.company.trim(),
    phone: normalizeLeadPhone(payload.phone.trim()),
    email: payload.email.trim().toLowerCase(),
    status: payload.status || 'جديد',
    budget: Math.max(0, Number(payload.budget) || 0),
    company_size: payload.companySize || 'صغير',
    source: payload.source || '',
    category: payload.category || '',
    score: Math.max(0, Math.min(100, Number(payload.score) || 0)),
    sla_status: payload.slaStatus || 'مستقر',
    assigned_to_id: payload.assignedTo || null,
    follow_up_at: payload.followUpAt || null,
    loss_reason_code: payload.lossReasonCode || null,
    timeline_json: [] as unknown[],
    created_at: now,
    updated_at: now,
  };
  const { error: insErr } = await sb.from('leads').insert(insert);
  if (insErr) throw new Error(insErr.message);
  let timeline = parseTimeline(payload.timeline);
  const firstActivity: Activity = {
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId: id,
    action: 'إضافة الليد إلى النظام',
    userId: actor.id,
    userName: actor.name,
    createdAt: new Date().toISOString(),
  };
  timeline = timeline.length > 0 ? [...timeline, firstActivity] : [firstActivity];
  const { data: updated, error: upErr } = await sb
    .from('leads')
    .update({ timeline_json: timeline, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (upErr || !updated) throw new Error(upErr?.message || 'فشل تحديث المخطط الزمني');
  return mapLeadFromRow(updated as Record<string, unknown>);
}

export async function supabasePatchLead(
  id: string,
  patch: Partial<{
    status: string;
    assignedTo: string | null;
    followUpAt: string | null;
    lossReasonCode: string | null;
    budget: number;
    slaStatus: string;
    score: number;
    note: string;
    appendActivity: {
      action: string;
      note?: string;
      channelType?: 'call' | 'chat' | 'other';
      evidenceType?: 'recording' | 'chat_export' | 'link' | 'note_only';
      evidenceRef?: string;
      durationSeconds?: number;
      qaStatus?: 'pending';
    };
    reviewActivity: {
      activityId: string;
      decision: 'approved' | 'rejected';
      comment?: string;
    };
  }>,
): Promise<Lead> {
  const actor = await getActor();
  const sb = getSupabase();
  const { data: existingRow, error: exErr } = await sb.from('leads').select('*').eq('id', id).maybeSingle();
  if (exErr || !existingRow) throw new Error('الليد غير موجود');
  const existing = mapLeadFromRow(existingRow as Record<string, unknown>);
  let canEdit =
    actor.role === 'مالك' ||
    actor.role === 'مدير مبيعات' ||
    (actor.role === 'مندوب' && existing.assignedTo === actor.id);
  if (!canEdit && actor.role === 'مندوب' && actor.isTeamLeader) {
    const teamIds = await fetchTeamMemberIds(sb, actor.id);
    if (canTeamLeaderPatchLead(actor, existing, patch, teamIds)) canEdit = true;
  }
  if (!canEdit) throw new Error('غير مصرح');

  const data: Record<string, unknown> = {};
  if (patch.status != null) data.status = String(patch.status);
  if (patch.assignedTo !== undefined) data.assigned_to_id = patch.assignedTo || null;
  if (patch.followUpAt !== undefined) data.follow_up_at = patch.followUpAt ? patch.followUpAt : null;
  if (patch.lossReasonCode !== undefined) data.loss_reason_code = patch.lossReasonCode ? String(patch.lossReasonCode) : null;
  if (patch.budget != null) data.budget = Math.max(0, Number(patch.budget) || 0);
  if (patch.slaStatus != null) data.sla_status = String(patch.slaStatus);
  if (patch.score != null) data.score = Math.max(0, Math.min(100, Number(patch.score) || 0));

  let timeline = parseTimeline((existingRow as { timeline_json?: unknown }).timeline_json);

  if (patch.reviewActivity) {
    if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') throw new Error('غير مصرح بمراجعة النشاط');
    const ra = patch.reviewActivity;
    const activityId = String(ra.activityId || '').trim();
    const decision = ra.decision === 'rejected' ? 'rejected' : 'approved';
    const idx = timeline.findIndex((a) => a && a.id === activityId);
    if (idx < 0) throw new Error('النشاط غير موجود');
    const prev = timeline[idx];
    timeline[idx] = {
      ...prev,
      qaStatus: decision,
      qaReviewedAt: new Date().toISOString(),
      qaReviewedById: actor.id,
      qaReviewedByName: actor.name,
      qaComment: ra.comment != null && String(ra.comment).trim() ? String(ra.comment).trim() : undefined,
    };
    data.timeline_json = timeline;
  } else if (patch.status != null && patch.status !== existing.status) {
    timeline = [
      {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        leadId: id,
        action: `تغيير الحالة إلى ${patch.status}`,
        userId: actor.id,
        userName: actor.name,
        createdAt: new Date().toISOString(),
        note: patch.note || undefined,
      },
      ...timeline,
    ];
    data.timeline_json = timeline;
  } else if (patch.appendActivity) {
    const app = patch.appendActivity;
    const entry: Activity = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      leadId: id,
      action: String(app.action || 'نشاط'),
      userId: actor.id,
      userName: actor.name,
      createdAt: new Date().toISOString(),
    };
    if (app.note != null && String(app.note).trim()) entry.note = String(app.note).trim();
    if (app.channelType) entry.channelType = app.channelType;
    if (app.evidenceType) entry.evidenceType = app.evidenceType;
    if (app.evidenceRef != null && String(app.evidenceRef).trim()) entry.evidenceRef = String(app.evidenceRef).trim();
    if (typeof app.durationSeconds === 'number' && !Number.isNaN(app.durationSeconds)) {
      entry.durationSeconds = Math.max(0, Math.round(app.durationSeconds));
    }
    if (entry.evidenceRef || app.qaStatus === 'pending') entry.qaStatus = 'pending';
    timeline = [entry, ...timeline];
    data.timeline_json = timeline;
  }

  if (Object.keys(data).length === 0) {
    return existing;
  }
  data.updated_at = new Date().toISOString();
  const { data: row, error } = await sb.from('leads').update(data).eq('id', id).select('*').single();
  if (error || !row) throw new Error(error?.message || 'فشل التحديث');
  return mapLeadFromRow(row as Record<string, unknown>);
}

export async function supabaseImportLeadsCsv(payload: {
  source: string;
  leads: Array<{
    name: string;
    company: string;
    phone: string;
    email: string;
    status?: string;
    budget?: number;
    companySize?: string;
    category?: string;
    score?: number;
    linkedinRowIndex?: number;
    leadDate?: string;
  }>;
  routeToManagerId?: string | null;
}): Promise<{
  ok: boolean;
  created: number;
  skippedDuplicates: number;
  failed: number;
  leads: Lead[];
}> {
  const actor = await getActor();
  if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') {
    throw new Error('غير مصرح باستيراد الليدز');
  }
  const sb = getSupabase();
  const source = String(payload.source || 'linkedin').trim();
  const routeToManagerId = payload.routeToManagerId || null;
  const leadsOut: Lead[] = [];
  let created = 0;
  let skippedDuplicates = 0;
  let failed = 0;

  for (const row of payload.leads) {
    let name = String(row.name || '').trim().slice(0, 200);
    const company = String(row.company || '—').trim().slice(0, 200);
    let phone = normalizeLeadPhone(String(row.phone || '').trim());
    let email = String(row.email || '').trim().toLowerCase();
    const rowKey = row.linkedinRowIndex || name || company;
    if (!name) {
      name = company && company !== '—' ? company : 'عميل مستورد';
    }
    if (!name) {
      failed += 1;
      continue;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      email = `import-${String(rowKey).replace(/\D/g, '').slice(0, 12) || Date.now()}@lead.local`;
    }
    if (!phone) {
      const digits = String(rowKey).replace(/\D/g, '').slice(-6).padStart(6, '0');
      phone = `0199${digits}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 11);
    }

    const { data: byEmail } = await sb.from('leads').select('id').eq('email', email).limit(1);
    const { data: byPhone } = await sb.from('leads').select('id').eq('phone', phone).limit(1);
    if ((byEmail && byEmail.length > 0) || (byPhone && byPhone.length > 0)) {
      skippedDuplicates += 1;
      continue;
    }

    const id = `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const leadDateRaw = row.leadDate ? new Date(String(row.leadDate)) : null;
    const now =
      leadDateRaw && !Number.isNaN(leadDateRaw.getTime())
        ? leadDateRaw.toISOString()
        : new Date().toISOString();
    const timeline = [
      {
        id: `ev-csv-${id}`,
        leadId: id,
        action: `استيراد CSV (${source})`,
        note: row.linkedinRowIndex ? `صف الملف: ${row.linkedinRowIndex}` : undefined,
        userId: actor.id,
        userName: actor.name,
        createdAt: now,
      },
      {
        id: `a-${id}`,
        leadId: id,
        action: 'إضافة الليد إلى النظام',
        userId: actor.id,
        userName: actor.name,
        createdAt: now,
      },
    ];

    const insert = {
      id,
      customer_code: null,
      name,
      company,
      phone,
      email,
      status: String(row.status || 'جديد'),
      assigned_to_id: routeToManagerId,
      budget: Math.max(0, Number(row.budget) || 0),
      company_size: String(row.companySize || 'صغير'),
      source,
      category: String(row.category || 'إعلانات'),
      score: Math.max(0, Math.min(100, Number(row.score) || 50)),
      follow_up_at: null,
      loss_reason_code: null,
      sla_status: 'مستقر',
      timeline_json: timeline,
      created_at: now,
      updated_at: now,
    };

    const { error } = await sb.from('leads').insert(insert);
    if (error) {
      failed += 1;
      continue;
    }
    leadsOut.push(mapLeadFromRow(insert as Record<string, unknown>));
    created += 1;
  }

  return { ok: true, created, skippedDuplicates, failed, leads: leadsOut };
}

export async function supabaseDeleteLead(leadId: string): Promise<void> {
  const actor = await getActor();
  if (actor.role !== 'مالك' && actor.role !== 'مدير مبيعات') throw new Error('غير مصرح بحذف الليد');
  const sb = getSupabase();
  const [{ count: invCount }, { count: pqCount }] = await Promise.all([
    sb.from('invoices').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
    sb.from('price_quotes').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
  ]);
  if ((invCount ?? 0) > 0 || (pqCount ?? 0) > 0) {
    throw new Error('لا يمكن حذف الليد: توجد فواتير أو عروض أسعار مرتبطة به');
  }
  const { error } = await sb.from('leads').delete().eq('id', leadId);
  if (error) throw new Error(error.message);
}
