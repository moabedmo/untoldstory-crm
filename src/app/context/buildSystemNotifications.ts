import { getMonthKey } from './dateMonthKey';
import { hasAssignedActiveSalesLead, operationalBaselineForPayrollReminder } from './notificationGates';
import type {
  CustodyFund,
  EquipmentBooking,
  Expense,
  Invoice,
  Lead,
  LeadIngestionSettings,
  MeetingBooking,
  MonthlyTarget,
  PayrollApproval,
  PayrollApprovalRequest,
  PersonalTodo,
  PriceQuote,
  SlaEscalationSettings,
  ShootBooking,
  SystemNotification,
  User,
} from './DataContext';

export type BuildSystemNotificationsInput = {
  leads: Lead[];
  users: User[];
  expenses: Expense[];
  invoices: Invoice[];
  payrollApprovals: PayrollApproval[];
  payrollApprovalRequests: PayrollApprovalRequest[];
  monthlyTargets: MonthlyTarget[];
  shootBookings: ShootBooking[];
  equipmentBookings: EquipmentBooking[];
  meetingBookings: MeetingBooking[];
  priceQuotes: PriceQuote[];
  custodyFunds: CustodyFund[];
  leadIngestionSettings: LeadIngestionSettings;
  slaEscalationSettings: SlaEscalationSettings;
  attendanceRecordsCount: number;
  /** مهام شخصية لكل مستخدم (تظهر للمعني مباشرة في الجرس) */
  personalTodosByUserId?: Record<string, PersonalTodo[]>;
};

/** تجميع تنبيهات النظام من حالة الـ CRM (وحدة منفصلة عن DataContext لتقليل حجم الملف). */
export function buildSystemNotifications(input: BuildSystemNotificationsInput): SystemNotification[] {
  const {
    leads,
    users,
    expenses,
    invoices,
    payrollApprovals,
    payrollApprovalRequests,
    monthlyTargets,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    priceQuotes,
    custodyFunds,
    leadIngestionSettings,
    slaEscalationSettings,
    attendanceRecordsCount,
    personalTodosByUserId = {},
  } = input;

  const isPayrollApproved = (monthKey: string) => payrollApprovals.some((p) => p.monthKey === monthKey);
  const payrollReminderBaseline = operationalBaselineForPayrollReminder({
    attendanceRecordsCount,
    payrollApprovalsCount: payrollApprovals.length,
    payrollApprovalRequestsCount: payrollApprovalRequests.length,
  });
  const hasActiveAssignedLead = hasAssignedActiveSalesLead(leads);

    const now = new Date();
    const nowIso = now.toISOString();
    const monthKey = getMonthKey(nowIso);
    const out: SystemNotification[] = [];

    /** مهام مفتوحة لكل مستخدم — تصل للمعني فقط (موظف ← موظف عبر قائمة المستهدف) */
    for (const [uid, todos] of Object.entries(personalTodosByUserId || {})) {
      const open = (Array.isArray(todos) ? todos : []).filter((t) => !t.done).length;
      if (open === 0) continue;
      const u = users.find((x) => String(x.id).trim() === String(uid).trim());
      if (!u) continue;
      out.push({
        id: `n-open-personal-todos-${uid}`,
        level: 'medium',
        title: 'مهام معلّقة على قائمتك',
        message: `لديك ${open} مهمة شخصية لم تُكمَل بعد`,
        createdAt: nowIso,
        targetRoles: [u.role],
        targetUserId: String(uid).trim(),
        entityType: 'system',
        navigateTab: 'home',
      });
    }

    const overdueFollowUps = leads.filter(l => {
      if (!l.followUpAt) return false;
      const ts = new Date(l.followUpAt).getTime();
      return ts < now.getTime() && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة';
    });
    if (overdueFollowUps.length > 0) {
      out.push({
        id: `n-overdue-followups-${overdueFollowUps.length}`,
        level: 'high',
        title: 'متابعات متأخرة',
        message: `يوجد ${overdueFollowUps.length} عميل بحاجة لمتابعة فورية`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات', 'مندوب'],
        entityType: 'lead',
        queue: 'ops',
      });
      const overdueByRep = users
        .filter((u) => u.role === 'مندوب')
        .map((rep) => ({
          rep,
          count: overdueFollowUps.filter((lead) => lead.assignedTo === rep.id).length,
        }))
        .filter((row) => row.count > 0);
      overdueByRep.forEach(({ rep, count }) => {
        out.push({
          id: `n-overdue-followups-rep-${rep.id}-${count}`,
          level: 'high',
          title: 'متابعات متأخرة (خاصتي)',
          message: `لديك ${count} ليدز بحاجة لمتابعة فورية`,
          createdAt: nowIso,
          targetRoles: ['مندوب'],
          targetUserId: rep.id,
          entityType: 'lead',
          queue: 'ops',
          navigateTab: 'leads',
        });
      });
    }

    const staleLeads = leads.filter((l) => {
      if (l.status === 'مغلق - فوز' || l.status === 'مغلق - خسارة') return false;
      const latestActivityAt = l.timeline[0]?.createdAt || l.updatedAt || l.createdAt;
      const ageMins = (now.getTime() - new Date(latestActivityAt).getTime()) / (1000 * 60);
      return ageMins >= slaEscalationSettings.criticalAfterMinutes;
    });
    if (staleLeads.length > 0) {
      out.push({
        id: `n-stale-escalation-${staleLeads.length}`,
        level: 'high',
        priority: 'critical',
        queue: 'ops',
        title: 'تصعيد: ليدز بدون متابعة',
        message: `${staleLeads.length} ليدز مفتوحة لم يتم تحديثها منذ يومين أو أكثر`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'lead',
        navigateTab: 'leads',
      });
    }
    const autoReassignCandidates = leads.filter((l) => {
      if (!l.assignedTo) return false;
      if (l.status === 'مغلق - فوز' || l.status === 'مغلق - خسارة') return false;
      const latestActivityAt = l.timeline[0]?.createdAt || l.updatedAt || l.createdAt;
      const ageHours = (now.getTime() - new Date(latestActivityAt).getTime()) / (1000 * 60 * 60);
      return ageHours >= slaEscalationSettings.autoReassignAfterHours;
    });
    if (slaEscalationSettings.autoReassignAfterHours > 0 && autoReassignCandidates.length > 0) {
      out.push({
        id: `n-auto-reassign-candidates-${autoReassignCandidates.length}`,
        level: 'medium',
        title: 'مرشحين لإعادة توزيع تلقائي',
        message: `${autoReassignCandidates.length} ليدز تجاوزت حد SLA لإعادة التوزيع`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'lead',
        navigateTab: 'leads',
      });
    }

    const wonWithoutEvidence = leads.filter((l) => {
      if (l.status !== 'مغلق - فوز') return false;
      return !l.timeline.some((a) => Boolean(a.evidenceRef?.trim()));
    });
    if (wonWithoutEvidence.length > 0) {
      out.push({
        id: `n-archive-gap-${wonWithoutEvidence.length}`,
        level: 'medium',
        queue: 'ops',
        title: 'فجوة أرشفة مستندات العملاء',
        message: `${wonWithoutEvidence.length} عميل فائز بدون أي دليل/مرفق في السجل`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'lead',
        navigateTab: 'leads',
      });
    }

    const unassigned = leads.filter(l => !l.assignedTo && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة');
    if (unassigned.length > 0) {
      out.push({
        id: `n-unassigned-${unassigned.length}`,
        level: 'medium',
        title: 'ليدز غير مسندة',
        message: `${unassigned.length} ليدز بدون مندوب حتى الآن`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'lead',
      });
    }

    /** تعيين ليد لمندوب/مدير مبيعات — آخر نشاط على الليد يبيّن التوجيه (حديثاً) */
    const ASSIGN_ACTION_RE = /تعيين المندوب|توزيع تلقائي/;
    const ASSIGN_MAX_MS = 14 * 24 * 60 * 60 * 1000;
    const leadsWithRecentAssignment = leads.filter((l) => {
      if (!l.assignedTo) return false;
      if (l.status === 'مغلق - فوز' || l.status === 'مغلق - خسارة') return false;
      const a = l.timeline?.[0];
      if (!a?.createdAt || !a?.action) return false;
      if (!ASSIGN_ACTION_RE.test(String(a.action))) return false;
      return now.getTime() - new Date(a.createdAt).getTime() <= ASSIGN_MAX_MS;
    });
    const assignByUser = new Map<string, Lead[]>();
    for (const l of leadsWithRecentAssignment) {
      const rid = String(l.assignedTo || '').trim();
      if (!rid) continue;
      const arr = assignByUser.get(rid) || [];
      if (arr.length < 30) arr.push(l);
      assignByUser.set(rid, arr);
    }
    assignByUser.forEach((list, assigneeId) => {
      const u = users.find((x) => String(x.id).trim() === assigneeId);
      if (!u || (u.role !== 'مندوب' && u.role !== 'مدير مبيعات')) return;
      const lines = list
        .slice(0, 8)
        .map((l) => `• ${l.name}${l.company ? ` — ${l.company}` : ''}`)
        .join('\n');
      const more = list.length > 8 ? `\n… و${list.length - 8} ليدز أخرى` : '';
      out.push({
        id: `n-lead-assigned-to-${assigneeId}-${list.length}`,
        level: 'high',
        title: `تم توجيه ليدز إليك (${list.length})`,
        message: `يوجد ${list.length} عميلاً مُسنَدين إليك مؤخراً:\n${lines}${more}`,
        createdAt: nowIso,
        targetRoles: [u.role],
        targetUserId: assigneeId,
        entityType: 'lead',
        navigateTab: 'leads',
      });
    });

    const managerId =
      leadIngestionSettings.managerUserId
      || users.find((u) => u.role === 'مدير مبيعات')?.id
      || '';
    const pendingImported = leads.filter((l) =>
      l.assignedTo === managerId &&
      l.status === 'جديد' &&
      (
        l.source === 'Facebook Leads API'
        || l.source === 'LinkedIn Lead Gen'
        || l.source === 'Google Ads Leads'
        || l.source === 'Google Business Leads'
        || l.source === 'Email Leads Inbox'
      )
    );
    if (pendingImported.length > 0 && managerId) {
      out.push({
        id: `n-imported-manager-${pendingImported.length}`,
        level: 'high',
        title: 'ليدز جديدة من القنوات المربوطة',
        message: `${pendingImported.length} ليدز وصلت تلقائياً وتنتظر توزيع مدير المبيعات`,
        createdAt: nowIso,
        targetRoles: ['مدير مبيعات', 'مالك'],
        targetUserId: managerId,
        entityType: 'lead',
        navigateTab: 'leads',
      });
      out.push({
        id: `n-imported-owner-copy-${pendingImported.length}`,
        level: 'medium',
        title: 'نسخة متابعة: ليدز القنوات المربوطة',
        message: `${pendingImported.length} ليدز وصلت تلقائياً وتنتظر توزيع مدير المبيعات`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'lead',
        navigateTab: 'leads',
      });
    }

    const pendingExpenses = expenses.filter(e => e.approvalStatus === 'قيد الاعتماد').length;
    if (pendingExpenses > 0) {
      out.push({
        id: `n-pending-expenses-${pendingExpenses}`,
        level: 'medium',
        title: 'مصروفات بانتظار الاعتماد',
        message: `يوجد ${pendingExpenses} مصروفات تحتاج اعتماد`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات', 'محاسب'],
        entityType: 'system',
      });
    }

    /** مقدّم المصروف يعرف أن طلبه ما زال بانتظار الاعتماد */
    const pendingExpRows = expenses.filter((e) => e.approvalStatus === 'قيد الاعتماد' && String(e.submittedById || '').trim());
    const expBySubmitter = new Map<string, Expense[]>();
    for (const e of pendingExpRows) {
      const sid = String(e.submittedById).trim();
      const arr = expBySubmitter.get(sid) || [];
      if (arr.length < 20) arr.push(e);
      expBySubmitter.set(sid, arr);
    }
    expBySubmitter.forEach((list, submitterId) => {
      const u = users.find((x) => String(x.id).trim() === submitterId);
      if (!u) return;
      const lines = list
        .slice(0, 6)
        .map((ex) => `• ${ex.title} — ${(ex.totalAmount ?? ex.amount).toLocaleString('ar-EG')} ج.م`)
        .join('\n');
      const more = list.length > 6 ? `\n… و${list.length - 6} مصروفات أخرى` : '';
      out.push({
        id: `n-expense-pending-submitter-${submitterId}-${list.length}`,
        level: 'medium',
        title: `مصروفاتك بانتظار الاعتماد (${list.length})`,
        message: `${lines}${more}`,
        createdAt: nowIso,
        targetRoles: [u.role],
        targetUserId: submitterId,
        entityType: 'system',
        navigateTab: u.role === 'مدير إنتاج' ? 'production' : 'home',
      });
    });

    const pendingProdClaims = shootBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
      + equipmentBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
      + meetingBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length;
    if (pendingProdClaims > 0) {
      out.push({
        id: `n-prod-claims-${pendingProdClaims}`,
        level: 'high',
        title: 'مطالبات مالية لطلبات الإنتاج',
        message: `يوجد ${pendingProdClaims} مطالبات مالية معتمدة من المالك بانتظار تنفيذ المحاسب`,
        createdAt: nowIso,
        targetRoles: ['محاسب'],
        entityType: 'system',
        navigateTab: 'bookings',
      });
    }

    /** طلبات «قيد المراجعة» كانت خارج التنبيهات — المالك/مدير المبيعات يحتاجان يكونوا على علم قبل الاعتماد. */
    const pendingShootReviews = shootBookings.filter((b) => b.status === 'قيد المراجعة');
    if (pendingShootReviews.length > 0) {
      const lines = pendingShootReviews
        .slice(0, 8)
        .map((b) => `• ${b.customerName} — ${b.date} ${b.time} (${b.repName})`)
        .join('\n');
      const more =
        pendingShootReviews.length > 8 ? `\n… و${pendingShootReviews.length - 8} طلبات أخرى` : '';
      out.push({
        id: `n-shoot-pending-batch-${pendingShootReviews.length}`,
        level: pendingShootReviews.some((b) => b.financialStatus === 'بانتظار_اعتماد_مالك')
          ? 'high'
          : 'medium',
        title: `طلبات حجز تصوير بانتظار المراجعة (${pendingShootReviews.length})`,
        message: `${lines}${more}`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'system',
        navigateTab: 'bookings',
      });
    }
    const shootPendingByRep = new Map<string, ShootBooking[]>();
    pendingShootReviews.forEach((b) => {
      const rid = String(b.repId || '').trim();
      if (!rid) return;
      const arr = shootPendingByRep.get(rid) || [];
      arr.push(b);
      shootPendingByRep.set(rid, arr);
    });
    shootPendingByRep.forEach((list, repId) => {
      const u = users.find((x) => String(x.id).trim() === repId);
      if (!u || u.role !== 'مندوب') return;
      out.push({
        id: `n-shoot-pending-my-${repId}-${list.length}`,
        level: 'medium',
        title: `طلبات تصويرك بانتظار المراجعة (${list.length})`,
        message: list
          .slice(0, 6)
          .map((b) => `• ${b.customerName} — ${b.date} ${b.time}`)
          .join('\n') + (list.length > 6 ? `\n… و${list.length - 6} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['مندوب'],
        targetUserId: repId,
        entityType: 'system',
        navigateTab: 'bookings',
      });
    });
    const pendingShootFinanceOwner = pendingShootReviews.filter((b) => b.financialStatus === 'بانتظار_اعتماد_مالك');
    if (pendingShootFinanceOwner.length > 0) {
      out.push({
        id: `n-shoot-finance-owner-${pendingShootFinanceOwner.length}`,
        level: 'high',
        title: `مطالبات إنتاج (تصوير) تنتظر اعتمادك (${pendingShootFinanceOwner.length})`,
        message:
          `${pendingShootFinanceOwner.length} طلباً من مدير الإنتاج بمبالغ أو شروط مالية بحاجة لاعتماد المالك. راجع الحجوزات.`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'system',
        navigateTab: 'bookings',
      });
    }

    const pendingEquipmentReviews = equipmentBookings.filter((b) => b.status === 'قيد المراجعة');
    if (pendingEquipmentReviews.length > 0) {
      out.push({
        id: `n-equipment-pending-batch-${pendingEquipmentReviews.length}`,
        level: 'medium',
        title: `حجوزات معدات تحت المراجعة (${pendingEquipmentReviews.length})`,
        message: pendingEquipmentReviews
          .slice(0, 6)
          .map((b) => `• ${b.equipmentName} — ${b.customerName}`)
          .join('\n'),
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'system',
        navigateTab: 'bookings',
      });
    }
    const equipPendingByRep = new Map<string, EquipmentBooking[]>();
    pendingEquipmentReviews.forEach((b) => {
      const rid = String(b.repId || '').trim();
      if (!rid) return;
      const arr = equipPendingByRep.get(rid) || [];
      arr.push(b);
      equipPendingByRep.set(rid, arr);
    });
    equipPendingByRep.forEach((list, repId) => {
      const u = users.find((x) => String(x.id).trim() === repId);
      if (!u || u.role !== 'مندوب') return;
      out.push({
        id: `n-equipment-pending-my-${repId}-${list.length}`,
        level: 'medium',
        title: `طلبات معداتك بانتظار المراجعة (${list.length})`,
        message: list
          .slice(0, 6)
          .map((b) => `• ${b.equipmentName} — ${b.customerName}`)
          .join('\n') + (list.length > 6 ? `\n… و${list.length - 6} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['مندوب'],
        targetUserId: repId,
        entityType: 'system',
        navigateTab: 'bookings',
      });
    });

    const pendingMeetingReviews = meetingBookings.filter((b) => (b.status || 'معتمد') === 'قيد المراجعة');
    if (pendingMeetingReviews.length > 0) {
      out.push({
        id: `n-meeting-pending-batch-${pendingMeetingReviews.length}`,
        level: 'medium',
        title: `اجتماعات تحت المراجعة (${pendingMeetingReviews.length})`,
        message: pendingMeetingReviews
          .slice(0, 6)
          .map((b) => `• ${b.title} — ${b.date}`)
          .join('\n'),
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات'],
        entityType: 'system',
        navigateTab: 'bookings',
      });
    }
    const meetingPendingByRep = new Map<string, MeetingBooking[]>();
    pendingMeetingReviews.forEach((b) => {
      const rid = String(b.repId || '').trim();
      if (!rid) return;
      const arr = meetingPendingByRep.get(rid) || [];
      arr.push(b);
      meetingPendingByRep.set(rid, arr);
    });
    meetingPendingByRep.forEach((list, repId) => {
      const u = users.find((x) => String(x.id).trim() === repId);
      if (!u || u.role !== 'مندوب') return;
      out.push({
        id: `n-meeting-pending-my-${repId}-${list.length}`,
        level: 'medium',
        title: `طلبات اجتماعاتك بانتظار المراجعة (${list.length})`,
        message: list
          .slice(0, 6)
          .map((b) => `• ${b.title} — ${b.date}`)
          .join('\n') + (list.length > 6 ? `\n… و${list.length - 6} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['مندوب'],
        targetUserId: repId,
        entityType: 'system',
        navigateTab: 'bookings',
      });
    });

    const invoicesWithBalance = invoices.filter((inv) => (inv.remainingAmount ?? 0) > 0);
    const overdueInstallments = invoicesWithBalance.filter((inv) => inv.nextDueDate && new Date(inv.nextDueDate).getTime() < now.getTime());
    if (overdueInstallments.length > 0) {
      out.push({
        id: `n-invoice-overdue-installments-${overdueInstallments.length}`,
        level: 'high',
        title: 'أقساط عملاء متأخرة',
        message: `يوجد ${overdueInstallments.length} فواتير بها أقساط مستحقة تجاوزت موعد السداد`,
        createdAt: nowIso,
        targetRoles: ['محاسب', 'مالك'],
        entityType: 'invoice',
        navigateTab: 'accountant',
      });
    }
    const dueSoonInstallments = invoicesWithBalance.filter((inv) => {
      if (!inv.nextDueDate) return false;
      const diff = new Date(inv.nextDueDate).getTime() - now.getTime();
      return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 3;
    });
    if (dueSoonInstallments.length > 0) {
      out.push({
        id: `n-invoice-due-soon-installments-${dueSoonInstallments.length}`,
        level: 'medium',
        title: 'أقساط عملاء تستحق قريباً',
        message: `يوجد ${dueSoonInstallments.length} فواتير يتبقى عليها تحصيل خلال 3 أيام`,
        createdAt: nowIso,
        targetRoles: ['محاسب'],
        entityType: 'invoice',
        navigateTab: 'accountant',
      });
    }

    const pendingPriceQuotes = priceQuotes.filter(q => q.status === 'قيد اعتماد المالك').length;
    if (pendingPriceQuotes > 0) {
      out.push({
        id: `n-pending-quotes-${pendingPriceQuotes}`,
        level: 'high',
        title: 'عروض أسعار بانتظار اعتماد المالك',
        message: `يوجد ${pendingPriceQuotes} عرض سعر مالي يحتاج اعتمادك قبل التسجيل في دفاتر المحاسب`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'system',
        navigateTab: 'approvals',
      });
      out.push({
        id: `n-pending-quotes-manager-copy-${pendingPriceQuotes}`,
        level: 'medium',
        title: 'نسخة متابعة لطلبات عرض السعر',
        message: `يوجد ${pendingPriceQuotes} طلبات عرض سعر بانتظار اعتماد المالك`,
        createdAt: nowIso,
        targetRoles: ['مدير مبيعات'],
        entityType: 'system',
        navigateTab: 'approvals',
      });
    }

    const pendingPricingByPm = new Map<string, number>();
    const ownerRevisionByPm = new Map<string, number>();
    priceQuotes.forEach((q) => {
      if (q.status !== 'بانتظار التسعير' || !q.productionAssignedId) return;
      const k = String(q.productionAssignedId).trim();
      if (!k) return;
      pendingPricingByPm.set(k, (pendingPricingByPm.get(k) || 0) + 1);
      if (/طلب تعديل من المالك/.test(q.pricingNote || '')) {
        ownerRevisionByPm.set(k, (ownerRevisionByPm.get(k) || 0) + 1);
      }
    });
    pendingPricingByPm.forEach((count, pmId) => {
      const rev = ownerRevisionByPm.get(pmId) || 0;
      const msg =
        rev > 0
          ? `لديك ${count} عرض سعر يحتاج التسعير — منها ${rev} بإعادة طلب من المالك لتعديل التسعير`
          : `لديك ${count} عرض سعر يحتاج التسعير في الإنتاج`;
      out.push({
        id: `n-quote-pending-pricing-${pmId}`,
        level: 'high',
        priority: rev > 0 ? 'critical' : 'normal',
        title: rev > 0 ? 'تسعير — يتضمن طلب تعديل من المالك' : 'طلبات تسعير بانتظارك',
        message: msg,
        createdAt: nowIso,
        targetRoles: ['مدير إنتاج'],
        targetUserId: pmId,
        entityType: 'system',
        navigateTab: 'bookings',
      });
    });

    const recentQuoteDecisions = priceQuotes
      .filter((q) => q.status === 'معتمد' || q.status === 'مرفوض')
      .filter((q) => q.approvedAt && (now.getTime() - new Date(q.approvedAt).getTime()) <= 1000 * 60 * 60 * 24 * 14);
    recentQuoteDecisions.forEach((q) => {
      out.push({
        id: `n-quote-result-owner-${q.id}`,
        level: q.status === 'معتمد' ? 'low' : 'medium',
        title: q.status === 'معتمد' ? 'تم اعتماد عرض سعر' : 'تم رفض عرض سعر',
        message: `${q.title} — ${q.customerName}`,
        createdAt: nowIso,
        targetRoles: ['مندوب', 'مدير مبيعات', 'مالك'],
        targetUserId: q.createdById,
        entityType: 'system',
        entityId: q.id,
        navigateTab: 'leads',
      });
      const creator = users.find((u) => u.id === q.createdById);
      if (creator?.role === 'مندوب') {
        out.push({
          id: `n-quote-result-manager-copy-${q.id}`,
          level: q.status === 'معتمد' ? 'low' : 'medium',
          title: q.status === 'معتمد' ? 'تم اعتماد عرض سعر (نسخة متابعة)' : 'تم رفض عرض سعر (نسخة متابعة)',
          message: `${q.createdByName} — ${q.title}`,
          createdAt: nowIso,
          targetRoles: ['مدير مبيعات'],
          entityType: 'system',
          entityId: q.id,
          navigateTab: 'approvals',
        });
      }
    });

    if (payrollReminderBaseline && !isPayrollApproved(monthKey)) {
      out.push({
        id: `n-payroll-${monthKey}`,
        level: 'medium',
        title: 'كشف المرتبات غير معتمد',
        message: `كشف المرتبات لشهر ${monthKey} لم يتم اعتماده بعد`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'محاسب'],
        entityType: 'system',
      });
    }
    const pendingPayrollRequest = payrollApprovalRequests.find(
      (r) => r.monthKey === monthKey && r.status === 'بانتظار_اعتماد_المالك'
    );
    if (pendingPayrollRequest) {
      out.push({
        id: `n-payroll-request-owner-${pendingPayrollRequest.id}`,
        level: 'high',
        title: 'طلب اعتماد كشف المرتبات من المحاسب',
        message: `شهر ${monthKey} — مطالبات مرفقة (${pendingPayrollRequest.claimsSummary.totalEstimatedAmount.toLocaleString()} ج.م)`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'system',
        navigateTab: 'accountant',
      });
    }

    const monthNow = getMonthKey(nowIso);
    const repsBehindCalls = users
      .filter(u => u.role === 'مندوب')
      .filter((rep) => {
        const target = monthlyTargets.find(t => t.repId === rep.id);
        const callsTarget = target?.callsTarget ?? 80;
        const assignedLeads = leads.filter(l => l.assignedTo === rep.id);
        const callsCount = assignedLeads.reduce((sum, lead) => {
          const interactionsThisMonth = lead.timeline.filter((a) => {
            if (a.userId !== rep.id) return false;
            if (getMonthKey(a.createdAt) !== monthNow) return false;
            return /(مكالمة|اتصال|واتساب|تواصل|لم يرد)/.test(a.action);
          }).length;
          return sum + interactionsThisMonth;
        }, 0);
        return callsCount < callsTarget;
      });
    if (hasActiveAssignedLead && repsBehindCalls.length > 0) {
      out.push({
        id: `n-calls-gap-${repsBehindCalls.length}`,
        level: 'low',
        title: 'مستهدف المكالمات',
        message: `${repsBehindCalls.length} مندوبين أقل من مستهدف المكالمات`,
        createdAt: nowIso,
        targetRoles: ['مالك', 'مدير مبيعات', 'محاسب'],
        entityType: 'user',
      });
    }

    const recentThreshold = Date.now() - 1000 * 60 * 60 * 24 * 30;
    shootBookings
      .filter(b => b.status === 'معتمد' || b.status === 'مرفوض')
      .filter(b => new Date(b.createdAt).getTime() >= recentThreshold)
      .forEach((b) => {
        out.push({
          id: `n-shoot-${b.id}-${b.status}`,
          level: b.status === 'معتمد' ? 'low' : 'medium',
          title: b.status === 'معتمد' ? 'تم اعتماد حجز تصوير' : 'تم رفض حجز تصوير',
          message: `${b.customerName} - ${b.date} ${b.time}`,
          createdAt: nowIso,
          targetRoles: ['مندوب'],
          targetUserId: b.repId,
          entityType: 'system',
          entityId: b.id,
        });
      });

    equipmentBookings
      .filter(b => b.status === 'معتمد' || b.status === 'مرفوض')
      .filter(b => new Date(b.createdAt).getTime() >= recentThreshold)
      .forEach((b) => {
        out.push({
          id: `n-eq-${b.id}-${b.status}`,
          level: b.status === 'معتمد' ? 'low' : 'medium',
          title: b.status === 'معتمد' ? 'تم اعتماد حجز معدات' : 'تم رفض حجز معدات',
          message: `${b.equipmentName} x${b.quantity} - ${b.customerName}`,
          createdAt: nowIso,
          targetRoles: ['مندوب'],
          targetUserId: b.repId,
          entityType: 'system',
          entityId: b.id,
        });
      });

    meetingBookings
      .filter((b) => b.status === 'معتمد' || b.status === 'مرفوض')
      .filter((b) => new Date(b.createdAt).getTime() >= recentThreshold)
      .forEach((b) => {
        out.push({
          id: `n-meeting-${b.id}-${b.status}`,
          level: b.status === 'معتمد' ? 'low' : 'medium',
          title: b.status === 'معتمد' ? 'تم اعتماد حجز اجتماع' : 'تم رفض حجز اجتماع',
          message: `${b.title} — ${b.date} ${b.startTime}`,
          createdAt: nowIso,
          targetRoles: ['مندوب'],
          targetUserId: b.repId,
          entityType: 'system',
          entityId: b.id,
        });
      });

    const custodyPendingOwner = custodyFunds.filter((c) => c.status === 'طلب_بانتظار_المالك');
    custodyPendingOwner.slice(0, 8).forEach((c) => {
      out.push({
        id: `n-custody-owner-row-${c.id}`,
        level: 'high',
        title: 'طلب عهدة إنتاج جديد',
        message: `${c.title} — ${c.totalAmount.toLocaleString()} ج.م (${c.productionManagerName})`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'system',
        entityId: c.id,
        navigateTab: 'approvals',
      });
    });
    if (custodyPendingOwner.length > 0) {
      const lines = custodyPendingOwner
        .slice(0, 6)
        .map((c) => `• ${c.title} — ${c.totalAmount.toLocaleString()} ج.م (${c.productionManagerName})`)
        .join('\n');
      const more = custodyPendingOwner.length > 6 ? `\n… و${custodyPendingOwner.length - 6} طلبات أخرى` : '';
      out.push({
        id: `n-custody-owner-${custodyPendingOwner.length}`,
        level: 'high',
        title: `طلبات عهدة بانتظار اعتمادك (${custodyPendingOwner.length})`,
        message: `${lines}${more}`,
        createdAt: nowIso,
        targetRoles: ['مالك'],
        entityType: 'system',
        navigateTab: 'approvals',
      });
    }

    const custodyPay = custodyFunds.filter((c) => c.status === 'بانتظار_دفع_محاسب');
    custodyPay.slice(0, 8).forEach((c) => {
      out.push({
        id: `n-custody-pay-row-${c.id}`,
        level: 'high',
        title: 'عهدة معتمدة تنتظر تسجيل دفع',
        message: `${c.title} — ${c.totalAmount.toLocaleString()} ج.م (${c.productionManagerName})`,
        createdAt: nowIso,
        targetRoles: ['محاسب'],
        entityType: 'system',
        entityId: c.id,
        navigateTab: 'accountant',
      });
    });
    if (custodyPay.length > 0) {
      out.push({
        id: `n-custody-pay-${custodyPay.length}`,
        level: 'high',
        title: `عهدة بانتظار تسجيل الدفع (${custodyPay.length})`,
        message: custodyPay
          .slice(0, 5)
          .map((c) => `• ${c.title} — ${c.totalAmount.toLocaleString()} ج.م`)
          .join('\n') + (custodyPay.length > 5 ? `\n… و${custodyPay.length - 5} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['محاسب'],
        entityType: 'system',
        navigateTab: 'accountant',
      });
    }

    const custodySettle = custodyFunds.filter((c) => c.status === 'تسوية_بانتظار_محاسب');
    if (custodySettle.length > 0) {
      out.push({
        id: `n-custody-settle-${custodySettle.length}`,
        level: 'high',
        title: `تسوية عهدة بانتظار إقفالك (${custodySettle.length})`,
        message: custodySettle
          .slice(0, 5)
          .map((c) => {
            const spent = c.spendLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
            return `• ${c.title} — مصروف ${spent.toLocaleString()} / ${c.totalAmount.toLocaleString()} ج.م`;
          })
          .join('\n') + (custodySettle.length > 5 ? `\n… و${custodySettle.length - 5} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['محاسب'],
        entityType: 'system',
        navigateTab: 'accountant',
      });
    }
    const activeCustodyForLong = custodyFunds.filter((c) => {
      if (c.status !== 'نشطة') return false;
      const receivedAt = c.receivedAt || c.paymentAt || c.approvedAt || c.createdAt;
      if (!receivedAt) return false;
      const ageDays = (now.getTime() - new Date(receivedAt).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays >= 7;
    });
    if (activeCustodyForLong.length > 0) {
      out.push({
        id: `n-custody-long-active-${activeCustodyForLong.length}`,
        level: 'medium',
        title: 'عهد إنتاج نشطة تحتاج تسوية',
        message: `يوجد ${activeCustodyForLong.length} عهدة نشطة منذ أكثر من 7 أيام بدون تسوية`,
        createdAt: nowIso,
        targetRoles: ['محاسب', 'مدير إنتاج', 'مالك'],
        entityType: 'system',
        navigateTab: 'production',
      });
    }

    const readyByPm = new Map<string, CustodyFund[]>();
    custodyFunds.filter((c) => c.status === 'جاهزة_للاستلام' && c.productionManagerId).forEach((c) => {
      const list = readyByPm.get(c.productionManagerId) || [];
      list.push(c);
      readyByPm.set(c.productionManagerId, list);
    });
    readyByPm.forEach((list, pmId) => {
      list.slice(0, 8).forEach((c) => {
        out.push({
          id: `n-custody-ready-row-${c.id}`,
          level: 'high',
          title: 'تم صرف العهدة — جاهزة للاستلام',
          message: `${c.title} — ${c.totalAmount.toLocaleString()} ج.م${c.paymentMethod ? ` (${c.paymentMethod})` : ''}`,
          createdAt: nowIso,
          targetRoles: ['مدير إنتاج'],
          targetUserId: pmId,
          entityType: 'system',
          entityId: c.id,
          navigateTab: 'production',
        });
      });
      out.push({
        id: `n-custody-ready-${pmId}`,
        level: 'high',
        title: `عهدة جاهزة للاستلام (${list.length})`,
        message: list
          .slice(0, 8)
          .map((c) => `• ${c.title} — ${c.totalAmount.toLocaleString()} ج.م`)
          .join('\n') + (list.length > 8 ? `\n… و${list.length - 8} أخرى` : ''),
        createdAt: nowIso,
        targetRoles: ['مدير إنتاج'],
        targetUserId: pmId,
        entityType: 'system',
        navigateTab: 'production',
      });
    });

    const rejByPm = new Map<string, CustodyFund[]>();
    custodyFunds.filter((c) => c.status === 'مرفوض_طلب' && c.productionManagerId).forEach((c) => {
      const list = rejByPm.get(c.productionManagerId) || [];
      list.push(c);
      rejByPm.set(c.productionManagerId, list);
    });
    rejByPm.forEach((list, pmId) => {
      out.push({
        id: `n-custody-rej-${pmId}`,
        level: 'medium',
        title: `طلب عهدة مرفوض (${list.length})`,
        message: list
          .slice(0, 6)
          .map((c) => `• ${c.title}${c.requestRejectReason ? ` — ${c.requestRejectReason}` : ''}`)
          .join('\n'),
        createdAt: nowIso,
        targetRoles: ['مدير إنتاج'],
        targetUserId: pmId,
        entityType: 'system',
        navigateTab: 'production',
      });
    });

    return out
      .map((n) => ({
        ...n,
        queue: n.queue || 'ops',
        priority: n.priority || (n.level === 'high' ? 'critical' : 'normal'),
      }))
      .sort((a, b) => {
        const pa = a.priority === 'critical' ? 0 : 1;
        const pb = b.priority === 'critical' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

}
