import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  LayoutDashboard, Users, Briefcase, Settings, Bell, Search, Plus, Phone, Mail, 
  MoreVertical, Filter, ArrowUpRight, Target, UserPlus, Trophy, Clock, LogOut, 
  Menu, X, ChevronRight, MessageSquare, CheckCircle2, TrendingUp, Building2, Home,
  DollarSign, ShieldCheck, Lock, Wallet, Receipt, FileUp, PieChart as PieIcon, 
  BarChart3, Calendar, Layers, Zap, Star, AlertCircle, FileText, Banknote, Trash2,
  XCircle, ArrowLeftRight
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, PieChart as RePieChart, Pie, Legend, FunnelChart, Funnel
} from 'recharts';
import { Toaster, toast } from 'sonner';
import {
  useData,
  DataProvider,
  Lead,
  User,
  LeadStatus,
  LeadCategory,
  Activity,
  Invoice,
  Expense,
  ChartOfAccount,
  ManualJournalLine,
  PriceQuote,
  ClientPayment,
  CustodyFund,
  CustodySpendLine,
  CustodySpendAttachment,
  ExternalLeadChannel,
  IntegrationProvider,
  SystemNotification,
  DeleteLeadResult,
  canonicalTodoUserId,
  PersonalTodo,
  BookingSpendLine,
  custodyFundBelongsToProductionManager,
} from './context/DataContext';
import SeoOverviewPage from './(dashboard)/seo/page';
import SeoAuditPage from './(dashboard)/seo/audit/page';
import SeoKeywordsPage from './(dashboard)/seo/keywords/page';
import SeoContentPage from './(dashboard)/seo/content/page';
import SeoRankingsPage from './(dashboard)/seo/rankings/page';
import SeoBacklinksPage from './(dashboard)/seo/backlinks/page';
import SeoReportsPage from './(dashboard)/seo/reports/page';
import { getApiBaseUrl } from '@/config/api';
import {
  isSupabaseDirectMode,
  getSupabaseDashboardAuthUsersUrl,
  getSupabaseDashboardEditorUrl,
  getSupabaseDashboardSqlUrl,
} from '@/config/supabaseMode';
import { getSupabase } from '@/lib/supabase/client';
import { mapUserFromRow } from '@/lib/supabase/postgrestMappers';
import { isServerDataMode } from '@/config/dataSource';
import { expenseSubmitterDisplay } from '@/lib/expenseSubmitterDisplay';
import { patchMyPasswordApi } from '@/lib/api/authPasswordApi';
import PageViewsHub from './components/PageViewsHub';

// --- Shared Components ---
const SYSTEM_NAME = 'The Untold Story System';
const SYSTEM_LOGO = '/brand/the-untold-story-logo.png';
const ALERT_HIGH_EXPENSE = 50000;
const ALERT_MAX_OVERDUE_LEADS = 5;
const NAV_INTENT_KEY = 'prod_system_nav_intent';
const FINANCE_INTENT_KEY = 'prod_system_finance_intent';
const BOOKING_INTENT_KEY = 'prod_system_booking_intent';
type InvoiceQuickFilter = 'all' | 'overdue_installments' | 'due_today_installments' | 'missing_cost_center';
type ExpenseQuickFilter = 'all' | 'pending_approval';
type BookingQuickFilter = 'all' | 'today' | 'pending_review' | 'financial_claims_pending_execution';

/** أدوار يُخزَّن لها راتب أساسي (عرض عند المحاسب وتعديل الراتب) */
const PAYROLL_SALARY_ROLES: User['role'][] = ['مندوب', 'محاسب', 'مدير مبيعات', 'مدير إنتاج'];

type BookingHubTab = 'shoot' | 'equipment' | 'meeting' | 'other';

function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && typeof Notification.requestPermission === 'function';
}

/** إشعار نظام التشغيل عند وجود إذن؛ يُعتمد تحت أيام أثناء عدم ظهور التبويب افتراضياً لتقليل الإزعاج مع التوست. */
function notifyDesktopPersonalTask(title: string, body: string, tag: string, showWhenTabVisible: boolean) {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  const tabHidden = document.visibilityState === 'hidden';
  if (!showWhenTabVisible && !tabHidden) return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      lang: 'ar',
      icon: typeof window !== 'undefined' ? `${window.location.origin}${SYSTEM_LOGO}` : undefined,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // تجاهل (سياقة غير آمنة أو حظر المتصفّح)
  }
}

/** نغمة تنبيه موعد المهمة — Web Audio مع resume + اهتزاز على الجوال */
async function playPersonalTodoDueBeep(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([100, 60, 100, 60, 200, 60, 400]);
    }
  } catch {
    /* ignore */
  }
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* قد يفشل بدون تفاعل مستخدم — نكمل المحاولة */
    }
    const master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    const playTone = (freq: number, start: number, dur: number, wave: OscillatorType = 'square') => {
      const osc = ctx.createOscillator();
      osc.type = wave;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.exponentialRampToValueAtTime(0.85, start + 0.025);
      env.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.frequency.value = freq;
      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    };
    const t0 = ctx.currentTime;
    for (let round = 0; round < 3; round++) {
      const b = round * 0.42;
      playTone(784, t0 + b, 0.12);
      playTone(988, t0 + b + 0.14, 0.12);
      playTone(1175, t0 + b + 0.28, 0.14);
    }
    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }, 2200);
  } catch {
    /* حظر التشغيل التلقائي أو غياب Web Audio */
  }
}
const REP_INTERACTION_PLAYBOOKS: Record<'call' | 'chat' | 'other', { id: string; label: string; text: string }[]> = {
  call: [
    { id: 'call-discovery', label: 'اكتشاف احتياج العميل', text: 'تمت مكالمة اكتشاف: فهم الهدف التجاري، التحديات الحالية، والميزانية المتوقعة. الخطوة التالية: إرسال تصور أولي خلال 24 ساعة.' },
    { id: 'call-followup', label: 'متابعة بعد عرض السعر', text: 'تمت مكالمة متابعة عرض السعر: شرح البنود الرئيسية والجدول الزمني، وتم تسجيل الملاحظات المطلوبة من العميل قبل قرار نهائي.' },
  ],
  chat: [
    { id: 'chat-brief', label: 'جمع الـBrief عبر الشات', text: 'تم استلام Brief عبر الشات: نطاق العمل، المخرجات المطلوبة، وأمثلة مرجعية. سيتم تحويلها لعرض سعر تفصيلي.' },
    { id: 'chat-reminder', label: 'تذكير واستكمال المتطلبات', text: 'تم إرسال متابعة واتساب لتأكيد النقاط الناقصة (الميزانية/الموعد/الموافقات الداخلية) مع تحديد موعد رد واضح.' },
  ],
  other: [
    { id: 'other-summary', label: 'تحديث عام منظم', text: 'تم تسجيل تحديث منظم على العميل مع توضيح ما تم، ما ينتظر من العميل، والخطوة التشغيلية التالية بالتاريخ.' },
  ],
};

const StatCard = ({ title, value, icon: Icon, trend, onClick }: any) => (
  <button
    type="button"
    onClick={onClick}
    className={`premium-3d-card w-full text-right relative overflow-hidden bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-rose-500/[0.05] backdrop-blur-xl border border-white/15 p-6 rounded-[2rem] shadow-[0_12px_40px_rgba(0,0,0,0.35)] hover:border-rose-400/40 hover:shadow-[0_18px_48px_rgba(190,24,93,0.22)] transition-all duration-300 group ${onClick ? 'cursor-pointer' : ''}`}
  >
    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(251,113,133,0.18),transparent_55%)]" />
    <div className="relative flex items-center justify-between mb-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-rose-500/30 to-rose-400/10 border border-rose-300/20 text-rose-100 group-hover:scale-110 transition-transform duration-300">
        <Icon className="w-6 h-6" />
      </div>
      {trend && (
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${trend > 0 ? 'bg-rose-500/20 border-rose-300/25 text-rose-100' : 'bg-zinc-500/15 border-white/15 text-zinc-200'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <p className="relative text-zinc-400 text-[11px] font-bold uppercase tracking-[0.22em] mb-2">{title}</p>
    <p className="relative text-3xl md:text-4xl font-black text-white leading-none tracking-tight">{value}</p>
  </button>
);

const MiniMetricCard = ({ title, value, hint, icon: Icon, tone = 'indigo', onClick }: any) => {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
      : tone === 'amber'
        ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
        : tone === 'rose'
          ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`premium-3d-metric w-full text-right rounded-2xl border p-4 backdrop-blur-lg shadow-[0_8px_26px_rgba(0,0,0,0.28)] ${toneClass} ${onClick ? 'hover:border-white/35 transition-all duration-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black tracking-wide">{title}</p>
          <p className="text-xl font-black mt-1">{value}</p>
          {hint && <p className="text-[11px] opacity-80 mt-1">{hint}</p>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
    </button>
  );
};

const trafficRowClass = (tone: 'safe' | 'warn' | 'danger' | 'neutral') => {
  if (tone === 'safe') return 'border-r-2 border-emerald-500/35 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]';
  if (tone === 'warn') return 'border-r-2 border-amber-500/35 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]';
  if (tone === 'danger') return 'border-r-2 border-rose-500/35 bg-rose-500/[0.04] hover:bg-rose-500/[0.08]';
  return 'border-r-2 border-transparent hover:bg-white/[0.03]';
};

const escapeHtml = (value: string) =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const SectionTitle = ({ title, subtitle, icon: Icon }: any) => (
  <div className="premium-section-title flex items-center gap-4 mb-8">
    {Icon && (
      <div className="w-12 h-12 bg-[#7C6BFF]/20 rounded-2xl flex items-center justify-center text-[#A99FFF]">
        <Icon className="w-6 h-6" />
      </div>
    )}
    <div className="min-w-0">
      <h2 className="text-2xl font-black text-white tracking-tight">{title}</h2>
      <p className="text-sm text-zinc-400 font-bold">{subtitle}</p>
    </div>
  </div>
);

// --- Owner Dashboard ---

const OwnerDashboard = ({ onGoToTab, openAccountantSubTab, openBookingsWithIntent }: any) => {
  const { leads, invoices, expenses, shootBookings, equipmentBookings, meetingBookings, getRepSnapshots, printBrandingSettings } = useData();
  const [conversionMode, setConversionMode] = useState<'all' | 'closed'>('all');
  
  const funnelData = useMemo(() => {
    const counts = {
      'جديد': leads.filter(l => l.status === 'جديد').length,
      'قيد التواصل': leads.filter(l => l.status === 'قيد التواصل').length,
      'عرض سعر': leads.filter(l => l.status === 'عرض سعر').length,
      'تفاوض': leads.filter(l => l.status === 'تفاوض').length,
      'مغلق - فوز': leads.filter(l => l.status === 'مغلق - فوز').length,
      'مغلق - خسارة': leads.filter(l => l.status === 'مغلق - خسارة').length,
    };
    return Object.entries(counts).map(([name, value]) => ({ name, value, fill: '#10b981' }));
  }, [leads]);

  const repPerformance = useMemo(() => {
    const leadMap = new Map(leads.map(lead => [lead.id, lead]));
    return getRepSnapshots().map(rep => {
      const repPaidRevenue = invoices
        .filter(inv => inv.status === 'مدفوع')
        .filter(inv => {
          const lead = leadMap.get(inv.leadId);
          return lead?.assignedTo === rep.repId;
        })
        .reduce((sum, inv) => sum + (inv.totalAmount ?? inv.amount), 0);
      return {
      name: rep.repName,
      won: rep.wonDeals,
      points: Math.round(rep.conversionRate * 10),
      revenue: repPaidRevenue,
      };
    });
  }, [getRepSnapshots, invoices, leads]);

  const totalRevenue = useMemo(
    () => invoices.filter(inv => inv.status === 'مدفوع').reduce((acc, inv) => acc + (inv.totalAmount ?? inv.amount), 0),
    [invoices]
  );
  const wonLeadsCount = useMemo(() => leads.filter(l => l.status === 'مغلق - فوز').length, [leads]);
  const closedLeadsCount = useMemo(
    () => leads.filter(l => l.status === 'مغلق - فوز' || l.status === 'مغلق - خسارة').length,
    [leads]
  );
  const conversionRateAll = useMemo(
    () => (leads.length > 0 ? ((wonLeadsCount / leads.length) * 100).toFixed(1) : '0.0'),
    [leads.length, wonLeadsCount]
  );
  const conversionRateClosed = useMemo(
    () => (closedLeadsCount > 0 ? ((wonLeadsCount / closedLeadsCount) * 100).toFixed(1) : '0.0'),
    [closedLeadsCount, wonLeadsCount]
  );
  const conversionRate = conversionMode === 'all' ? conversionRateAll : conversionRateClosed;
  const avgDealValue = useMemo(() => {
    const paidInvoices = invoices.filter(inv => inv.status === 'مدفوع');
    if (paidInvoices.length === 0) return 0;
    const totalPaid = paidInvoices.reduce((sum, inv) => sum + (inv.totalAmount ?? inv.amount), 0);
    return Math.round(totalPaid / paidInvoices.length);
  }, [invoices]);
  const ownerInsights = useMemo(() => {
    const openLeads = leads.filter(l => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length;
    const pendingRevenue = invoices
      .filter(inv => inv.status !== 'مدفوع')
      .reduce((sum, inv) => sum + (inv.totalAmount ?? inv.amount), 0);
    const lostRate = closedLeadsCount > 0 ? (Number(((closedLeadsCount - wonLeadsCount) / closedLeadsCount) * 100).toFixed(1)) : 0;
    const paidInvoicesCount = invoices.filter(inv => inv.status === 'مدفوع').length;
    const topRep = [...repPerformance].sort((a, b) => b.revenue - a.revenue)[0];
    return {
      openLeads,
      pendingRevenue,
      lostRate,
      paidInvoicesCount,
      topRep,
    };
  }, [leads, invoices, closedLeadsCount, wonLeadsCount, repPerformance]);
  const ownerBrief = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayRevenue = invoices
      .filter((inv) => inv.status === 'مدفوع' && inv.date.slice(0, 10) === todayKey)
      .reduce((sum, inv) => sum + Number(inv.totalAmount ?? inv.amount ?? 0), 0);
    const pendingApprovals = expenses.filter((e) => e.approvalStatus === 'قيد الاعتماد').length
      + shootBookings.filter((b) => b.status === 'قيد المراجعة').length
      + equipmentBookings.filter((b) => b.status === 'قيد المراجعة').length
      + meetingBookings.filter((b) => b.status === 'قيد المراجعة').length;
    const pipelineAmount = leads
      .filter((l) => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة')
      .reduce((sum, l) => sum + Number(l.budget || 0), 0);
    const staleOpenLeads = leads.filter((l) => {
      if (l.status === 'مغلق - فوز' || l.status === 'مغلق - خسارة') return false;
      const latestAt = l.timeline[0]?.createdAt || l.updatedAt || l.createdAt;
      return (Date.now() - new Date(latestAt).getTime()) >= (1000 * 60 * 60 * 24 * 2);
    }).length;
    return { todayRevenue, pendingApprovals, pipelineAmount, staleOpenLeads };
  }, [invoices, expenses, shootBookings, equipmentBookings, meetingBookings, leads]);

  const printOwnerPdf = () => {
    const company = escapeHtml(printBrandingSettings.companyName || 'اسم الشركة');
    const header = escapeHtml(printBrandingSettings.reportHeader || 'تقرير داخلي');
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:48px;max-width:160px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString('ar-EG');
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const rows = repPerformance
      .map((r) => `<tr><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.name)}</td><td style="padding:8px;border:1px solid #ddd;">${r.won}</td><td style="padding:8px;border:1px solid #ddd;">${r.revenue.toLocaleString()} ج.م</td></tr>`)
      .join('');
    const html = `
      <html dir="rtl"><head><meta charset="utf-8" /><title>تقرير المالك</title>
      <style>
        :root { --primary-color: ${primaryColor}; }
        .page-number { text-align:left; font-size:11px; color:#666; margin-top:8px; }
        @media print {
          .page-number::after { content: counter(page) " / " counter(pages); }
        }
      </style></head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid var(--primary-color);padding-bottom:10px;margin-bottom:12px;">
          <div>
            <h3 style="margin:0;">${company}</h3>
            <p style="margin:4px 0 0;color:#666;">${header}</p>
          </div>
          ${logo}
        </div>
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">تاريخ الطباعة: ${escapeHtml(printDate)}</p>` : ''}
        <h2>تقرير المالك - ملخص الأداء</h2>
        <p>إجمالي الإيرادات: ${totalRevenue.toLocaleString()} ج.م</p>
        <p>إجمالي الليدز: ${leads.length}</p>
        <p>معدل التحويل: ${conversionRate}%</p>
        <p>متوسط قيمة الصفقة: ${avgDealValue.toLocaleString()} ج.م</p>
        <h3>أداء المناديب</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <thead><tr><th style="padding:8px;border:1px solid #ddd;">المندوب</th><th style="padding:8px;border:1px solid #ddd;">صفقات فوز</th><th style="padding:8px;border:1px solid #ddd;">الإيراد</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${(signatureName || signatureTitle) ? `
          <div style="margin-top:24px;display:flex;justify-content:flex-end;">
            <div style="text-align:center;min-width:220px;">
              <div style="height:48px;border-bottom:1px dashed #bbb;margin-bottom:6px;"></div>
              ${signatureName ? `<div style="font-weight:700;">${signatureName}</div>` : ''}
              ${signatureTitle ? `<div style="font-size:12px;color:#666;">${signatureTitle}</div>` : ''}
            </div>
          </div>
        ` : ''}
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid #ddd;color:#666;font-size:12px;">${footer}</div>
        ${printBrandingSettings.showPageNumbers ? '<div class="page-number"></div>' : ''}
      </body></html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const goLeads = (intent?: { leadsAssignedFilter?: 'all' | 'mine' | 'unassigned'; leadsStatusFilter?: 'الكل' | LeadStatus; leadsOverdueOnly?: boolean; leadsRepUserId?: string; leadsClient360Id?: string }) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', ...(intent || {}) }));
    onGoToTab?.('leads');
  };

  const goPendingApprovals = () => {
    openBookingsWithIntent?.('pending_review', 'لا توجد صفحة متاحة لعرض الطلبات المنتظرة في صلاحياتك الحالية');
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="نظرة عامة للمالك" subtitle="متابعة الأداء المالي والبيعي للشركة بالكامل" icon={LayoutDashboard} />
      <div className="flex items-center gap-3">
        <button onClick={printOwnerPdf} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">تقرير المالك PDF</button>
      </div>
      <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-2xl p-2 w-fit">
        <button
          onClick={() => setConversionMode('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black ${conversionMode === 'all' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}
        >
          تحويل = فوز / كل الليدز
        </button>
        <button
          onClick={() => setConversionMode('closed')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black ${conversionMode === 'closed' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}
        >
          تحويل = فوز / الليدز المقفولة
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MiniMetricCard title="ليدز ما زالت مفتوحة" value={ownerInsights.openLeads} hint="تحتاج متابعة حتى الإغلاق" icon={Briefcase} tone="amber" onClick={() => goLeads()} />
        <MiniMetricCard title="إيراد قيد التحصيل" value={`${ownerInsights.pendingRevenue.toLocaleString()} ج.م`} hint="فواتير غير مدفوعة بالكامل" icon={Wallet} tone="indigo" onClick={() => openAccountantSubTab?.('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية')} />
        <MiniMetricCard title="معدل خسارة الصفقات" value={`${ownerInsights.lostRate}%`} hint="من إجمالي الصفقات المقفلة" icon={AlertCircle} tone={Number(ownerInsights.lostRate) > 45 ? 'rose' : 'emerald'} onClick={() => goLeads({ leadsStatusFilter: 'مغلق - خسارة' })} />
        <MiniMetricCard title="أفضل مندوب حاليًا" value={ownerInsights.topRep?.name || 'لا يوجد'} hint={ownerInsights.topRep ? `${ownerInsights.topRep.revenue.toLocaleString()} ج.م` : 'لا توجد بيانات كافية'} icon={Trophy} tone="emerald" onClick={() => onGoToTab?.('team-performance')} />
      </div>
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
        <h4 className="font-black text-white mb-3">Owner Daily Brief</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <button type="button" onClick={() => openAccountantSubTab?.('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية')} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">إيراد اليوم: <span className="font-black text-emerald-300">{ownerBrief.todayRevenue.toLocaleString()} ج.م</span></button>
          <button type="button" onClick={goPendingApprovals} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">طلبات معلقة: <span className="font-black text-amber-300">{ownerBrief.pendingApprovals}</span></button>
          <button type="button" onClick={() => goLeads()} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">Pipeline مفتوح: <span className="font-black text-indigo-300">{ownerBrief.pipelineAmount.toLocaleString()} ج.م</span></button>
          <button type="button" onClick={() => goLeads({ leadsOverdueOnly: true })} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">ليدز معرضة للفقد: <span className="font-black text-rose-300">{ownerBrief.staleOpenLeads}</span></button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="إجمالي الإيرادات" value={`${totalRevenue.toLocaleString()} ج.م`} icon={DollarSign} trend={12} color="emerald" onClick={() => openAccountantSubTab?.('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية')} />
        <StatCard title="إجمالي الليدز" value={leads.length} icon={Users} trend={5} color="blue" onClick={() => goLeads()} />
        <StatCard title="معدل التحويل" value={`${conversionRate}%`} icon={Target} trend={2} color="purple" onClick={() => onGoToTab?.('team-performance')} />
        <StatCard title="متوسط قيمة الصفقة" value={`${avgDealValue.toLocaleString()} ج.م`} icon={Wallet} trend={-1} color="amber" onClick={() => openAccountantSubTab?.('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 p-8 rounded-[3rem]">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <Layers className="w-5 h-5 text-emerald-500" />
            مراحل المبيعات الموحدة
          </h3>
          <div className="space-y-3 mt-2">
            {(() => {
              const activeStages = funnelData.filter((s: any) => s.name !== 'مغلق - خسارة');
              const lossStage = funnelData.find((s: any) => s.name === 'مغلق - خسارة');
              const maxVal = Math.max(...funnelData.map((s: any) => s.value), 1);
              const stageColors: Record<string, { bar: string }> = {
                'جديد':          { bar: '#6366f1' },
                'قيد التواصل':  { bar: '#8b5cf6' },
                'عرض سعر':      { bar: '#f59e0b' },
                'تفاوض':        { bar: '#f97316' },
                'مغلق - فوز':   { bar: '#10b981' },
                'مغلق - خسارة': { bar: '#ef4444' },
              };
              const total = funnelData[0]?.value || 1;
              return (
                <>
                  {funnelData.map((stage: any, idx: number) => {
                    const isLoss = stage.name === 'مغلق - خسارة';
                    const pct = maxVal > 0 ? Math.max((stage.value / maxVal) * 100, stage.value > 0 ? 4 : 0) : 0;
                    const convPct = total > 0 ? Math.round((stage.value / total) * 100) : 0;
                    const color = stageColors[stage.name]?.bar ?? '#10b981';
                    return (
                      <div key={stage.name} className="flex items-center gap-3 group">
                        <div className="w-28 shrink-0 text-right">
                          <span className={`text-xs font-bold ${isLoss ? 'text-rose-300' : 'text-zinc-300'}`}>{stage.name}</span>
                        </div>
                        <div className="flex-1 relative h-8 bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
                          <div
                            className="h-full rounded-xl transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: color + '33', borderRight: `2px solid ${color}99` }}
                          />
                          <div className="absolute inset-0 flex items-center px-3 justify-between">
                            <span className="text-[11px] font-black" style={{ color }}>{stage.value}</span>
                            <span className="text-[10px] text-zinc-500">{convPct}%</span>
                          </div>
                        </div>
                        {idx < funnelData.length - 2 && (
                          <div className="shrink-0 w-6 flex justify-center">
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                              <path d="M5 0 L10 7 L5 14 L0 7 Z" fill="#334155" />
                            </svg>
                          </div>
                        )}
                        {idx === funnelData.length - 2 && <div className="w-6 shrink-0" />}
                        {idx === funnelData.length - 1 && <div className="w-6 shrink-0" />}
                      </div>
                    );
                  })}
                  <div className="mt-3 pt-3 border-t border-white/[0.06] flex gap-4 text-[11px] text-zinc-500">
                    <span>إجمالي: <b className="text-zinc-300">{funnelData.reduce((s: number, d: any) => s + d.value, 0)}</b></span>
                    <span>معدل الفوز: <b className="text-emerald-300">{total > 0 ? Math.round(((funnelData.find((d: any) => d.name === 'مغلق - فوز')?.value ?? 0) / total) * 100) : 0}%</b></span>
                    <span>الخسارة: <b className="text-rose-300">{total > 0 ? Math.round(((funnelData.find((d: any) => d.name === 'مغلق - خسارة')?.value ?? 0) / total) * 100) : 0}%</b></span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 p-8 rounded-[3rem]">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-emerald-500" />
            أداء المناديب (الإيرادات)
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={repPerformance}>
                <XAxis dataKey="name" stroke="#475569" fontSize={12} />
                <YAxis stroke="#475569" fontSize={12} />
                <Tooltip 
                   contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                   itemStyle={{ color: '#10b981' }}
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
              <p className="text-[11px] text-zinc-400">فواتير مدفوعة</p>
              <p className="text-lg font-black text-emerald-300">{ownerInsights.paidInvoicesCount}</p>
            </div>
            <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
              <p className="text-[11px] text-zinc-400">فجوة التحصيل</p>
              <p className="text-lg font-black text-amber-300">{ownerInsights.pendingRevenue.toLocaleString()} ج.م</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Accountant View ---

const AccountantView = ({ onGoToTab }: { onGoToTab?: (tab: string) => void }) => {
  type ExpenseCategory = Expense['category'];
  const { currentUser, invoices, expenses, leads, users, addInvoice, updateInvoiceStatus, recordInvoiceCollection, addExpense, updateExpenseStatus, approveExpense, rejectExpense, closedMonths, closeMonth, reopenMonth, isMonthClosed, chartOfAccounts, addChartAccount, removeChartAccount, manualJournalEntries, addManualJournalEntry, removeManualJournalEntry, journalCodingRules, setJournalCodingRules, expenseCodingRules, setExpenseCodingRules, customerCodePrefix, setCustomerCodePrefix, expenseSavedViews, setExpenseSavedViews, payrollAutoSendDay, setPayrollAutoSendDay, closedFiscalYears, closeFiscalYear, reopenFiscalYear, getOpeningBalances, getRepSnapshots, attendanceRecords, logAttendance, payrollApprovals, payrollApprovalRequests, financialReopenRequests, approvePayroll, reopenPayroll, isPayrollApproved, requestPayrollApproval, ownerApprovePayrollRequest, ownerRejectPayrollRequest, requestMonthReopen, ownerApproveMonthReopenRequest, ownerRejectMonthReopenRequest, printBrandingSettings, addEmployee, updateEmployeeSalary, accountingPolicy, updateAccountingPolicy, priceQuotes, custodyFunds, custodyAccountByCategory, updateCustodyAccountByCategory, createCustodyFund, submitCustodyDraftToOwner, ownerApproveCustodyRequest, ownerRejectCustodyRequest, accountantRecordCustodyPayment, accountantApproveCustodySettlement, accountantRejectCustodySettlement } = useData();
  const [activeFinanceTab, setActiveFinanceTab] = useState<'invoices' | 'expenses' | 'ledger' | 'reports' | 'coa' | 'journals' | 'reps' | 'codebook' | 'custody'>('invoices');
  const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = useState(false);
  const [invoiceDetailsId, setInvoiceDetailsId] = useState<string | null>(null);
  const [journalFocusId, setJournalFocusId] = useState<string | null>(null);
  const [isLeadPickerOpen, setIsLeadPickerOpen] = useState(false);
  const leadPickerRef = useRef<HTMLDivElement | null>(null);
  const repsSectionRef = useRef<HTMLDivElement | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    leadId: '',
    customerName: '',
    amount: '',
    vatRate: '14',
    costCenter: 'عام',
    status: 'قيد الانتظار' as Invoice['status'],
  });
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    category: 'تشغيل' as 'رواتب' | 'إيجارات' | 'معدات' | 'تسويق' | 'تشغيل' | 'ضيافة' | 'نثريات' | 'أخرى',
    amount: '',
    vatRate: '14',
    costCenter: 'عام',
    status: 'قيد الانتظار' as 'مدفوع' | 'قيد الانتظار',
    vendor: '',
    note: '',
  });
  const [coaForm, setCoaForm] = useState({
    code: '',
    name: '',
    type: 'expense' as ChartOfAccount['type'],
  });
  const [journalForm, setJournalForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    lines: [
      { accountCode: chartOfAccounts[0]?.code || '1010', debit: '', credit: '', costCenter: 'عام' },
      { accountCode: chartOfAccounts[1]?.code || '1120', debit: '', credit: '', costCenter: 'عام' },
    ] as { accountCode: string; debit: string; credit: string; costCenter: string }[],
  });
  const [payrollSearch, setPayrollSearch] = useState('');
  const [payrollSort, setPayrollSort] = useState<'net_desc' | 'penalty_desc' | 'response_asc' | 'overdue_desc' | 'name_asc'>('net_desc');
  const [payrollRoleFilter, setPayrollRoleFilter] = useState<'all' | User['role']>('all');
  const [newEmployeeForm, setNewEmployeeForm] = useState({ name: '', role: 'مندوب' as User['role'], baseSalary: '10000' });
  const [expenseCodeFilter, setExpenseCodeFilter] = useState('');
  const [expenseKeywordFilter, setExpenseKeywordFilter] = useState('');
  const [expenseMonthFilter, setExpenseMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [invoiceQuickFilter, setInvoiceQuickFilter] = useState<InvoiceQuickFilter>('all');
  const [expenseQuickFilter, setExpenseQuickFilter] = useState<ExpenseQuickFilter>('all');
  const [expensePaymentPickId, setExpensePaymentPickId] = useState<string | null>(null);
  const [newExpenseViewName, setNewExpenseViewName] = useState('');
  const [newJournalCoding, setNewJournalCoding] = useState({ title: '', accountCode: '', costCenter: 'عام' });
  const [custodyForm, setCustodyForm] = useState({ title: '', description: '', totalAmount: '', productionManagerId: '' });
  const [reopenMonthReason, setReopenMonthReason] = useState('');
  const canApproveExpenses = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const canCloseMonths = currentUser?.role === 'مالك';
  const canRequestMonthReopen = currentUser?.role === 'محاسب' || currentUser?.role === 'مالك';
  const goClient360 = (leadId?: string) => {
    if (!leadId || leadId === 'manual') return;
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };
  const pendingMonthReopenRequests = useMemo(
    () => financialReopenRequests.filter((r) => r.status === 'بانتظار_اعتماد_المالك').sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    [financialReopenRequests]
  );
  const expenseCategoryCodeMap = useMemo(() => {
    const map: Record<string, string> = {};
    expenseCodingRules.forEach((rule) => {
      map[rule.category] = rule.prefix.trim().toUpperCase() || 'EXP-OTH';
    });
    return map;
  }, [expenseCodingRules]);
  const toFour = (n: number) => String(n).padStart(4, '0');
  useEffect(() => {
    const applyFinanceIntent = () => {
      try {
        const raw = localStorage.getItem(FINANCE_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as { tab?: string; financeTab?: typeof activeFinanceTab; invoiceQuickFilter?: InvoiceQuickFilter; expenseQuickFilter?: ExpenseQuickFilter };
        if (intent.tab !== 'accountant') return;
        if (intent.financeTab) setActiveFinanceTab(intent.financeTab);
        if (intent.invoiceQuickFilter) setInvoiceQuickFilter(intent.invoiceQuickFilter);
        if (intent.expenseQuickFilter) setExpenseQuickFilter(intent.expenseQuickFilter);
        localStorage.removeItem(FINANCE_INTENT_KEY);
        if (intent.financeTab === 'reps') {
          setTimeout(() => repsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        }
      } catch {
        // ignore malformed intent
      }
    };
    applyFinanceIntent();
    window.addEventListener('storage', applyFinanceIntent);
    window.addEventListener('focus', applyFinanceIntent);
    window.addEventListener('finance-intent', applyFinanceIntent as EventListener);
    return () => {
      window.removeEventListener('storage', applyFinanceIntent);
      window.removeEventListener('focus', applyFinanceIntent);
      window.removeEventListener('finance-intent', applyFinanceIntent as EventListener);
    };
  }, []);
  const getExpenseCode = (exp: Expense) => {
    const seq = Number(exp.id.replace(/\D/g, '')) || 0;
    const prefix = expenseCategoryCodeMap[exp.category] || 'EXP-OTH';
    return `${prefix}-${toFour(seq)}`;
  };
  const getCustomerCode = (inv: Invoice) => {
    const source = inv.leadId && inv.leadId !== 'manual' ? inv.leadId : inv.customerName;
    const numeric = source.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10000;
    return `${(customerCodePrefix || 'CUS').toUpperCase()}-${toFour(numeric)}`;
  };
  const invoiceDetails = useMemo(
    () => invoices.find((inv) => inv.id === invoiceDetailsId) || null,
    [invoices, invoiceDetailsId]
  );
  const displayedJournals = useMemo(
    () => (journalFocusId ? manualJournalEntries.filter((entry) => entry.id === journalFocusId) : manualJournalEntries),
    [manualJournalEntries, journalFocusId]
  );
  
  const stats = useMemo(() => {
    const receivableTotal = invoices.reduce((acc, inv) => acc + inv.amount, 0);
    const receivablePaid = invoices.reduce((acc, inv) => acc + (inv.paidAmount ?? (inv.status === 'مدفوع' ? (inv.totalAmount ?? inv.amount) : 0)), 0);
    const receivablePending = invoices
      .filter(i => i.status === 'قيد الانتظار')
      .reduce((acc, inv) => acc + (inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0))), 0);
    const receivableLate = invoices
      .filter(i => i.status === 'متأخر')
      .reduce((acc, inv) => acc + (inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0))), 0);
    const expensesTotal = expenses.reduce((acc, exp) => acc + exp.amount, 0);
    const expensesPaid = expenses.filter(e => e.status === 'مدفوع').reduce((acc, exp) => acc + exp.amount, 0);
    const expensesPending = expenses.filter(e => e.status === 'قيد الانتظار').reduce((acc, exp) => acc + exp.amount, 0);
    const netCash = receivablePaid - expensesPaid;
    return { receivableTotal, receivablePaid, receivablePending, receivableLate, expensesTotal, expensesPaid, expensesPending, netCash };
  }, [invoices, expenses]);
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const currentPayrollApproval = useMemo(
    () => payrollApprovals.find(p => p.monthKey === currentMonthKey),
    [payrollApprovals, currentMonthKey]
  );
  const currentPayrollRequest = useMemo(
    () => payrollApprovalRequests.find((r) => r.monthKey === currentMonthKey && r.status === 'بانتظار_اعتماد_المالك'),
    [payrollApprovalRequests, currentMonthKey]
  );
  const latestPayrollRequest = useMemo(
    () => payrollApprovalRequests.find((r) => r.monthKey === currentMonthKey),
    [payrollApprovalRequests, currentMonthKey]
  );
  const filteredExpenseRows = useMemo(() => {
    const monthKey = expenseMonthFilter.trim();
    const codeKey = expenseCodeFilter.trim().toLowerCase();
    const keyword = expenseKeywordFilter.trim().toLowerCase();
    return expenses.filter((exp) => {
      const expMonth = exp.date.slice(0, 7);
      if (monthKey && expMonth !== monthKey) return false;
      const code = getExpenseCode(exp).toLowerCase();
      if (codeKey && !code.includes(codeKey)) return false;
      if (keyword) {
        const title = exp.title.toLowerCase();
        const vendor = (exp.vendor || '').toLowerCase();
        const note = (exp.note || '').toLowerCase();
        if (!title.includes(keyword) && !vendor.includes(keyword) && !note.includes(keyword)) return false;
      }
      if (expenseQuickFilter === 'pending_approval' && exp.approvalStatus !== 'قيد الاعتماد') return false;
      return true;
    });
  }, [expenses, expenseMonthFilter, expenseCodeFilter, expenseKeywordFilter, expenseQuickFilter]);

  const filteredInvoiceRows = useMemo(() => {
    const todayDateKey = new Date().toISOString().slice(0, 10);
    if (invoiceQuickFilter === 'all') return invoices;
    if (invoiceQuickFilter === 'missing_cost_center') {
      return invoices.filter((inv) => !inv.costCenter || !inv.costCenter.trim());
    }
    if (invoiceQuickFilter === 'overdue_installments') {
      return invoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && Boolean(inv.nextDueDate) && inv.nextDueDate! < todayDateKey);
    }
    if (invoiceQuickFilter === 'due_today_installments') {
      return invoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && inv.nextDueDate === todayDateKey);
    }
    return invoices;
  }, [invoices, invoiceQuickFilter]);
  const filteredExpenseSummary = useMemo(() => {
    const total = filteredExpenseRows.reduce((s, exp) => s + (exp.totalAmount ?? exp.amount), 0);
    const paid = filteredExpenseRows.filter(e => e.status === 'مدفوع').reduce((s, exp) => s + (exp.totalAmount ?? exp.amount), 0);
    const pending = total - paid;
    return { total, paid, pending, count: filteredExpenseRows.length };
  }, [filteredExpenseRows]);
  useEffect(() => {
    if (currentUser?.role !== 'محاسب') return;
    if (!payrollAutoSendDay) return;
    const today = new Date().getDate();
    if (today !== payrollAutoSendDay) return;
    if (isPayrollApproved(currentMonthKey) || currentPayrollRequest) return;
    void requestPayrollApproval(currentMonthKey, 'scheduled').catch(() => {});
  }, [currentUser, payrollAutoSendDay, currentMonthKey, currentPayrollRequest, isPayrollApproved, requestPayrollApproval]);
  const isOwnerView = currentUser?.role === 'مالك';
  const pendingPayrollRequestsForOwner = useMemo(
    () => payrollApprovalRequests.filter((r) => r.status === 'بانتظار_اعتماد_المالك'),
    [payrollApprovalRequests]
  );
  const pendingCustodyForOwner = useMemo(
    () => custodyFunds.filter((c) => c.status === 'طلب_بانتظار_المالك'),
    [custodyFunds]
  );
  const pendingCustodyFromAccountant = useMemo(
    () => pendingCustodyForOwner.filter((c) => users.find((u) => u.id === c.createdById)?.role === 'محاسب'),
    [pendingCustodyForOwner, users]
  );
  const pendingCustodyFromProduction = useMemo(
    () => pendingCustodyForOwner.filter((c) => users.find((u) => u.id === c.createdById)?.role === 'مدير إنتاج'),
    [pendingCustodyForOwner, users]
  );
  const pendingExpensesForOwner = useMemo(
    () => expenses.filter((e) => e.approvalStatus === 'قيد الاعتماد'),
    [expenses]
  );
  const pendingExpensesFromProduction = useMemo(() => {
    const fromProductionManager = (e: Expense) => {
      if (e.submittedById) {
        const u = users.find((x) => x.id === e.submittedById);
        if (u?.role === 'مدير إنتاج') return true;
      }
      return /طلب\s*مدير\s*الإنتاج/i.test(`${e.vendor || ''} ${e.note || ''}`);
    };
    return pendingExpensesForOwner.filter(fromProductionManager);
  }, [pendingExpensesForOwner, users]);
  const pendingExpensesFromAccountant = useMemo(
    () =>
      pendingExpensesForOwner.filter((e) => {
        if (e.submittedById) {
          const u = users.find((x) => x.id === e.submittedById);
          return u?.role !== 'مدير إنتاج';
        }
        return !/طلب\s*مدير\s*الإنتاج/i.test(`${e.vendor || ''} ${e.note || ''}`);
      }),
    [pendingExpensesForOwner, users]
  );

  const accountingReport = useMemo(() => {
    const revenueRecognized = invoices.filter(i => i.status === 'مدفوع').reduce((s, i) => s + i.amount, 0);
    const expenseRecognized = expenses.filter(e => e.status === 'مدفوع').reduce((s, e) => s + e.amount, 0);
    const grossProfit = revenueRecognized - expenseRecognized;
    const receivables = invoices.filter(i => i.status !== 'مدفوع').reduce((s, i) => s + i.amount, 0);
    const payables = expenses.filter(e => e.status !== 'مدفوع').reduce((s, e) => s + e.amount, 0);
    return { revenueRecognized, expenseRecognized, grossProfit, receivables, payables };
  }, [invoices, expenses]);

  const vatSummary = useMemo(() => {
    const outputVat = invoices.reduce((sum, inv) => sum + (inv.vatAmount ?? Math.round(inv.amount * ((inv.vatRate ?? 14) / 100))), 0);
    const inputVat = expenses.reduce((sum, exp) => sum + (exp.vatAmount ?? Math.round(exp.amount * ((exp.vatRate ?? 14) / 100))), 0);
    return {
      outputVat,
      inputVat,
      netVatPayable: outputVat - inputVat,
    };
  }, [invoices, expenses]);

  const accountingEntries = useMemo(() => {
    const rows: { date: string; account: string; debit: number; credit: number; note: string; costCenter: string }[] = [];
    const accountName = (code: string) => chartOfAccounts.find(a => a.code === code)?.name || code;
    invoices.forEach((inv) => {
      const vatAmount = inv.vatAmount ?? Math.round(inv.amount * ((inv.vatRate ?? 14) / 100));
      const gross = inv.totalAmount ?? inv.amount + vatAmount;
      const counterAccount = inv.status === 'مدفوع' ? 'الصندوق/البنك' : 'العملاء (ذمم مدينة)';
      rows.push({ date: inv.date, account: counterAccount, debit: gross, credit: 0, note: `فاتورة ${inv.id}`, costCenter: inv.costCenter || 'عام' });
      rows.push({ date: inv.date, account: 'إيراد خدمات', debit: 0, credit: inv.amount, note: `إثبات الإيراد ${inv.id}`, costCenter: inv.costCenter || 'عام' });
      rows.push({ date: inv.date, account: 'ضريبة قيمة مضافة مخرجات', debit: 0, credit: vatAmount, note: `VAT مخرجات ${inv.id}`, costCenter: inv.costCenter || 'عام' });
    });
    expenses.forEach((exp) => {
      const vatAmount = exp.vatAmount ?? Math.round(exp.amount * ((exp.vatRate ?? 14) / 100));
      const gross = exp.totalAmount ?? exp.amount + vatAmount;
      const counterAccount =
        exp.status !== 'مدفوع'
          ? 'الموردون (ذمم دائنة)'
          : exp.paymentMethod === 'كاش'
            ? 'الصندوق (نقدية)'
            : exp.paymentMethod === 'بنك'
              ? 'البنك'
              : 'الصندوق/البنك';
      rows.push({ date: exp.date, account: `مصروف ${exp.category}`, debit: exp.amount, credit: 0, note: `مصروف ${exp.id}`, costCenter: exp.costCenter || 'عام' });
      rows.push({ date: exp.date, account: 'ضريبة قيمة مضافة مدخلات', debit: vatAmount, credit: 0, note: `VAT مدخلات ${exp.id}`, costCenter: exp.costCenter || 'عام' });
      rows.push({
        date: exp.date,
        account: counterAccount,
        debit: 0,
        credit: gross,
        note: `إثبات الالتزام ${exp.id}${exp.status === 'مدفوع' && exp.paymentMethod ? ` — ${exp.paymentMethod}` : ''}`,
        costCenter: exp.costCenter || 'عام',
      });
    });
    manualJournalEntries.forEach((entry) => {
      entry.lines.forEach((line) => {
        rows.push({
          date: entry.date,
          account: accountName(line.accountCode),
          debit: line.debit,
          credit: line.credit,
          note: `قيد يدوي ${entry.id} - ${entry.description}`,
          costCenter: line.costCenter || 'عام',
        });
      });
    });
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, expenses, manualJournalEntries, chartOfAccounts]);

  const trialBalance = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    accountingEntries.forEach((entry) => {
      const prev = map.get(entry.account) || { debit: 0, credit: 0 };
      map.set(entry.account, { debit: prev.debit + entry.debit, credit: prev.credit + entry.credit });
    });
    return [...map.entries()].map(([account, sums]) => ({
      account,
      debit: sums.debit,
      credit: sums.credit,
      balance: sums.debit - sums.credit,
    }));
  }, [accountingEntries]);
  const currentYear = useMemo(() => String(new Date().getFullYear()), []);
  const nextYearOpening = useMemo(
    () => trialBalance.map(t => ({ accountCode: t.account, balance: t.balance })),
    [trialBalance]
  );

  const costCenterSummary = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number }>();
    invoices.forEach((inv) => {
      const cc = inv.costCenter || 'عام';
      const prev = map.get(cc) || { revenue: 0, expense: 0 };
      map.set(cc, { ...prev, revenue: prev.revenue + inv.amount });
    });
    expenses.forEach((exp) => {
      const cc = exp.costCenter || 'عام';
      const prev = map.get(cc) || { revenue: 0, expense: 0 };
      map.set(cc, { ...prev, expense: prev.expense + exp.amount });
    });
    return [...map.entries()].map(([name, sums]) => ({ name, ...sums, net: sums.revenue - sums.expense }));
  }, [invoices, expenses]);
  const profitabilityByCustomer = useMemo(() => {
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const expenseByCostCenter = new Map<string, number>();
    expenses.forEach((exp) => {
      const cc = exp.costCenter || 'عام';
      expenseByCostCenter.set(cc, (expenseByCostCenter.get(cc) || 0) + Number(exp.totalAmount ?? exp.amount ?? 0));
    });
    const rows = invoices.map((inv) => {
      const lead = leadById.get(inv.leadId);
      const costCenter = inv.costCenter || lead?.category || 'عام';
      const revenue = Number(inv.totalAmount ?? inv.amount ?? 0);
      const allocatedExpense = (expenseByCostCenter.get(costCenter) || 0) * 0.25;
      const grossProfit = revenue - allocatedExpense;
      const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      return {
        invoiceId: inv.id,
        leadId: inv.leadId,
        customerName: inv.customerName,
        costCenter,
        status: inv.status,
        revenue,
        allocatedExpense,
        grossProfit,
        marginPct,
      };
    });
    return rows
      .sort((a, b) => b.grossProfit - a.grossProfit)
      .slice(0, 30);
  }, [invoices, expenses, leads]);
  const cashflowCalendar = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    const daily = new Map<string, { expectedCollections: number; openInvoices: number }>();
    invoices.forEach((inv) => {
      const remaining = Number(inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount ?? 0) - (inv.paidAmount ?? 0)));
      if (remaining <= 0) return;
      if (!inv.nextDueDate) return;
      const due = new Date(inv.nextDueDate);
      if (Number.isNaN(due.getTime())) return;
      if (due.getTime() < start.getTime() || due.getTime() > end.getTime()) return;
      const key = due.toISOString().slice(0, 10);
      const prev = daily.get(key) || { expectedCollections: 0, openInvoices: 0 };
      daily.set(key, {
        expectedCollections: prev.expectedCollections + remaining,
        openInvoices: prev.openInvoices + 1,
      });
    });
    return Array.from(daily.entries())
      .map(([date, sums]) => ({ date, ...sums }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [invoices]);
  const nextWeekCashflow = useMemo(
    () => cashflowCalendar.slice(0, 7).reduce((sum, row) => sum + row.expectedCollections, 0),
    [cashflowCalendar]
  );
  const monthCashflow = useMemo(
    () => cashflowCalendar.reduce((sum, row) => sum + row.expectedCollections, 0),
    [cashflowCalendar]
  );

  const repsFinance = useMemo(() => {
    const employees = users;
    const snapshots = getRepSnapshots();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartTs = monthStart.getTime();

    return employees.map((rep) => {
      const snap = snapshots.find(s => s.repId === rep.id);
      const isSalesRep = rep.role === 'مندوب';
      const repLeads = isSalesRep ? leads.filter(l => l.assignedTo === rep.id) : [];
      const overdueFollowUps = repLeads.filter(l => {
        if (!l.followUpAt) return false;
        const ts = new Date(l.followUpAt).getTime();
        return ts < Date.now() && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة';
      }).length;
      const repAttendance = attendanceRecords.filter(a => a.repId === rep.id && new Date(a.createdAt).getTime() >= monthStartTs);
      const attendanceDays = new Set(repAttendance.filter(a => a.type === 'in').map(a => new Date(a.createdAt).toISOString().slice(0, 10)));
      const lateAttendanceDays = new Set(
        repAttendance.filter(a => {
          if (a.type !== 'in') return false;
          const d = new Date(a.createdAt);
          const mins = d.getHours() * 60 + d.getMinutes();
          return mins > (9 * 60 + 30);
        }).map(a => new Date(a.createdAt).toISOString().slice(0, 10))
      );

    const baseSalary =
      Number(rep.baseSalary) > 0
        ? Number(rep.baseSalary)
        : rep.authSource === 'database'
          ? 0
          : isSalesRep
            ? 10000
            : 0;
      const lateResponsePenalty = isSalesRep ? Math.max(0, (snap?.avgResponseMins || 0) - 45) * 15 : 0;
      const followUpPenalty = isSalesRep ? overdueFollowUps * 120 : 0;
      const callsShortage = isSalesRep ? Math.max(0, (snap?.callsTarget || 80) - (snap?.callsCount || 0)) : 0;
      const callsPenalty = isSalesRep ? callsShortage * 35 : 0;
      const attendancePenalty = lateAttendanceDays.size * 75;
      const totalPenalty = Math.round(lateResponsePenalty + followUpPenalty + callsPenalty + attendancePenalty);
      const netSalary = Math.max(0, baseSalary - totalPenalty);

      return {
        repId: rep.id,
        repName: rep.name,
        role: rep.role,
        baseSalary,
        netSalary,
        attendanceDays: attendanceDays.size,
        lateAttendanceDays: lateAttendanceDays.size,
        callsCount: isSalesRep ? (snap?.callsCount || 0) : 0,
        callsTarget: isSalesRep ? (snap?.callsTarget || 80) : 0,
        avgResponseMins: isSalesRep ? (snap?.avgResponseMins || 0) : 0,
        overdueFollowUps,
        penalties: {
          lateResponsePenalty: Math.round(lateResponsePenalty),
          followUpPenalty,
          callsPenalty,
          attendancePenalty,
          totalPenalty,
        },
      };
    });
  }, [users, getRepSnapshots, leads, attendanceRecords]);

  const repsPayrollSummary = useMemo(() => {
    const totalBase = repsFinance.reduce((sum, row) => sum + row.baseSalary, 0);
    const totalNet = repsFinance.reduce((sum, row) => sum + row.netSalary, 0);
    const totalPenalties = repsFinance.reduce((sum, row) => sum + row.penalties.totalPenalty, 0);
    const repsNeedAttention = repsFinance.filter(
      row => row.overdueFollowUps > 0 || (row.callsTarget > 0 && row.callsCount < row.callsTarget) || row.lateAttendanceDays > 2
    ).length;
    return {
      totalBase,
      totalNet,
      totalPenalties,
      repsNeedAttention,
      payrollGapPercent: totalBase > 0 ? Math.round((totalPenalties / totalBase) * 100) : 0,
    };
  }, [repsFinance]);

  const filteredRepsFinance = useMemo(() => {
    const q = payrollSearch.trim().toLowerCase();
    const roleFiltered = payrollRoleFilter === 'all'
      ? repsFinance
      : repsFinance.filter(row => row.role === payrollRoleFilter);
    const searched = q
      ? roleFiltered.filter(row => row.repName.toLowerCase().includes(q))
      : roleFiltered;
    const sorted = [...searched];
    sorted.sort((a, b) => {
      if (payrollSort === 'name_asc') return a.repName.localeCompare(b.repName, 'ar');
      if (payrollSort === 'penalty_desc') return b.penalties.totalPenalty - a.penalties.totalPenalty;
      if (payrollSort === 'response_asc') return a.avgResponseMins - b.avgResponseMins;
      if (payrollSort === 'overdue_desc') return b.overdueFollowUps - a.overdueFollowUps;
      return b.netSalary - a.netSalary;
    });
    return sorted;
  }, [repsFinance, payrollSearch, payrollSort, payrollRoleFilter]);

  const cycleInvoiceStatus = (status: Invoice['status']): Invoice['status'] => {
    if (status === 'قيد الانتظار') return 'مدفوع';
    if (status === 'مدفوع') return 'متأخر';
    return 'قيد الانتظار';
  };
  const cycleExpenseStatus = (status: 'مدفوع' | 'قيد الانتظار'): 'مدفوع' | 'قيد الانتظار' =>
    status === 'مدفوع' ? 'قيد الانتظار' : 'مدفوع';

  const handleAddEmployeeFromAccountant = async () => {
    const name = newEmployeeForm.name.trim();
    if (!name) {
      toast.error('اكتب اسم الموظف');
      return;
    }
    const baseSalary = Math.max(0, Number(newEmployeeForm.baseSalary) || 0);
    const ok = await addEmployee({
      name,
      role: newEmployeeForm.role,
      baseSalary: PAYROLL_SALARY_ROLES.includes(newEmployeeForm.role) ? baseSalary : undefined,
    });
    if (ok) setNewEmployeeForm({ name: '', role: 'مندوب', baseSalary: '10000' });
  };

  const handleCreateInvoice = async () => {
    const amount = Number(invoiceForm.amount);
    const vatRate = Number(invoiceForm.vatRate);
    if (!invoiceForm.customerName.trim() || !amount || amount <= 0) {
      toast.error('يرجى إدخال اسم العميل ومبلغ صحيح');
      return;
    }
    if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
      toast.error('يرجى إدخال نسبة ضريبة صحيحة');
      return;
    }

    const created = await addInvoice({
      leadId: invoiceForm.leadId || 'manual',
      customerName: invoiceForm.customerName.trim(),
      amount,
      vatRate,
      costCenter: invoiceForm.costCenter.trim() || 'عام',
      status: invoiceForm.status,
    });
    if (!created) {
      toast.error('الشهر الحالي مقفل محاسبياً ولا يمكن إضافة فاتورة جديدة');
      return;
    }

    setInvoiceForm({
      leadId: '',
      customerName: '',
      amount: '',
      vatRate: '14',
      costCenter: 'عام',
      status: 'قيد الانتظار',
    });
    setIsLeadPickerOpen(false);
    setIsCreateInvoiceOpen(false);
    toast.success('تم إصدار الفاتورة بنجاح');
  };

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!leadPickerRef.current) return;
      if (!leadPickerRef.current.contains(event.target as Node)) {
        setIsLeadPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const updateExpenseCodingRule = (category: ExpenseCategory, prefix: string) => {
    setExpenseCodingRules(prev => prev.map(rule => (
      rule.category === category
        ? { ...rule, prefix: prefix.toUpperCase().replace(/\s+/g, '') }
        : rule
    )));
  };

  const handleAddJournalCodingRule = () => {
    if (!newJournalCoding.title.trim() || !newJournalCoding.accountCode.trim()) {
      toast.error('أدخل اسم الكود والحساب');
      return;
    }
    setJournalCodingRules(prev => [
      ...prev,
      {
        id: `jr-${Date.now()}`,
        title: newJournalCoding.title.trim(),
        accountCode: newJournalCoding.accountCode.trim(),
        costCenter: newJournalCoding.costCenter.trim() || 'عام',
      },
    ]);
    setNewJournalCoding({ title: '', accountCode: chartOfAccounts[0]?.code || '1010', costCenter: 'عام' });
    toast.success('تمت إضافة كود يومية جديد');
  };

  const applyJournalCodingRule = (ruleId: string) => {
    const rule = journalCodingRules.find(r => r.id === ruleId);
    if (!rule) return;
    setJournalForm(prev => {
      if (prev.lines.length === 0) return prev;
      const nextLines = [...prev.lines];
      nextLines[0] = {
        ...nextLines[0],
        accountCode: rule.accountCode,
        costCenter: rule.costCenter || 'عام',
      };
      return {
        ...prev,
        lines: nextLines,
        description: prev.description || `قيد ${rule.title}`,
      };
    });
    toast.success(`تم تطبيق كود اليومية: ${rule.title}`);
  };

  const handleCreateExpense = async () => {
    const amount = Number(expenseForm.amount);
    const vatRate = Number(expenseForm.vatRate);
    if (!expenseForm.title.trim() || !amount || amount <= 0) {
      toast.error('يرجى إدخال وصف مصروف ومبلغ صحيح');
      return;
    }
    if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
      toast.error('يرجى إدخال نسبة ضريبة صحيحة');
      return;
    }
    const created = await addExpense({
      title: expenseForm.title.trim(),
      category: expenseForm.category,
      amount,
      vatRate,
      costCenter: expenseForm.costCenter.trim() || 'عام',
      status: expenseForm.status,
      vendor: expenseForm.vendor.trim() || undefined,
      note: expenseForm.note.trim() || undefined,
    });
    if (!created) {
      toast.error('الشهر الحالي مقفل محاسبياً ولا يمكن إضافة مصروف جديد');
      return;
    }
    setExpenseForm({
      title: '',
      category: 'تشغيل',
      amount: '',
      vatRate: '14',
      costCenter: 'عام',
      status: 'قيد الانتظار',
      vendor: '',
      note: '',
    });
    setIsCreateExpenseOpen(false);
    toast.success('تم تسجيل المصروف بنجاح');
  };
  useEffect(() => {
    const title = expenseForm.title.trim().toLowerCase();
    if (!title) return;
    if (title.includes('شاي') || title.includes('قهوة') || title.includes('ضيافة')) {
      setExpenseForm(prev => ({
        ...prev,
        category: 'ضيافة',
        costCenter: prev.costCenter === 'عام' ? 'إدارة' : prev.costCenter,
      }));
    } else if (title.includes('نثري') || title.includes('مواصلات') || title.includes('مشتريات بسيطة')) {
      setExpenseForm(prev => ({
        ...prev,
        category: 'نثريات',
        costCenter: prev.costCenter === 'عام' ? 'تشغيل' : prev.costCenter,
      }));
    }
  }, [expenseForm.title]);

  const handleAddAccount = () => {
    if (!coaForm.code.trim() || !coaForm.name.trim()) {
      toast.error('أدخل كود واسم الحساب');
      return;
    }
    const created = addChartAccount({
      code: coaForm.code.trim(),
      name: coaForm.name.trim(),
      type: coaForm.type,
    });
    if (!created) {
      toast.error('كود الحساب موجود بالفعل أو غير مسموح');
      return;
    }
    setCoaForm({ code: '', name: '', type: 'expense' });
    toast.success('تمت إضافة الحساب');
  };

  const updateJournalLine = (idx: number, patch: Partial<{ accountCode: string; debit: string; credit: string; costCenter: string }>) => {
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === idx ? { ...line, ...patch } : line)),
    }));
  };

  const addJournalLine = () => {
    setJournalForm(prev => ({
      ...prev,
      lines: [...prev.lines, { accountCode: chartOfAccounts[0]?.code || '1010', debit: '', credit: '', costCenter: 'عام' }],
    }));
  };

  const handleCreateJournal = async () => {
    const lines: ManualJournalLine[] = journalForm.lines.map(l => ({
      accountCode: l.accountCode,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      costCenter: l.costCenter || 'عام',
    }));
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    if (!journalForm.description.trim()) {
      toast.error('اكتب وصف القيد');
      return;
    }
    if (Math.abs(debit - credit) > 0.01 || debit <= 0 || credit <= 0) {
      toast.error('القيد غير متزن (المدين لازم يساوي الدائن)');
      return;
    }
    const ok = await addManualJournalEntry({
      date: new Date(journalForm.date).toISOString(),
      description: journalForm.description.trim(),
      lines,
    });
    if (!ok) {
      toast.error('تعذر حفظ القيد (قد تكون السنة مقفلة)');
      return;
    }
    setJournalForm({
      date: new Date().toISOString().slice(0, 10),
      description: '',
      lines: [
        { accountCode: chartOfAccounts[0]?.code || '1010', debit: '', credit: '', costCenter: 'عام' },
        { accountCode: chartOfAccounts[1]?.code || '1120', debit: '', credit: '', costCenter: 'عام' },
      ],
    });
    toast.success('تم حفظ القيد اليدوي');
  };

  const ledgerRows = useMemo(() => {
    const incomeRows = invoices.map(inv => ({
      id: inv.id,
      type: 'إيراد' as const,
      title: `فاتورة ${inv.customerName}`,
      amount: inv.totalAmount ?? inv.amount + (inv.vatAmount ?? Math.round(inv.amount * ((inv.vatRate ?? 14) / 100))),
      status: inv.status,
      date: inv.date,
      sign: inv.status === 'مدفوع' ? '+' : '0',
    }));
    const expenseRows = expenses.map(exp => {
      const submitter = expenseSubmitterDisplay(exp, users);
      const payTag = exp.status === 'مدفوع' && exp.paymentMethod ? ` — ${exp.paymentMethod}` : '';
      return {
        id: exp.id,
        type: 'مصروف' as const,
        title: submitter ? `${exp.title} — ${submitter}${payTag}` : `${exp.title}${payTag}`,
        amount: exp.totalAmount ?? exp.amount + (exp.vatAmount ?? Math.round(exp.amount * ((exp.vatRate ?? 14) / 100))),
        status: exp.status,
        date: exp.date,
        sign: exp.status === 'مدفوع' ? '-' : '0',
      };
    });
    return [...incomeRows, ...expenseRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, expenses, users]);

  const exportFinanceCsv = () => {
    const rows = [
      ['type', 'id', 'title', 'amount', 'status', 'date'],
      ...ledgerRows.map(r => [r.type, r.id, r.title, String(r.amount), r.status, new Date(r.date).toLocaleString('ar-EG')]),
      ['', '', '', '', '', ''],
      ['account', 'debit', 'credit', 'balance'],
      ...trialBalance.map(r => [r.account, String(r.debit), String(r.credit), String(r.balance)]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportExecutiveReport = () => {
    const rows = [
      ['metric', 'value'],
      ['revenue_recognized', String(accountingReport.revenueRecognized)],
      ['expenses_recognized', String(accountingReport.expenseRecognized)],
      ['gross_profit', String(accountingReport.grossProfit)],
      ['receivables', String(accountingReport.receivables)],
      ['payables', String(accountingReport.payables)],
      ['closed_months_count', String(closedMonths.length)],
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `executive-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPayrollCsv = () => {
    const rows = [
      ['rep_name', 'attendance_days', 'late_days', 'calls', 'calls_target', 'avg_response_mins', 'overdue_followups', 'late_response_penalty', 'followup_penalty', 'calls_penalty', 'attendance_penalty', 'total_penalty', 'base_salary', 'net_salary'],
      ...filteredRepsFinance.map(r => [
        r.repName,
        String(r.attendanceDays),
        String(r.lateAttendanceDays),
        String(r.callsCount),
        String(r.callsTarget),
        String(r.avgResponseMins),
        String(r.overdueFollowUps),
        String(r.penalties.lateResponsePenalty),
        String(r.penalties.followUpPenalty),
        String(r.penalties.callsPenalty),
        String(r.penalties.attendancePenalty),
        String(r.penalties.totalPenalty),
        String(r.baseSalary),
        String(r.netSalary),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${currentMonthKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPayrollReport = () => {
    const company = escapeHtml(printBrandingSettings.companyName || 'اسم الشركة');
    const header = escapeHtml(printBrandingSettings.reportHeader || 'تقرير داخلي');
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:44px;max-width:140px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString('ar-EG');
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const rows = filteredRepsFinance
      .map((r) => `
        <tr>
          <td>${escapeHtml(r.repName)}</td>
          <td>${r.attendanceDays}</td>
          <td>${r.lateAttendanceDays}</td>
          <td>${r.callsCount}/${r.callsTarget}</td>
          <td>${r.avgResponseMins} دقيقة</td>
          <td>${r.overdueFollowUps}</td>
          <td>${r.penalties.totalPenalty.toLocaleString()} ج.م</td>
          <td>${r.baseSalary.toLocaleString()} ج.م</td>
          <td>${r.netSalary.toLocaleString()} ج.م</td>
        </tr>
      `)
      .join('');
    const html = `
      <html dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>كشف المرتبات - ${currentMonthKey}</title>
        <style>
          :root { --primary-color: ${primaryColor}; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
          h2 { margin-bottom: 6px; }
          p { margin: 4px 0 12px; color: #444; }
          .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 12px 0 16px; }
          .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
          .card b { display: block; margin-top: 4px; font-size: 18px; }
          table { border-collapse: collapse; width: 100%; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: right; font-size: 12px; }
          th { background: #f5f5f5; }
          .page-number { text-align:left; font-size:11px; color:#666; margin-top:8px; }
          @media print {
            .page-number::after { content: counter(page) " / " counter(pages); }
          }
        </style>
      </head>
      <body>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid var(--primary-color);padding-bottom:10px;margin-bottom:12px;">
          <div>
            <h3 style="margin:0;">${company}</h3>
            <p style="margin:4px 0 0;color:#666;">${header}</p>
          </div>
          ${logo}
        </div>
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">تاريخ الطباعة: ${escapeHtml(printDate)}</p>` : ''}
        <h2>كشف المرتبات - ${currentMonthKey}</h2>
        <p>حالة الاعتماد: ${isPayrollApproved(currentMonthKey) ? 'معتمد' : 'غير معتمد'} | عدد الصفوف: ${filteredRepsFinance.length}</p>
        <div class="cards">
          <div class="card">إجمالي الأساسي<b>${repsPayrollSummary.totalBase.toLocaleString()} ج.م</b></div>
          <div class="card">إجمالي الصافي<b>${repsPayrollSummary.totalNet.toLocaleString()} ج.م</b></div>
          <div class="card">إجمالي الخصومات<b>${repsPayrollSummary.totalPenalties.toLocaleString()} ج.م</b></div>
          <div class="card">مندوبين يحتاجوا متابعة<b>${repsPayrollSummary.repsNeedAttention}</b></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>المندوب</th><th>حضور</th><th>تأخير</th><th>المكالمات</th><th>متوسط الرد</th><th>متابعات متأخرة</th><th>الخصومات</th><th>الأساسي</th><th>الصافي</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${(signatureName || signatureTitle) ? `
          <div style="margin-top:24px;display:flex;justify-content:flex-end;">
            <div style="text-align:center;min-width:220px;">
              <div style="height:48px;border-bottom:1px dashed #bbb;margin-bottom:6px;"></div>
              ${signatureName ? `<div style="font-weight:700;">${signatureName}</div>` : ''}
              ${signatureTitle ? `<div style="font-size:12px;color:#666;">${signatureTitle}</div>` : ''}
            </div>
          </div>
        ` : ''}
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid #ddd;color:#666;font-size:12px;">${footer}</div>
        ${printBrandingSettings.showPageNumbers ? '<div class="page-number"></div>' : ''}
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  if (isOwnerView) {
    return (
      <div className="animate-in fade-in duration-500 space-y-6">
        <SectionTitle title="اعتمادات مالية المالك" subtitle="عرض اعتماد فقط مع فصل المصدر: المحاسب vs مدير الإنتاج" icon={ShieldCheck} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-lg">طلبات قادمة من المحاسب</h4>
              <span className="text-xs text-zinc-400">
                {pendingPayrollRequestsForOwner.length + pendingCustodyFromAccountant.length + pendingExpensesFromAccountant.length} طلب
              </span>
            </div>
            <div className="space-y-3">
              {pendingPayrollRequestsForOwner.map((req) => (
                <div key={req.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">طلب اعتماد كشف مرتبات — {req.monthKey}</p>
                  <p className="text-xs text-zinc-300 mt-1">
                    إجمالي مطالبات مرفقة: {req.claimsSummary.totalEstimatedAmount.toLocaleString()} ج.م
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={async () => {
                        const ok = await ownerApprovePayrollRequest(req.id);
                        if (!ok) { toast.error('تعذر اعتماد الطلب'); return; }
                        toast.success('تم اعتماد طلب كشف المرتبات');
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >
                      اعتماد
                    </button>
                    <button
                      onClick={async () => {
                        const reason = window.prompt('سبب الرفض (اختياري):') || undefined;
                        const ok = await ownerRejectPayrollRequest(req.id, reason);
                        if (!ok) { toast.error('تعذر رفض الطلب'); return; }
                        toast.info('تم رفض طلب كشف المرتبات');
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black"
                    >
                      رفض
                    </button>
                  </div>
                </div>
              ))}
              {pendingCustodyFromAccountant.map((c) => (
                <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">طلب عهدة من المحاسب: {c.title}</p>
                  <p className="text-xs text-zinc-400 mt-1">{c.totalAmount.toLocaleString()} ج.م — موجّه إلى {c.productionManagerName}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await ownerApproveCustodyRequest(c.id); if (!ok) { toast.error('تعذر الاعتماد'); return; } toast.success('تم اعتماد طلب العهدة'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                    <button onClick={async () => { const ok = await ownerRejectCustodyRequest(c.id, window.prompt('سبب الرفض (اختياري):') || undefined); if (!ok) { toast.error('تعذر الرفض'); return; } toast.info('تم رفض طلب العهدة'); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                </div>
              ))}
              {pendingExpensesFromAccountant.map((e) => {
                const submitter = expenseSubmitterDisplay(e, users);
                return (
                <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">طلب مصروف من المحاسب: {e.title}</p>
                  <p className="text-xs text-zinc-400 mt-1">{(e.totalAmount ?? e.amount).toLocaleString()} ج.م</p>
                  {submitter ? (
                    <p className="text-[11px] text-zinc-500 mt-1">مقدّم الطلب: {submitter}</p>
                  ) : null}
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await approveExpense(e.id); if (!ok) { toast.error('تعذر اعتماد المصروف'); return; } toast.success('تم اعتماد المصروف'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                    <button onClick={async () => { const ok = await rejectExpense(e.id); if (!ok) { toast.error('تعذر رفض المصروف'); return; } toast.info('تم رفض المصروف'); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                </div>
                );
              })}
              {pendingPayrollRequestsForOwner.length === 0 && pendingCustodyFromAccountant.length === 0 && pendingExpensesFromAccountant.length === 0 && (
                <p className="text-xs text-zinc-500">لا توجد طلبات اعتماد حالياً من المحاسب.</p>
              )}
            </div>
          </div>

          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-lg">طلبات قادمة من مدير الإنتاج</h4>
              <span className="text-xs text-zinc-400">
                {pendingCustodyFromProduction.length + pendingExpensesFromProduction.length} طلب
              </span>
            </div>
            <div className="space-y-3">
              {pendingCustodyFromProduction.map((c) => (
                <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">طلب عهدة: {c.title}</p>
                  <p className="text-xs text-zinc-400 mt-1">{c.totalAmount.toLocaleString()} ج.م — {c.productionManagerName}</p>
                  <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{c.description || '—'}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await ownerApproveCustodyRequest(c.id); if (!ok) { toast.error('تعذر الاعتماد'); return; } toast.success('تم اعتماد طلب العهدة'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                    <button onClick={async () => { const ok = await ownerRejectCustodyRequest(c.id, window.prompt('سبب الرفض (اختياري):') || undefined); if (!ok) { toast.error('تعذر الرفض'); return; } toast.info('تم رفض طلب العهدة'); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                </div>
              ))}
              {pendingExpensesFromProduction.map((e) => {
                const submitter = expenseSubmitterDisplay(e, users);
                return (
                <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">طلب مصروف إنتاج: {e.title}</p>
                  <p className="text-xs text-zinc-400 mt-1">{(e.totalAmount ?? e.amount).toLocaleString()} ج.م — {e.costCenter}</p>
                  {submitter ? (
                    <p className="text-[11px] text-teal-300/90 mt-1 font-bold">مقدّم الطلب: {submitter}</p>
                  ) : null}
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await approveExpense(e.id); if (!ok) { toast.error('تعذر اعتماد المصروف'); return; } toast.success('تم اعتماد المصروف'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                    <button onClick={async () => { const ok = await rejectExpense(e.id); if (!ok) { toast.error('تعذر رفض المصروف'); return; } toast.info('تم رفض المصروف'); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                </div>
                );
              })}
              {pendingCustodyFromProduction.length === 0 && pendingExpensesFromProduction.length === 0 && (
                <p className="text-xs text-zinc-500">لا توجد طلبات اعتماد حالياً من مدير الإنتاج.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="نظام الإدارة المالية" subtitle="الفواتير، التدفقات النقدية، وتقارير التحصيل" icon={Receipt} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">إيراد محصل</p>
          <p className="text-2xl font-black text-emerald-500">{stats.receivablePaid.toLocaleString()} ج.م</p>
          <p className="text-[11px] text-zinc-500 mt-2">{invoices.filter(i => i.status === 'مدفوع').length} فاتورة مدفوعة</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">ذمم مدينة منتظرة</p>
          <p className="text-2xl font-black text-amber-500">{stats.receivablePending.toLocaleString()} ج.م</p>
          <p className="text-[11px] text-zinc-500 mt-2">{invoices.filter(i => i.status === 'قيد الانتظار').length} فاتورة معلقة</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">مصروفات مدفوعة</p>
          <p className="text-2xl font-black text-rose-400">{stats.expensesPaid.toLocaleString()} ج.م</p>
          <p className="text-[11px] text-zinc-500 mt-2">{expenses.filter(e => e.status === 'مدفوع').length} حركة دفع</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">مصروفات منتظرة</p>
          <p className="text-2xl font-black text-amber-400">{stats.expensesPending.toLocaleString()} ج.م</p>
          <p className="text-[11px] text-zinc-500 mt-2">{expenses.filter(e => e.approvalStatus === 'قيد الاعتماد').length} تحتاج اعتماد</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">صافي الخزينة</p>
          <p className={`text-2xl font-black ${stats.netCash >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>{stats.netCash.toLocaleString()} ج.م</p>
          <p className="text-[11px] text-zinc-500 mt-2">بعد خصم كل المدفوعات</p>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[2rem] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setActiveFinanceTab('invoices')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'invoices' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>الفواتير</button>
          <button onClick={() => setActiveFinanceTab('expenses')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'expenses' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>المصروفات</button>
          <button onClick={() => setActiveFinanceTab('ledger')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'ledger' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>دفتر اليومية</button>
          <button onClick={() => setActiveFinanceTab('reports')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'reports' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>التقارير التنفيذية</button>
          <button onClick={() => setActiveFinanceTab('reps')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'reps' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>إدارة الموظفين</button>
          <button onClick={() => setActiveFinanceTab('coa')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'coa' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>دليل الحسابات</button>
          <button onClick={() => setActiveFinanceTab('codebook')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'codebook' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>دليل الأكواد</button>
          <button onClick={() => setActiveFinanceTab('journals')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'journals' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>قيود يدوية</button>
          <button onClick={() => setActiveFinanceTab('custody')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'custody' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>عهد الإنتاج</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
          <button onClick={() => (activeFinanceTab === 'reps' ? printPayrollReport() : window.print())} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">طباعة</button>
          <button onClick={exportExecutiveReport} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">تقرير تنفيذي</button>
          <button onClick={exportFinanceCsv} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">تصدير CSV</button>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-[2rem] p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-300">الشهر الحالي: <span className="font-black text-white">{currentMonthKey}</span></p>
        <span className={`px-3 py-1 rounded-lg text-xs font-black ${isMonthClosed(currentMonthKey) ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          {isMonthClosed(currentMonthKey) ? 'مقفل محاسبيًا' : 'مفتوح'}
        </span>
        {canCloseMonths && !isMonthClosed(currentMonthKey) && (
          <button
            onClick={async () => {
              const ok = await closeMonth(currentMonthKey);
              if (!ok) {
                toast.error('تعذر تقفيل الشهر');
                return;
              }
              toast.success('تم تقفيل الشهر الحالي');
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            تقفيل الشهر
          </button>
        )}
        {canCloseMonths && isMonthClosed(currentMonthKey) && (
          <button
            onClick={async () => {
              const ok = await reopenMonth(currentMonthKey);
              if (!ok) {
                toast.error('تعذر إعادة فتح الشهر');
                return;
              }
              toast.success('تم إعادة فتح الشهر الحالي');
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
          >
            إعادة الفتح (مباشر)
          </button>
        )}
        <span className={`px-3 py-1 rounded-lg text-xs font-black ${closedFiscalYears.includes(currentYear) ? 'bg-rose-500/20 text-rose-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
          السنة {currentYear}: {closedFiscalYears.includes(currentYear) ? 'مقفلة' : 'مفتوحة'}
        </span>
        {canCloseMonths && !closedFiscalYears.includes(currentYear) && (
          <button
            onClick={async () => {
              const normalized = trialBalance.map((t) => {
                const code = chartOfAccounts.find(a => a.name === t.account)?.code || t.account;
                return { accountCode: code, balance: t.balance };
              });
              const ok = await closeFiscalYear(currentYear, normalized);
              if (!ok) {
                toast.error('تعذر تقفيل السنة المالية');
                return;
              }
              toast.success(`تم تقفيل سنة ${currentYear} وترحيل أرصدة افتتاحية`);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            تقفيل السنة
          </button>
        )}
        {canCloseMonths && closedFiscalYears.includes(currentYear) && (
          <button
            onClick={async () => {
              const ok = await reopenFiscalYear(currentYear);
              if (!ok) {
                toast.error('تعذر إعادة فتح السنة المالية');
                return;
              }
              toast.success(`تم فتح سنة ${currentYear}`);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
          >
            إعادة فتح السنة
          </button>
        )}
        <span className="text-xs text-zinc-400">أرصدة افتتاحية {String(Number(currentYear) + 1)}: {getOpeningBalances(String(Number(currentYear) + 1)).length}</span>
      </div>
      <div className="bg-slate-900/40 border border-slate-800 rounded-[2rem] p-4 space-y-3">
        <p className="text-sm text-zinc-200 font-black">فتح شهر مقفل بطلب اعتماد</p>
        {canRequestMonthReopen && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2">
            <input
              value={reopenMonthReason}
              onChange={(e) => setReopenMonthReason(e.target.value)}
              placeholder="سبب إعادة الفتح (إلزامي)"
              className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-xs"
            />
            <button
              onClick={async () => {
                const ok = await requestMonthReopen(currentMonthKey, reopenMonthReason);
                if (!ok) {
                  toast.error('تعذر إرسال الطلب: تحقق أن الشهر مقفل ولا يوجد طلب معلق');
                  return;
                }
                toast.success('تم إرسال طلب إعادة الفتح لاعتماد المالك');
                setReopenMonthReason('');
              }}
              className="px-3 py-2 rounded-xl text-xs font-black bg-indigo-500 text-white"
            >
              إرسال طلب إعادة فتح
            </button>
          </div>
        )}
        {currentUser?.role === 'مالك' && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">طلبات بانتظارك: {pendingMonthReopenRequests.length}</p>
            {pendingMonthReopenRequests.slice(0, 6).map((req) => (
              <div key={req.id} className="bg-[#0B1020] border border-white/10 rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-white font-bold">{req.monthKey}</span>
                <span className="text-zinc-400">{req.requestedByName}</span>
                <span className="text-zinc-500">{req.reason}</span>
                <div className="mr-auto flex gap-2">
                  <button
                    onClick={async () => {
                      const ok = await ownerApproveMonthReopenRequest(req.id);
                      if (!ok) {
                        toast.error('تعذر الاعتماد');
                        return;
                      }
                      toast.success(`تم اعتماد فتح ${req.monthKey}`);
                    }}
                    className="px-2 py-1 rounded-lg bg-emerald-500 text-slate-950 font-black"
                  >
                    اعتماد
                  </button>
                  <button
                    onClick={async () => {
                      const reason = window.prompt('سبب الرفض (اختياري)') || '';
                      const ok = await ownerRejectMonthReopenRequest(req.id, reason);
                      if (!ok) {
                        toast.error('تعذر الرفض');
                        return;
                      }
                      toast.info('تم رفض الطلب');
                    }}
                    className="px-2 py-1 rounded-lg bg-rose-500 text-white font-black"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
            {pendingMonthReopenRequests.length === 0 && <p className="text-xs text-zinc-500">لا توجد طلبات حالياً.</p>}
          </div>
        )}
      </div>

      {activeFinanceTab === 'invoices' && (
        <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-2xl p-4 text-sm text-zinc-200">
          <p className="font-black text-white mb-1">عروض أسعار المبيعات والتسجيل المحاسبي</p>
          <p className="text-xs text-zinc-400 leading-relaxed">
            عروض الأسعار التي يرسلها المندوب أو المبيعات <span className="text-amber-300 font-bold">لا تظهر هنا</span> إلا بعد اعتماد المالك؛ عندها تُنشأ فاتورة بمصدر «عرض سعر معتمد».
            الفواتير التي يُدخلها المحاسب يدوياً تُسجَّل كـ «يدوي محاسب».
            {priceQuotes.filter(q => q.status === 'قيد اعتماد المالك').length > 0 && (
              <span className="block mt-2 text-amber-200/90">
                يوجد {priceQuotes.filter(q => q.status === 'قيد اعتماد المالك').length} عرض سعر بانتظار اعتماد المالك في مركز الاعتمادات.
              </span>
            )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 bg-slate-900/40 border border-slate-800 rounded-[3rem] overflow-hidden">
          <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
            <h3 className="text-xl font-bold flex items-center gap-3">
              <Receipt className="w-5 h-5 text-emerald-500" />
              {activeFinanceTab === 'invoices'
                ? 'سجل الفواتير والتحصيل'
                : activeFinanceTab === 'expenses'
                ? 'سجل المصروفات'
                : activeFinanceTab === 'ledger'
                ? 'دفتر اليومية'
                : activeFinanceTab === 'reps'
                ? 'إدارة الموظفين: الحضور والانصراف والخصومات والرواتب'
                : activeFinanceTab === 'coa'
                ? 'دليل الحسابات'
                : activeFinanceTab === 'codebook'
                ? 'دليل الأكواد المحاسبية'
                : activeFinanceTab === 'journals'
                ? 'إدخال قيود يومية يدوية'
                : activeFinanceTab === 'custody'
                ? 'عهد الإنتاج والتكويد'
                : 'لوحة التقارير التنفيذية'}
            </h3>
            {activeFinanceTab === 'invoices' ? (
              <button onClick={() => setIsCreateInvoiceOpen(true)} className="bg-emerald-500 text-slate-950 px-6 py-2.5 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20">
                <Plus className="w-5 h-5" />
                إصدار فاتورة
              </button>
            ) : activeFinanceTab === 'expenses' ? (
              <button onClick={() => setIsCreateExpenseOpen(true)} className="bg-rose-500 text-white px-6 py-2.5 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-rose-400 transition-all">
                <Plus className="w-5 h-5" />
                تسجيل مصروف
              </button>
            ) : null}
          </div>
          {activeFinanceTab === 'invoices' && invoiceQuickFilter !== 'all' && (
            <div className="mx-8 mt-4 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2">
              <span className="text-xs text-amber-200 font-bold">فلتر تنبيهات الفواتير مفعل</span>
              <button onClick={() => setInvoiceQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">إلغاء الفلتر</button>
            </div>
          )}
          {activeFinanceTab === 'expenses' && expenseQuickFilter !== 'all' && (
            <div className="mx-8 mt-4 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2">
              <span className="text-xs text-amber-200 font-bold">فلتر تنبيهات المصروفات مفعل</span>
              <button onClick={() => setExpenseQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">إلغاء الفلتر</button>
            </div>
          )}
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-2xl border border-white/5">
            {activeFinanceTab === 'invoices' && (
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/95">
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">رقم</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">المصدر</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">العميل</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">المبلغ الأساسي</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">VAT</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الإجمالي</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">المحصل</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">المتبقي</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">موعد القسط</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">مركز تكلفة</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">التاريخ</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الحالة</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredInvoiceRows.map((inv, idx) => (
                    <tr key={inv.id} className={`border-r-2 ${inv.status === 'مدفوع' ? 'border-emerald-500/30' : inv.status === 'متأخر' ? 'border-rose-500/30' : 'border-amber-500/30'} ${idx % 2 === 0 ? 'bg-[#0E152B]/55' : 'bg-[#0B1224]/55'} hover:bg-[#1A2440]/55 transition-colors`}>
                      <td className="p-6 font-mono text-emerald-500 text-xs">{inv.id}</td>
                      <td className="p-6 text-[10px] font-bold">
                        <span className={`px-2 py-1 rounded-lg inline-block ${inv.recordOrigin === 'عرض_سعر_معتمد' ? 'bg-emerald-500/15 text-emerald-300' : inv.recordOrigin === 'يدوي_محاسب' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-500/15 text-zinc-400'}`}>
                          {inv.recordOrigin === 'عرض_سعر_معتمد' ? 'عرض معتمد' : inv.recordOrigin === 'يدوي_محاسب' ? 'يدوي محاسب' : 'ترحيل'}
                        </span>
                      </td>
                      <td className="p-6 font-bold text-slate-200">
                        {inv.leadId && inv.leadId !== 'manual' ? (
                          <button type="button" onClick={() => goClient360(inv.leadId)} className="cursor-pointer text-right hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                            {inv.customerName}
                          </button>
                        ) : (
                          <p>{inv.customerName}</p>
                        )}
                        <p className="text-[10px] text-zinc-500 mt-1">كود عميل: {getCustomerCode(inv)}</p>
                      </td>
                      <td className="p-6 font-black text-white">{inv.amount.toLocaleString()} ج.م</td>
                      <td className="p-6 text-indigo-300">{(inv.vatAmount ?? 0).toLocaleString()} ج.م</td>
                      <td className="p-6 font-black text-emerald-300">{(inv.totalAmount ?? inv.amount).toLocaleString()} ج.م</td>
                      <td className="p-6 text-emerald-300 font-bold">{(inv.paidAmount ?? 0).toLocaleString()} ج.م</td>
                      <td className="p-6 text-amber-300 font-bold">{(inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0))).toLocaleString()} ج.م</td>
                      <td className="p-6 text-xs text-zinc-300">{inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString('ar-EG') : '—'}</td>
                      <td className="p-6 text-xs text-zinc-300">{inv.costCenter || 'عام'}</td>
                      <td className="p-6 text-xs text-slate-500 font-bold">{new Date(inv.date).toLocaleDateString('ar-EG')}</td>
                      <td className="p-6"><span className={`px-4 py-1.5 rounded-xl text-[9px] font-black inline-flex items-center gap-2 ${inv.status === 'مدفوع' ? 'bg-emerald-500/10 text-emerald-500' : inv.status === 'متأخر' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>{inv.status}</span></td>
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setInvoiceDetailsId(inv.id)}
                            data-tooltip="عرض تفاصيل الفاتورة"
                            aria-label="عرض تفاصيل الفاتورة"
                            className="icon-tooltip p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white border border-slate-700/50"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              void (async () => {
                              const nextStatus = cycleInvoiceStatus(inv.status);
                              const updated = await updateInvoiceStatus(inv.id, nextStatus);
                              if (!updated) {
                                toast.error('لا يمكن تعديل فاتورة ضمن شهر مقفل');
                                return;
                              }
                              toast.success(`تم تحديث الحالة إلى: ${nextStatus}`);
                              })();
                            }}
                            data-tooltip="تغيير حالة الفاتورة"
                            aria-label="تغيير حالة الفاتورة"
                            className="icon-tooltip p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white border border-slate-700/50"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              void (async () => {
                              const remaining = inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0));
                              if (remaining <= 0) {
                                toast.info('الفاتورة مسددة بالكامل');
                                return;
                              }
                              const amountInput = window.prompt(`أدخل قيمة الدفعة (المتبقي ${remaining.toLocaleString()} ج.م)`, String(remaining));
                              if (!amountInput) return;
                              const amount = Number(amountInput);
                              if (!Number.isFinite(amount) || amount <= 0) {
                                toast.error('قيمة غير صحيحة');
                                return;
                              }
                              const methodInput = window.prompt('طريقة التحصيل: اكتب "كاش" أو "تحويل"', 'تحويل');
                              const method = methodInput === 'كاش' ? 'كاش' : 'تحويل';
                              const nextDueDate = window.prompt('موعد القسط القادم (YYYY-MM-DD) - اتركه فارغ لو لا يوجد متبقي', inv.nextDueDate ? inv.nextDueDate.slice(0, 10) : '');
                              const ok = await recordInvoiceCollection(inv.id, {
                                amount,
                                method,
                                nextDueDate: nextDueDate?.trim() || undefined
                              });
                              if (!ok) {
                                toast.error('تعذر تسجيل الدفعة (تحقق من صلاحياتك أو إقفالات الفترة)');
                                return;
                              }
                              toast.success('تم تسجيل الدفعة وإنشاء قيد التحصيل تلقائيًا');
                              })();
                            }}
                            data-tooltip="تسجيل دفعة تحصيل"
                            aria-label="تسجيل دفعة تحصيل"
                            className="icon-tooltip p-2.5 bg-emerald-600/25 hover:bg-emerald-600/35 rounded-xl text-emerald-200 hover:text-white border border-emerald-500/30"
                          >
                            <Banknote className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeFinanceTab === 'expenses' && (
              <>
              <div className="p-4 border-b border-slate-800 bg-[#0B1020]/50 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    type="month"
                    value={expenseMonthFilter}
                    onChange={(e) => setExpenseMonthFilter(e.target.value)}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  />
                  <input
                    value={expenseCodeFilter}
                    onChange={(e) => setExpenseCodeFilter(e.target.value)}
                    placeholder="بحث بكود المصروف (EXP-HSP...)"
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  />
                  <input
                    value={expenseKeywordFilter}
                    onChange={(e) => setExpenseKeywordFilter(e.target.value)}
                    placeholder="بحث نصي (مثال: شاي)"
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  />
                  <button
                    onClick={() => { setExpenseCodeFilter(''); setExpenseKeywordFilter(''); }}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs font-black text-zinc-200"
                  >
                    مسح الفلاتر
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newExpenseViewName}
                    onChange={(e) => setNewExpenseViewName(e.target.value)}
                    placeholder="اسم العرض المحفوظ"
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs min-w-[170px]"
                  />
                  <button
                    onClick={() => {
                      const name = newExpenseViewName.trim();
                      if (!name) { toast.error('اكتب اسم العرض أولًا'); return; }
                      setExpenseSavedViews(prev => [
                        ...prev,
                        { id: `view-${Date.now()}`, name, month: expenseMonthFilter, code: expenseCodeFilter, keyword: expenseKeywordFilter },
                      ]);
                      setNewExpenseViewName('');
                      toast.success('تم حفظ العرض');
                    }}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs font-black text-zinc-200"
                  >
                    حفظ العرض الحالي
                  </button>
                  {expenseSavedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setExpenseMonthFilter(view.month);
                          setExpenseCodeFilter(view.code);
                          setExpenseKeywordFilter(view.keyword);
                        }}
                        className="px-2 py-1 rounded-lg text-[11px] bg-white/10 border border-white/10"
                      >
                        {view.name}
                      </button>
                      <button
                        onClick={() => setExpenseSavedViews(prev => prev.filter(v => v.id !== view.id))}
                        className="px-1.5 py-1 rounded-lg text-[10px] bg-rose-500/20 text-rose-300"
                      >
                        حذف
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="px-2 py-1 rounded-lg bg-white/10 text-zinc-200">عدد الحركات: {filteredExpenseSummary.count}</span>
                  <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300">إجمالي: {filteredExpenseSummary.total.toLocaleString()} ج.م</span>
                  <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300">مدفوع: {filteredExpenseSummary.paid.toLocaleString()} ج.م</span>
                  <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300">قيد الانتظار: {filteredExpenseSummary.pending.toLocaleString()} ج.م</span>
                </div>
              </div>
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/95">
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">رقم</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">البند</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الفئة</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">المبلغ الأساسي</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">VAT</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الإجمالي</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">مركز تكلفة</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">مقدّم الطلب</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الاعتماد</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">الحالة</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">طريقة الدفع</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredExpenseRows.map((exp, idx) => (
                    <tr key={exp.id} className={`border-r-2 ${exp.approvalStatus === 'مرفوض' ? 'border-rose-500/30' : exp.status === 'مدفوع' ? 'border-emerald-500/30' : 'border-amber-500/30'} ${idx % 2 === 0 ? 'bg-[#0E152B]/55' : 'bg-[#0B1224]/55'} hover:bg-[#1A2440]/55 transition-colors`}>
                      <td className="p-6 text-xs font-mono text-rose-400">{exp.id}</td>
                      <td className="p-6">
                        <p className="font-bold">{exp.title}</p>
                        <p className="text-xs text-zinc-400">{exp.vendor || '-'}</p>
                        <p className="text-[10px] text-[#A99FFF] mt-1">كود: {getExpenseCode(exp)}</p>
                      </td>
                      <td className="p-6">
                        <p>{exp.category}</p>
                        <p className="text-[10px] text-zinc-500">{expenseCategoryCodeMap[exp.category] || 'EXP-OTH'}</p>
                      </td>
                      <td className="p-6 font-black">{exp.amount.toLocaleString()} ج.م</td>
                      <td className="p-6 text-indigo-300">{(exp.vatAmount ?? 0).toLocaleString()} ج.م</td>
                      <td className="p-6 font-black text-rose-300">{(exp.totalAmount ?? exp.amount).toLocaleString()} ج.م</td>
                      <td className="p-6 text-xs text-zinc-300">{exp.costCenter || 'عام'}</td>
                      <td className="p-6 text-xs text-zinc-400">{expenseSubmitterDisplay(exp, users) || '—'}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${exp.approvalStatus === 'معتمد' ? 'bg-emerald-500/15 text-emerald-300' : exp.approvalStatus === 'مرفوض' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {exp.approvalStatus}
                        </span>
                        {exp.approvedBy && <p className="text-[10px] text-zinc-500 mt-1">{exp.approvedBy}</p>}
                      </td>
                      <td className="p-6"><span className={`px-4 py-1.5 rounded-xl text-[9px] font-black inline-flex items-center gap-2 ${exp.status === 'مدفوع' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>{exp.status}</span></td>
                      <td className="p-6 text-xs text-zinc-300">
                        {exp.status === 'مدفوع' ? (
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${exp.paymentMethod === 'كاش' ? 'bg-amber-500/20 text-amber-200' : exp.paymentMethod === 'بنك' ? 'bg-sky-500/20 text-sky-200' : 'bg-zinc-700/40 text-zinc-500'}`}>
                            {exp.paymentMethod === 'كاش' || exp.paymentMethod === 'بنك' ? exp.paymentMethod : 'لم تُحدَّد'}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          {canApproveExpenses && exp.approvalStatus === 'قيد الاعتماد' && (
                            <>
                              <button onClick={() => { void (async () => { const ok = await approveExpense(exp.id); if (!ok) { toast.error('لا يمكن اعتماد المصروف في هذه الحالة'); return; } toast.success('تم اعتماد المصروف'); })(); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-500 text-slate-950">اعتماد</button>
                              <button onClick={() => { void (async () => { const ok = await rejectExpense(exp.id); if (!ok) { toast.error('لا يمكن رفض المصروف في هذه الحالة'); return; } toast.success('تم رفض المصروف'); })(); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-rose-500 text-white">رفض</button>
                            </>
                          )}
                          <button
                            data-tooltip="تغيير حالة المصروف (عند التسجيل كمدفوع: كاش أو بنك)"
                            aria-label="تغيير حالة المصروف"
                            onClick={() => {
                              void (async () => {
                                const next = cycleExpenseStatus(exp.status);
                                if (next === 'مدفوع') {
                                  if (exp.approvalStatus !== 'معتمد') {
                                    toast.error('لازم اعتماد المصروف قبل الدفع أو الشهر مقفل');
                                    return;
                                  }
                                  setExpensePaymentPickId(exp.id);
                                  return;
                                }
                                const ok = await updateExpenseStatus(exp.id, next);
                                if (!ok) {
                                  toast.error('لا يمكن تعديل مصروف في شهر مقفل');
                                  return;
                                }
                                toast.success(`تم تحديث الحالة إلى: ${next}`);
                              })();
                            }}
                            className="icon-tooltip p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white border border-slate-700/50"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredExpenseRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="p-6 text-center text-zinc-400 text-sm">لا توجد مصروفات مطابقة للفلاتر الحالية.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {expensePaymentPickId && (
                <div
                  className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/65"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="expense-pay-method-title"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setExpensePaymentPickId(null);
                  }}
                >
                  <div className="bg-[#0F1528] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
                    <h3 id="expense-pay-method-title" className="font-black text-lg text-white">تسجيل الدفع</h3>
                    <p className="text-sm text-zinc-400">اختر طريقة الصرف لتظهر في الدفاتر والحركة المحاسبية.</p>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="w-full py-3 rounded-xl bg-amber-500/90 text-slate-950 text-sm font-black hover:bg-amber-400 transition-colors"
                        onClick={() => {
                          void (async () => {
                            const id = expensePaymentPickId;
                            if (!id) return;
                            const ok = await updateExpenseStatus(id, 'مدفوع', 'كاش');
                            setExpensePaymentPickId(null);
                            if (!ok) {
                              toast.error('تعذر التحديث — تحقق من الاعتماد أو إغلاق الشهر أو إعداد قاعدة البيانات');
                              return;
                            }
                            toast.success('تم تسجيل المصروف كمدفوع — كاش');
                          })();
                        }}
                      >
                        كاش
                      </button>
                      <button
                        type="button"
                        className="w-full py-3 rounded-xl bg-sky-600 text-white text-sm font-black hover:bg-sky-500 transition-colors"
                        onClick={() => {
                          void (async () => {
                            const id = expensePaymentPickId;
                            if (!id) return;
                            const ok = await updateExpenseStatus(id, 'مدفوع', 'بنك');
                            setExpensePaymentPickId(null);
                            if (!ok) {
                              toast.error('تعذر التحديث — تحقق من الاعتماد أو إغلاق الشهر أو إعداد قاعدة البيانات');
                              return;
                            }
                            toast.success('تم تسجيل المصروف كمدفوع — بنك');
                          })();
                        }}
                      >
                        بنك
                      </button>
                      <button type="button" className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-300" onClick={() => setExpensePaymentPickId(null)}>
                        إلغاء
                      </button>
                    </div>
                  </div>
                </div>
              )}
              </>
            )}
            {activeFinanceTab === 'ledger' && (
              <table className="w-full text-right border-collapse">
                <thead><tr className="bg-slate-950/50"><th className="p-6 text-[10px] font-black text-slate-500 uppercase">التاريخ</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">النوع</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">الوصف</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">الحالة</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">الحركة</th></tr></thead>
                <tbody className="divide-y divide-slate-800/50">
                  {ledgerRows.map(row => (
                    <tr key={`${row.type}-${row.id}`} className={trafficRowClass(row.sign === '+' ? 'safe' : row.sign === '-' ? 'danger' : 'warn')}>
                      <td className="p-6 text-xs text-zinc-400">{new Date(row.date).toLocaleDateString('ar-EG')}</td>
                      <td className="p-6">{row.type}</td>
                      <td className="p-6 font-bold">{row.title}</td>
                      <td className="p-6 text-sm">{row.status}</td>
                      <td className={`p-6 font-black ${row.sign === '+' ? 'text-emerald-400' : row.sign === '-' ? 'text-rose-400' : 'text-zinc-400'}`}>{row.sign === '0' ? '—' : `${row.sign}${row.amount.toLocaleString()} ج.م`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeFinanceTab === 'reps' && (
              <div ref={repsSectionRef} className="p-6 space-y-4">
                <div className="bg-[#0F1528]/70 border border-white/10 rounded-2xl p-4 text-sm text-zinc-300">
                  هذه الصفحة مربوطة مباشرة ببيانات المندوبين: الحضور/الانصراف + سرعة الرد + المتابعات + عدد المكالمات مقابل التارجت.
                </div>
                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-black">إضافة موظف جديد من المحاسب</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      value={newEmployeeForm.name}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="اسم الموظف"
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    />
                    <select
                      value={newEmployeeForm.role}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, role: e.target.value as User['role'] }))}
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="مندوب">مندوب مبيعات</option>
                      <option value="محاسب">محاسب</option>
                      <option value="مدير مبيعات">مدير مبيعات</option>
                      <option value="مدير إنتاج">مدير إنتاج</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={newEmployeeForm.baseSalary}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, baseSalary: e.target.value }))}
                      disabled={!PAYROLL_SALARY_ROLES.includes(newEmployeeForm.role)}
                      placeholder="الراتب الأساسي"
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                    />
                    <button onClick={handleAddEmployeeFromAccountant} className="bg-[#7C6BFF] text-white rounded-xl px-3 py-2 text-sm font-black">
                      إضافة الموظف
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>إجمالي الموظفين: {users.length}</span>
                    <span>•</span>
                    <span>المندوبين: {users.filter(u => u.role === 'مندوب').length}</span>
                    <span>•</span>
                    <span>المحاسبين: {users.filter(u => u.role === 'محاسب').length}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <MiniMetricCard title="إجمالي المرتبات الأساسية" value={`${repsPayrollSummary.totalBase.toLocaleString()} ج.م`} hint="قبل الخصومات" icon={Wallet} tone="indigo" />
                  <MiniMetricCard title="إجمالي صافي المرتبات" value={`${repsPayrollSummary.totalNet.toLocaleString()} ج.م`} hint="بعد الخصومات" icon={CheckCircle2} tone="emerald" />
                  <MiniMetricCard title="إجمالي الخصومات" value={`${repsPayrollSummary.totalPenalties.toLocaleString()} ج.م`} hint={`${repsPayrollSummary.payrollGapPercent}% من الأساسي`} icon={AlertCircle} tone="rose" />
                  <MiniMetricCard title="موظفين يحتاجوا متابعة" value={repsPayrollSummary.repsNeedAttention} hint="تأخير/متابعات/مكالمات" icon={Users} tone="amber" />
                </div>
                <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-3">
                  <span className={`px-3 py-1 rounded-lg text-xs font-black ${isPayrollApproved(currentMonthKey) ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                    حالة كشف المرتبات {currentMonthKey}: {isPayrollApproved(currentMonthKey) ? 'معتمد' : 'غير معتمد'}
                  </span>
                  {currentPayrollApproval && (
                    <span className="text-xs text-zinc-400">
                      اعتماد بواسطة {currentPayrollApproval.approvedByName} - {new Date(currentPayrollApproval.approvedAt).toLocaleString('ar-EG')}
                    </span>
                  )}
                  <button
                    onClick={exportPayrollCsv}
                    className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200"
                  >
                    تصدير كشف المرتبات CSV
                  </button>
                  <button
                    onClick={printPayrollReport}
                    className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200"
                  >
                    طباعة / حفظ PDF
                  </button>
                  {currentUser?.role === 'محاسب' && !isPayrollApproved(currentMonthKey) && (
                    <>
                      <button
                        onClick={async () => {
                          const ok = await requestPayrollApproval(currentMonthKey, 'manual');
                          if (!ok) { toast.error('يوجد طلب قائم بالفعل أو تم اعتماد الشهر'); return; }
                          toast.success(`تم إرسال طلب اعتماد كشف المرتبات لشهر ${currentMonthKey}`);
                        }}
                        disabled={Boolean(currentPayrollRequest)}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-amber-500 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        إرسال طلب اعتماد للمالك
                      </button>
                      <div className="flex items-center gap-2 bg-[#0F1528] border border-white/10 rounded-xl px-2 py-1">
                        <span className="text-[11px] text-zinc-400">إرسال تلقائي يوم</span>
                        <input
                          type="number"
                          min={1}
                          max={28}
                          value={payrollAutoSendDay}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw) { setPayrollAutoSendDay(''); return; }
                            const num = Number(raw);
                            if (!Number.isFinite(num)) return;
                            setPayrollAutoSendDay(Math.max(1, Math.min(28, Math.floor(num))));
                          }}
                          className="w-16 bg-transparent border border-white/15 rounded-lg px-2 py-1 text-xs"
                        />
                      </div>
                    </>
                  )}
                  {currentUser?.role === 'مالك' && !isPayrollApproved(currentMonthKey) && currentPayrollRequest && (
                    <>
                      <button
                        onClick={async () => {
                          const ok = await ownerApprovePayrollRequest(currentPayrollRequest.id);
                          if (!ok) { toast.error('تعذر اعتماد الطلب'); return; }
                          toast.success(`تم اعتماد كشف المرتبات لشهر ${currentMonthKey}`);
                        }}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
                      >
                        اعتماد طلب المالك
                      </button>
                      <button
                        onClick={async () => {
                          const reason = window.prompt('سبب الرفض (اختياري):') || undefined;
                          const ok = await ownerRejectPayrollRequest(currentPayrollRequest.id, reason);
                          if (!ok) { toast.error('تعذر رفض الطلب'); return; }
                          toast.info('تم رفض طلب اعتماد كشف المرتبات');
                        }}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
                      >
                        رفض الطلب
                      </button>
                    </>
                  )}
                  {currentUser?.role === 'مالك' && isPayrollApproved(currentMonthKey) && (
                    <button
                      onClick={async () => {
                        const ok = await reopenPayroll(currentMonthKey);
                        if (!ok) {
                          toast.error('تعذر إلغاء الاعتماد');
                          return;
                        }
                        toast.info(`تم إلغاء اعتماد كشف المرتبات لشهر ${currentMonthKey}`);
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
                    >
                      إلغاء الاعتماد
                    </button>
                  )}
                </div>
                <div className="bg-[#0B1020]/50 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
                  <p className="font-black text-zinc-200">طلب اعتماد المرتبات (مستقل)</p>
                  {currentPayrollRequest ? (
                    <>
                      <p className="text-zinc-300">
                        حالة الطلب: <span className="text-amber-300 font-black">بانتظار اعتماد المالك</span> — بواسطة {currentPayrollRequest.requestedByName}
                      </p>
                      <p className="text-zinc-400">
                        الكوبون المالي المرفق: مصروفات ({currentPayrollRequest.claimsSummary.pendingExpensesCount}) + مطالبات إنتاج ({currentPayrollRequest.claimsSummary.pendingProdClaimsCount}) + عهد بانتظار دفع ({currentPayrollRequest.claimsSummary.pendingCustodyPaymentsCount}) = <span className="text-white font-black">{currentPayrollRequest.claimsSummary.totalEstimatedAmount.toLocaleString()} ج.م</span>
                      </p>
                    </>
                  ) : latestPayrollRequest ? (
                    <p className="text-zinc-400">
                      آخر طلب هذا الشهر: <span className={latestPayrollRequest.status === 'معتمد' ? 'text-emerald-300 font-black' : 'text-rose-300 font-black'}>{latestPayrollRequest.status}</span>
                      {latestPayrollRequest.rejectReason ? ` — السبب: ${latestPayrollRequest.rejectReason}` : ''}
                    </p>
                  ) : (
                    <p className="text-zinc-500">لا يوجد طلب اعتماد مرسل لهذا الشهر حتى الآن.</p>
                  )}
                </div>
                <div className="bg-[#0B1020]/60 border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px]">
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={payrollSearch}
                      onChange={(e) => setPayrollSearch(e.target.value)}
                      placeholder="بحث باسم المندوب"
                      className="w-full bg-[#0F1528] border border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs"
                    />
                  </div>
                  <select
                    value={payrollSort}
                    onChange={(e) => setPayrollSort(e.target.value as typeof payrollSort)}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="net_desc">فرز: أعلى صافي مرتب</option>
                    <option value="penalty_desc">فرز: أعلى خصومات</option>
                    <option value="response_asc">فرز: أسرع استجابة</option>
                    <option value="overdue_desc">فرز: أكثر متابعات متأخرة</option>
                    <option value="name_asc">فرز: الاسم (أ-ي)</option>
                  </select>
                  <select
                    value={payrollRoleFilter}
                    onChange={(e) => setPayrollRoleFilter(e.target.value as typeof payrollRoleFilter)}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="all">الدور: الكل</option>
                    <option value="مالك">الدور: مالك</option>
                    <option value="محاسب">الدور: محاسب</option>
                    <option value="مدير مبيعات">الدور: مدير مبيعات</option>
                    <option value="مدير إنتاج">الدور: مدير إنتاج</option>
                    <option value="مندوب">الدور: مندوب</option>
                  </select>
                  <span className="text-[11px] text-zinc-400">عدد الصفوف المعروضة: {filteredRepsFinance.length}</span>
                </div>
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-2xl border border-white/5">
                  <table className="w-full min-w-[1100px]">
                    <thead>
                      <tr className="bg-[#0B1020]/95">
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">الموظف</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">الحضور</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">المكالمات</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">متوسط الرد</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">متابعات متأخرة</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">إجمالي الخصومات</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">المرتب الأساسي</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">صافي المرتب</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">تسجيل ماكينة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredRepsFinance.map((row) => {
                        const riskTone: 'safe' | 'warn' | 'danger' =
                          row.overdueFollowUps >= 2 || row.lateAttendanceDays >= 3
                            ? 'danger'
                            : row.callsCount < row.callsTarget || row.avgResponseMins > 45
                              ? 'warn'
                              : 'safe';
                        return (
                        <tr key={row.repId} className={trafficRowClass(riskTone)}>
                          <td className="p-3 font-bold">
                            <div>{row.repName}</div>
                            <div className="text-[10px] text-zinc-500 mt-1">{row.role}</div>
                          </td>
                          <td className="p-3 text-sm">
                            <div>أيام حضور: {row.attendanceDays}</div>
                            <div className="text-rose-300 text-xs">تأخير حضور: {row.lateAttendanceDays} يوم</div>
                          </td>
                          <td className="p-3 text-sm">
                            <div className="font-bold">{row.callsTarget > 0 ? `${row.callsCount}/${row.callsTarget}` : '—'}</div>
                            <div className="w-28 h-1.5 bg-white/10 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-indigo-400" style={{ width: `${row.callsTarget > 0 ? Math.min(100, Math.round((row.callsCount / Math.max(1, row.callsTarget)) * 100)) : 0}%` }} />
                            </div>
                          </td>
                          <td className="p-3 text-sm">{row.callsTarget > 0 ? `${row.avgResponseMins} دقيقة` : '—'}</td>
                          <td className="p-3 text-sm">{row.callsTarget > 0 ? row.overdueFollowUps : '—'}</td>
                          <td className="p-3">
                            <div className="text-rose-300 font-black">{row.penalties.totalPenalty.toLocaleString()} ج.م</div>
                            <div className="text-[11px] text-zinc-500">
                              رد: {row.penalties.lateResponsePenalty} | متابعة: {row.penalties.followUpPenalty} | مكالمات: {row.penalties.callsPenalty} | حضور: {row.penalties.attendancePenalty}
                            </div>
                          </td>
                          <td className="p-3">
                            <input
                              key={`${row.repId}-${row.baseSalary}`}
                              type="number"
                              min={0}
                              defaultValue={row.baseSalary}
                              onBlur={(e) => {
                                void (async () => {
                                const salary = Math.max(0, Number(e.currentTarget.value) || 0);
                                const ok = await updateEmployeeSalary(row.repId, salary);
                                if (!ok) {
                                  toast.error('تعذر حفظ الراتب على السيرفر');
                                  return;
                                }
                                toast.success(`تم تحديث راتب ${row.repName}`);
                                })();
                              }}
                              className="w-28 bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                            />
                            <p className="text-[10px] text-zinc-500 mt-1">ج.م</p>
                          </td>
                          <td className="p-3 font-black text-emerald-300">{row.netSalary.toLocaleString()} ج.م</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <button disabled={isPayrollApproved(currentMonthKey)} onClick={() => { void (async () => { const ok = await logAttendance(row.repId, 'in', 'machine'); if (!ok) { toast.error('تعذر تسجيل الحضور'); return; } toast.success(`تم تسجيل حضور ${row.repName}`); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black disabled:opacity-40 disabled:cursor-not-allowed">حضور</button>
                              <button disabled={isPayrollApproved(currentMonthKey)} onClick={() => { void (async () => { const ok = await logAttendance(row.repId, 'out', 'machine'); if (!ok) { toast.error('تعذر تسجيل الانصراف'); return; } toast.info(`تم تسجيل انصراف ${row.repName}`); })(); }} className="px-2 py-1 rounded-lg text-xs bg-amber-500 text-slate-950 font-black disabled:opacity-40 disabled:cursor-not-allowed">انصراف</button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredRepsFinance.length === 0 && (
                    <div className="p-8 text-center text-zinc-400 text-sm">لا توجد نتائج مطابقة للبحث الحالي.</div>
                  )}
                </div>
              </div>
            )}
            {activeFinanceTab === 'coa' && (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input value={coaForm.code} onChange={(e) => setCoaForm(prev => ({ ...prev, code: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder="كود الحساب" />
                  <input value={coaForm.name} onChange={(e) => setCoaForm(prev => ({ ...prev, name: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder="اسم الحساب" />
                  <select value={coaForm.type} onChange={(e) => setCoaForm(prev => ({ ...prev, type: e.target.value as ChartOfAccount['type'] }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
                    <option value="asset">أصل</option><option value="liability">التزام</option><option value="equity">حقوق ملكية</option><option value="revenue">إيراد</option><option value="expense">مصروف</option>
                  </select>
                  <button onClick={handleAddAccount} className="bg-indigo-500 text-white rounded-xl font-black text-sm">إضافة حساب</button>
                </div>
                <div className="space-y-2 max-h-80 overflow-auto">
                  {chartOfAccounts.map(acc => (
                    <div key={acc.code} className="grid grid-cols-5 gap-2 items-center bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2 text-sm">
                      <span className="font-mono text-zinc-300">{acc.code}</span>
                      <span className="font-bold">{acc.name}</span>
                      <span className="text-zinc-400">{acc.type}</span>
                      <span className={`text-xs font-black ${acc.isSystem ? 'text-amber-300' : 'text-emerald-300'}`}>{acc.isSystem ? 'System' : 'Custom'}</span>
                      <button onClick={() => { const ok = removeChartAccount(acc.code); if (!ok) { toast.error('لا يمكن حذف هذا الحساب (نظامي أو مستخدم في قيود)'); return; } toast.success('تم حذف الحساب'); }} className="bg-rose-500/20 text-rose-300 rounded-lg px-3 py-1 text-xs font-black">
                        حذف
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeFinanceTab === 'codebook' && (
              <div className="p-6 space-y-6">
                <div className="bg-[#0B1020]/70 border border-amber-500/20 rounded-2xl p-4 space-y-3">
                  <h4 className="font-black mb-1">قيود وسياسة عروض الأسعار (مبيعات)</h4>
                  <p className="text-xs text-zinc-400">يحدد المحاسب النص التوجيهي ومراكز التكلفة المسموح إرسال عروض الأسعار منها، والحد التنبيهي للمبالغ.</p>
                  <textarea
                    value={accountingPolicy.policyNotes}
                    onChange={(e) => { void updateAccountingPolicy({ policyNotes: e.target.value }); }}
                    rows={3}
                    className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                  />
                  <div>
                    <label className="text-xs font-bold text-zinc-400">مراكز التكلفة المسموحة لعروض المبيعات (مفصولة بفاصلة)</label>
                    <input
                      value={accountingPolicy.allowedCostCentersForQuotes.join(', ')}
                      onChange={(e) => {
                        void updateAccountingPolicy({
                          allowedCostCentersForQuotes: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                        });
                      }}
                      className="w-full mt-1 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder="عام, تصوير, إعلانات"
                    />
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-xs text-zinc-400">تنبيه عند تجاوز مبلغ (ج.م)</label>
                    <input
                      type="number"
                      value={accountingPolicy.minAmountHighlight || 0}
                      onChange={(e) => { void updateAccountingPolicy({ minAmountHighlight: Math.max(0, Number(e.target.value) || 0) }); }}
                      className="w-36 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    />
                    <span className="text-[10px] text-zinc-500">0 = بدون تنبيه تلقائي في الجدول</span>
                  </div>
                </div>

                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4">
                  <h4 className="font-black mb-3">أكواد فئات المصروفات</h4>
                  <p className="text-xs text-zinc-400 mb-4">المحاسب يقدر يحدد Prefix لكل فئة، وسيتم استخدامه تلقائيًا عند ترميز المصروفات.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {expenseCodingRules.map((rule) => (
                      <div key={`exp-code-${rule.category}`} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold">{rule.category}</p>
                          <p className="text-[11px] text-zinc-500">مثال: {rule.prefix || 'EXP-OTH'}-0001</p>
                        </div>
                        <input
                          value={rule.prefix}
                          onChange={(e) => updateExpenseCodingRule(rule.category, e.target.value)}
                          className="w-32 bg-[#0B1020] border border-white/15 rounded-lg px-2 py-1.5 text-xs font-mono"
                          placeholder="EXP-XXX"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4">
                  <h4 className="font-black mb-3">كود العملاء</h4>
                  <p className="text-xs text-zinc-400 mb-3">حدد البادئة المستخدمة في توليد أكواد العملاء داخل الفواتير.</p>
                  <div className="flex items-center gap-3">
                    <input
                      value={customerCodePrefix}
                      onChange={(e) => setCustomerCodePrefix(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                      className="w-40 bg-[#0B1020] border border-white/15 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder="CUS"
                    />
                    <span className="text-xs text-zinc-400">مثال الكود: {(customerCodePrefix || 'CUS').toUpperCase()}-0001</span>
                  </div>
                </div>

                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <h4 className="font-black">أكواد القيود اليومية الجاهزة</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      value={newJournalCoding.title}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, title: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder="اسم الكود (مثال: ضيافة شهرية)"
                    />
                    <select
                      value={newJournalCoding.accountCode}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, accountCode: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">اختر الحساب</option>
                      {chartOfAccounts.map(acc => <option key={`book-${acc.code}`} value={acc.code}>{acc.code} - {acc.name}</option>)}
                    </select>
                    <input
                      value={newJournalCoding.costCenter}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, costCenter: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder="مركز التكلفة"
                    />
                    <button onClick={handleAddJournalCodingRule} className="bg-[#7C6BFF] text-white rounded-xl px-3 py-2 text-sm font-black">
                      إضافة كود
                    </button>
                  </div>
                  <div className="space-y-2">
                    {journalCodingRules.map(rule => (
                      <div key={rule.id} className="flex items-center justify-between gap-3 bg-[#0F1528]/70 border border-white/10 rounded-xl px-3 py-2">
                        <div>
                          <p className="font-bold">{rule.title}</p>
                          <p className="text-[11px] text-zinc-400">{rule.accountCode} | {rule.costCenter || 'عام'}</p>
                        </div>
                        <button
                          onClick={() => setJournalCodingRules(prev => prev.filter(r => r.id !== rule.id))}
                          className="px-2 py-1 rounded-lg text-xs font-black bg-rose-500/20 text-rose-300"
                        >
                          حذف
                        </button>
                      </div>
                    ))}
                    {journalCodingRules.length === 0 && <p className="text-xs text-zinc-500">لا يوجد أكواد يومية محفوظة بعد.</p>}
                  </div>
                </div>
              </div>
            )}
            {activeFinanceTab === 'journals' && (
              <div className="p-6 space-y-4">
                {journalCodingRules.length > 0 && (
                  <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-400">تطبيق كود جاهز:</span>
                    {journalCodingRules.map(rule => (
                      <button
                        key={`quick-rule-${rule.id}`}
                        onClick={() => applyJournalCodingRule(rule.id)}
                        className="px-3 py-1.5 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-[#7C6BFF]/40"
                      >
                        {rule.title}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input type="date" value={journalForm.date} onChange={(e) => setJournalForm(prev => ({ ...prev, date: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" />
                  <input value={journalForm.description} onChange={(e) => setJournalForm(prev => ({ ...prev, description: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm md:col-span-2" placeholder="وصف القيد" />
                </div>
                <div className="space-y-2">
                  {journalForm.lines.map((line, idx) => (
                    <div key={`line-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <select value={line.accountCode} onChange={(e) => updateJournalLine(idx, { accountCode: e.target.value })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
                        {chartOfAccounts.map(acc => <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>)}
                      </select>
                      <input type="number" min={0} value={line.debit} onChange={(e) => updateJournalLine(idx, { debit: e.target.value, credit: '' })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder="مدين" />
                      <input type="number" min={0} value={line.credit} onChange={(e) => updateJournalLine(idx, { credit: e.target.value, debit: '' })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder="دائن" />
                      <input value={line.costCenter} onChange={(e) => updateJournalLine(idx, { costCenter: e.target.value })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder="مركز تكلفة" />
                      <button onClick={() => setJournalForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))} className="bg-rose-500/20 text-rose-300 rounded-xl px-3 py-2 text-xs font-black">حذف سطر</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={addJournalLine} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm font-black">إضافة سطر</button>
                  <button onClick={handleCreateJournal} className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black">حفظ القيد</button>
                  {journalFocusId && (
                    <button
                      onClick={() => setJournalFocusId(null)}
                      className="px-4 py-2 rounded-xl bg-[#0F1528] border border-white/10 text-sm font-black text-zinc-200"
                    >
                      إظهار كل القيود
                    </button>
                  )}
                  <span className="text-xs text-zinc-400">يشترط توازن المدين والدائن.</span>
                </div>
                {(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك') && manualJournalEntries.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('حذف جميع قيود الحسابات نهائياً؟ لا يمكن التراجع.')) return;
                        let deletedCount = 0;
                        for (const entry of [...manualJournalEntries]) {
                          const ok = await removeManualJournalEntry(entry.id);
                          if (ok) deletedCount++;
                        }
                        toast.success(`تم حذف ${deletedCount} قيد`);
                      }}
                      className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-black text-rose-200 hover:bg-rose-500/25 transition-colors"
                    >
                      حذف الكل
                    </button>
                  </div>
                )}
                <div className="space-y-2 max-h-64 overflow-auto">
                  {displayedJournals.map(entry => (
                    <div key={entry.id} className={`rounded-xl p-3 ${journalFocusId === entry.id ? 'bg-indigo-500/10 border border-indigo-400/40' : 'bg-slate-950/40 border border-white/10'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black">{entry.id} - {entry.description}</p>
                          <p className="text-xs text-zinc-500">{new Date(entry.date).toLocaleDateString('ar-EG')}</p>
                        </div>
                        {(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await removeManualJournalEntry(entry.id);
                              if (!ok) {
                                toast.error('لا يمكن الحذف: شهر أو سنة مغلقة، أو القيد مرتبط بتحصيل فاتورة أو عهدة');
                              } else {
                                toast.success('تم حذف القيد');
                              }
                            }}
                            className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-500/25"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                      {entry.lines.map((line, li) => (
                        <div key={`${entry.id}-${li}`} className="grid grid-cols-4 gap-2 text-xs text-zinc-300">
                          <span>{line.accountCode}</span>
                          <span className="text-emerald-300">{line.debit.toLocaleString()}</span>
                          <span className="text-rose-300">{line.credit.toLocaleString()}</span>
                          <span>{line.costCenter || 'عام'}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeFinanceTab === 'reports' && (
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6 space-y-3">
                    <h5 className="font-black text-lg">قائمة الدخل (P&L)</h5>
                    <div className="flex justify-between text-zinc-300"><span>الإيرادات المحصلة</span><span className="font-black text-emerald-400">{accountingReport.revenueRecognized.toLocaleString()} ج.م</span></div>
                    <div className="flex justify-between text-zinc-300"><span>المصروفات المدفوعة</span><span className="font-black text-rose-400">{accountingReport.expenseRecognized.toLocaleString()} ج.م</span></div>
                    <div className="border-t border-white/10 pt-3 flex justify-between"><span className="font-black">صافي الربح التشغيلي</span><span className={`font-black ${accountingReport.grossProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{accountingReport.grossProfit.toLocaleString()} ج.م</span></div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6 space-y-3">
                    <h5 className="font-black text-lg">تقرير VAT</h5>
                    <div className="flex justify-between text-zinc-300"><span>VAT مخرجات</span><span className="font-black text-amber-300">{vatSummary.outputVat.toLocaleString()} ج.م</span></div>
                    <div className="flex justify-between text-zinc-300"><span>VAT مدخلات</span><span className="font-black text-indigo-300">{vatSummary.inputVat.toLocaleString()} ج.م</span></div>
                    <div className="border-t border-white/10 pt-3 flex justify-between"><span className="font-black">صافي الضريبة</span><span className={`font-black ${vatSummary.netVatPayable >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{vatSummary.netVatPayable.toLocaleString()} ج.م</span></div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6 space-y-3">
                    <h5 className="font-black text-lg">ميزان مراجعة سريع</h5>
                    <div className="flex justify-between text-zinc-300"><span>النقدية</span><span className="font-black">{stats.netCash.toLocaleString()} ج.م</span></div>
                    <div className="flex justify-between text-zinc-300"><span>ذمم مدينة</span><span className="font-black text-amber-300">{accountingReport.receivables.toLocaleString()} ج.م</span></div>
                    <div className="flex justify-between text-zinc-300"><span>ذمم دائنة</span><span className="font-black text-rose-300">{accountingReport.payables.toLocaleString()} ج.م</span></div>
                    <div className="text-xs text-zinc-500 pt-2">نسخة تشغيلية لإدارة الشركة مع منظور محاسبي.</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">ميزان المراجعة</h5>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl border border-white/5">
                      <table className="w-full text-right min-w-[520px]">
                        <thead>
                          <tr className="bg-[#0B1020]/95">
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">الحساب</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">مدين</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">دائن</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">الرصيد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {trialBalance.map((row, idx) => (
                            <tr key={row.account} className={`${idx % 2 === 0 ? 'bg-[#0E152B]/45' : 'bg-[#0B1224]/45'} hover:bg-[#1A2440]/45`}>
                              <td className="p-3 text-sm font-bold text-zinc-200">{row.account}</td>
                              <td className="p-3 text-sm text-emerald-300">{row.debit.toLocaleString()}</td>
                              <td className="p-3 text-sm text-rose-300">{row.credit.toLocaleString()}</td>
                              <td className={`p-3 text-sm font-black ${row.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.balance.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">ربحية مراكز التكلفة</h5>
                    <div className="space-y-2 max-h-72 overflow-auto pr-1">
                      {costCenterSummary.map(row => (
                        <div key={row.name} className="grid grid-cols-4 gap-2 text-sm border-b border-white/5 pb-2">
                          <span className="font-bold text-zinc-200">{row.name}</span>
                          <span className="text-emerald-300">{row.revenue.toLocaleString()}</span>
                          <span className="text-rose-300">{row.expense.toLocaleString()}</span>
                          <span className={`${row.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.net.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">Profitability Dashboard (حسب العميل)</h5>
                    <p className="text-xs text-zinc-500 mb-3">تقدير ربحية لكل عميل بناءً على الفواتير وتوزيع مصروفات مركز التكلفة.</p>
                    <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-white/5">
                      <table className="w-full min-w-[700px] text-right">
                        <thead>
                          <tr className="bg-[#0B1020]/95">
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">العميل</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">الإيراد</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">تكلفة مخصصة</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">هامش ربحي</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {profitabilityByCustomer.map((row) => (
                            <tr key={`prof-${row.invoiceId}`} className="hover:bg-[#1A2440]/35">
                              <td className="p-3 text-sm font-bold text-zinc-200">
                                {row.leadId && row.leadId !== 'manual' ? (
                                  <button type="button" onClick={() => goClient360(row.leadId)} className="cursor-pointer text-right hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                                    {row.customerName}
                                  </button>
                                ) : (
                                  row.customerName
                                )}
                              </td>
                              <td className="p-3 text-sm text-emerald-300">{row.revenue.toLocaleString()}</td>
                              <td className="p-3 text-sm text-rose-300">{row.allocatedExpense.toLocaleString()}</td>
                              <td className={`p-3 text-sm font-black ${row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.grossProfit.toLocaleString()}</td>
                              <td className={`p-3 text-sm font-black ${row.marginPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{row.marginPct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">Expected Cashflow Calendar (30 يوم)</h5>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 text-sm">المتوقع 7 أيام: <span className="font-black text-emerald-300">{nextWeekCashflow.toLocaleString()} ج.م</span></div>
                      <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 text-sm">المتوقع 30 يوم: <span className="font-black text-indigo-300">{monthCashflow.toLocaleString()} ج.م</span></div>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                      {cashflowCalendar.map((row) => (
                        <div key={`cf-${row.date}`} className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 flex items-center justify-between text-sm">
                          <div>
                            <p className="font-bold text-zinc-200">{new Date(row.date).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                            <p className="text-[11px] text-zinc-500">{row.openInvoices} فواتير متوقعة التحصيل</p>
                          </div>
                          <p className="font-black text-emerald-300">{row.expectedCollections.toLocaleString()} ج.م</p>
                        </div>
                      ))}
                      {cashflowCalendar.length === 0 && (
                        <p className="text-sm text-zinc-500 text-center py-8">لا توجد أقساط متوقعة خلال 30 يوم.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeFinanceTab === 'custody' && (
              <div className="p-8 space-y-8">
                <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-6 space-y-4">
                  <h5 className="font-black text-lg">تكويد فئات المصروف (لترحيل قيود التسوية)</h5>
                  <p className="text-xs text-zinc-500">يحدد المحاسب أي حساب في الدليل يُستخدم لكل فئة عند اعتماد المالك لتسوية العهدة.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(['رواتب', 'إيجارات', 'معدات', 'تسويق', 'تشغيل', 'ضيافة', 'نثريات', 'أخرى'] as const).map((cat) => (
                      <div key={cat} className="flex items-center gap-2 bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-zinc-400 w-24">{cat}</span>
                        <select
                          className="flex-1 bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                          value={custodyAccountByCategory[cat] || '5110'}
                          onChange={(e) => { void updateCustodyAccountByCategory({ [cat]: e.target.value } as Partial<Record<Expense['category'], string>>); }}
                        >
                          {chartOfAccounts.map((a) => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-6 space-y-4">
                  <h5 className="font-black text-lg">إنشاء عهدة جديدة</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                      placeholder="عنوان العهدة"
                      value={custodyForm.title}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, title: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                      placeholder="المبلغ"
                      value={custodyForm.totalAmount}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, totalAmount: e.target.value }))}
                    />
                    <select
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm md:col-span-2"
                      value={custodyForm.productionManagerId}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, productionManagerId: e.target.value }))}
                    >
                      <option value="">— مدير الإنتاج —</option>
                      {users.filter((u) => u.role === 'مدير إنتاج').map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <textarea
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm md:col-span-2 min-h-[80px]"
                      placeholder="تفاصيل العهدة"
                      value={custodyForm.description}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, description: e.target.value }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                      const ok = await createCustodyFund({
                        title: custodyForm.title,
                        description: custodyForm.description,
                        totalAmount: Number(custodyForm.totalAmount) || 0,
                        productionManagerId: custodyForm.productionManagerId,
                      });
                      if (ok) {
                        toast.success('تم إنشاء العهدة كمسودة');
                        setCustodyForm({ title: '', description: '', totalAmount: '', productionManagerId: '' });
                      } else toast.error('تأكد من العنوان والمبلغ ومدير الإنتاج');
                      })();
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black"
                  >
                    حفظ مسودة
                  </button>
                </div>
                <div className="space-y-3">
                  <h5 className="font-black text-lg">سجل العهد</h5>
                  {custodyFunds.length === 0 && <p className="text-sm text-zinc-500">لا توجد عهود بعد.</p>}
                  {custodyFunds.map((cf) => (
                    <div key={cf.id} className="bg-[#0F1528]/80 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 w-full">
                      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                      <div>
                        <p className="font-bold text-white">{cf.title}</p>
                        <p className="text-xs text-zinc-400">{cf.totalAmount.toLocaleString()} ج.م — {cf.productionManagerName} — {cf.status}</p>
                        {cf.journalEntryPaymentId && <p className="text-[10px] text-teal-400 mt-1">قيد صرف: {cf.journalEntryPaymentId}</p>}
                        {(cf.journalEntrySettlementId || cf.journalEntryId) && (
                          <p className="text-[10px] text-emerald-400 mt-1">قيد إقفال: {cf.journalEntrySettlementId || cf.journalEntryId}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(cf.status === 'مسودة' || cf.status === 'مرفوض_طلب') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await submitCustodyDraftToOwner(cf.id);
                              if (ok) toast.success('تم الإرسال للمالك لاعتماد الطلب');
                              else toast.error('تعذر الإرسال');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[#7C6BFF] text-white text-xs font-black"
                          >
                            إرسال للمالك
                          </button>
                        )}
                        {cf.status === 'بانتظار_دفع_محاسب' && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRecordCustodyPayment(cf.id, 'كاش');
                                if (ok) toast.success('تم تسجيل الدفع كاش وقيد الصرف');
                                else toast.error('تعذر — تحقق من الحسابات أو إغلاق الشهر');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-teal-500 text-slate-950 text-xs font-black"
                            >
                              دفع كاش + قيد صرف
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRecordCustodyPayment(cf.id, 'تحويل');
                                if (ok) toast.success('تم تسجيل الدفع بتحويل وقيد الصرف');
                                else toast.error('تعذر — تحقق من الحسابات أو إغلاق الشهر');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-indigo-500 text-white text-xs font-black"
                            >
                              دفع تحويل + قيد صرف
                            </button>
                          </>
                        )}
                        {cf.status === 'تسوية_بانتظار_محاسب' && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantApproveCustodySettlement(cf.id);
                                if (ok) toast.success('تم إقفال العهدة وترحيل قيد التسوية');
                                else toast.error('تعذر — تحقق من البيانات أو إغلاق الشهر');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black"
                            >
                              اعتماد التسوية وقيد الإقفال
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRejectCustodySettlement(cf.id);
                                if (ok) toast.info('تم إرجاع العهدة لتعديل البنود');
                                else toast.error('تعذر');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-rose-500/80 text-white text-xs font-black"
                            >
                              رفض وإرجاع
                            </button>
                          </>
                        )}
                      </div>
                      </div>
                      {cf.status === 'تسوية_بانتظار_محاسب' && (
                        <div className="w-full pt-2 border-t border-white/10 space-y-2">
                          <p className="text-[11px] font-black text-amber-200/95">مراجعة بنود التسوية ومستندات مدير الإنتاج قبل اعتماد قيد الإقفال ترحيلياً إلى القيود:</p>
                          <CustodySettlementReviewBlock lines={cf.spendLines} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem]">
            <h4 className="font-black text-lg mb-6 flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
              التدفق النقدي الشهري
            </h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[
                  { name: 'يناير', income: 400000, expense: 190000 },
                  { name: 'فبراير', income: 650000, expense: 230000 },
                  { name: 'مارس', income: stats.receivablePaid, expense: stats.expensesPaid },
                ]}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="income" stroke="#6366f1" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={3} />
                  <Area type="monotone" dataKey="expense" stroke="#f43f5e" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={3} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-6 flex justify-between items-center pt-6 border-t border-slate-800">
               <div>
                 <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">ذمم متأخرة</p>
                 <p className="text-xl font-black text-rose-400">{stats.receivableLate.toLocaleString()} ج.م</p>
               </div>
               <div className="text-left">
                 <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">صافي التدفق</p>
                 <p className={`text-xl font-black ${stats.netCash >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>{stats.netCash.toLocaleString()} ج.م</p>
               </div>
            </div>
          </div>

          <div className="bg-indigo-600 p-8 rounded-[3rem] text-white shadow-2xl shadow-indigo-600/20 relative overflow-hidden group">
            <div className="absolute top-[-20%] right-[-20%] w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-widest opacity-80 mb-2">تنبيهات الحسابات</p>
              <h5 className="text-xl font-black mb-4">ذمم منتظرة: {stats.receivablePending.toLocaleString()} ج.م | مصروفات منتظرة: {stats.expensesPending.toLocaleString()} ج.م</h5>
              <button
                onClick={() => toast.info('راجع تبويبات الفواتير والمصروفات وصدّر التقرير CSV عند الحاجة')}
                className="w-full bg-white text-indigo-600 py-3 rounded-2xl font-black text-sm hover:bg-slate-100 transition-all shadow-xl"
              >
                مراجعة السجلات
              </button>
            </div>
          </div>
        </div>
      </div>

      {isCreateInvoiceOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">إصدار فاتورة جديدة</h3>
              <button
                onClick={() => setIsCreateInvoiceOpen(false)}
                className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div ref={leadPickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsLeadPickerOpen(v => !v)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-right text-zinc-100 flex items-center justify-between"
                >
                  <span className="truncate">
                    {invoiceForm.leadId
                      ? `${leads.find(l => l.id === invoiceForm.leadId)?.name || ''} - ${leads.find(l => l.id === invoiceForm.leadId)?.company || ''}`
                      : 'اختياري: ربط بليد موجود'}
                  </span>
                  <ChevronRight className={`w-4 h-4 text-zinc-400 transition-transform ${isLeadPickerOpen ? 'rotate-[-90deg]' : 'rotate-90'}`} />
                </button>
                {isLeadPickerOpen && (
                  <div className="absolute z-[260] mt-2 w-full bg-[#111827] border border-white/15 rounded-2xl shadow-2xl max-h-64 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setInvoiceForm(prev => ({ ...prev, leadId: '' }));
                        setIsLeadPickerOpen(false);
                      }}
                      className="w-full text-right px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/10"
                    >
                      اختياري: ربط بليد موجود
                    </button>
                    {leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setInvoiceForm(prev => ({
                            ...prev,
                            leadId: lead.id,
                            customerName: lead.name || prev.customerName,
                            amount: lead.budget ? String(lead.budget) : prev.amount,
                            costCenter: lead.category || prev.costCenter,
                          }));
                          setIsLeadPickerOpen(false);
                        }}
                        className="w-full text-right px-4 py-2.5 text-sm text-zinc-100 hover:bg-[#7C6BFF]/25 border-t border-white/5"
                      >
                        {lead.name} - {lead.company}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <select
                value={invoiceForm.status}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, status: e.target.value as Invoice['status'] }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-zinc-100 [color-scheme:dark]"
              >
                <option value="قيد الانتظار">قيد الانتظار</option>
                <option value="مدفوع">مدفوع</option>
                <option value="متأخر">متأخر</option>
              </select>

              <input
                value={invoiceForm.customerName}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, customerName: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2"
                placeholder="اسم العميل"
              />

              <input
                type="number"
                min={1}
                value={invoiceForm.amount}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, amount: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
                placeholder="المبلغ الأساسي"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={invoiceForm.vatRate}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, vatRate: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
                placeholder="نسبة VAT %"
              />
              <input
                value={invoiceForm.costCenter}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, costCenter: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2"
                placeholder="مركز التكلفة (مثال: إعلانات)"
              />
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={handleCreateInvoice}
                className="flex-1 bg-emerald-500 text-slate-950 py-3 rounded-2xl font-black"
              >
                حفظ الفاتورة
              </button>
              <button
                onClick={() => setIsCreateInvoiceOpen(false)}
                className="flex-1 bg-slate-800 border border-slate-700 py-3 rounded-2xl font-black"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreateExpenseOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">تسجيل مصروف جديد</h3>
              <button onClick={() => setIsCreateExpenseOpen(false)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input value={expenseForm.title} onChange={(e) => setExpenseForm(prev => ({ ...prev, title: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2" placeholder="وصف المصروف" />
              <select value={expenseForm.category} onChange={(e) => setExpenseForm(prev => ({ ...prev, category: e.target.value as any }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                <option value="تشغيل">تشغيل</option><option value="رواتب">رواتب</option><option value="إيجارات">إيجارات</option><option value="معدات">معدات</option><option value="تسويق">تسويق</option><option value="ضيافة">ضيافة</option><option value="نثريات">نثريات</option><option value="أخرى">أخرى</option>
              </select>
              <select value={expenseForm.status} onChange={(e) => setExpenseForm(prev => ({ ...prev, status: e.target.value as any }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                <option value="قيد الانتظار">قيد الانتظار</option><option value="مدفوع">مدفوع</option>
              </select>
              <input type="number" min={0} max={100} value={expenseForm.vatRate} onChange={(e) => setExpenseForm(prev => ({ ...prev, vatRate: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder="نسبة VAT %" />
              <input value={expenseForm.costCenter} onChange={(e) => setExpenseForm(prev => ({ ...prev, costCenter: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder="مركز التكلفة" />
              <input value={expenseForm.vendor} onChange={(e) => setExpenseForm(prev => ({ ...prev, vendor: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder="المورد (اختياري)" />
              <input type="number" min={1} value={expenseForm.amount} onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder="المبلغ" />
              <textarea value={expenseForm.note} onChange={(e) => setExpenseForm(prev => ({ ...prev, note: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2" placeholder="ملاحظات (اختياري)" />
              <div className="md:col-span-2 text-[11px] text-zinc-400">
                الكود المحاسبي المتوقع: <span className="font-mono text-[#A99FFF]">{expenseCategoryCodeMap[expenseForm.category] || 'EXP-OTH'}-{toFour(expenses.length + 1)}</span>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={handleCreateExpense} className="flex-1 bg-rose-500 text-white py-3 rounded-2xl font-black">حفظ المصروف</button>
              <button onClick={() => setIsCreateExpenseOpen(false)} className="flex-1 bg-slate-800 border border-slate-700 py-3 rounded-2xl font-black">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {invoiceDetails && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-[2.5rem] p-6">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h3 className="text-xl font-black">تفاصيل الفاتورة {invoiceDetails.id}</h3>
                <p className="text-xs text-zinc-400 mt-1">{invoiceDetails.customerName} • {new Date(invoiceDetails.date).toLocaleDateString('ar-EG')}</p>
              </div>
              <button onClick={() => setInvoiceDetailsId(null)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">إجمالي الفاتورة</p>
                <p className="font-black text-emerald-300">{(invoiceDetails.totalAmount ?? invoiceDetails.amount).toLocaleString()} ج.م</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">المحصل</p>
                <p className="font-black text-emerald-400">{(invoiceDetails.paidAmount ?? 0).toLocaleString()} ج.م</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">المتبقي</p>
                <p className="font-black text-amber-300">{(invoiceDetails.remainingAmount ?? 0).toLocaleString()} ج.م</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">موعد القسط القادم</p>
                <p className="font-black text-zinc-200">{invoiceDetails.nextDueDate ? new Date(invoiceDetails.nextDueDate).toLocaleDateString('ar-EG') : '—'}</p>
              </div>
            </div>
            <div className="bg-[#0B1020]/60 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <h4 className="font-black text-sm">سجل الدفعات والتحصيل</h4>
                <span className="text-xs text-zinc-400">{(invoiceDetails.collections || []).length} حركة</span>
              </div>
              {(invoiceDetails.collections || []).length === 0 ? (
                <p className="p-4 text-sm text-zinc-400">لا توجد دفعات مسجلة بعد.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="text-[10px] uppercase text-zinc-500">
                        <th className="px-4 py-3">التاريخ</th>
                        <th className="px-4 py-3">الطريقة</th>
                        <th className="px-4 py-3">المبلغ</th>
                        <th className="px-4 py-3">رقم القيد</th>
                        <th className="px-4 py-3">ملاحظة</th>
                        <th className="px-4 py-3">فتح القيد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(invoiceDetails.collections || []).map((c) => (
                        <tr key={c.id} className="text-sm">
                          <td className="px-4 py-3 text-zinc-300">{new Date(c.date).toLocaleString('ar-EG')}</td>
                          <td className="px-4 py-3 text-indigo-300">{c.method}</td>
                          <td className="px-4 py-3 font-black text-emerald-300">{c.amount.toLocaleString()} ج.م</td>
                          <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">{c.journalEntryId || '—'}</td>
                          <td className="px-4 py-3 text-zinc-400">{c.note || '—'}</td>
                          <td className="px-4 py-3">
                            {c.journalEntryId ? (
                              <button
                                onClick={() => {
                                  setJournalFocusId(c.journalEntryId || null);
                                  setActiveFinanceTab('journals');
                                  setInvoiceDetailsId(null);
                                  toast.success(`تم فتح القيد ${c.journalEntryId}`);
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                              >
                                عرض القيد
                              </button>
                            ) : (
                              <span className="text-zinc-500 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PriceQuoteSubmitModal = ({
  lead,
  open,
  onClose,
}: {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
}) => {
  const { addPriceQuote, accountingPolicy, users } = useData();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('14');
  const [costCenter, setCostCenter] = useState('عام');
  const [note, setNote] = useState('');
  const [productionUserId, setProductionUserId] = useState('');

  const allowedCC = accountingPolicy.allowedCostCentersForQuotes;
  const productionUsers = useMemo(
    () => users.filter((u) => u.role === 'مدير إنتاج' || u.role === 'إنتاج'),
    [users]
  );
  const routeToProduction = productionUserId !== '';

  useEffect(() => {
    if (open && lead) {
      setTitle(`عرض سعر — ${lead.company}`);
      setAmount(String(lead.budget || ''));
      setVatRate('14');
      setCostCenter(allowedCC.includes('عام') ? 'عام' : allowedCC[0] || 'عام');
      setNote('');
      setProductionUserId('');
    }
  }, [open, lead?.id, allowedCC.join(',')]);

  useEffect(() => {
    if (!open) return;
    if (allowedCC.length > 0 && !allowedCC.includes(costCenter)) {
      setCostCenter(allowedCC[0]);
    }
  }, [allowedCC.join(','), open]);

  if (!open || !lead) return null;

  const selectedProdUser = productionUsers.find((u) => u.id === productionUserId);

  const submit = async () => {
    if (!title.trim()) { toast.error('أدخل عنوان العرض'); return; }
    const amt = Number(amount);
    if (!routeToProduction && (!amt || amt <= 0)) {
      toast.error('أدخل المبلغ، أو اختر موظف إنتاج للتسعير');
      return;
    }
    const vr = Number(vatRate);
    if (Number.isNaN(vr) || vr < 0 || vr > 100) { toast.error('نسبة ضريبة غير صحيحة'); return; }
    let ok = false;
    try {
      ok = await addPriceQuote({
        leadId: lead.id,
        customerName: `${lead.name} / ${lead.company}`,
        title: title.trim(),
        amount: amt,
        vatRate: vr,
        costCenter: costCenter.trim() || 'عام',
        note: note.trim() || undefined,
        productionAssignedId: selectedProdUser?.id,
        productionAssignedName: selectedProdUser?.name,
      });
    } catch (err) {
      toast.error(`تعذر الإرسال: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!ok) { toast.error('تعذر الإرسال: تحقق من البيانات'); return; }
    toast.success(
      routeToProduction
        ? `تم إرسال طلب التسعير إلى ${selectedProdUser?.name} — سيُرسَل للمالك بعد التسعير`
        : 'تم إرسال عرض السعر للمالك — لن يُسجَّل محاسبياً إلا بعد الاعتماد'
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[240] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#0B1020] shadow-2xl p-6 space-y-4">
        <div>
          <p className="text-xs text-zinc-500">طلب عرض سعر — يمكن إرساله مباشرةً للمالك أو لموظف إنتاج للتسعير أولاً</p>
          <h3 className="text-lg font-black text-white mt-1">{lead.name} / {lead.company}</h3>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">عنوان العرض <span className="text-rose-400">*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm" placeholder="مثال: تغطية حفل شركة..." />
        </div>

        {productionUsers.length > 0 && (
          <div>
            <label className="block text-xs font-bold text-zinc-400 mb-1">توجيه التسعير إلى موظف إنتاج (اختياري)</label>
            <select
              value={productionUserId}
              onChange={(e) => setProductionUserId(e.target.value)}
              className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">— أُسعِّر بنفسي الآن —</option>
              {productionUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
            {routeToProduction && (
              <p className="text-[11px] text-amber-300/80 mt-1">سيحصل {selectedProdUser?.name} على الطلب لوضع السعر ثم يُحوَّل للمالك تلقائياً.</p>
            )}
          </div>
        )}

        {!routeToProduction && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-zinc-400">المبلغ (قبل الضريبة)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-bold text-zinc-400">ضريبة %</label>
              <input value={vatRate} onChange={(e) => setVatRate(e.target.value)} type="number" min={0} max={100} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">مركز التكلفة</label>
          <select value={costCenter} onChange={(e) => setCostCenter(e.target.value)} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm">
            {(allowedCC.length > 0 ? allowedCC : ['عام']).map((cc) => (
              <option key={cc} value={cc}>{cc}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">تفاصيل / ملاحظات</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm resize-y" placeholder="تفاصيل الخدمة المطلوبة، مواعيد، متطلبات..." />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 border border-white/15">إلغاء</button>
          <button type="button" onClick={submit} className={`px-4 py-2 rounded-xl text-sm font-black text-white ${routeToProduction ? 'bg-amber-500 hover:bg-amber-400' : 'bg-[#7C6BFF] hover:bg-[#6B5AEE]'} transition-colors`}>
            {routeToProduction ? `إرسال للتسعير → ${selectedProdUser?.name}` : 'إرسال للمالك'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Leads Workspace ---

const LeadsWorkspace = () => {
  const { leads, users, invoices, expenses, shootBookings, equipmentBookings, meetingBookings, manualCustomers, currentUser, addLead, addManualCustomer, assignLead, updateLeadStatus, deleteLead } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'الكل' | LeadStatus>('الكل');
  const [assignedFilter, setAssignedFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [repUserFilterId, setRepUserFilterId] = useState('');
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);
  const [client360Lead, setClient360Lead] = useState<Lead | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<{ name: string; customerCode: string; sourceLabel?: string; sourceType: 'lead_auto' | 'manual' } | null>(null);
  const [entityMode, setEntityMode] = useState<'leads' | 'customers'>('leads');
  const [leadForm, setLeadForm] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    budget: '',
    companySize: 'متوسط' as Lead['companySize'],
    source: 'يدوي',
    category: 'شركات صغيرة' as LeadCategory,
  });
  const [customerForm, setCustomerForm] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    sourceLabel: 'يدوي',
  });

  const leadStatuses: LeadStatus[] = ['جديد', 'قيد التواصل', 'عرض سعر', 'تفاوض', 'مغلق - فوز', 'مغلق - خسارة'];
  const leadCategories: LeadCategory[] = ['إنجليزي', 'شركات كبرى', 'شركات صغيرة', 'إعلانات', 'سوشيال ميديا'];
  const reps = users.filter(u => u.role === 'مندوب');
  const salesManager = users.find(u => u.role === 'مدير مبيعات');
  const canCreateLead = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const canAddManualCustomer = currentUser?.role === 'محاسب' || currentUser?.role === 'مالك';
  const canUseCustomerMode = currentUser?.role === 'محاسب' || currentUser?.role === 'مالك';
  const canManageAssignment = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const canChangeAnyStatus = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const isSalesManagerLeadDistribution = currentUser?.role === 'مدير مبيعات';
  const canSubmitQuoteForLead = (lead: Lead) =>
    !!currentUser &&
    (currentUser.role === 'مدير مبيعات' ||
      (currentUser.role === 'مندوب' && lead.assignedTo === currentUser.id));

  const toastDeleteLeadResult = (r: DeleteLeadResult) => {
    if (r === 'deleted') toast.success('تم حذف الليد');
    else if (r === 'blocked') toast.error('لا يمكن الحذف: توجد فواتير أو عروض أسعار مرتبطة بهذا الليد');
    else if (r === 'forbidden') toast.error('ليست لديك صلاحية حذف الليد');
    else toast.error('تعذر حذف الليد');
  };

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'محاسب') {
      setEntityMode('customers');
    } else if (!canUseCustomerMode) {
      setEntityMode('leads');
    }
  }, [currentUser, canUseCustomerMode]);

  useEffect(() => {
    const applyIntent = () => {
      try {
        const raw = localStorage.getItem(NAV_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as { tab?: string; leadsAssignedFilter?: 'all' | 'mine' | 'unassigned'; leadsStatusFilter?: 'الكل' | LeadStatus; leadsOverdueOnly?: boolean; leadsRepUserId?: string; leadsClient360Id?: string };
        if (intent.tab !== 'leads') return;
        if (intent.leadsAssignedFilter) setAssignedFilter(intent.leadsAssignedFilter);
        if (intent.leadsStatusFilter) setStatusFilter(intent.leadsStatusFilter);
        setOverdueOnly(Boolean(intent.leadsOverdueOnly));
        setRepUserFilterId(intent.leadsRepUserId || '');
        if (intent.leadsClient360Id) {
          const target = leads.find((l) => l.id === intent.leadsClient360Id);
          if (target) setClient360Lead(target);
        }
        localStorage.removeItem(NAV_INTENT_KEY);
      } catch {
        // ignore malformed nav intent
      }
    };
    applyIntent();
    window.addEventListener('storage', applyIntent);
    window.addEventListener('focus', applyIntent);
    return () => {
      window.removeEventListener('storage', applyIntent);
      window.removeEventListener('focus', applyIntent);
    };
  }, [leads]);

  const visibleLeads = useMemo(() => {
    if (!currentUser) return [];
    let result = [...leads];

    if (currentUser.role === 'محاسب') {
      // المحاسب يرى الليد فقط بعد اعتماد المالك فعلياً (فاتورة من عرض سعر معتمد)
      const approvedLeadIds = new Set(
        invoices
          .filter((inv) => inv.recordOrigin === 'عرض_سعر_معتمد' && inv.leadId && inv.leadId !== 'manual')
          .map((inv) => inv.leadId)
      );
      result = result.filter((l) => approvedLeadIds.has(l.id));
    }

    if (currentUser.role === 'مندوب') {
      result = result.filter(l => l.assignedTo === currentUser.id);
    }

    if (currentUser.role !== 'محاسب' && assignedFilter === 'mine') {
      result = result.filter(l => l.assignedTo === currentUser.id);
    }
    if (currentUser.role !== 'محاسب' && assignedFilter === 'unassigned') {
      result = result.filter(l => !l.assignedTo);
    }

    if (currentUser.role !== 'محاسب' && currentUser.role !== 'مدير مبيعات' && statusFilter !== 'الكل') {
      result = result.filter(l => l.status === statusFilter);
    }

    if (repUserFilterId) {
      result = result.filter((l) => l.assignedTo === repUserFilterId);
    }

    if (overdueOnly) {
      result = result.filter((l) =>
        l.slaStatus !== 'مستقر' &&
        l.status !== 'مغلق - فوز' &&
        l.status !== 'مغلق - خسارة'
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    }

    return result;
  }, [leads, invoices, currentUser, assignedFilter, statusFilter, overdueOnly, repUserFilterId, search]);

  const handleCreateLead = () => {
    const budget = Number(leadForm.budget);
    if (!leadForm.name.trim() || !leadForm.company.trim() || !leadForm.phone.trim() || !budget || budget <= 0) {
      toast.error('يرجى استكمال البيانات الأساسية (الاسم - الشركة - الهاتف - الميزانية)');
      return;
    }

    const ok = addLead({
      name: leadForm.name.trim(),
      company: leadForm.company.trim(),
      phone: leadForm.phone.trim(),
      email: leadForm.email.trim() || `${leadForm.name.replace(/\s+/g, '.').toLowerCase()}@mail.com`,
      status: 'جديد',
      budget,
      companySize: leadForm.companySize,
      source: leadForm.source.trim() || 'يدوي',
      category: leadForm.category,
    });

    if (!ok) return; // addLead already showed a toast error

    setLeadForm({
      name: '',
      company: '',
      phone: '',
      email: '',
      budget: '',
      companySize: 'متوسط',
      source: 'يدوي',
      category: 'شركات صغيرة',
    });
    setIsAddLeadOpen(false);
    // reset filters so the newly added lead is always visible
    setAssignedFilter('all');
    setOverdueOnly(false);
    setRepUserFilterId('');
    setSearch('');
    toast.success('تمت إضافة ليد جديد بنجاح');
  };

  const customerRows = useMemo(() => {
    const byKey = new Map<string, {
      id: string;
      customerCode: string;
      name: string;
      company?: string;
      phone?: string;
      email?: string;
      sourceLabel: string;
      sourceType: 'lead_auto' | 'manual';
      receivableDebit: number;
      payableCredit: number;
    }>();
    const norm = (s: string) => s.trim().toLowerCase();
    manualCustomers.forEach((c) => {
      const key = c.customerCode || norm(c.name || c.company || c.phone || c.id);
      if (!key) return;
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: c.id,
          customerCode: c.customerCode,
          name: c.name,
          company: c.company,
          phone: c.phone,
          email: c.email,
          sourceLabel: c.sourceLabel || 'يدوي',
          sourceType: 'manual',
          receivableDebit: 0,
          payableCredit: 0,
        });
      }
    });
    invoices.forEach((inv) => {
      const code = inv.customerCode || '';
      const nameKey = norm(inv.customerName || '');
      const existingByCode = code ? byKey.get(code) : undefined;
      const existingByName = !existingByCode
        ? Array.from(byKey.values()).find((c) => norm(c.name) === nameKey)
        : undefined;
      const existing = existingByCode || existingByName;
      if (!existing) return;
      const total = inv.totalAmount ?? inv.amount;
      const paid = inv.paidAmount ?? (inv.status === 'مدفوع' ? total : 0);
      const remaining = Math.max(0, total - paid);
      const overPayment = Math.max(0, paid - total);
      existing.receivableDebit += remaining;
      existing.payableCredit += overPayment;
      byKey.set(existing.customerCode || norm(existing.name), existing);
    });
    const q = search.trim().toLowerCase();
    return Array.from(byKey.values())
      .filter((c) => !q || [c.name, c.company, c.phone, c.email, c.sourceLabel].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((a, b) => (b.receivableDebit + b.payableCredit) - (a.receivableDebit + a.payableCredit));
  }, [manualCustomers, invoices, search]);

  const handleAddManualCustomer = async () => {
    const ok = await addManualCustomer({
      name: customerForm.name,
      company: customerForm.company,
      phone: customerForm.phone,
      email: customerForm.email,
      sourceLabel: customerForm.sourceLabel,
    });
    if (!ok) {
      toast.error('تعذر إضافة العميل. صلاحية المالك/المحاسب فقط مع اسم صحيح');
      return;
    }
    setCustomerForm({ name: '', company: '', phone: '', email: '', sourceLabel: 'يدوي' });
    setIsAddLeadOpen(false);
    toast.success('تم إضافة العميل بنجاح');
  };

  const customerStatementInvoices = useMemo(() => {
    if (!statementCustomer) return [];
    const key = statementCustomer.name.trim().toLowerCase();
    return invoices
      .filter((inv) => {
        if (inv.customerCode && statementCustomer.customerCode) return inv.customerCode === statementCustomer.customerCode;
        if (statementCustomer.sourceType === 'lead_auto' && inv.leadId && inv.leadId !== 'manual') {
          const lead = leads.find((l) => l.id === inv.leadId);
          if (lead?.customerCode) return lead.customerCode === statementCustomer.customerCode;
        }
        return inv.customerName.trim().toLowerCase() === key;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, statementCustomer, leads]);
  const customerStatementTotals = useMemo(() => {
    const total = customerStatementInvoices.reduce((s, inv) => s + (inv.totalAmount ?? inv.amount), 0);
    const paid = customerStatementInvoices.reduce((s, inv) => s + (inv.paidAmount ?? (inv.status === 'مدفوع' ? (inv.totalAmount ?? inv.amount) : 0)), 0);
    const remaining = Math.max(0, total - paid);
    return { total, paid, remaining, count: customerStatementInvoices.length };
  }, [customerStatementInvoices]);
  const customerStatementCollections = useMemo(() => {
    return customerStatementInvoices
      .flatMap((inv) =>
        (inv.collections || []).map((col) => ({
          invoiceId: inv.id,
          invoiceDate: inv.date,
          ...col,
        }))
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [customerStatementInvoices]);
  const customerStatementCode = useMemo(() => {
    if (!statementCustomer) return 'CUS-0000';
    return statementCustomer.customerCode;
  }, [statementCustomer]);
  const client360Data = useMemo(() => {
    if (!client360Lead) return null;
    const leadInvoices = invoices
      .filter((inv) => inv.leadId === client360Lead.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const leadExpenses = expenses
      .filter((exp) => (exp.note || '').includes(client360Lead.name) || (exp.costCenter || '') === (client360Lead.category || ''))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
    const leadMeetings = meetingBookings
      .filter((m) => m.leadId === client360Lead.id)
      .sort((a, b) => new Date(`${b.date}T${b.startTime}:00`).getTime() - new Date(`${a.date}T${a.startTime}:00`).getTime())
      .slice(0, 8);
    const leadShoots = shootBookings
      .filter((s) => s.leadId === client360Lead.id)
      .sort((a, b) => new Date(`${b.date}T${b.time}:00`).getTime() - new Date(`${a.date}T${a.time}:00`).getTime())
      .slice(0, 8);
    const leadEquipment = equipmentBookings
      .filter((e) => e.leadId === client360Lead.id)
      .sort((a, b) => new Date(b.fromDate).getTime() - new Date(a.fromDate).getTime())
      .slice(0, 8);
    const evidenceItems = client360Lead.timeline.filter((a) => Boolean(a.evidenceRef?.trim())).slice(0, 12);
    const totalRevenue = leadInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount ?? inv.amount ?? 0), 0);
    const totalCollected = leadInvoices.reduce((sum, inv) => sum + Number(inv.paidAmount ?? (inv.status === 'مدفوع' ? (inv.totalAmount ?? inv.amount ?? 0) : 0)), 0);
    const totalRemaining = Math.max(0, totalRevenue - totalCollected);
    return {
      leadInvoices,
      leadExpenses,
      leadMeetings,
      leadShoots,
      leadEquipment,
      evidenceItems,
      totalRevenue,
      totalCollected,
      totalRemaining,
    };
  }, [client360Lead, invoices, expenses, meetingBookings, shootBookings, equipmentBookings]);
  const exportCustomerStatementCsv = () => {
    if (!statementCustomer) return;
    const rows: string[][] = [
      ['customer_name', statementCustomer.name],
      ['source', statementCustomer.sourceLabel || 'غير محدد'],
      ['invoices_count', String(customerStatementTotals.count)],
      ['total_invoices', String(customerStatementTotals.total)],
      ['total_paid', String(customerStatementTotals.paid)],
      ['total_remaining', String(customerStatementTotals.remaining)],
      [],
      ['invoice_id', 'invoice_date', 'invoice_total', 'paid', 'remaining', 'next_due_date', 'status', 'collections_count'],
      ...customerStatementInvoices.map((inv) => {
        const total = inv.totalAmount ?? inv.amount;
        const paid = inv.paidAmount ?? (inv.status === 'مدفوع' ? total : 0);
        const remaining = Math.max(0, total - paid);
        return [
          inv.id,
          new Date(inv.date).toLocaleDateString('ar-EG'),
          String(total),
          String(paid),
          String(remaining),
          inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString('ar-EG') : '',
          inv.status,
          String((inv.collections || []).length),
        ];
      }),
      [],
      ['payment_date', 'invoice_id', 'method', 'amount', 'journal_entry_id', 'note'],
      ...customerStatementCollections.map((col) => [
        new Date(col.date).toLocaleString('ar-EG'),
        col.invoiceId,
        col.method,
        String(col.amount),
        col.journalEntryId || '',
        col.note || '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer-statement-${customerStatementCode}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printCustomerStatement = () => {
    if (!statementCustomer) return;
    const invoiceRows = customerStatementInvoices
      .map((inv) => {
        const total = inv.totalAmount ?? inv.amount;
        const paid = inv.paidAmount ?? (inv.status === 'مدفوع' ? total : 0);
        const remaining = Math.max(0, total - paid);
        return `
          <tr>
            <td>${inv.id}</td>
            <td>${new Date(inv.date).toLocaleDateString('ar-EG')}</td>
            <td>${total.toLocaleString()} ج.م</td>
            <td>${paid.toLocaleString()} ج.م</td>
            <td>${remaining.toLocaleString()} ج.م</td>
            <td>${inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString('ar-EG') : '—'}</td>
            <td>${inv.status}</td>
          </tr>
        `;
      })
      .join('');
    const collectionRows = customerStatementCollections
      .map((col) => `
        <tr>
          <td>${new Date(col.date).toLocaleString('ar-EG')}</td>
          <td>${col.invoiceId}</td>
          <td>${col.method}</td>
          <td>${col.amount.toLocaleString()} ج.م</td>
          <td>${col.journalEntryId || '—'}</td>
          <td>${col.note || '—'}</td>
        </tr>
      `)
      .join('');
    const html = `
      <html dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>كشف حساب العميل - ${statementCustomer.name} (${customerStatementCode})</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
          h2, h3 { margin: 8px 0; }
          .meta { color:#555; margin-bottom:10px; }
          .cards { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin: 12px 0 18px; }
          .card { border:1px solid #ddd; border-radius:8px; padding:10px; }
          table { border-collapse: collapse; width: 100%; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: right; font-size: 12px; }
          th { background: #f5f5f5; }
        </style>
      </head>
      <body>
        <h2>كشف حساب العميل: ${statementCustomer.name} (${customerStatementCode})</h2>
        <p class="meta">المصدر: ${statementCustomer.sourceLabel || 'غير محدد'} | تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
        <div class="cards">
          <div class="card">إجمالي الفواتير<br/><b>${customerStatementTotals.total.toLocaleString()} ج.م</b></div>
          <div class="card">المحصل<br/><b>${customerStatementTotals.paid.toLocaleString()} ج.م</b></div>
          <div class="card">المتبقي<br/><b>${customerStatementTotals.remaining.toLocaleString()} ج.م</b></div>
        </div>
        <h3>تفاصيل الفواتير</h3>
        <table>
          <thead>
            <tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th>المحصل</th><th>المتبقي</th><th>موعد القسط</th><th>الحالة</th></tr>
          </thead>
          <tbody>${invoiceRows || '<tr><td colspan="7">لا توجد فواتير</td></tr>'}</tbody>
        </table>
        <h3 style="margin-top:18px;">حركة الدفعات</h3>
        <table>
          <thead>
            <tr><th>التاريخ</th><th>رقم الفاتورة</th><th>الطريقة</th><th>القيمة</th><th>رقم القيد</th><th>ملاحظة</th></tr>
          </thead>
          <tbody>${collectionRows || '<tr><td colspan="6">لا توجد دفعات</td></tr>'}</tbody>
        </table>
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="animate-in fade-in duration-500">
      <SectionTitle title={entityMode === 'customers' ? 'إدارة العملاء الخارجيين' : 'إدارة الليدز'} subtitle={entityMode === 'customers' ? 'العملاء الخارجيون فقط (خارج مسار الليدز) مع الأرصدة المدينة/الدائنة' : currentUser?.role === 'محاسب' ? 'يعرض للمحاسب الليدز المعتمدة من المالك فقط (تحولت فعلياً لتنفيذ مالي)' : 'بحث، تصفية، وتحديث الحالة والتعيين بشكل مباشر'} icon={Users} />

      <div className="bg-slate-900/40 border border-slate-800 rounded-[3rem] p-6 md:p-8 mb-6">
        {canUseCustomerMode && (
          <div className="mb-4 flex gap-2">
            <button onClick={() => setEntityMode('leads')} className={`px-4 py-2 rounded-xl text-xs font-black ${entityMode === 'leads' ? 'bg-[#7C6BFF] text-white' : 'bg-[#0F1528] border border-white/10 text-zinc-300'}`}>الليدز</button>
            <button onClick={() => setEntityMode('customers')} className={`px-4 py-2 rounded-xl text-xs font-black ${entityMode === 'customers' ? 'bg-[#7C6BFF] text-white' : 'bg-[#0F1528] border border-white/10 text-zinc-300'}`}>العملاء</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={entityMode === 'customers' ? 'بحث بالاسم أو الشركة أو المصدر أو الهاتف' : 'بحث بالاسم أو الشركة أو الهاتف'}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl pr-11 pl-4 py-3 text-sm"
            />
          </div>

          {entityMode === 'leads' && currentUser?.role !== 'محاسب' && !isSalesManagerLeadDistribution && (<select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'الكل' | LeadStatus)}
            className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
          >
            <option value="الكل">كل الحالات</option>
            {leadStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>)}

          {entityMode === 'leads' && currentUser?.role !== 'محاسب' && (<select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value as 'all' | 'mine' | 'unassigned')}
            className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
          >
            <option value="all">الكل</option>
            <option value="mine">الخاص بي</option>
            <option value="unassigned">غير موزع</option>
          </select>)}
        </div>

        {entityMode === 'leads' && overdueOnly && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2">
            <span className="text-xs text-rose-200 font-bold">فلتر المتأخر مفعل الآن</span>
            <button onClick={() => { setOverdueOnly(false); setRepUserFilterId(''); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-rose-500 text-white">
              عرض الكل
            </button>
          </div>
        )}
        {entityMode === 'leads' && repUserFilterId && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2">
            <span className="text-xs text-indigo-200 font-bold">فلتر المندوب مفعل: {users.find((u) => u.id === repUserFilterId)?.name || repUserFilterId}</span>
            <button onClick={() => setRepUserFilterId('')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500 text-white">
              إلغاء فلتر المندوب
            </button>
          </div>
        )}

        {entityMode === 'leads' && canCreateLead && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setIsAddLeadOpen(true)}
            className="bg-[#7C6BFF] text-white px-6 py-3 rounded-2xl text-sm font-black inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              إضافة ليد
            </button>
          </div>
        )}
        {entityMode === 'customers' && canAddManualCustomer && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setIsAddLeadOpen(true)}
              className="bg-[#7C6BFF] text-white px-6 py-3 rounded-2xl text-sm font-black inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              إضافة عميل
            </button>
          </div>
        )}
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[950px]">
            <thead>
              {entityMode === 'leads' ? (
                <tr className="bg-[#0B1020]/80">
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">العميل</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">التفاصيل</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">التصنيف</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">المندوب</th>
                  {!isSalesManagerLeadDistribution && <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">الحالة</th>}
                  {!isSalesManagerLeadDistribution && <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">الإجراءات</th>}
                </tr>
              ) : (
                <tr className="bg-[#0B1020]/80">
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">العميل</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">المصدر</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">الرصيد المدين</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">الرصيد الدائن</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">حالة الحساب</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">إجراءات</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-white/10">
              {entityMode === 'leads' ? visibleLeads.map((lead) => {
                const assignedRep = users.find(u => u.id === lead.assignedTo);
                return (
                  <tr key={lead.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="p-5">
                      <p className="font-black text-white">{lead.name}</p>
                      <p className="text-xs text-zinc-400 mt-1">{lead.company}</p>
                    </td>
                    <td className="p-5 text-sm">
                      <p>{lead.phone}</p>
                      <p className="text-xs text-zinc-400 mt-1">{lead.budget.toLocaleString()} ج.م</p>
                      {isSalesManagerLeadDistribution && (
                        <p className="text-[11px] text-zinc-500 mt-1">{lead.source}</p>
                      )}
                      {isSalesManagerLeadDistribution && canManageAssignment && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`حذف الليد «${lead.name}» نهائياً؟ لا يمكن التراجع.`)) return;
                            toastDeleteLeadResult(await deleteLead(lead.id));
                          }}
                          className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black bg-rose-500/15 text-rose-200 border border-rose-500/35 hover:bg-rose-500/25"
                        >
                          <Trash2 className="w-3 h-3" />
                          حذف الليد
                        </button>
                      )}
                    </td>
                    <td className="p-5">
                      <span className="text-xs px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 font-bold">{lead.category}</span>
                    </td>
                    <td className="p-5">
                      {canManageAssignment ? (
                        <select
                          value={lead.assignedTo || ''}
                          onChange={(e) => assignLead(lead.id, e.target.value || undefined)}
                          className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-xs min-w-[150px]"
                        >
                          <option value="">بدون تعيين</option>
                          {salesManager && <option value={salesManager.id}>عند مدير المبيعات</option>}
                          {reps.map(rep => (
                            <option key={rep.id} value={rep.id}>{rep.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm font-bold text-zinc-300">{assignedRep?.name || 'غير معيّن'}</span>
                      )}
                    </td>
                    {!isSalesManagerLeadDistribution && (
                      <td className="p-5">
                        {canChangeAnyStatus || lead.assignedTo === currentUser?.id ? (
                          <select
                            value={lead.status}
                            onChange={(e) => updateLeadStatus(lead.id, e.target.value as LeadStatus)}
                            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-xs min-w-[140px]"
                          >
                            {leadStatuses.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-zinc-200 font-bold">{lead.status}</span>
                        )}
                      </td>
                    )}
                    {!isSalesManagerLeadDistribution && (
                      <td className="p-5">
                        <div className="flex flex-wrap items-center gap-2 justify-end">
                          {canSubmitQuoteForLead(lead) && (
                            <button
                              type="button"
                              onClick={() => setQuoteLead(lead)}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-amber-500/20 text-amber-200 border border-amber-500/30"
                            >
                              عرض سعر
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setClient360Lead(lead)}
                            className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                          >
                            Client 360
                          </button>
                          {currentUser?.role === 'محاسب' && lead.status === 'مغلق - فوز' && (
                            <button
                              type="button"
                              onClick={() => setStatementCustomer({
                                name: lead.name,
                                customerCode: (lead as any).customerCode || 'CUS-0000',
                                sourceLabel: lead.source,
                                sourceType: 'lead_auto',
                              })}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
                            >
                              كشف حساب
                            </button>
                          )}
                          {canManageAssignment && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`حذف الليد «${lead.name}» نهائياً؟ لا يمكن التراجع.`)) return;
                                toastDeleteLeadResult(await deleteLead(lead.id));
                              }}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-rose-500/15 text-rose-200 border border-rose-500/35 hover:bg-rose-500/25 inline-flex items-center gap-1"
                              title="حذف الليد"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              حذف
                            </button>
                          )}
                          <button
                            onClick={() => toast.info(`آخر تحديث: ${new Date(lead.updatedAt).toLocaleString('ar-EG')}`)}
                            data-tooltip="عرض آخر تحديث"
                            aria-label="عرض آخر تحديث"
                            className="icon-tooltip p-2.5 bg-[#0F1528] hover:bg-[#151E38] rounded-xl text-zinc-300 transition-colors"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }) : customerRows.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="p-5">
                    <p className="font-black text-white">{c.name}</p>
                    <p className="text-xs text-zinc-400 mt-1">{c.company || '—'}</p>
                    <p className="text-xs text-zinc-500 mt-1">{c.phone || c.email || '—'}</p>
                  </td>
                  <td className="p-5 text-sm">
                    <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-amber-500/20 text-amber-300">
                      خارجي ({c.sourceLabel})
                    </span>
                  </td>
                  <td className="p-5 text-amber-300 font-black">{c.receivableDebit.toLocaleString()} ج.م</td>
                  <td className="p-5 text-emerald-300 font-black">{c.payableCredit.toLocaleString()} ج.م</td>
                  <td className="p-5">
                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${c.receivableDebit > 0 ? 'bg-amber-500/20 text-amber-300' : c.payableCredit > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-200'}`}>
                      {c.receivableDebit > 0 ? 'مدين' : c.payableCredit > 0 ? 'دائن' : 'متزن'}
                    </span>
                  </td>
                  <td className="p-5">
                    <button
                      onClick={() => setStatementCustomer({ name: c.name, customerCode: c.customerCode, sourceLabel: c.sourceLabel, sourceType: c.sourceType })}
                      className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                    >
                      كشف حساب
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(entityMode === 'leads' ? visibleLeads.length === 0 : customerRows.length === 0) && (
          <div className="p-12 text-center text-zinc-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            لا توجد نتائج مطابقة للفلاتر الحالية
          </div>
        )}
      </div>

      <PriceQuoteSubmitModal lead={quoteLead} open={!!quoteLead} onClose={() => setQuoteLead(null)} />

      {isAddLeadOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-[#0E1426] border border-white/10 w-full max-w-2xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">{entityMode === 'customers' ? 'إضافة عميل جديد' : 'إضافة ليد جديد'}</h3>
              <button onClick={() => setIsAddLeadOpen(false)} className="p-2 hover:bg-white/10 rounded-xl">
                <X className="w-6 h-6" />
              </button>
            </div>

            {entityMode === 'customers' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={customerForm.name} onChange={(e) => setCustomerForm(prev => ({ ...prev, name: e.target.value }))} placeholder="اسم العميل" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.company} onChange={(e) => setCustomerForm(prev => ({ ...prev, company: e.target.value }))} placeholder="اسم الشركة (اختياري)" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.phone} onChange={(e) => setCustomerForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="رقم الهاتف" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.email} onChange={(e) => setCustomerForm(prev => ({ ...prev, email: e.target.value }))} placeholder="البريد الإلكتروني (اختياري)" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.sourceLabel} onChange={(e) => setCustomerForm(prev => ({ ...prev, sourceLabel: e.target.value }))} placeholder="المصدر (مثال: صيانة / زيارة مباشرة)" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm md:col-span-2" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={leadForm.name} onChange={(e) => setLeadForm(prev => ({ ...prev, name: e.target.value }))} placeholder="اسم العميل" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.company} onChange={(e) => setLeadForm(prev => ({ ...prev, company: e.target.value }))} placeholder="اسم الشركة" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.phone} onChange={(e) => setLeadForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="رقم الهاتف" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.email} onChange={(e) => setLeadForm(prev => ({ ...prev, email: e.target.value }))} placeholder="البريد الإلكتروني (اختياري)" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input type="number" min={1} value={leadForm.budget} onChange={(e) => setLeadForm(prev => ({ ...prev, budget: e.target.value }))} placeholder="الميزانية المتوقعة" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.source} onChange={(e) => setLeadForm(prev => ({ ...prev, source: e.target.value }))} placeholder="المصدر" className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />

                <select value={leadForm.companySize} onChange={(e) => setLeadForm(prev => ({ ...prev, companySize: e.target.value as Lead['companySize'] }))} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm">
                  <option value="صغير">صغير</option>
                  <option value="متوسط">متوسط</option>
                  <option value="كبير">كبير</option>
                </select>

                <select value={leadForm.category} onChange={(e) => setLeadForm(prev => ({ ...prev, category: e.target.value as LeadCategory }))} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm">
                  {leadCategories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button onClick={entityMode === 'customers' ? handleAddManualCustomer : handleCreateLead} className="flex-1 bg-[#7C6BFF] text-white py-3 rounded-2xl font-black">{entityMode === 'customers' ? 'حفظ العميل' : 'حفظ الليد'}</button>
              <button onClick={() => setIsAddLeadOpen(false)} className="flex-1 bg-[#0F1528] border border-white/15 py-3 rounded-2xl font-black">إلغاء</button>
            </div>
          </div>
        </div>
      )}
      {statementCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[230] flex items-center justify-center p-6">
          <div className="bg-[#0E1426] border border-white/10 w-full max-w-5xl rounded-[2.5rem] p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-black">كشف حساب العميل: {statementCustomer.name}</h3>
                <p className="text-xs text-zinc-500 mt-1">كود العميل: {customerStatementCode} • المصدر: {statementCustomer.sourceLabel || 'غير محدد'} • عدد الفواتير: {customerStatementTotals.count}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportCustomerStatementCsv} className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">تصدير CSV</button>
                <button onClick={printCustomerStatement} className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">طباعة / PDF</button>
                <button onClick={() => setStatementCustomer(null)} className="p-2 hover:bg-white/10 rounded-xl">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">إجمالي الفواتير</p>
                <p className="text-lg font-black text-white">{customerStatementTotals.total.toLocaleString()} ج.م</p>
              </div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">المحصل</p>
                <p className="text-lg font-black text-emerald-300">{customerStatementTotals.paid.toLocaleString()} ج.م</p>
              </div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">المتبقي (أقساط/ذمم)</p>
                <p className="text-lg font-black text-amber-300">{customerStatementTotals.remaining.toLocaleString()} ج.م</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full min-w-[980px] text-right">
                <thead>
                  <tr className="bg-[#0B1020]/80">
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">رقم الفاتورة</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">التاريخ</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">الإجمالي</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">المحصل</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">المتبقي</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">موعد القسط</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">الحالة</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">الدفعات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {customerStatementInvoices.map((inv) => {
                    const total = inv.totalAmount ?? inv.amount;
                    const paid = inv.paidAmount ?? (inv.status === 'مدفوع' ? total : 0);
                    const remaining = Math.max(0, total - paid);
                    return (
                      <tr key={inv.id} className="hover:bg-white/[0.03]">
                        <td className="p-4 font-mono text-xs text-indigo-300">{inv.id}</td>
                        <td className="p-4 text-xs text-zinc-300">{new Date(inv.date).toLocaleDateString('ar-EG')}</td>
                        <td className="p-4 font-black text-white">{total.toLocaleString()} ج.م</td>
                        <td className="p-4 font-black text-emerald-300">{paid.toLocaleString()} ج.م</td>
                        <td className="p-4 font-black text-amber-300">{remaining.toLocaleString()} ج.م</td>
                        <td className="p-4 text-xs text-zinc-300">{inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString('ar-EG') : '—'}</td>
                        <td className="p-4 text-xs">
                          <span className={`px-2 py-1 rounded-lg font-black ${inv.status === 'مدفوع' ? 'bg-emerald-500/20 text-emerald-300' : inv.status === 'متأخر' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{inv.status}</span>
                        </td>
                        <td className="p-4 text-xs text-zinc-300">{(inv.collections || []).length} دفعة</td>
                      </tr>
                    );
                  })}
                  {customerStatementInvoices.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-zinc-500">لا توجد فواتير لهذا العميل بعد.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <h4 className="font-black mb-3">حركة الدفعات (مجمعة)</h4>
              <div className="overflow-x-auto max-h-[260px]">
                <table className="w-full min-w-[900px] text-right">
                  <thead>
                    <tr className="bg-[#0B1020]/80">
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">التاريخ</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">رقم الفاتورة</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">طريقة الدفع</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">القيمة</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">رقم القيد</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {customerStatementCollections.map((col) => (
                      <tr key={col.id} className="hover:bg-white/[0.03]">
                        <td className="p-3 text-xs text-zinc-300">{new Date(col.date).toLocaleString('ar-EG')}</td>
                        <td className="p-3 font-mono text-xs text-indigo-300">{col.invoiceId}</td>
                        <td className="p-3 text-xs text-cyan-300">{col.method}</td>
                        <td className="p-3 font-black text-emerald-300">{col.amount.toLocaleString()} ج.م</td>
                        <td className="p-3 font-mono text-[11px] text-zinc-400">{col.journalEntryId || '—'}</td>
                        <td className="p-3 text-xs text-zinc-400">{col.note || '—'}</td>
                      </tr>
                    ))}
                    {customerStatementCollections.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-5 text-center text-zinc-500">لا توجد دفعات مسجلة لهذا العميل حتى الآن.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {client360Lead && client360Data && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[240] flex items-center justify-center p-6">
          <div className="bg-[#0E1426] border border-white/10 w-full max-w-6xl rounded-[2.5rem] p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-black">Client 360: {client360Lead.name}</h3>
                <p className="text-xs text-zinc-500 mt-1">{client360Lead.company} • {client360Lead.phone} • الحالة: {client360Lead.status}</p>
              </div>
              <button onClick={() => setClient360Lead(null)} className="p-2 hover:bg-white/10 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">إجمالي الفواتير</p><p className="text-lg font-black text-white">{client360Data.totalRevenue.toLocaleString()} ج.م</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">المحصل</p><p className="text-lg font-black text-emerald-300">{client360Data.totalCollected.toLocaleString()} ج.م</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">المتبقي</p><p className="text-lg font-black text-amber-300">{client360Data.totalRemaining.toLocaleString()} ج.م</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">مرفقات موثقة</p><p className="text-lg font-black text-cyan-300">{client360Data.evidenceItems.length}</p></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">آخر التواصلات</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Lead.timeline.slice(0, 10).map((a) => (
                    <div key={a.id} className="border border-white/10 rounded-lg p-2">
                      <p className="text-sm font-bold text-zinc-200">{a.action}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">{a.note || 'بدون ملاحظة'}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">أرشيف الأدلة</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Data.evidenceItems.map((a) => (
                    <a key={a.id} href={a.evidenceRef} target="_blank" rel="noreferrer" className="block border border-cyan-500/25 rounded-lg p-2 hover:bg-cyan-500/10">
                      <p className="text-sm font-bold text-cyan-200">{a.action}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">{new Date(a.createdAt).toLocaleString('ar-EG')}</p>
                    </a>
                  ))}
                  {client360Data.evidenceItems.length === 0 && <p className="text-sm text-zinc-500">لا توجد أدلة مرفقة حتى الآن.</p>}
                </div>
              </div>
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">ملخص فواتير العميل</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Data.leadInvoices.map((inv) => (
                    <div key={inv.id} className="border border-white/10 rounded-lg p-2 flex items-center justify-between text-sm">
                      <span className="text-zinc-200 font-bold">{inv.id}</span>
                      <span className="text-emerald-300">{Number(inv.totalAmount ?? inv.amount).toLocaleString()} ج.م</span>
                      <span className="text-zinc-400">{inv.status}</span>
                    </div>
                  ))}
                  {client360Data.leadInvoices.length === 0 && <p className="text-sm text-zinc-500">لا توجد فواتير مرتبطة.</p>}
                </div>
              </div>
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">الحالة التشغيلية (اجتماعات/تصوير/معدات)</h4>
                <div className="text-xs text-zinc-300 space-y-2">
                  <p>اجتماعات: <span className="font-black text-indigo-300">{client360Data.leadMeetings.length}</span></p>
                  <p>طلبات تصوير: <span className="font-black text-amber-300">{client360Data.leadShoots.length}</span></p>
                  <p>طلبات معدات: <span className="font-black text-cyan-300">{client360Data.leadEquipment.length}</span></p>
                  <p>مصروفات مرتبطة (تقديري): <span className="font-black text-rose-300">{client360Data.leadExpenses.length}</span></p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Sales Manager Settings ---

const SalesManagerSettings = ({
  visualMode = 'premium',
  onVisualModeChange,
}: {
  visualMode?: 'premium' | 'classic';
  onVisualModeChange?: (mode: 'premium' | 'classic') => void;
}) => {
  const {
    users,
    currentUser,
    updateUserSkills,
    addEmployee,
    updateEmployeeProfile,
    ownerSetEmployeePassword,
    removeEmployee,
    printBrandingSettings,
    updatePrintBrandingSettings,
    leadIngestionSettings,
    updateLeadIngestionSettings,
    slaEscalationSettings,
    updateSlaEscalationSettings,
    leadDataQualitySettings,
    updateLeadDataQualitySettings,
    workflowRulesSettings,
    updateWorkflowRulesSettings,
    integrations,
    startIntegrationConnect,
    disconnectIntegration,
    syncExternalLeads,
  } = useData();
  const reps = users.filter(u => u.role === 'مندوب');
  const salesManager = users.find(u => u.role === 'مدير مبيعات');
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const canEditBranding = currentUser?.role === 'مالك';
  /** تعديل صف موظف من الجدول (لا يشمل حساب مالك آخر غير المستخدم الحالي) */
  const canOwnerEditEmployeeRow = (em: User) =>
    Boolean(canEditBranding && !(em.role === 'مالك' && em.id !== currentUser?.id));

  const skillOptions: LeadCategory[] = ['إنجليزي', 'شركات كبرى', 'شركات صغيرة', 'إعلانات', 'سوشيال ميديا'];
  const roleOptions: User['role'][] = ['مدير مبيعات', 'محاسب', 'مندوب', 'مدير إنتاج'];
  const [newEmployee, setNewEmployee] = useState({
    name: '',
    role: 'مندوب' as User['role'],
    avatar: '',
    loginEmail: '',
    password: '',
    baseSalary: '10000',
  });
  const [employeeEdits, setEmployeeEdits] = useState<
    Record<string, { name: string; role: User['role']; avatar: string; email: string; baseSalary: string }>
  >({});
  const [employeePwDraft, setEmployeePwDraft] = useState<Record<string, { pw: string; pw2: string }>>({});
  const [ownerPwdCurrent, setOwnerPwdCurrent] = useState('');
  const [ownerPwdNew, setOwnerPwdNew] = useState('');
  const [ownerPwdConfirm, setOwnerPwdConfirm] = useState('');
  const [ownerPwdSaving, setOwnerPwdSaving] = useState(false);
  const integrationRows: { provider: IntegrationProvider; title: string; hint: string }[] = [
    { provider: 'facebook', title: 'Facebook', hint: 'Meta Pages + Lead Ads' },
    { provider: 'instagram', title: 'Instagram', hint: 'Instagram Business via Meta' },
    { provider: 'google_ads', title: 'Google Ads', hint: 'Google Ads API lead sources' },
    { provider: 'whatsapp', title: 'WhatsApp Business', hint: 'Cloud API templates + inbox sync' },
    { provider: 'linkedin', title: 'LinkedIn', hint: 'Lead Gen Forms + organization pages' },
  ];

  const toggleSkill = async (userId: string, currentSkills: LeadCategory[] = [], skill: LeadCategory) => {
    const skills = currentSkills || [];
    const newSkills = skills.includes(skill) 
      ? skills.filter(s => s !== skill)
      : [...skills, skill];
    const ok = await updateUserSkills(userId, newSkills);
    if (!ok) {
      toast.error('تعذر حفظ المهارات على السيرفر');
      return;
    }
    toast.success('تم تحديث مهارات المندوب وتوزيع العمل');
  };

  const backupSystemData = async () => {
    if (isServerDataMode()) {
      if (isSupabaseDirectMode()) {
        toast.message('النسخ الاحتياطي JSON مرتبط بخادم Express — في وضع Supabase استخدم تصدير لوحة Supabase أو أدوات النسخ الاحتياطي');
        return;
      }
      const token = localStorage.getItem('prod_system_jwt');
      if (!token) {
        toast.error('لا يوجد توكن جلسة — سجّل الدخول أولاً');
        return;
      }
      const base = getApiBaseUrl();
      const authH: HeadersInit = { Authorization: `Bearer ${token}` };
      const fetchJson = async (path: string) => {
        const r = await fetch(`${base}${path}`, { headers: authH });
        if (!r.ok) throw new Error(path);
        return r.json();
      };
      try {
        const [
          ws,
          leadsJ,
          usersJ,
          invJ,
          expJ,
          quotesJ,
          customersJ,
          journalsJ,
          polJ,
          closedJ,
          targetsJ,
          custodySetJ,
          auditJ,
          fundsJ,
          shootJ,
          equipJ,
          meetJ,
          attendJ,
        ] = await Promise.all([
          fetchJson('/api/workspace-state').catch(() => ({})),
          fetchJson('/api/leads').catch(() => ({ leads: [] })),
          fetchJson('/api/users').catch(() => ({ users: [] })),
          fetchJson('/api/invoices').catch(() => ({ invoices: [] })),
          fetchJson('/api/expenses').catch(() => ({ expenses: [] })),
          fetchJson('/api/price-quotes').catch(() => ({ quotes: [] })),
          fetchJson('/api/manual-customers').catch(() => ({ customers: [] })),
          fetchJson('/api/manual-journals').catch(() => ({ journals: [] })),
          fetchJson('/api/accounting-policy').catch(() => ({ policy: null })),
          fetchJson('/api/closed-months').catch(() => ({ closedMonths: [] })),
          fetchJson('/api/monthly-targets').catch(() => ({ targets: [] })),
          fetchJson('/api/custody-settings').catch(() => ({ custodyAccountByCategory: {} })),
          fetchJson('/api/audit-events').catch(() => ({ events: [] })),
          fetchJson('/api/custody-funds').catch(() => ({ funds: [] })),
          fetchJson('/api/shoot-bookings').catch(() => ({ bookings: [] })),
          fetchJson('/api/equipment-bookings').catch(() => ({ bookings: [] })),
          fetchJson('/api/meeting-bookings').catch(() => ({ bookings: [] })),
          fetchJson('/api/attendance-records').catch(() => ({ records: [] })),
        ]);
        const payload = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            mode: 'server',
            note:
              'لقطة REST من السيرفر. استرجاع الملف لا يكتب على قاعدة البيانات — للاستعادة استخدم نسخ احتياطي لقاعدة البيانات أو وضع محلي مع أدوات الاستيراد.',
            data: {
              workspace: ws.workspace ?? {},
              leads: leadsJ.leads ?? [],
              users: usersJ.users ?? [],
              invoices: invJ.invoices ?? [],
              expenses: expJ.expenses ?? [],
              priceQuotes: quotesJ.quotes ?? [],
              manualCustomers: customersJ.customers ?? [],
              manualJournals: journalsJ.journals ?? [],
              accountingPolicy: polJ.policy ?? null,
              closedMonths: closedJ.closedMonths ?? [],
              monthlyTargets: targetsJ.targets ?? [],
              custodyAccountByCategory: custodySetJ.custodyAccountByCategory ?? {},
              auditEvents: auditJ.events ?? [],
              custodyFunds: fundsJ.funds ?? [],
              shootBookings: shootJ.bookings ?? [],
              equipmentBookings: equipJ.bookings ?? [],
              meetingBookings: meetJ.bookings ?? [],
              attendanceRecords: attendJ.records ?? [],
            },
          },
          null,
          2
        );
        const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `backup-server-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success('تم تنزيل لقطة من السيرفر');
      } catch {
        toast.error('تعذر تنزيل لقطة السيرفر');
      }
      return;
    }
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('prod_system_')) continue;
      const value = localStorage.getItem(key);
      if (typeof value === 'string') snapshot[key] = value;
    }
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), data: snapshot }, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-pro-system-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('تم تنزيل نسخة احتياطية للنظام');
  };

  const restoreSystemData = (file: File) => {
    if (isServerDataMode()) {
      toast.error(
        'استرجاع ملف النسخة يعدّل التخزين المحلي فقط ولا يزامن قاعدة البيانات. عطّل وضع السيرفر أو استعد من نسخة احتياطية لقاعدة البيانات.'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const data = parsed?.data;
        if (!data || typeof data !== 'object') throw new Error('invalid payload');
        const ok = window.confirm('استرجاع النسخة سيستبدل بيانات النظام الحالية. هل تريد المتابعة؟');
        if (!ok) return;
        Object.entries(data).forEach(([key, value]) => {
          if (key.startsWith('prod_system_') && typeof value === 'string') {
            localStorage.setItem(key, value);
          }
        });
        toast.success('تم استرجاع النسخة الاحتياطية. سيتم إعادة تحميل النظام.');
        setTimeout(() => window.location.reload(), 700);
      } catch {
        toast.error('ملف النسخة غير صالح');
      }
    };
    reader.readAsText(file);
  };

  const handleLogoUpload = (file: File) => {
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error('حجم اللوجو كبير. الحد الأقصى 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const logoDataUrl = String(reader.result || '');
      updatePrintBrandingSettings({ logoDataUrl });
      toast.success('تم تحديث لوجو التقارير');
    };
    reader.readAsDataURL(file);
  };

  const handleEmployeeAvatarUpload = (file: File, userId?: string) => {
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error('حجم الصورة كبير. الحد الأقصى 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const avatarDataUrl = String(reader.result || '');
      if (userId) {
        const user = users.find((u) => u.id === userId);
        if (!user) return;
        const draft =
          employeeEdits[userId] || {
            name: user.name,
            role: user.role,
            avatar: user.avatar || '',
            email: (user.email || '').trim(),
            baseSalary: PAYROLL_SALARY_ROLES.includes(user.role) ? String(user.baseSalary ?? 0) : '',
          };
        setEmployeeEdits((prev) => ({ ...prev, [userId]: { ...draft, avatar: avatarDataUrl } }));
      } else {
        setNewEmployee((prev) => ({ ...prev, avatar: avatarDataUrl }));
      }
      toast.success('تم رفع الصورة بنجاح');
    };
    reader.readAsDataURL(file);
  };

  const handleSyncChannel = async (channel: ExternalLeadChannel) => {
    try {
      const imported = await syncExternalLeads(channel, 5);
      if (!imported) {
        if (isSupabaseDirectMode()) return;
        toast.error('تعذر سحب الليدز. تأكد أن القناة مربوطة أولاً أو أن الخادم يعمل.');
        return;
      }
      toast.success(`تم سحب ${imported} ليدز وتحويلها تلقائياً لمدير المبيعات`);
    } catch {
      toast.error('تعذر مزامنة القناة مع الخادم');
    }
  };

  const providerToPullChannel: Partial<Record<IntegrationProvider, ExternalLeadChannel>> = {
    facebook: 'facebook',
    instagram: 'facebook',
    google_ads: 'google',
    linkedin: 'linkedin',
  };

  const handlePullFromIntegration = (provider: IntegrationProvider) => {
    const ch = providerToPullChannel[provider];
    if (!ch) {
      toast.message('سحب الليدز لهذه المنصة يتطلّب تكاملاً خاصاً على خادم التطبيق.');
      return;
    }
    void handleSyncChannel(ch);
  };

  const handleConnectIntegration = (provider: IntegrationProvider) => {
    const result = startIntegrationConnect(provider);
    if (!result.ok || !result.authUrl) {
      toast.error('تعذر بدء الربط حالياً');
      return;
    }
    window.open(result.authUrl, '_blank', 'noopener,noreferrer');
    toast.info(
      'سيتم فتح نافذة تسجيل الدخول الرسمية للمنصة. سجّل الدخول بالحساب الذي تريد سحب الليدز أو الإعلانات منه، ثم وافق على الصلاحيات لإتمام الربط.',
    );
  };

  const handleDisconnectIntegration = (provider: IntegrationProvider) => {
    const ok = disconnectIntegration(provider);
    if (!ok) {
      toast.error('تعذر فصل الربط');
      return;
    }
    toast.success('تم فصل الربط بنجاح');
  };

  const ensureEdit = (u: User) => {
    setEmployeeEdits((prev) => {
      if (prev[u.id]) return prev;
      return {
        ...prev,
        [u.id]: {
          name: u.name,
          role: u.role,
          avatar: u.avatar || '',
          email: (u.email || '').trim(),
          baseSalary: PAYROLL_SALARY_ROLES.includes(u.role) ? String(u.baseSalary ?? 0) : '',
        },
      };
    });
  };

  const handleCreateEmployee = async () => {
    const clean = newEmployee.name.trim();
    if (!clean) {
      toast.error('اكتب اسم الموظف');
      return;
    }
    const emailTrim = newEmployee.loginEmail.trim().toLowerCase();
    const pwd = newEmployee.password.trim();
    if (!isServerDataMode()) {
      toast.error('غير متاح — تأكد من بناء الواجهة للإنتاج أو ضبط VITE_DATA_SOURCE=server');
      return;
    }
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast.error('أدخل بريداً صالحاً لتسجيل الدخول');
      return;
    }
    if (pwd.length > 0 && pwd.length < 8) {
      toast.error('كلمة المرور ٨ أحرف فأكثر، أو اتركها فارغة');
      return;
    }
    const ok = await addEmployee({
      name: clean,
      role: newEmployee.role,
      avatar: newEmployee.avatar.trim() || undefined,
      email: emailTrim,
      password: pwd.length >= 8 ? pwd : undefined,
      baseSalary: PAYROLL_SALARY_ROLES.includes(newEmployee.role)
        ? Math.max(0, Math.round(Number(String(newEmployee.baseSalary).replace(/,/g, '')) || 0))
        : undefined,
    });
    if (ok) setNewEmployee({ name: '', role: 'مندوب', avatar: '', loginEmail: '', password: '', baseSalary: '10000' });
  };

  const handleSaveEmployee = async (userId: string) => {
    const draft = employeeEdits[userId];
    if (!draft) return;
    const emailTrim = (draft.email || '').trim().toLowerCase();
    if (canEditBranding && emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast.error('صيغة البريد غير صالحة');
      return;
    }
    const salaryParsed = PAYROLL_SALARY_ROLES.includes(draft.role)
      ? Math.max(0, Math.round(Number(String(draft.baseSalary).replace(/,/g, '')) || 0))
      : undefined;
    const ok = await updateEmployeeProfile(userId, {
      name: draft.name,
      role: draft.role,
      avatar: draft.avatar,
      ...(canEditBranding ? { email: draft.email } : {}),
      ...(PAYROLL_SALARY_ROLES.includes(draft.role) && salaryParsed !== undefined ? { baseSalary: salaryParsed } : {}),
    });
    if (!ok) {
      return;
    }
    toast.success('تم تحديث بيانات الموظف');
  };

  const handleDeleteEmployee = async (userId: string, name: string) => {
    const yes = window.confirm(`تأكيد حذف الموظف: ${name} ؟`);
    if (!yes) return;
    const ok = await removeEmployee(userId);
    if (!ok) return;
    toast.success('تم حذف الموظف');
  };

  const handleSaveEmployeePassword = async (userId: string) => {
    const d = employeePwDraft[userId];
    if (!d?.pw || d.pw.length < 8) {
      toast.error('كلمة المرور ٨ أحرف أو أكثر');
      return;
    }
    if (d.pw !== d.pw2) {
      toast.error('تأكيد كلمة المرور غير متطابق');
      return;
    }
    const yes = window.confirm('تأكيد تعيين كلمة مرور جديدة لهذا الموظف؟ سيستخدمها في تسجيل الدخول القادم.');
    if (!yes) return;
    const ok = await ownerSetEmployeePassword(userId, d.pw);
    if (ok) {
      setEmployeePwDraft((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const handleChangeOwnerPassword = async () => {
    if (!isServerDataMode()) {
      toast.error('متاح في وضع السيرفر فقط');
      return;
    }
    if (ownerPwdNew.length < 8) {
      toast.error('كلمة المرور الجديدة ٨ أحرف أو أكثر');
      return;
    }
    if (ownerPwdNew !== ownerPwdConfirm) {
      toast.error('تأكيد كلمة المرور غير متطابق');
      return;
    }
    setOwnerPwdSaving(true);
    try {
      await patchMyPasswordApi({ currentPassword: ownerPwdCurrent, newPassword: ownerPwdNew });
      setOwnerPwdCurrent('');
      setOwnerPwdNew('');
      setOwnerPwdConfirm('');
      toast.success('تم تحديث كلمة مرور حساب المالك');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحديث كلمة المرور');
    } finally {
      setOwnerPwdSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="إعدادات توزيع العمل" subtitle="تحديد مهارات المناديب للتحكم في التوزيع التلقائي لليدز" icon={Settings} />

      <EquipmentMasterMiniPanel />

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-lg font-black">مظهر النظام</h3>
              <p className="text-xs text-zinc-400 mt-1">اختر بين الشكل الكلاسيكي أو الشكل السينمائي ثلاثي الأبعاد.</p>
            </div>
            <div className="inline-flex items-center gap-2 bg-[#0F1528]/80 border border-white/10 rounded-2xl p-1.5">
              <button
                type="button"
                onClick={() => onVisualModeChange?.('classic')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${visualMode === 'classic' ? 'bg-white/15 text-white border border-white/20' : 'text-zinc-300 hover:text-white'}`}
              >
                Classic
              </button>
              <button
                type="button"
                onClick={() => onVisualModeChange?.('premium')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${visualMode === 'premium' ? 'bg-[#7C6BFF] text-white border border-[#A99FFF]/45' : 'text-zinc-300 hover:text-white'}`}
              >
                Premium 3D
              </button>
            </div>
          </div>
        </div>
      )}

      {canEditBranding && isServerDataMode() && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div>
            <h3 className="text-lg font-black flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-300/90" />
              كلمة مرور حساب المالك
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              غيّر كلمة مرور تسجيل الدخول لحسابك (بريد المالك). يُشترط إدخال كلمة المرور الحالية قبل تعيين الجديدة.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="password"
              autoComplete="current-password"
              value={ownerPwdCurrent}
              onChange={(e) => setOwnerPwdCurrent(e.target.value)}
              placeholder="كلمة المرور الحالية"
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={ownerPwdNew}
              onChange={(e) => setOwnerPwdNew(e.target.value)}
              placeholder="كلمة المرور الجديدة (٨+ أحرف)"
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={ownerPwdConfirm}
              onChange={(e) => setOwnerPwdConfirm(e.target.value)}
              placeholder="تأكيد الجديدة"
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={ownerPwdSaving || !ownerPwdCurrent.trim()}
            onClick={handleChangeOwnerPassword}
            className="px-4 py-2 rounded-xl text-sm font-black border border-amber-400/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {ownerPwdSaving ? 'جاري الحفظ…' : 'حفظ كلمة المرور'}
          </button>
        </div>
      )}

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h3 className="text-lg font-black">ربط مصادر الليدز — تسجيل الدخول الرسمي</h3>
            </div>
            <div className="text-xs text-zinc-300 bg-white/5 px-3 py-2 rounded-xl border border-white/10 shrink-0">
              المدير المستلم: <span className="font-black">{salesManager?.name || 'غير محدد'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <button
              type="button"
              onClick={() => updateLeadIngestionSettings({ autoRouteToManager: !leadIngestionSettings.autoRouteToManager })}
              className={`px-3 py-2 rounded-xl border font-bold transition-all ${leadIngestionSettings.autoRouteToManager ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}
            >
              التحويل التلقائي لمدير المبيعات: {leadIngestionSettings.autoRouteToManager ? 'مفعل' : 'متوقف'}
            </button>
            {salesManager && (
              <button
                type="button"
                onClick={() => updateLeadIngestionSettings({ managerUserId: salesManager.id })}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:border-white/30 transition-all"
              >
                تثبيت المدير الحالي كمستلم
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {integrationRows.map((row) => {
              const state = integrations.find((x) => x.provider === row.provider);
              const connected = !!state?.connected;
              const pullCh = providerToPullChannel[row.provider];
              return (
                <div key={row.provider} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black">{row.title}</p>
                      <p className="text-[11px] text-zinc-400">{row.hint}</p>
                      <p className="text-[11px] mt-1 text-zinc-500">
                        الربط:{' '}
                        <span
                          className={
                            connected ? 'text-emerald-300' : state?.status === 'error' ? 'text-rose-300' : 'text-zinc-400'
                          }
                        >
                          {connected ? 'متصل' : state?.status === 'error' ? 'خطأ' : 'غير متصل'}
                        </span>
                        {!connected && state?.status && state.status !== 'error' ? (
                          <span className="text-zinc-500"> ({state.status})</span>
                        ) : null}
                      </p>
                      {state?.accountLabel && <p className="text-[11px] text-zinc-400">الحساب: {state.accountLabel}</p>}
                      {state?.lastError && <p className="text-[11px] text-rose-300 mt-1">{state.lastError}</p>}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleConnectIntegration(row.provider)}
                        className="px-3 py-2 rounded-xl text-xs font-black border border-indigo-400/35 bg-indigo-500/20 text-indigo-200 hover:border-indigo-300/60 transition-all"
                      >
                        {connected ? 'إعادة الربط' : 'ربط (تسجيل دخول)'}
                      </button>
                      <button
                        type="button"
                        disabled={!connected}
                        onClick={() => handleDisconnectIntegration(row.provider)}
                        className="px-3 py-2 rounded-xl text-xs font-black border border-rose-400/35 bg-rose-500/15 text-rose-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        فصل الربط
                      </button>
                    </div>
                  </div>
                  {pullCh ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        disabled={!connected || isSupabaseDirectMode()}
                        onClick={() => handlePullFromIntegration(row.provider)}
                        className="px-3 py-2 rounded-xl text-xs font-black border border-white/15 bg-white/5 hover:border-white/30 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        سحب ليدز الآن
                      </button>
                      {isSupabaseDirectMode() ? (
                        <span className="text-[10px] text-zinc-500">غير متاح في وضع Supabase المباشر حالياً</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-500 pt-2 border-t border-white/10">
                      سحب الليدز من هذه القناة يتطلّب تطويراً إضافياً على خادم التطبيق.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4 space-y-3">
            <div>
              <p className="font-black text-sm">البريد الوارد</p>
              <p className="text-[11px] text-zinc-500">لا يوجد OAuth للبريد في هذه القائمة — إعداد يدوي ثم سحب تجريبي.</p>
            </div>
            {(() => {
              const cfg = leadIngestionSettings.email;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateLeadIngestionSettings({
                          email: { connected: !cfg.connected },
                        } as any)
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-black border transition-all ${cfg.connected ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-rose-500/15 border-rose-400/35 text-rose-200'}`}
                    >
                      {cfg.connected ? 'متصل (يدوي)' : 'غير متصل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSyncChannel('email')}
                      className="px-3 py-2 rounded-xl text-xs font-black border border-white/15 bg-white/5 hover:border-white/30 transition-all"
                    >
                      سحب ليدز الآن
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      value={cfg.accountRef || ''}
                      onChange={(e) =>
                        updateLeadIngestionSettings({
                          email: { accountRef: e.target.value },
                        } as any)
                      }
                      placeholder="معرّف صندوق / عنوان IMAP"
                      className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateLeadIngestionSettings({
                          email: { autoSync: !cfg.autoSync },
                        } as any)
                      }
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${cfg.autoSync ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}
                    >
                      المزامنة التلقائية: {cfg.autoSync ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-5">
          <div>
            <h3 className="text-lg font-black">Enterprise Controls</h3>
            <p className="text-xs text-zinc-400 mt-1">إعدادات متقدمة لسير العمل، جودة البيانات، ومصفوفة تصعيد SLA.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">Workflow Rules</p>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ quoteRequiresOwnerApproval: !workflowRulesSettings.quoteRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.quoteRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                اعتماد المالك لعروض السعر: {workflowRulesSettings.quoteRequiresOwnerApproval ? 'إجباري' : 'مرن (مدير مبيعات/مالك)'}
              </button>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ externalMeetingRequiresOwnerApproval: !workflowRulesSettings.externalMeetingRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.externalMeetingRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                اعتماد مالك للاجتماعات الخارجية: {workflowRulesSettings.externalMeetingRequiresOwnerApproval ? 'مفعل' : 'متوقف'}
              </button>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ expenseRequiresOwnerApproval: !workflowRulesSettings.expenseRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.expenseRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                اعتماد مالك للمصروفات: {workflowRulesSettings.expenseRequiresOwnerApproval ? 'مفعل' : 'اعتماد تلقائي'}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">SLA Escalation Matrix</p>
              <label className="block text-xs text-zinc-300">تحذير بعد (دقيقة)</label>
              <input type="number" min={5} value={slaEscalationSettings.warningAfterMinutes} onChange={(e) => updateSlaEscalationSettings({ warningAfterMinutes: Number(e.target.value) || 5 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
              <label className="block text-xs text-zinc-300">حرج بعد (دقيقة)</label>
              <input type="number" min={10} value={slaEscalationSettings.criticalAfterMinutes} onChange={(e) => updateSlaEscalationSettings({ criticalAfterMinutes: Number(e.target.value) || 10 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
              <label className="block text-xs text-zinc-300">مرشح إعادة توزيع بعد (ساعات)</label>
              <input type="number" min={0} value={slaEscalationSettings.autoReassignAfterHours} onChange={(e) => updateSlaEscalationSettings({ autoReassignAfterHours: Number(e.target.value) || 0 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">Lead Data Quality</p>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ rejectDuplicateLeads: !leadDataQualitySettings.rejectDuplicateLeads })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.rejectDuplicateLeads ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                رفض الليد المكرر: {leadDataQualitySettings.rejectDuplicateLeads ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ duplicatePhone: !leadDataQualitySettings.duplicatePhone })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.duplicatePhone ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                مطابقة التكرار برقم الهاتف: {leadDataQualitySettings.duplicatePhone ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ duplicateEmail: !leadDataQualitySettings.duplicateEmail })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.duplicateEmail ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                مطابقة التكرار بالإيميل: {leadDataQualitySettings.duplicateEmail ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ requireCompany: !leadDataQualitySettings.requireCompany })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.requireCompany ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                الشركة حقل إجباري: {leadDataQualitySettings.requireCompany ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ requireBudget: !leadDataQualitySettings.requireBudget })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.requireBudget ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                الميزانية حقل إجباري: {leadDataQualitySettings.requireBudget ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-black">إدارة الموظفين حسب الأدوار</h3>
          {canEditBranding && (
            <div className="text-xs text-zinc-400">صلاحيات الإدارة الكاملة للمالك فقط (إضافة/تعديل/حذف)</div>
          )}
        </div>
        {canEditBranding && (
          <div className="mb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
              <input
                value={newEmployee.name}
                onChange={(e) => setNewEmployee((p) => ({ ...p, name: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="اسم الموظف"
              />
              <select
                value={newEmployee.role}
                onChange={(e) => {
                  const role = e.target.value as User['role'];
                  setNewEmployee((p) => ({
                    ...p,
                    role,
                    baseSalary: PAYROLL_SALARY_ROLES.includes(role) && (!p.baseSalary || p.baseSalary.trim() === '')
                      ? '10000'
                      : p.baseSalary,
                  }));
                }}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                disabled={!PAYROLL_SALARY_ROLES.includes(newEmployee.role)}
                value={newEmployee.baseSalary}
                onChange={(e) =>
                  setNewEmployee((p) => ({ ...p, baseSalary: e.target.value.replace(/[^\d]/g, '') }))
                }
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm disabled:opacity-45"
                placeholder="راتب أساسي (مندوب)"
              />
              <input
                type="email"
                autoComplete="off"
                value={newEmployee.loginEmail}
                onChange={(e) => setNewEmployee((p) => ({ ...p, loginEmail: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="البريد لتسجيل الدخول"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={newEmployee.password}
                onChange={(e) => setNewEmployee((p) => ({ ...p, password: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder="كلمة المرور (اختياري • ٨+)"
              />
              <label className="px-3 py-2 rounded-xl text-sm border border-white/10 bg-[#0F1528] text-zinc-200 cursor-pointer text-center flex items-center justify-center min-h-[42px]">
                رفع صورة
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleEmployeeAvatarUpload(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <div className="flex items-center justify-center rounded-xl border border-white/10 bg-[#0F1528] min-h-[42px]">
                {newEmployee.avatar ? (
                  <img src={newEmployee.avatar} alt="" className="w-10 h-10 rounded-lg object-cover" />
                ) : (
                  <span className="text-[11px] text-zinc-500 px-2">بدون صورة</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCreateEmployee}
                className="px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-black text-sm xl:col-span-1"
              >
                إضافة موظف وحساب
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-right">
            <thead>
              <tr className="bg-[#0B1020]/80">
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الاسم</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">بريد الدخول</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الدور</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الصورة</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الراتب الأساسي</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">حالة مهارات التوزيع</th>
                {canEditBranding && (
                  <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400 min-w-[170px]">باسورد جديد</th>
                )}
                {canEditBranding && <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">إجراءات المالك</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((employee) => {
                const draft =
                  employeeEdits[employee.id] || {
                    name: employee.name,
                    role: employee.role,
                    avatar: employee.avatar || '',
                    email: (employee.email || '').trim(),
                    baseSalary: PAYROLL_SALARY_ROLES.includes(employee.role) ? String(employee.baseSalary ?? 0) : '',
                  };
                return (
                  <tr key={employee.id} className={trafficRowClass(employee.role === 'مندوب' ? (employee.skills.length > 0 ? 'safe' : 'warn') : 'neutral')}>
                    <td className="p-3 font-bold">
                      {canOwnerEditEmployeeRow(employee) ? (
                        <input
                          value={draft.name}
                          onFocus={() => ensureEdit(employee)}
                          onChange={(e) => setEmployeeEdits((prev) => ({ ...prev, [employee.id]: { ...draft, name: e.target.value } }))}
                          className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs w-full"
                        />
                      ) : (
                        employee.name
                      )}
                    </td>
                    <td className="p-3 max-w-[220px] align-top">
                      {canOwnerEditEmployeeRow(employee) ? (
                        <input
                          type="email"
                          dir="ltr"
                          autoComplete="off"
                          value={draft.email}
                          onFocus={() => ensureEdit(employee)}
                          onChange={(e) =>
                            setEmployeeEdits((prev) => ({ ...prev, [employee.id]: { ...draft, email: e.target.value } }))
                          }
                          className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-mono w-full"
                          placeholder="email@example.com"
                        />
                      ) : (
                        <span dir="ltr" className="text-[11px] text-zinc-300 font-mono break-all block">
                          {employee.authSource === 'database' && employee.email?.trim()
                            ? employee.email.trim()
                            : '—'}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {canOwnerEditEmployeeRow(employee) ? (
                        <select
                          value={draft.role}
                          onFocus={() => ensureEdit(employee)}
                          onChange={(e) => {
                            const role = e.target.value as User['role'];
                            setEmployeeEdits((prev) => {
                              const d = prev[employee.id] || draft;
                              const nextBase =
                                PAYROLL_SALARY_ROLES.includes(role)
                                  ? d.baseSalary && d.baseSalary.trim() !== ''
                                    ? d.baseSalary
                                    : String(employee.baseSalary ?? 10000)
                                  : '';
                              return { ...prev, [employee.id]: { ...d, role, baseSalary: nextBase } };
                            });
                          }}
                          className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                        >
                          {roleOptions.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        employee.role
                      )}
                    </td>
                    <td className="p-3">
                      {canOwnerEditEmployeeRow(employee) ? (
                        <div className="flex items-center gap-2">
                          <img src={draft.avatar || employee.avatar} alt="" className="w-9 h-9 rounded-lg object-cover border border-white/15" />
                          <label className="px-2 py-1 rounded-lg text-[11px] border border-white/15 bg-[#0F1528] cursor-pointer">
                            رفع
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onFocus={() => ensureEdit(employee)}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleEmployeeAvatarUpload(f, employee.id);
                                e.currentTarget.value = '';
                              }}
                            />
                          </label>
                        </div>
                      ) : (
                        <img src={employee.avatar} alt="" className="w-9 h-9 rounded-lg object-cover border border-white/15" />
                      )}
                    </td>
                    <td className="p-3 min-w-[120px]">
                      {canOwnerEditEmployeeRow(employee) && PAYROLL_SALARY_ROLES.includes(draft.role) ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={draft.baseSalary}
                            onFocus={() => ensureEdit(employee)}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => ({
                                ...prev,
                                [employee.id]: { ...draft, baseSalary: e.target.value.replace(/[^\d]/g, '') },
                              }))
                            }
                            className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-mono w-full min-w-0"
                            placeholder="0"
                          />
                          <span className="text-[10px] text-zinc-500 shrink-0">ج.م</span>
                        </div>
                      ) : PAYROLL_SALARY_ROLES.includes(employee.role) ? (
                        `${(employee.baseSalary || 0).toLocaleString('ar-EG')} ج.م`
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3 text-xs text-zinc-300">
                      {employee.role === 'مندوب'
                        ? (employee.skills.length > 0 ? `جاهز (${employee.skills.length} مهارة)` : 'يحتاج تحديد مهارات')
                        : 'غير مطلوب'}
                    </td>
                    {canEditBranding && (
                      <td className="p-3 align-top">
                        {!canOwnerEditEmployeeRow(employee) || employee.id === currentUser?.id ? (
                          <span className="text-[10px] text-zinc-600">—</span>
                        ) : (
                          <div className="flex flex-col gap-1.5 min-w-[150px]">
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={employeePwDraft[employee.id]?.pw ?? ''}
                              onChange={(e) =>
                                setEmployeePwDraft((prev) => ({
                                  ...prev,
                                  [employee.id]: { pw: e.target.value, pw2: prev[employee.id]?.pw2 ?? '' },
                                }))
                              }
                              placeholder="جديدة (٨+)"
                              className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full"
                            />
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={employeePwDraft[employee.id]?.pw2 ?? ''}
                              onChange={(e) =>
                                setEmployeePwDraft((prev) => ({
                                  ...prev,
                                  [employee.id]: { pw: prev[employee.id]?.pw ?? '', pw2: e.target.value },
                                }))
                              }
                              placeholder="تأكيد"
                              className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveEmployeePassword(employee.id)}
                              className="px-2 py-1.5 rounded-lg text-[11px] font-black border border-amber-400/35 text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 transition-colors"
                            >
                              حفظ الباسورد
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                    {canEditBranding && (
                      <td className="p-3">
                        {employee.role === 'مالك' || employee.id === currentUser?.id ? (
                          <span className="text-[11px] text-zinc-500">
                            {employee.id === currentUser?.id ? 'حسابك الحالي — لا يُحذف من الجدول' : 'حساب مالك — لا يُحذف'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleSaveEmployee(employee.id)} className="px-2 py-1 rounded-lg text-[11px] border border-emerald-400/30 text-emerald-200 bg-emerald-500/10">حفظ</button>
                            <button type="button" onClick={() => handleDeleteEmployee(employee.id, employee.name)} className="px-2 py-1 rounded-lg text-[11px] border border-rose-400/30 text-rose-200 bg-rose-500/10">حذف</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold flex items-center gap-3">
              <Zap className="w-5 h-5 text-amber-500" />
              التوزيع التلقائي الذكي
            </h3>
            <div className="w-12 h-6 bg-emerald-500 rounded-full relative">
              <div className="absolute left-7 top-1 w-4 h-4 bg-white rounded-full" />
            </div>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed mb-6 font-bold">
            النظام يقوم حالياً بتوجيه الليدز تلقائياً للمندوب الأنسب بناءً على:
            <br />• تطابق مهارات المندوب مع تصنيف الليد.
            <br />• المندوب الأقل ضغطاً في عدد الليدز المفتوحة.
            <br />• تقييم سرعة الرد.
          </p>
        </div>

        {reps.map(rep => (
          <div key={rep.id} className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem] hover:border-slate-700 transition-all">
            <div className="flex items-center gap-4 mb-6">
              <img src={rep.avatar} className="w-16 h-16 rounded-2xl border-2 border-slate-800" alt="" />
              <div>
                <h4 className="font-black text-lg">{rep.name}</h4>
                <div className="flex gap-4 mt-1">
                  <span className="text-xs text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {rep.stats.dealsWon} صفقة</span>
                  <span className="text-xs text-amber-500 font-bold flex items-center gap-1"><Star className="w-3 h-3" /> {rep.stats.points} نقطة</span>
                </div>
              </div>
            </div>
            
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">التخصصات والمهارات:</p>
            <div className="flex flex-wrap gap-2">
              {skillOptions.map(skill => {
                const isSelected = (rep.skills || []).includes(skill);
                return (
                  <button
                    key={`${rep.id}-${skill}`}
                    onClick={() => { void toggleSkill(rep.id, rep.skills || [], skill); }}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem] space-y-4">
        <h3 className="text-xl font-black">هوية الطباعة والتقارير</h3>
        <p className="text-sm text-zinc-400">يستخدمها النظام تلقائياً في تقارير PDF الخاصة بالمالك والمحاسب والمندوب.</p>
        {!canEditBranding && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200">
            تعديل الهوية متاح للمالك فقط.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={printBrandingSettings.companyName}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ companyName: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder="اسم الشركة"
          />
          <div className="flex items-center gap-2 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2">
            <span className="text-xs text-zinc-400">اللون الأساسي للتقارير</span>
            <input
              type="color"
              value={printBrandingSettings.primaryColor || '#4F46E5'}
              disabled={!canEditBranding}
              onChange={(e) => updatePrintBrandingSettings({ primaryColor: e.target.value })}
              className="w-8 h-8 bg-transparent border-0 p-0 disabled:opacity-60"
            />
            <span className="text-xs font-mono text-zinc-300">{printBrandingSettings.primaryColor}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={!canEditBranding}
              onClick={() => logoInputRef.current?.click()}
              className="px-3 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 disabled:opacity-60"
            >
              رفع لوجو الشركة
            </button>
            {printBrandingSettings.logoDataUrl && canEditBranding && (
              <button
                onClick={() => updatePrintBrandingSettings({ logoDataUrl: '' })}
                className="px-3 py-2 rounded-xl text-sm font-black bg-rose-500/20 text-rose-300"
              >
                حذف اللوجو
              </button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoUpload(file);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={printBrandingSettings.showPrintDate}
              disabled={!canEditBranding}
              onChange={(e) => updatePrintBrandingSettings({ showPrintDate: e.target.checked })}
            />
            إظهار تاريخ الطباعة في التقارير
          </label>
          <label className="flex items-center gap-2 text-sm bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={printBrandingSettings.showPageNumbers}
              disabled={!canEditBranding}
              onChange={(e) => updatePrintBrandingSettings({ showPageNumbers: e.target.checked })}
            />
            إظهار ترقيم الصفحات
          </label>
        </div>
        <textarea
          value={printBrandingSettings.reportHeader}
          disabled={!canEditBranding}
          onChange={(e) => updatePrintBrandingSettings({ reportHeader: e.target.value })}
          className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px] disabled:opacity-60"
          placeholder="نص الهيدر في التقارير"
        />
        <textarea
          value={printBrandingSettings.reportFooter}
          disabled={!canEditBranding}
          onChange={(e) => updatePrintBrandingSettings({ reportFooter: e.target.value })}
          className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px] disabled:opacity-60"
          placeholder="نص الفوتر في التقارير"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={printBrandingSettings.signatureName || ''}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ signatureName: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder="اسم المسؤول للتوقيع (اختياري)"
          />
          <input
            value={printBrandingSettings.signatureTitle || ''}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ signatureTitle: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder="المسمى الوظيفي للتوقيع (اختياري)"
          />
        </div>
        {printBrandingSettings.logoDataUrl && (
          <div className="bg-[#0B1020]/60 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-zinc-400 mb-2">معاينة اللوجو</p>
            <img src={printBrandingSettings.logoDataUrl} alt="company logo" className="h-16 w-auto object-contain" />
          </div>
        )}
      </div>
      <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem]">
        <h3 className="text-xl font-black mb-4">نسخ احتياطي واسترجاع</h3>
        <p className="text-sm text-zinc-400 mb-5">
          لضمان أمان البيانات، يمكنك حفظ نسخة من النظام أو استرجاع نسخة سابقة. ملف JSON من الواجهة ليس نسخة احتياطية لقاعدة
          البيانات: في وضع السيرفر يصدّر لقطة REST للعرض/الأرشفة فقط، وفي الوضع المحلي يصدّر مفاتيح{' '}
          <code className="text-zinc-300">localStorage</code> التجريبية — للاستعادة الكاملة استخدم نسخ احتياطي لقاعدة البيانات أو
          سير عمل الاستيراد الرسمي.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={backupSystemData} className="px-4 py-2 rounded-xl text-sm font-black bg-[#7C6BFF] text-white">تنزيل نسخة احتياطية</button>
          <button onClick={() => restoreInputRef.current?.click()} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">استرجاع نسخة</button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) restoreSystemData(file);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
};

// --- Rep View & Bulk Upload ---

const BulkUploadModal = ({ isOpen, onClose }: any) => {
  const { bulkAddLeads } = useData();
  const [isUploading, setIsUploading] = useState(false);

  const handleSimulateUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      void (async () => {
        const mockLeads: any[] = [
          { name: 'يوسف كمال', company: 'ميديا هاوس', phone: '01223344556', email: 'y.kamal@mail.com', status: 'جديد', budget: 25000, companySize: 'متوسط', source: 'رفع ملف', category: 'إعلانات' },
          { name: 'نهى سالم', company: 'تيك فلو', phone: '01011223344', email: 'noha@tech.com', status: 'جديد', budget: 60000, companySize: 'كبير', source: 'رفع ملف', category: 'شركات كبرى' },
          { name: 'John Doe', company: 'Int Global', phone: '+12345678', email: 'john@int.com', status: 'جديد', budget: 15000, companySize: 'صغير', source: 'رفع ملف', category: 'إنجليزي' },
        ];
        const { created, failed } = await bulkAddLeads(mockLeads);
        setIsUploading(false);
        onClose();
        if (created > 0) {
          toast.success(`تم رفع ${created} ليدز وتوزيعها تلقائياً${failed ? ` (${failed} صفوف لم تُضف)` : ''}.`);
        } else {
          toast.error('لم تُضف ليدز — تحقق من الصلاحيات أو من عدم التكرار/شروط الجودة.');
        }
      })();
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-[3rem] p-8 animate-in zoom-in duration-300">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black">رفع ليدز من ملف</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-xl transition-colors"><X className="w-6 h-6" /></button>
        </div>

        <div className="border-2 border-dashed border-slate-700 rounded-3xl p-12 text-center hover:border-emerald-500/50 transition-colors group cursor-pointer" onClick={handleSimulateUpload}>
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
            <FileUp className="w-10 h-10 text-emerald-500" />
          </div>
          <p className="text-lg font-bold mb-2">اضغط هنا أو اسحب الملف لرفعه</p>
          <p className="text-sm text-slate-500 uppercase tracking-widest font-black">Excel, CSV (حتى 10MB)</p>
          {isUploading && (
             <div className="mt-8">
               <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                 <div className="bg-emerald-500 h-full animate-progress" style={{ width: '60%' }} />
               </div>
               <p className="mt-4 text-emerald-500 font-bold text-sm animate-pulse">جاري تحليل البيانات وتوزيع الليدز...</p>
             </div>
          )}
        </div>

        <div className="mt-8 bg-blue-500/10 border border-blue-500/20 p-6 rounded-2xl flex items-start gap-4 text-blue-400">
          <AlertCircle className="w-6 h-6 flex-shrink-0" />
          <p className="text-xs font-bold leading-relaxed">تأكد من وجود الأعمدة التالية في الملف: الاسم، الشركة، الموبايل، التصنيف (إنجليزي، شركات كبرى، إلخ) لضمان دقة التوزيع التلقائي.</p>
        </div>
      </div>
    </div>
  );
};

const RepProfessionalDashboard = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const { leads, logLeadInteraction, updateLeadStatus, setLeadFollowUp, printBrandingSettings, priceQuotes, repRecordClientAcceptance, repRecordClientRejection } = useData();
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);

  // ---- State for client-response modal ----
  const [clientRespQuote, setClientRespQuote] = useState<PriceQuote | null>(null);
  const [clientRespMode, setClientRespMode] = useState<'accepted' | 'rejected' | null>(null);
  const [clientPaymentMethod, setClientPaymentMethod] = useState<'كاش' | 'تحويل'>('كاش');
  const [clientPaymentType, setClientPaymentType] = useState<'single' | 'multi'>('single');
  const [clientPaymentLines, setClientPaymentLines] = useState<{ id: string; amount: string; dueDate: string; method: 'كاش' | 'تحويل'; note: string }[]>([]);
  const [clientRejectionNote, setClientRejectionNote] = useState('');

  const openClientRespModal = (q: PriceQuote) => {
    setClientRespQuote(q);
    setClientRespMode(null);
    setClientPaymentMethod('كاش');
    setClientPaymentType('single');
    setClientPaymentLines([{ id: `cp-${Date.now()}`, amount: String(q.totalAmount ?? q.amount), dueDate: new Date().toISOString().slice(0, 10), method: 'كاش', note: '' }]);
    setClientRejectionNote('');
  };

  const submitClientAcceptance = async () => {
    if (!clientRespQuote) return;
    const lines = clientPaymentLines.filter((l) => Number(l.amount) > 0);
    if (!lines.length) { toast.error('أدخل تفاصيل الدفع'); return; }
    const payments: ClientPayment[] = lines.map((l) => ({
      id: l.id,
      amount: Math.round(Number(l.amount)),
      dueDate: l.dueDate,
      method: l.method,
      note: l.note.trim() || undefined,
    }));
    const ok = await repRecordClientAcceptance(clientRespQuote.id, payments);
    if (ok) {
      toast.success('تم تسجيل موافقة العميل وإنشاء الفاتورة');
      setClientRespQuote(null);
    } else {
      toast.error('تعذر الحفظ');
    }
  };

  const submitClientRejection = async () => {
    if (!clientRespQuote) return;
    const ok = await repRecordClientRejection(clientRespQuote.id, clientRejectionNote.trim() || undefined);
    if (ok) {
      toast.warning('تم تسجيل رفض العميل');
      setClientRespQuote(null);
    } else {
      toast.error('تعذر الحفظ');
    }
  };

  const myApprovedQuotes = useMemo(
    () => (priceQuotes as PriceQuote[]).filter((q) => q.status === 'معتمد' && q.createdById === currentUser.id),
    [priceQuotes, currentUser.id]
  );
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [leadFilter, setLeadFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [showEndOfDayPanel, setShowEndOfDayPanel] = useState(false);
  const [interactionModal, setInteractionModal] = useState<{
    isOpen: boolean;
    lead: Lead | null;
    action: string;
    note: string;
    channelType: 'call' | 'chat' | 'other';
    evidenceType: 'recording' | 'chat_export' | 'link' | 'note_only';
    evidenceRef: string;
    durationSeconds: string;
    toastType: 'success' | 'info';
  }>({
    isOpen: false,
    lead: null,
    action: '',
    note: '',
    channelType: 'other',
    evidenceType: 'note_only',
    evidenceRef: '',
    durationSeconds: '',
    toastType: 'success',
  });
  const openLeadClient360 = (leadId: string) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };

  const myLeads = useMemo(
    () => leads.filter(l => l.assignedTo === currentUser.id).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [leads, currentUser.id]
  );

  const isConfirmedContactActivity = (activity: Activity) =>
    /(مكالمة تمت|إرسال واتساب متابعة|واتساب|تم التواصل|متابعة مكتملة)/.test(activity.action);
  const hasValidEvidenceNote = (activity: Activity) => (activity.note || '').trim().length > 0;
  const hasDocumentedContact = (lead: Lead) =>
    lead.timeline.some(
      (a) => a.userId === currentUser.id && isConfirmedContactActivity(a) && hasValidEvidenceNote(a)
    );

  const kpis = useMemo(() => {
    const active = myLeads.filter(l => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length;
    const won = myLeads.filter(l => l.status === 'مغلق - فوز').length;
    const lost = myLeads.filter(l => l.status === 'مغلق - خسارة').length;
    const contacted = myLeads.filter(hasDocumentedContact).length;
    const now = Date.now();
    const followUpOverdue = myLeads.filter(l =>
      l.followUpAt &&
      new Date(l.followUpAt).getTime() < now &&
      l.status !== 'مغلق - فوز' &&
      l.status !== 'مغلق - خسارة'
    ).length;
    return { active, won, lost, contacted, followUpOverdue };
  }, [myLeads]);

  const repRates = useMemo(() => {
    const total = myLeads.length;
    const closed = kpis.won + kpis.lost;
    const conversionAll = total > 0 ? ((kpis.won / total) * 100) : 0;
    const contactRate = total > 0 ? ((kpis.contacted / total) * 100) : 0;
    return { conversionAll, contactRate, closed };
  }, [myLeads.length, kpis]);

  const operationalLeads = useMemo(() => {
    const openLeads = myLeads.filter(l => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة');
    const now = Date.now();
    const priorityScore = (lead: Lead) => {
      const overdueBoost = lead.followUpAt && new Date(lead.followUpAt).getTime() < now ? 4 : 0;
      const slaBoost = lead.slaStatus === 'حرج' ? 3 : lead.slaStatus === 'متأخر' ? 2 : 1;
      const noContactBoost = hasDocumentedContact(lead) ? 0 : 2;
      return overdueBoost + slaBoost + noContactBoost;
    };
    return [...openLeads].sort((a, b) => {
      const byPriority = priorityScore(b) - priorityScore(a);
      if (byPriority !== 0) return byPriority;
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });
  }, [myLeads]);

  const todayWindow = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { now, start, end };
  }, []);

  const filteredLeads = useMemo(() => {
    const { now, start, end } = todayWindow;
    return operationalLeads.filter((lead) => {
      if (!lead.followUpAt) return leadFilter === 'all';
      const ts = new Date(lead.followUpAt).getTime();
      if (leadFilter === 'today') return ts >= start.getTime() && ts < end.getTime();
      if (leadFilter === 'overdue') return ts < now.getTime();
      return true;
    });
  }, [operationalLeads, leadFilter, todayWindow]);

  const openInteractionComposer = (
    lead: Lead,
    action: string,
    defaultNote: string,
    toastType: 'success' | 'info' = 'success'
  ) => {
    const inferredChannel: 'call' | 'chat' | 'other' =
      /(مكالمة|اتصال)/.test(action) ? 'call' : /(واتساب|شات)/.test(action) ? 'chat' : 'other';
    setInteractionModal({
      isOpen: true,
      lead,
      action,
      note: defaultNote,
      channelType: inferredChannel,
      evidenceType: 'note_only',
      evidenceRef: '',
      durationSeconds: '',
      toastType,
    });
  };

  const submitInteractionNote = () => {
    if (!interactionModal.lead) return;
    const note = interactionModal.note.trim();
    if (!note) {
      toast.error('اكتب ملخص التواصل قبل الحفظ.');
      return;
    }
    logLeadInteraction(
      interactionModal.lead.id,
      interactionModal.action,
      note,
      {
        channelType: interactionModal.channelType,
        evidenceType: interactionModal.evidenceType,
        evidenceRef: interactionModal.evidenceRef.trim() || undefined,
        durationSeconds: interactionModal.durationSeconds ? Number(interactionModal.durationSeconds) || undefined : undefined,
      }
    );
    if (interactionModal.toastType === 'info') {
      toast.info(`تم حفظ التحديث: ${interactionModal.lead.name}`);
    } else {
      toast.success(`تم حفظ التحديث: ${interactionModal.lead.name}`);
    }
    setInteractionModal({
      isOpen: false,
      lead: null,
      action: '',
      note: '',
      channelType: 'other',
      evidenceType: 'note_only',
      evidenceRef: '',
      durationSeconds: '',
      toastType: 'success',
    });
  };
  const applyPlaybookTemplate = (templateId: string) => {
    if (!templateId) return;
    const templates = REP_INTERACTION_PLAYBOOKS[interactionModal.channelType] || [];
    const picked = templates.find((t) => t.id === templateId);
    if (!picked) return;
    setInteractionModal((prev) => ({ ...prev, note: picked.text }));
  };

  const logCallDone = (lead: Lead) => {
    openInteractionComposer(lead, 'مكالمة تمت', 'تمت مكالمة وتأكيد الخطوة التالية مع العميل', 'success');
  };

  const logNoAnswer = (lead: Lead) => {
    openInteractionComposer(lead, 'محاولة اتصال - لم يرد', 'لم يرد - سيتم إعادة المحاولة', 'info');
  };

  const logWhatsApp = (lead: Lead) => {
    openInteractionComposer(lead, 'إرسال واتساب متابعة', 'تم إرسال متابعة واتساب وتوضيح المطلوب من العميل', 'success');
  };

  const closeWon = (lead: Lead) => {
    updateLeadStatus(lead.id, 'مغلق - فوز', 'إغلاق الصفقة من لوحة المندوب');
    toast.success(`تم إغلاق الصفقة فوز: ${lead.name}`);
  };

  const closeLost = (lead: Lead) => {
    const reasonMap: Record<string, string> = {
      '1': 'price',
      '2': 'timing',
      '3': 'budget',
      '4': 'competition',
      '5': 'no_response',
      '6': 'scope',
      '7': 'other',
    };
    const picked = window.prompt(
      'حدد سبب الخسارة:\n1) السعر\n2) التوقيت\n3) الميزانية\n4) منافس\n5) عدم الرد\n6) خارج النطاق\n7) أخرى'
    ) || '';
    const reasonCode = reasonMap[picked.trim()];
    if (!reasonCode) {
      toast.error('لازم تحديد سبب خسارة صحيح قبل الإغلاق.');
      return;
    }
    const qualityChecks = window.prompt(
      'Quality Gate قبل الإغلاق (اكتب Y أو N)\n1) هل تم آخر محاولة تواصل؟\n2) هل تم تقديم عرض سعر/حل مناسب؟\n3) هل تم توثيق اعتراض العميل بوضوح؟\nمثال: Y,Y,N'
    ) || '';
    const checks = qualityChecks.split(',').map((x) => x.trim().toUpperCase());
    if (checks.length !== 3 || checks.some((x) => x !== 'Y' && x !== 'N')) {
      toast.error('صيغة التحقق غير صحيحة. استخدم Y,Y,N');
      return;
    }
    const passedChecks = checks.filter((x) => x === 'Y').length;
    if (passedChecks < 2) {
      toast.error('لا يمكن إغلاق خسارة قبل استكمال حد أدنى من خطوات الجودة.');
      return;
    }
    const note = window.prompt('اكتب ملاحظة مختصرة عن سبب الخسارة') || '';
    if (!note.trim()) {
      toast.error('لازم كتابة ملاحظة سبب الخسارة.');
      return;
    }
    updateLeadStatus(lead.id, 'مغلق - خسارة', `loss_reason=${reasonCode} | qa_gate=${checks.join('/') } | ${note.trim()}`);
    toast.warning(`تم إغلاق الصفقة خسارة: ${lead.name}`);
  };

  const completeFollowUpNow = (lead: Lead) => {
    logLeadInteraction(lead.id, 'متابعة مكتملة', 'تمت المتابعة بنجاح من لوحة المندوب');
    const next = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    setLeadFollowUp(lead.id, next);
    setFollowUpDrafts(prev => ({ ...prev, [lead.id]: new Date(next).toISOString().slice(0, 16) }));
    toast.success(`تمت المتابعة وتم تحديد الموعد القادم بعد 24 ساعة: ${lead.name}`);
  };

  const hasContactToday = (lead: Lead) =>
    lead.timeline.some((a) => {
      if (a.userId !== currentUser.id) return false;
      if (!isConfirmedContactActivity(a) || !hasValidEvidenceNote(a)) return false;
      const ts = new Date(a.createdAt).getTime();
      return ts >= todayWindow.start.getTime() && ts < todayWindow.end.getTime();
    });

  const endOfDayPendingLeads = useMemo(
    () => operationalLeads.filter((lead) => !hasContactToday(lead)),
    [operationalLeads, todayWindow.start.getTime(), todayWindow.end.getTime(), currentUser.id]
  );

  const queueSummary = useMemo(() => {
    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const dueToday = operationalLeads.filter((l) => {
      if (!l.followUpAt) return false;
      const ts = new Date(l.followUpAt).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    }).length;
    const overdue = operationalLeads.filter((l) => l.followUpAt && new Date(l.followUpAt).getTime() < now).length;
    const noContact = operationalLeads.filter((l) => !hasDocumentedContact(l)).length;
    return { dueToday, overdue, noContact };
  }, [operationalLeads]);

  const printRepReport = () => {
    const company = escapeHtml(printBrandingSettings.companyName || 'اسم الشركة');
    const header = escapeHtml(printBrandingSettings.reportHeader || 'تقرير داخلي');
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:42px;max-width:130px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString('ar-EG');
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const rows = filteredLeads
      .map((lead) => {
        const latest = lead.timeline[0];
        const followUpLabel = lead.followUpAt ? new Date(lead.followUpAt).toLocaleString('ar-EG') : 'غير محدد';
        return `
          <tr>
            <td>${escapeHtml(lead.name)}</td>
            <td>${escapeHtml(lead.company)}</td>
            <td>${escapeHtml(lead.status)}</td>
            <td>${escapeHtml(lead.slaStatus)}</td>
            <td>${escapeHtml(followUpLabel)}</td>
            <td>${escapeHtml(latest?.action || 'لا يوجد')}</td>
          </tr>
        `;
      })
      .join('');
    const html = `
      <html dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>تقرير المندوب - ${currentUser.name}</title>
        <style>
          :root { --primary-color: ${primaryColor}; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
          h2 { margin: 0 0 8px; }
          .meta { color: #444; margin-bottom: 12px; }
          .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
          .card { border: 1px solid #ddd; border-radius: 8px; padding: 8px; font-size: 12px; }
          .card b { display: block; margin-top: 3px; font-size: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: right; font-size: 12px; }
          th { background: #f5f5f5; }
          .page-number { text-align:left; font-size:11px; color:#666; margin-top:8px; }
          @media print {
            .page-number::after { content: counter(page) " / " counter(pages); }
          }
        </style>
      </head>
      <body>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid var(--primary-color);padding-bottom:10px;margin-bottom:12px;">
          <div>
            <h3 style="margin:0;">${company}</h3>
            <p style="margin:4px 0 0;color:#666;">${header}</p>
          </div>
          ${logo}
        </div>
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">تاريخ الطباعة: ${escapeHtml(printDate)}</p>` : ''}
        <h2>تقرير متابعة المندوب - ${currentUser.name}</h2>
        <p class="meta">الفلتر الحالي: ${leadFilter === 'all' ? 'الكل' : leadFilter === 'today' ? 'متابعات اليوم' : 'المتأخر فقط'} | عدد العملاء: ${filteredLeads.length}</p>
        <div class="cards">
          <div class="card">نشط<b>${kpis.active}</b></div>
          <div class="card">تم التواصل<b>${kpis.contacted}</b></div>
          <div class="card">فوز<b>${kpis.won}</b></div>
          <div class="card">خسارة<b>${kpis.lost}</b></div>
          <div class="card">متأخر<b>${kpis.followUpOverdue}</b></div>
        </div>
        <table>
          <thead>
            <tr><th>العميل</th><th>الشركة</th><th>الحالة</th><th>SLA</th><th>المتابعة القادمة</th><th>آخر إجراء</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${(signatureName || signatureTitle) ? `
          <div style="margin-top:24px;display:flex;justify-content:flex-end;">
            <div style="text-align:center;min-width:220px;">
              <div style="height:48px;border-bottom:1px dashed #bbb;margin-bottom:6px;"></div>
              ${signatureName ? `<div style="font-weight:700;">${signatureName}</div>` : ''}
              ${signatureTitle ? `<div style="font-size:12px;color:#666;">${signatureTitle}</div>` : ''}
            </div>
          </div>
        ` : ''}
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid #ddd;color:#666;font-size:12px;">${footer}</div>
        ${printBrandingSettings.showPageNumbers ? '<div class="page-number"></div>' : ''}
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="لوحة تنفيذ المندوب" subtitle="قائمة عمل حقيقية: ماذا تم، وما الإجراء التالي، وما المتوقع اليوم" icon={LayoutDashboard} />
      <div className="flex items-center gap-2">
        <button onClick={printRepReport} className="px-4 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">
          طباعة تقرير المندوب (PDF)
        </button>
        <button
          onClick={() => setShowEndOfDayPanel((v) => !v)}
          className="px-4 py-2 rounded-xl text-xs font-black bg-amber-500/20 border border-amber-500/35 text-amber-200"
        >
          إنهاء اليوم ({endOfDayPendingLeads.length})
        </button>
      </div>

      {showEndOfDayPanel && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-black text-amber-200">مراجعة نهاية اليوم</p>
              <p className="text-xs text-zinc-300 mt-1">لازم كل عميل نشط يكون عليه تواصل موثق اليوم قبل إنهاء اليوم.</p>
            </div>
            {endOfDayPendingLeads.length === 0 && (
              <span className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                ممتاز - كل العملاء عليهم تواصل موثق اليوم
              </span>
            )}
          </div>
          {endOfDayPendingLeads.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
              {endOfDayPendingLeads.map((lead) => {
                const latest = lead.timeline[0];
                return (
                  <div key={`eod-${lead.id}`} className="bg-[#0F1528]/80 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button type="button" onClick={() => openLeadClient360(lead.id)} className="cursor-pointer text-right text-sm font-black text-white truncate hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                        {lead.name} - {lead.company}
                      </button>
                      <p className="text-[11px] text-zinc-400 mt-1 truncate">آخر تحديث: {latest?.action || 'لا يوجد'} {latest?.createdAt ? `- ${new Date(latest.createdAt).toLocaleString('ar-EG')}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => logCallDone(lead)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500 text-slate-950">مكالمة</button>
                      <button onClick={() => logWhatsApp(lead)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-indigo-500 text-white">واتساب</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MiniMetricCard title="مهام اليوم" value={queueSummary.dueToday} hint="متابعات مستحقة اليوم" icon={Calendar} tone="indigo" onClick={() => setLeadFilter('today')} />
        <MiniMetricCard title="متأخر يحتاج تدخل" value={queueSummary.overdue} hint="الأولوية القصوى الآن" icon={Bell} tone="rose" onClick={() => setLeadFilter('overdue')} />
        <MiniMetricCard title="بدون تواصل موثق" value={queueSummary.noContact} hint="تحتاج أول اتصال موثق" icon={Phone} tone="amber" onClick={() => setLeadFilter('all')} />
        <MiniMetricCard title="نسبة إغلاق" value={`${repRates.conversionAll.toFixed(1)}%`} hint={`${kpis.won} فوز من ${myLeads.length}`} icon={Trophy} tone="emerald" />
      </div>

      {queueSummary.overdue > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-sm font-bold text-rose-200">
            عندك <span className="text-rose-300 font-black">{queueSummary.overdue}</span> متابعات متأخرة. ابدأ بها قبل أي شيء.
          </p>
          <button
            onClick={() => setLeadFilter('overdue')}
            className="px-4 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            ابدأ بالمتأخر
          </button>
        </div>
      )}

      {/* ===== عروض معتمدة — بانتظار موافقة العميل ===== */}
      {myApprovedQuotes.length > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-[3rem] p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-lg font-black text-emerald-200">عروض أسعار معتمدة — قدمها للعميل</p>
              <p className="text-xs text-zinc-400 mt-1">هذه العروض اعتمدها المالك وتنتظر ردك بعد عرضها على العميل. سجل الموافقة أو الرفض.</p>
            </div>
            <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500/25 text-emerald-200 border border-emerald-500/40">
              {myApprovedQuotes.length} عرض
            </span>
          </div>
          <div className="space-y-3">
            {myApprovedQuotes.map((q) => {
              const total = (q.totalAmount ?? q.amount).toLocaleString('ar-EG');
              const schedule = q.paymentSchedule && q.paymentSchedule.length > 0
                ? `${q.paymentSchedule.length} دفعة مجدولة`
                : q.initialPayment && q.initialPayment > 0
                  ? `دفعة أولى: ${q.initialPayment.toLocaleString('ar-EG')} ج.م`
                  : 'دفعة واحدة';
              return (
                <div key={q.id} className="bg-[#0F1528]/80 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-black text-white text-sm">{q.title}</p>
                    <p className="text-xs text-zinc-400 mt-1">{q.customerName}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {total} ج.م (شامل الضريبة)
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {schedule}
                      </span>
                      {q.approvedAt && (
                        <span className="text-[10px] text-zinc-500">
                          اعتُمد: {new Date(q.approvedAt).toLocaleDateString('ar-EG')}
                        </span>
                      )}
                    </div>
                    {q.note && <p className="text-[11px] text-zinc-400 mt-1.5 italic">{q.note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openClientRespModal(q)}
                      className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"
                    >
                      تسجيل رد العميل
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Modal: تسجيل رد العميل ===== */}
      {clientRespQuote && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-6" dir="rtl">
          <div className="bg-[#0E1426] border border-white/10 rounded-[3rem] p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar space-y-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black">تسجيل رد العميل</h3>
              <button onClick={() => setClientRespQuote(null)} className="p-2 hover:bg-white/10 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 space-y-1">
              <p className="font-black text-white">{clientRespQuote.title}</p>
              <p className="text-xs text-zinc-400">{clientRespQuote.customerName}</p>
              <p className="text-sm font-black text-emerald-300 mt-1">{(clientRespQuote.totalAmount ?? clientRespQuote.amount).toLocaleString('ar-EG')} ج.م</p>
            </div>

            {/* اختيار وافق أم رفض */}
            {clientRespMode === null && (
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setClientRespMode('accepted')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all text-emerald-200"
                >
                  <CheckCircle2 className="w-10 h-10" />
                  <span className="font-black text-lg">وافق العميل</span>
                  <span className="text-xs text-zinc-400 text-center">سيتم تسجيل الصفقة وإنشاء الفاتورة</span>
                </button>
                <button
                  onClick={() => setClientRespMode('rejected')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 transition-all text-rose-200"
                >
                  <XCircle className="w-10 h-10" />
                  <span className="font-black text-lg">رفض العميل</span>
                  <span className="text-xs text-zinc-400 text-center">سيُغلق العرض ويُسجَّل سبب الرفض</span>
                </button>
              </div>
            )}

            {/* فورم الموافقة — تفاصيل الدفع */}
            {clientRespMode === 'accepted' && (
              <div className="space-y-5">
                <p className="text-sm font-black text-emerald-200">تفاصيل الدفع المتفق عليه مع العميل</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">نوع الدفعات</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setClientPaymentType('single'); setClientPaymentLines([{ id: `cp-${Date.now()}`, amount: String(clientRespQuote.totalAmount ?? clientRespQuote.amount), dueDate: new Date().toISOString().slice(0, 10), method: clientPaymentMethod, note: '' }]); }}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentType === 'single' ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}
                      >دفعة واحدة</button>
                      <button
                        onClick={() => setClientPaymentType('multi')}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentType === 'multi' ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}
                      >كذا دفعة</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">طريقة الدفع الافتراضية</label>
                    <div className="flex gap-2">
                      <button onClick={() => { setClientPaymentMethod('كاش'); setClientPaymentLines((prev) => prev.map((l) => ({ ...l, method: 'كاش' }))); }} className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentMethod === 'كاش' ? 'bg-amber-500/25 border-amber-500/50 text-amber-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}>كاش</button>
                      <button onClick={() => { setClientPaymentMethod('تحويل'); setClientPaymentLines((prev) => prev.map((l) => ({ ...l, method: 'تحويل' }))); }} className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentMethod === 'تحويل' ? 'bg-blue-500/25 border-blue-500/50 text-blue-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}>تحويل بنكي</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {clientPaymentLines.map((line, idx) => (
                    <div key={line.id} className="bg-white/5 border border-white/10 rounded-xl p-3 grid grid-cols-4 gap-2 items-end">
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">المبلغ (ج.م)</label>
                        <input type="number" min={1} value={line.amount} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, amount: e.target.value } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">تاريخ الاستحقاق</label>
                        <input type="date" value={line.dueDate} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, dueDate: e.target.value } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">طريقة</label>
                        <select value={line.method} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, method: e.target.value as 'كاش' | 'تحويل' } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm">
                          <option value="كاش">كاش</option>
                          <option value="تحويل">تحويل</option>
                        </select>
                      </div>
                      <div className="flex items-end gap-1">
                        <input placeholder="ملاحظة" value={line.note} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, note: e.target.value } : l))} className="flex-1 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                        {clientPaymentLines.length > 1 && (
                          <button onClick={() => setClientPaymentLines((prev) => prev.filter((_, i) => i !== idx))} className="p-2 hover:bg-rose-500/20 rounded-xl text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                  {clientPaymentType === 'multi' && (
                    <button onClick={() => setClientPaymentLines((prev) => [...prev, { id: `cp-${Date.now()}`, amount: '', dueDate: new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0, 10), method: clientPaymentMethod, note: '' }])} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300 hover:bg-white/10 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> إضافة دفعة
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => setClientRespMode(null)} className="px-4 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300">رجوع</button>
                  <button onClick={submitClientAcceptance} className="px-6 py-2.5 rounded-xl text-sm font-black bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors">
                    تأكيد الموافقة وإنشاء الفاتورة
                  </button>
                </div>
              </div>
            )}

            {/* فورم الرفض */}
            {clientRespMode === 'rejected' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">سبب رفض العميل (اختياري)</label>
                  <textarea
                    value={clientRejectionNote}
                    onChange={(e) => setClientRejectionNote(e.target.value)}
                    rows={3}
                    placeholder="اكتب سبب الرفض أو ملاحظة للفريق..."
                    className="w-full bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm resize-none"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => setClientRespMode(null)} className="px-4 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300">رجوع</button>
                  <button onClick={submitClientRejection} className="px-6 py-2.5 rounded-xl text-sm font-black bg-rose-500 text-white hover:bg-rose-400 transition-colors">
                    تأكيد رفض العميل
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-8">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <h3 className="text-xl font-black">قائمة التنفيذ اليومية</h3>
          <div className="flex items-center gap-2 bg-[#0F1528]/70 border border-white/10 rounded-xl p-1">
            <button onClick={() => setLeadFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'all' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>الكل</button>
            <button onClick={() => setLeadFilter('today')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'today' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>متابعات اليوم</button>
            <button onClick={() => setLeadFilter('overdue')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'overdue' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>المتأخر فقط</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-right">
            <thead>
              <tr className="bg-[#0B1020]/80 border-b border-white/10">
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">العميل</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">ما تم</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الملاحظة</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الإجراء التالي</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">أرشيف العميل</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">الحالة</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">تنفيذ سريع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
          {filteredLeads.map((lead) => {
            const latest = lead.timeline[0];
            const contacted = hasDocumentedContact(lead);
            const followUpTs = lead.followUpAt ? new Date(lead.followUpAt).getTime() : null;
            const isFollowUpOverdue = Boolean(
              followUpTs &&
              followUpTs < Date.now() &&
              lead.status !== 'مغلق - فوز' &&
              lead.status !== 'مغلق - خسارة'
            );
            const draftFollowUp = followUpDrafts[lead.id] ?? (lead.followUpAt ? new Date(lead.followUpAt).toISOString().slice(0, 16) : '');
            const leadArchive = lead.timeline.filter((a) => Boolean(a.evidenceRef?.trim())).slice(0, 3);
            const leadTone: 'safe' | 'warn' | 'danger' =
              lead.status === 'مغلق - خسارة' || lead.slaStatus === 'حرج' || isFollowUpOverdue
                ? 'danger'
                : lead.status === 'مغلق - فوز'
                  ? 'safe'
                  : lead.slaStatus === 'متأخر'
                    ? 'warn'
                    : 'safe';
            return (
              <tr
                key={lead.id}
                className={`hover:bg-white/[0.03] transition-colors ${trafficRowClass(leadTone)}`}
              >
                <td className="p-3 align-top">
                  <button type="button" onClick={() => openLeadClient360(lead.id)} className="cursor-pointer text-right font-black text-white hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                    {lead.name}
                  </button>
                  <p className="text-xs text-zinc-400 mt-1">{lead.company} - {lead.phone}</p>
                </td>
                <td className="p-3 align-top">
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-zinc-400">مرفقات: <span className="font-black text-zinc-200">{leadArchive.length}</span></p>
                    {leadArchive.map((a) => (
                      <a
                        key={a.id}
                        href={a.evidenceRef}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[11px] text-cyan-300 underline truncate"
                      >
                        {a.action}
                      </a>
                    ))}
                    {leadArchive.length === 0 && <p className="text-[11px] text-zinc-500">لا يوجد أرشيف بعد</p>}
                  </div>
                </td>
                <td className="p-3 align-top">
                  <p className="text-sm font-bold text-zinc-100">{latest?.action || 'لا يوجد تواصل حتى الآن'}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">{latest?.createdAt ? new Date(latest.createdAt).toLocaleString('ar-EG') : '—'}</p>
                  {latest?.evidenceRef && (
                    <a
                      href={latest.evidenceRef}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-[11px] text-indigo-300 mt-1 underline"
                    >
                      دليل التواصل
                    </a>
                  )}
                </td>
                <td className="p-3 align-top">
                  <p className="text-xs text-zinc-300 leading-5">{latest?.note?.trim() || 'لا توجد ملاحظة مسجلة'}</p>
                </td>
                <td className="p-3 align-top">
                  <div className="space-y-2">
                    <p className={`text-xs font-bold ${isFollowUpOverdue ? 'text-rose-300' : 'text-zinc-200'}`}>
                      {lead.followUpAt ? new Date(lead.followUpAt).toLocaleString('ar-EG') : 'غير محدد'}
                    </p>
                  <input
                    type="datetime-local"
                    value={draftFollowUp}
                    onChange={(e) => setFollowUpDrafts(prev => ({ ...prev, [lead.id]: e.target.value }))}
                    className="bg-[#151E38] border border-white/15 rounded-xl px-2 py-1.5 text-xs w-full"
                  />
                    <button
                      onClick={() => {
                        if (!draftFollowUp) {
                          setLeadFollowUp(lead.id, undefined);
                          toast.info(`تم إلغاء متابعة ${lead.name}`);
                          return;
                        }
                        const iso = new Date(draftFollowUp).toISOString();
                        setLeadFollowUp(lead.id, iso);
                        toast.success(`تم تحديد متابعة ${lead.name}`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-[#7C6BFF] text-white w-full"
                    >
                      حفظ الموعد
                    </button>
                  </div>
                </td>
                <td className="p-3 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${lead.status === 'مغلق - فوز' ? 'bg-emerald-500/20 text-emerald-300' : lead.status === 'مغلق - خسارة' ? 'bg-rose-500/20 text-rose-300' : 'bg-indigo-500/20 text-indigo-300'}`}>{lead.status}</span>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${lead.slaStatus === 'حرج' ? 'bg-rose-500/20 text-rose-300' : lead.slaStatus === 'متأخر' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>SLA {lead.slaStatus}</span>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${contacted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-500/20 text-zinc-300'}`}>{contacted ? 'موثق' : 'غير موثق'}</span>
                  </div>
                </td>
                <td className="p-3 align-top">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => logCallDone(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500 text-slate-950">مكالمة</button>
                    <button onClick={() => logWhatsApp(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-indigo-500 text-white">واتساب</button>
                    <button onClick={() => logNoAnswer(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-amber-500 text-slate-950">لم يرد</button>
                    <button onClick={() => completeFollowUpNow(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-cyan-500 text-slate-950">+24h</button>
                    <button onClick={() => closeWon(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-[#7C6BFF] text-white">فوز</button>
                    <button onClick={() => closeLost(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-rose-500 text-white">خسارة</button>
                  </div>
                  <button onClick={() => setQuoteLead(lead)} className="mt-1.5 w-full px-2 py-1.5 rounded-lg text-[11px] font-black bg-amber-500/20 text-amber-200 border border-amber-500/30">
                    عرض سعر
                  </button>
                </td>
              </tr>
            );
          })}
            </tbody>
          </table>
        </div>
        {filteredLeads.length === 0 && (
          <div className="text-center text-zinc-400 py-8">لا توجد عملاء مسندة لك حاليًا.</div>
        )}
      </div>
      <PriceQuoteSubmitModal lead={quoteLead} open={!!quoteLead} onClose={() => setQuoteLead(null)} />

      {interactionModal.isOpen && interactionModal.lead && (
        <div className="fixed inset-0 z-[220] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-[#0B1020] shadow-2xl">
            <div className="px-6 py-5 border-b border-white/10">
              <p className="text-xs text-zinc-400">تسجيل تواصل</p>
              <h3 className="text-lg font-black text-white mt-1">
                {interactionModal.action} - {interactionModal.lead.name}
              </h3>
            </div>
            <div className="p-6 space-y-3">
              <label className="block text-sm font-bold text-zinc-200">ملخص التواصل</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  applyPlaybookTemplate(e.target.value);
                  e.currentTarget.value = '';
                }}
                className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs text-zinc-200"
              >
                <option value="">اختيار Playbook جاهز (اختياري)</option>
                {(REP_INTERACTION_PLAYBOOKS[interactionModal.channelType] || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <textarea
                value={interactionModal.note}
                onChange={(e) => setInteractionModal(prev => ({ ...prev, note: e.target.value }))}
                rows={6}
                autoFocus
                placeholder="اكتب ملخصًا واضحًا لما تم مع العميل..."
                className="w-full bg-[#111A32] border border-white/15 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:border-[#7C6BFF] resize-y"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={interactionModal.channelType}
                  onChange={(e) => setInteractionModal(prev => ({ ...prev, channelType: e.target.value as 'call' | 'chat' | 'other' }))}
                  className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="call">مكالمة</option>
                  <option value="chat">شات/واتساب</option>
                  <option value="other">أخرى</option>
                </select>
                <select
                  value={interactionModal.evidenceType}
                  onChange={(e) => setInteractionModal(prev => ({ ...prev, evidenceType: e.target.value as 'recording' | 'chat_export' | 'link' | 'note_only' }))}
                  className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="note_only">بدون مرفق</option>
                  <option value="recording">رابط تسجيل مكالمة</option>
                  <option value="chat_export">رابط محادثة</option>
                  <option value="link">رابط مرجعي</option>
                </select>
                <input
                  value={interactionModal.evidenceRef}
                  onChange={(e) => setInteractionModal(prev => ({ ...prev, evidenceRef: e.target.value }))}
                  placeholder="رابط الدليل (اختياري)"
                  className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs md:col-span-2"
                />
                <input
                  type="number"
                  min={0}
                  value={interactionModal.durationSeconds}
                  onChange={(e) => setInteractionModal(prev => ({ ...prev, durationSeconds: e.target.value }))}
                  placeholder="مدة المكالمة بالثواني (اختياري)"
                  className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-2">
              <button
                onClick={() => setInteractionModal({
                  isOpen: false,
                  lead: null,
                  action: '',
                  note: '',
                  channelType: 'other',
                  evidenceType: 'note_only',
                  evidenceRef: '',
                  durationSeconds: '',
                  toastType: 'success',
                })}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 border border-white/15 text-zinc-200"
              >
                إلغاء
              </button>
              <button
                onClick={submitInteractionNote}
                className="px-4 py-2 rounded-xl text-sm font-black bg-[#7C6BFF] text-white"
              >
                حفظ التحديث
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RepPerformanceView = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const { getRepSnapshots, leads } = useData();
  const snapshot = useMemo(
    () => getRepSnapshots().find(r => r.repId === currentUser.id),
    [getRepSnapshots, currentUser.id]
  );

  const myLeads = useMemo(
    () => leads.filter(l => l.assignedTo === currentUser.id),
    [leads, currentUser.id]
  );

  const closedWon = myLeads.filter(l => l.status === 'مغلق - فوز');
  const activeOverdueCount = myLeads.filter(
    l => (l.slaStatus === 'متأخر' || l.slaStatus === 'حرج') && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة'
  ).length;

  const performanceScore = useMemo(() => {
    if (!snapshot) return 0;
    const conversionComponent = Math.min(100, snapshot.conversionRate) * 0.3;
    const revenueProgressComponent = Math.min(100, snapshot.revenueTargetProgress) * 0.3;
    const responseComponent = Math.max(0, 100 - Math.min(100, (snapshot.avgResponseMins / 60) * 100)) * 0.15;
    const overduePenaltyComponent = Math.max(0, 100 - Math.min(100, activeOverdueCount * 12)) * 0.1;
    const contactCoverageComponent = Math.min(100, snapshot.confirmedContactCoverage) * 0.1;
    const documentationComponent = Math.min(100, snapshot.documentationQualityScore) * 0.05;
    return Math.round(
      conversionComponent +
      revenueProgressComponent +
      responseComponent +
      overduePenaltyComponent +
      contactCoverageComponent +
      documentationComponent
    );
  }, [snapshot, activeOverdueCount]);

  const scoreLabel = performanceScore >= 85
    ? 'ممتاز'
    : performanceScore >= 70
      ? 'جيد جدًا'
      : performanceScore >= 55
        ? 'جيد'
        : 'يحتاج تحسين';
  const scoreColorClass = performanceScore >= 85
    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
    : performanceScore >= 70
      ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
      : performanceScore >= 55
        ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
        : 'text-rose-300 bg-rose-500/15 border-rose-500/30';

  const lastActions = myLeads
    .flatMap(lead => (lead.timeline[0] ? [{ leadId: lead.id, leadName: lead.name, action: lead.timeline[0].action, createdAt: lead.timeline[0].createdAt }] : []))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  if (!snapshot) {
    return (
      <div className="animate-in fade-in duration-500">
        <SectionTitle title="أدائي" subtitle="لا توجد بيانات كافية لحساب الأداء حاليًا" icon={Trophy} />
      </div>
    );
  }

  const goMyLeads = (overdueOnly = false) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsAssignedFilter: 'mine', leadsOverdueOnly: overdueOnly }));
    if (onGoToTab) onGoToTab('leads');
  };
  const goClient360 = (leadId: string) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="أدائي" subtitle="قياس نتائجك الفعلية وتحسين معدل الإغلاق" icon={Trophy} />

      <div className={`border rounded-[2rem] p-6 flex items-center justify-between gap-4 ${scoreColorClass}`}>
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-80">مؤشر الأداء</p>
          <p className="text-3xl font-black">{performanceScore}/100</p>
        </div>
        <div className="text-left">
          <p className="text-xs opacity-80">التقييم الحالي</p>
          <p className="text-xl font-black">{scoreLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard title="التحويل" value={`${snapshot.conversionRate.toFixed(1)}%`} icon={Target} onClick={() => goMyLeads(false)} />
        <StatCard title="صفقات فوز" value={snapshot.wonDeals} icon={CheckCircle2} onClick={() => goMyLeads(false)} />
        <StatCard title="صفقات خسارة" value={snapshot.lostDeals} icon={AlertCircle} onClick={() => goMyLeads(false)} />
        <StatCard title="متوسط الرد" value={`${snapshot.avgResponseMins} دقيقة`} icon={Clock} onClick={() => goMyLeads(true)} />
        <StatCard title="الإيراد" value={`${snapshot.revenue.toLocaleString()} ج.م`} icon={DollarSign} onClick={() => goMyLeads(false)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="تغطية تواصل مؤكد" value={`${snapshot.confirmedContactCoverage.toFixed(1)}%`} icon={ShieldCheck} onClick={() => goMyLeads(false)} />
        <StatCard title="تواصلات مؤكدة (موثقة)" value={snapshot.confirmedContacts} icon={MessageSquare} onClick={() => goMyLeads(false)} />
        <StatCard title="جودة التوثيق" value={`${snapshot.documentationQualityScore.toFixed(1)}%`} icon={FileText} onClick={() => goMyLeads(false)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h3 className="text-lg font-black mb-4">تقدم أهدافك الشهرية</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>هدف الليدز المغلقة فوز</span>
                <span className="font-black">{snapshot.wonDeals}/{snapshot.leadsTarget}</span>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#7C6BFF]" style={{ width: `${Math.min(100, snapshot.leadsTargetProgress)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>هدف الإيراد</span>
                <span className="font-black">{snapshot.revenue.toLocaleString()} / {snapshot.revenueTarget.toLocaleString()} ج.م</span>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, snapshot.revenueTargetProgress)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h3 className="text-lg font-black mb-4">آخر نشاطاتك على العملاء</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
            {lastActions.map((entry, idx) => (
              <button
                key={`${entry.leadName}-${idx}`}
                type="button"
                onClick={() => goClient360(entry.leadId)}
                className="w-full text-right bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 hover:border-indigo-300/35 transition-all"
              >
                <p className="text-sm font-bold">{entry.leadName}</p>
                <p className="text-xs text-zinc-300 mt-1">{entry.action}</p>
                <p className="text-[11px] text-zinc-500 mt-1">{new Date(entry.createdAt).toLocaleString('ar-EG')}</p>
              </button>
            ))}
            {lastActions.length === 0 && <p className="text-zinc-400 text-sm">لا توجد نشاطات مسجلة بعد.</p>}
          </div>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
        <h3 className="text-lg font-black mb-4">تحليل سريع</h3>
        <p className="text-sm text-zinc-300">
          عندك {myLeads.length} عميل مسند، منهم {closedWon.length} تم إغلاقهم فوز.
          {' '}استمر في المتابعة السريعة للعملاء المتأخرين لرفع التحويل والإيراد.
        </p>
        <p className="text-xs text-zinc-400 mt-3">
          يتم اعتبار التواصل "مؤكد" فقط عند تسجيل نشاط (مكالمة/واتساب) مع ملاحظة موثقة واضحة.
        </p>
      </div>
    </div>
  );
};

/** إضافة معدات رئيسية للحجوزات — يُزامن مع workspace-state في وضع السيرفر */
const EquipmentMasterMiniPanel = () => {
  const { currentUser, equipmentItems, addEquipmentItem } = useData();
  const [form, setForm] = useState({ name: '', category: '', quantity: '1' });
  const can =
    currentUser?.role === 'مالك' ||
    currentUser?.role === 'محاسب' ||
    currentUser?.role === 'مدير إنتاج';
  if (!can) return null;
  return (
    <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
      <div>
        <h3 className="text-lg font-black">معدات الحجز الرئيسية</h3>
        <p className="text-xs text-zinc-400 mt-1">
          تظهر في قوائم حجز المعدات. مع السيرفر تُحفظ في مساحة عمل الخادم.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">اسم المعدة</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="مثلاً: كاميرا FX6"
            className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-[8rem] flex-1">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">التصنيف</label>
          <input
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            placeholder="تصوير / إضاءة"
            className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="w-28">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">الكمية</label>
          <input
            type="number"
            min={0}
            value={form.quantity}
            onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
            className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const ok = addEquipmentItem({
              name: form.name.trim(),
              category: form.category.trim(),
              totalQuantity: Math.max(0, Math.floor(Number(form.quantity) || 0)),
            });
            if (!ok) {
              toast.error('تأكد من الاسم والتصنيف، أو أن المعدة غير مكررة');
              return;
            }
            setForm({ name: '', category: '', quantity: '1' });
            toast.success('تمت إضافة المعدة');
          }}
          className="rounded-xl bg-[#7C6BFF] px-4 py-2 text-sm font-black text-white"
        >
          إضافة
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-[#0B1020]/60 divide-y divide-white/5">
        {equipmentItems.filter((e) => e.active).length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">لا توجد معدات بعد.</p>
        ) : (
          equipmentItems
            .filter((e) => e.active)
            .map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-bold text-zinc-200">{e.name}</span>
                <span className="text-xs text-zinc-400">
                  {e.category} — {e.totalQuantity} وحدة
                </span>
              </div>
            ))
        )}
      </div>
    </div>
  );
};

type ProductionBookingSubmitKind = 'shoot' | 'equipment' | 'meeting';

const ProductionBookingSpendCompact = ({
  kind,
  bookingId,
  estimatedCost,
  accrualExpenseId,
  onSubmit,
}: {
  kind: ProductionBookingSubmitKind;
  bookingId: string;
  estimatedCost?: number;
  accrualExpenseId?: string;
  onSubmit: (k: ProductionBookingSubmitKind, id: string, lines: Omit<BookingSpendLine, 'id' | 'createdAt'>[]) => Promise<boolean>;
}) => {
  const [rows, setRows] = useState([
    { description: '', amount: '', invoiceRef: '', vendor: '' },
  ]);
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-amber-400/35 space-y-2">
      <p className="text-[11px] font-black text-amber-200/95">مدير الإنتاج: بنود وفواتير قبل طلب المحاسب للسداد</p>
      {accrualExpenseId ? (
        <p className="text-[10px] text-zinc-500">
          المصروف الاستحقاقي في الدفاتر:{' '}
          <span className="font-mono text-cyan-400">{accrualExpenseId}</span>
        </p>
      ) : null}
      {rows.map((r, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 text-[11px]">
          <input
            value={r.description}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)))}
            placeholder="الوصف / البيان"
            className="sm:col-span-4 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            type="number"
            min={0}
            value={r.amount}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
            placeholder="مبلغ"
            className="sm:col-span-2 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            value={r.invoiceRef}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, invoiceRef: e.target.value } : row)))}
            placeholder="مرجع فاتورة"
            className="sm:col-span-3 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            value={r.vendor}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, vendor: e.target.value } : row)))}
            placeholder="مورد"
            className="sm:col-span-2 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_x, i) => i !== idx)))}
            className="sm:col-span-1 rounded-lg border border-white/15 text-[10px] text-zinc-400 hover:bg-white/5 py-1"
          >
            حذف
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { description: '', amount: '', invoiceRef: '', vendor: '' }])}
          className="text-[11px] font-black px-2 py-1 rounded-lg bg-white/10 text-zinc-200"
        >
          + بند
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const lines = rows
                .map((rw) => ({
                  description: rw.description.trim(),
                  amount: Number(rw.amount),
                  invoiceRef: rw.invoiceRef.trim() || undefined,
                  vendor: rw.vendor.trim() || undefined,
                }))
                .filter((rw) => rw.description && rw.amount > 0);
              if (lines.length === 0) {
                toast.error('أضف بندًا واحدًا على الأقل مع وصف ومبلغ');
                return;
              }
              const sum = lines.reduce((s, x) => s + x.amount, 0);
              const est = Math.max(0, Number(estimatedCost) || 0);
              if (est > 0 && sum > est * 1.05 + 0.01) {
                toast.error('مجموع البنود أعلى من التقدير بأكثر من 5٪');
                return;
              }
              const ok = await onSubmit(kind, bookingId, lines);
              if (!ok) toast.error('تعذر الإرسال — تحقق من السيرفر أو أن الحالة «بانتظار تنفيذ إنتاج»');
              else {
                toast.success('تم تحويل الحجز للمحاسب لسداد الاستحقاق');
                setRows([{ description: '', amount: '', invoiceRef: '', vendor: '' }]);
              }
            })();
          }}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950"
        >
          إرسال للمحاسب
        </button>
      </div>
    </div>
  );
};

const BookingCenter = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const {
    leads,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    equipmentItems,
    addShootBooking,
    addEquipmentBooking,
    addMeetingBooking,
    otherBookings,
    addOtherBooking,
    removeOtherBooking,
    updateShootBookingStatus,
    updateEquipmentBookingStatus,
    updateMeetingBookingStatus,
    accountantExecuteShootBookingClaim,
    accountantExecuteEquipmentBookingClaim,
    accountantExecuteMeetingBookingClaim,
    productionSubmitBookingSpendToAccountant,
  } = useData();
  const canReview = currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات';
  const canOwnerApprove = currentUser.role === 'مالك';
  const canAccountantExecute = currentUser.role === 'محاسب';
  const canProductionSpend = currentUser.role === 'مدير إنتاج';
  /** كان مدير الإنتاج يرى فقط حجوزات repId=Nفسه فيبدو أن «كل الحجوزات اختفت» رغم أنها موجودة في السياق */
  const canViewAll = canReview || currentUser.role === 'مدير إنتاج';
  const goClient360 = (leadId?: string) => {
    if (!leadId) return;
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };
  const myLeads = useMemo(() => leads.filter(l => l.assignedTo === currentUser.id), [leads, currentUser.id]);
  /** المحاسب كان يرى فقط «بانتظار تنفيذ محاسب / منفذ» فاختفت كل الحجوزات قبل اعتماد المالك وبعده إذا كانت غير_مطلوب أو بانتظار_اعتماد_مالك */
  const visibleShoot = useMemo(
    () =>
      canViewAll || canAccountantExecute
        ? shootBookings
        : shootBookings.filter((b) => b.repId === currentUser.id),
    [canViewAll, canAccountantExecute, shootBookings, currentUser.id],
  );
  const visibleEquipment = useMemo(
    () =>
      canViewAll || canAccountantExecute
        ? equipmentBookings
        : equipmentBookings.filter((b) => b.repId === currentUser.id),
    [canViewAll, canAccountantExecute, equipmentBookings, currentUser.id],
  );
  const visibleMeetings = useMemo(
    () =>
      canViewAll || canAccountantExecute
        ? meetingBookings
        : meetingBookings.filter((m) => m.repId === currentUser.id),
    [canViewAll, canAccountantExecute, meetingBookings, currentUser.id],
  );
  const equipmentAvailableByName = useMemo(() => {
    const reserved = new Map<string, number>();
    equipmentBookings
      .filter(b => b.status === 'معتمد' || b.status === 'تم التسليم')
      .forEach((b) => {
        const prev = reserved.get(b.equipmentName) || 0;
        reserved.set(b.equipmentName, prev + (Number(b.quantity) || 0));
      });
    return new Map(
      equipmentItems.map((item) => {
        const used = reserved.get(item.name) || 0;
        return [item.name, Math.max(0, item.totalQuantity - used)];
      })
    );
  }, [equipmentItems, equipmentBookings]);
  const [shootForm, setShootForm] = useState({
    leadId: '',
    customerName: '',
    date: '',
    time: '',
    location: '',
    estimatedCost: '',
    notes: '',
  });
  const [equipmentForm, setEquipmentForm] = useState({
    leadId: '',
    customerName: '',
    equipmentName: '',
    quantity: '1',
    fromDate: '',
    toDate: '',
    estimatedCost: '',
    notes: '',
  });
  const [meetingForm, setMeetingForm] = useState({
    leadId: '',
    title: '',
    date: '',
    startTime: '',
    durationMins: '60',
    venueType: 'داخل_المقر' as 'داخل_المقر' | 'خارج_المقر',
    estimatedCost: '',
    location: '',
    notes: '',
  });
  const [bookingQuickFilter, setBookingQuickFilter] = useState<BookingQuickFilter>('all');
  const [bookingHubTab, setBookingHubTab] = useState<BookingHubTab>('shoot');
  const [otherForm, setOtherForm] = useState({ title: '', statement: '', date: '' });
  useEffect(() => {
    const applyBookingIntent = () => {
      try {
        const raw = localStorage.getItem(BOOKING_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as {
          tab?: string;
          bookingQuickFilter?: BookingQuickFilter;
          bookingHubTab?: BookingHubTab;
        };
        if (intent.tab !== 'bookings') return;
        if (intent.bookingQuickFilter) setBookingQuickFilter(intent.bookingQuickFilter);
        const hubTabs: BookingHubTab[] = ['shoot', 'equipment', 'meeting', 'other'];
        if (intent.bookingHubTab && hubTabs.includes(intent.bookingHubTab)) setBookingHubTab(intent.bookingHubTab);
        localStorage.removeItem(BOOKING_INTENT_KEY);
      } catch {
        // ignore malformed intent
      }
    };
    applyBookingIntent();
    window.addEventListener('storage', applyBookingIntent);
    window.addEventListener('focus', applyBookingIntent);
    window.addEventListener('booking-intent', applyBookingIntent as EventListener);
    return () => {
      window.removeEventListener('storage', applyBookingIntent);
      window.removeEventListener('focus', applyBookingIntent);
      window.removeEventListener('booking-intent', applyBookingIntent as EventListener);
    };
  }, []);
  const todayDateKey = new Date().toISOString().slice(0, 10);
  const filteredShoot = useMemo(() => {
    if (bookingQuickFilter === 'all') return visibleShoot;
    if (bookingQuickFilter === 'today') return visibleShoot.filter((b) => b.date === todayDateKey);
    if (bookingQuickFilter === 'pending_review') return visibleShoot.filter((b) => b.status === 'قيد المراجعة');
    if (bookingQuickFilter === 'financial_claims_pending_execution') return visibleShoot.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب');
    return visibleShoot;
  }, [visibleShoot, bookingQuickFilter, todayDateKey]);
  const filteredEquipment = useMemo(() => {
    if (bookingQuickFilter === 'all') return visibleEquipment;
    if (bookingQuickFilter === 'today') return visibleEquipment.filter((b) => b.fromDate <= todayDateKey && b.toDate >= todayDateKey);
    if (bookingQuickFilter === 'pending_review') return visibleEquipment.filter((b) => b.status === 'قيد المراجعة');
    if (bookingQuickFilter === 'financial_claims_pending_execution') return visibleEquipment.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب');
    return visibleEquipment;
  }, [visibleEquipment, bookingQuickFilter, todayDateKey]);
  const filteredMeetings = useMemo(() => {
    if (bookingQuickFilter === 'all') return visibleMeetings;
    if (bookingQuickFilter === 'today') return visibleMeetings.filter((m) => m.date === todayDateKey);
    if (bookingQuickFilter === 'pending_review') return visibleMeetings.filter((m) => m.status === 'قيد المراجعة');
    if (bookingQuickFilter === 'financial_claims_pending_execution') return visibleMeetings.filter((m) => m.financialStatus === 'بانتظار_تنفيذ_محاسب');
    return visibleMeetings;
  }, [visibleMeetings, bookingQuickFilter, todayDateKey]);
  const filteredOtherBookings = useMemo(() => {
    if (bookingQuickFilter === 'all') return otherBookings;
    if (bookingQuickFilter === 'today') return otherBookings.filter((b) => (b.date ? b.date === todayDateKey : false));
    return otherBookings;
  }, [otherBookings, bookingQuickFilter, todayDateKey]);
  const weekDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      const key = d.toISOString().slice(0, 10);
      return {
        key,
        label: d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' }),
      };
    });
  }, []);
  const weekShootMap = useMemo(() => {
    const map = new Map<string, typeof filteredShoot>();
    weekDays.forEach(day => map.set(day.key, []));
    filteredShoot.forEach((b) => {
      const arr = map.get(b.date);
      if (arr) arr.push(b);
    });
    return map;
  }, [filteredShoot, weekDays]);
  const weekMeetingMap = useMemo(() => {
    const map = new Map<string, typeof meetingBookings>();
    weekDays.forEach(day => map.set(day.key, []));
    filteredMeetings.forEach((m) => {
      const arr = map.get(m.date);
      if (arr) arr.push(m);
    });
    map.forEach((arr, key) => {
      map.set(key, [...arr].sort((a, b) => a.startTime.localeCompare(b.startTime)));
    });
    return map;
  }, [filteredMeetings, weekDays]);
  const upcomingMeetings = useMemo(
    () => [...filteredMeetings]
      .sort((a, b) => new Date(`${a.date}T${a.startTime}:00`).getTime() - new Date(`${b.date}T${b.startTime}:00`).getTime())
      .slice(0, 12),
    [filteredMeetings]
  );

  const handleAddShoot = async () => {
    if (!shootForm.customerName.trim() || !shootForm.date || !shootForm.time || !shootForm.location.trim()) {
      toast.error('اكمل بيانات حجز التصوير');
      return;
    }
    const result = await addShootBooking({
      leadId: shootForm.leadId || undefined,
      customerName: shootForm.customerName.trim(),
      date: shootForm.date,
      time: shootForm.time,
      location: shootForm.location.trim(),
      estimatedCost: Math.max(0, Number(shootForm.estimatedCost) || 0) || undefined,
      notes: shootForm.notes.trim() || undefined,
    });
    if (result.ok === false) {
      toast.error(result.message);
      return;
    }
    setShootForm({ leadId: '', customerName: '', date: '', time: '', location: '', estimatedCost: '', notes: '' });
    toast.success('تم إرسال طلب حجز التصوير');
  };

  const handleAddEquipment = async () => {
    const quantity = Math.max(1, Number(equipmentForm.quantity) || 1);
    if (!equipmentForm.customerName.trim() || !equipmentForm.equipmentName.trim() || !equipmentForm.fromDate || !equipmentForm.toDate) {
      toast.error('اكمل بيانات حجز المعدات');
      return;
    }
    const ok = await addEquipmentBooking({
      leadId: equipmentForm.leadId || undefined,
      customerName: equipmentForm.customerName.trim(),
      equipmentName: equipmentForm.equipmentName.trim(),
      quantity,
      fromDate: equipmentForm.fromDate,
      toDate: equipmentForm.toDate,
      estimatedCost: Math.max(0, Number(equipmentForm.estimatedCost) || 0) || undefined,
      notes: equipmentForm.notes.trim() || undefined,
    });
    if (!ok) {
      toast.error('تعذر الحجز: يوجد تعارض في نفس الفترة أو الكمية غير كافية');
      return;
    }
    setEquipmentForm({ leadId: '', customerName: '', equipmentName: '', quantity: '1', fromDate: '', toDate: '', estimatedCost: '', notes: '' });
    toast.success('تم إرسال طلب حجز المعدات');
  };

  const handleAddMeeting = async () => {
    const duration = Math.max(15, Number(meetingForm.durationMins) || 60);
    if (!meetingForm.title.trim() || !meetingForm.date || !meetingForm.startTime) {
      toast.error('اكمل بيانات الاجتماع');
      return;
    }
    const ok = await addMeetingBooking({
      leadId: meetingForm.leadId || undefined,
      title: meetingForm.title.trim(),
      date: meetingForm.date,
      startTime: meetingForm.startTime,
      durationMins: duration,
      venueType: meetingForm.venueType,
      estimatedCost: meetingForm.venueType === 'خارج_المقر' ? (Math.max(0, Number(meetingForm.estimatedCost) || 0) || undefined) : undefined,
      location: meetingForm.location.trim() || undefined,
      notes: meetingForm.notes.trim() || undefined,
    });
    if (!ok) {
      toast.error('تعذر الحجز: يوجد اجتماع آخر في نفس التوقيت');
      return;
    }
    setMeetingForm({ leadId: '', title: '', date: '', startTime: '', durationMins: '60', venueType: 'داخل_المقر', estimatedCost: '', location: '', notes: '' });
    toast.success('تم حفظ الاجتماع في التقويم الموحد');
  };

  const handleAddOther = async () => {
    if (!otherForm.statement.trim()) {
      toast.error('أدخل البيان (الوصف)');
      return;
    }
    const ok = await addOtherBooking({
      title: otherForm.title.trim(),
      statement: otherForm.statement.trim(),
      date: otherForm.date.trim() || undefined,
    });
    if (!ok) {
      toast.error('تعذر الحفظ');
      return;
    }
    setOtherForm({ title: '', statement: '', date: '' });
    toast.success('تم تسجيل الحجز');
  };

  const statusClass = (status: string) =>
    status === 'معتمد' || status === 'تم التسليم'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'مرفوض'
        ? 'bg-rose-500/15 text-rose-300'
        : 'bg-amber-500/15 text-amber-300';

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="نظام الحجوزات" subtitle={canOwnerApprove ? 'اعتماد طلبات الحجز ومتابعتها من نوع واحد في كل مرة' : canAccountantExecute ? 'تنفيذ المطالبات المالية المعتمدة' : 'اختر نوع الحجز: لوكيشن، معدات، اجتماع، أو إدخال بيان لحجز آخر'} icon={Calendar} />
      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white/[0.04] border border-white/10" dir="rtl">
        {([
          ['shoot', 'لوكيشن / تصوير'],
          ['equipment', 'معدات تصوير'],
          ['meeting', 'اجتماع'],
          ['other', 'حجوزات أخرى'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setBookingHubTab(id)}
            className={`flex-1 min-w-[130px] px-3 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-colors ${
              bookingHubTab === id
                ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {bookingHubTab === 'equipment' ? <EquipmentMasterMiniPanel /> : null}
      {bookingQuickFilter !== 'all' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-200 font-bold">فلتر تنبيهات الحجوزات مفعل</p>
          <button onClick={() => setBookingQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">إلغاء الفلتر</button>
        </div>
      )}

      {bookingHubTab === 'meeting' && !canAccountantExecute ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">تقويم اجتماعات المناديب (موحد)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const meetings = weekMeetingMap.get(day.key) || [];
            return (
              <div key={`meeting-${day.key}`} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 min-h-[150px]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-black text-zinc-200">{day.label}</p>
                  <span className="px-2 py-0.5 rounded-lg text-[10px] bg-cyan-500/20 text-cyan-300">{meetings.length}</span>
                </div>
                <div className="space-y-1.5">
                  {meetings.slice(0, 4).map((m) => (
                    <div key={m.id} className="text-[11px] bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                      <p className="font-bold truncate">{m.startTime} - {m.title}</p>
                      <p className="text-zinc-400 truncate">{m.repName}{m.location ? ` - ${m.location}` : ''}</p>
                    </div>
                  ))}
                  {meetings.length > 4 && <p className="text-[10px] text-zinc-500">+{meetings.length - 4} اجتماعات أخرى</p>}
                  {meetings.length === 0 && <p className="text-[10px] text-zinc-500">لا توجد اجتماعات</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'meeting' && !canReview && !canAccountantExecute && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
          <h3 className="font-black">إضافة موعد اجتماع / حجز مكان</h3>
          <select
            value={meetingForm.leadId}
            onChange={(e) => {
              const lead = myLeads.find((l) => l.id === e.target.value);
              setMeetingForm((prev) => ({
                ...prev,
                leadId: e.target.value,
                title: prev.title || (lead ? `اجتماع - ${lead.name}` : prev.title),
                location: prev.location || (lead?.company || prev.location),
              }));
            }}
            className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
          >
            <option value="">بدون ربط عميل (اختياري)</option>
            {myLeads.map((l) => (
              <option key={`meeting-lead-${l.id}`} value={l.id}>{l.name} - {l.company}</option>
            ))}
          </select>
          <input value={meetingForm.title} onChange={(e) => setMeetingForm(prev => ({ ...prev, title: e.target.value }))} placeholder="عنوان الاجتماع" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="date" value={meetingForm.date} onChange={(e) => setMeetingForm(prev => ({ ...prev, date: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="time" value={meetingForm.startTime} onChange={(e) => setMeetingForm(prev => ({ ...prev, startTime: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="number" min={15} step={15} value={meetingForm.durationMins} onChange={(e) => setMeetingForm(prev => ({ ...prev, durationMins: e.target.value }))} placeholder="المدة بالدقائق" className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          </div>
          <select value={meetingForm.venueType} onChange={(e) => setMeetingForm(prev => ({ ...prev, venueType: e.target.value as 'داخل_المقر' | 'خارج_المقر', estimatedCost: e.target.value === 'خارج_المقر' ? prev.estimatedCost : '' }))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm [color-scheme:dark]">
            <option value="داخل_المقر">داخل مقر الشركة (بدون مطالبة مالية)</option>
            <option value="خارج_المقر">خارج مقر الشركة (قد يحتاج مصروف انتقالات)</option>
          </select>
          {meetingForm.venueType === 'خارج_المقر' && (
            <input type="number" min={0} value={meetingForm.estimatedCost} onChange={(e) => setMeetingForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder="تكلفة انتقالات تقديرية (للاعتماد المالي)" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          )}
          <input value={meetingForm.location} onChange={(e) => setMeetingForm(prev => ({ ...prev, location: e.target.value }))} placeholder="مكان الاجتماع (اختياري)" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          <textarea value={meetingForm.notes} onChange={(e) => setMeetingForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="ملاحظات" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
          <button onClick={handleAddMeeting} className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-sm font-black">إرسال طلب الاجتماع/المكان</button>
        </div>
      )}

      {bookingHubTab === 'meeting' ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">الاجتماعات القادمة (مرئية للمالك ومدير المبيعات والمناديب)</h3>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {upcomingMeetings.map((m) => (
            <div key={m.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{m.title}</p>
                <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-cyan-500/20 text-cyan-300">
                  {m.durationMins} دقيقة
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">{m.date} - {m.startTime}{m.location ? ` - ${m.location}` : ''}</p>
              {m.leadId && (
                <button type="button" onClick={() => goClient360(m.leadId)} className="cursor-pointer text-right text-[11px] text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  العميل: {leads.find((l) => l.id === m.leadId)?.name || m.leadId}
                </button>
              )}
              <p className="text-[11px] text-zinc-500 mt-1">المندوب: {m.repName}</p>
              <p className="text-[11px] text-zinc-500 mt-1">نوع الاجتماع: {m.venueType || 'داخل_المقر'}</p>
              {typeof m.estimatedCost === 'number' && m.estimatedCost > 0 ? <p className="text-[11px] text-zinc-400 mt-1">تكلفة تقديرية: {m.estimatedCost.toLocaleString()} ج.م</p> : null}
              {m.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">الحالة المالية: {m.financialStatus}</p> : null}
              {m.status ? <p className="text-[11px] text-zinc-500 mt-1">الحالة: {m.status}</p> : null}
              {canOwnerApprove && m.status === 'قيد المراجعة' && (
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => { void (async () => { const ok = await updateMeetingBookingStatus(m.id, 'معتمد'); if (!ok) { toast.error('تعذر الاعتماد — تحقق من الشهر المحاسبي أو استحقاق المصروف'); return; } toast.success(m.estimatedCost && Number(m.estimatedCost) > 0 ? 'تم الاعتماد وتسجيل الاستحقاق — أكمل بنود الإنتاج' : 'تم اعتماد طلب الاجتماع'); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                  <button onClick={() => { void (async () => { const ok = await updateMeetingBookingStatus(m.id, 'مرفوض'); if (!ok) { toast.error('تعذر الرفض'); return; } toast.info('تم رفض طلب الاجتماع'); })(); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              )}
              {canAccountantExecute && m.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => { void (async () => {
                    const ok = await accountantExecuteMeetingBookingClaim(m.id, 'كاش');
                    if (!ok) toast.error('تعذر التنفيذ');
                    else toast.success('تم التنفيذ كاش وتسجيل المطالبة مالياً');
                  })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">تنفيذ كاش</button>
                  <button onClick={() => { void (async () => {
                    const ok = await accountantExecuteMeetingBookingClaim(m.id, 'تحويل');
                    if (!ok) toast.error('تعذر التنفيذ');
                    else toast.success('تم التنفيذ تحويل وتسجيل المطالبة مالياً');
                  })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">تنفيذ تحويل</button>
                </div>
              )}
              {canProductionSpend && m.financialStatus === 'بانتظار_تنفيذ_إنتاج' && (
                <ProductionBookingSpendCompact
                  kind="meeting"
                  bookingId={m.id}
                  estimatedCost={m.estimatedCost}
                  accrualExpenseId={m.accrualExpenseId}
                  onSubmit={productionSubmitBookingSpendToAccountant}
                />
              )}
            </div>
          ))}
          {upcomingMeetings.length === 0 && <p className="text-sm text-zinc-400">لا توجد اجتماعات مسجلة.</p>}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'shoot' ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">تقويم أسبوعي لمواعيد التصوير</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const bookings = weekShootMap.get(day.key) || [];
            return (
              <div key={day.key} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 min-h-[140px]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-black text-zinc-200">{day.label}</p>
                  <span className="px-2 py-0.5 rounded-lg text-[10px] bg-[#7C6BFF]/20 text-[#A99FFF]">{bookings.length}</span>
                </div>
                <div className="space-y-1.5">
                  {bookings.slice(0, 3).map((b) => (
                    <div key={b.id} className="text-[11px] bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                      <p className="font-bold truncate">
                        {b.time} - {b.leadId ? (
                          <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                            {b.customerName}
                          </button>
                        ) : b.customerName}
                      </p>
                      <p className="text-zinc-400 truncate">{b.location}</p>
                    </div>
                  ))}
                  {bookings.length > 3 && <p className="text-[10px] text-zinc-500">+{bookings.length - 3} مواعيد أخرى</p>}
                  {bookings.length === 0 && <p className="text-[10px] text-zinc-500">لا توجد مواعيد</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'shoot' && !canReview && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
            <h3 className="font-black">طلب حجز موعد تصوير</h3>
            <select
              value={shootForm.leadId}
              onChange={(e) => {
                const lead = myLeads.find(l => l.id === e.target.value);
                setShootForm(prev => ({ ...prev, leadId: e.target.value, customerName: lead?.name || prev.customerName }));
              }}
              className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">اختياري: ربط بعميل من ليدزك</option>
              {myLeads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.company}</option>)}
            </select>
            <input value={shootForm.customerName} onChange={(e) => setShootForm(prev => ({ ...prev, customerName: e.target.value }))} placeholder="اسم العميل" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={shootForm.date} onChange={(e) => setShootForm(prev => ({ ...prev, date: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
              <input type="time" value={shootForm.time} onChange={(e) => setShootForm(prev => ({ ...prev, time: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <input value={shootForm.location} onChange={(e) => setShootForm(prev => ({ ...prev, location: e.target.value }))} placeholder="مكان التصوير" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="number" min={0} value={shootForm.estimatedCost} onChange={(e) => setShootForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder="تكلفة تقديرية (مطالبة مالية)" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <textarea value={shootForm.notes} onChange={(e) => setShootForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="ملاحظات" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
            <button onClick={handleAddShoot} className="px-4 py-2 rounded-xl bg-[#7C6BFF] text-white text-sm font-black">إرسال طلب التصوير</button>
        </div>
      )}

      {bookingHubTab === 'equipment' && !canReview && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
            <h3 className="font-black">طلب حجز معدات</h3>
            <select
              value={equipmentForm.leadId}
              onChange={(e) => {
                const lead = myLeads.find(l => l.id === e.target.value);
                setEquipmentForm(prev => ({ ...prev, leadId: e.target.value, customerName: lead?.name || prev.customerName }));
              }}
              className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">اختياري: ربط بعميل من ليدزك</option>
              {myLeads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.company}</option>)}
            </select>
            <input value={equipmentForm.customerName} onChange={(e) => setEquipmentForm(prev => ({ ...prev, customerName: e.target.value }))} placeholder="اسم العميل" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select value={equipmentForm.equipmentName} onChange={(e) => setEquipmentForm(prev => ({ ...prev, equipmentName: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm">
                <option value="">اختر المعدة</option>
                {equipmentItems.filter(e => e.active).map(e => (
                  <option key={e.id} value={e.name}>
                    {e.name} ({e.category}) - متاح {equipmentAvailableByName.get(e.name) ?? e.totalQuantity}
                  </option>
                ))}
              </select>
              <input type="number" min={1} value={equipmentForm.quantity} onChange={(e) => setEquipmentForm(prev => ({ ...prev, quantity: e.target.value }))} placeholder="الكمية" className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={equipmentForm.fromDate} onChange={(e) => setEquipmentForm(prev => ({ ...prev, fromDate: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
              <input type="date" value={equipmentForm.toDate} onChange={(e) => setEquipmentForm(prev => ({ ...prev, toDate: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <input type="number" min={0} value={equipmentForm.estimatedCost} onChange={(e) => setEquipmentForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder="تكلفة تقديرية (مطالبة مالية)" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <textarea value={equipmentForm.notes} onChange={(e) => setEquipmentForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="ملاحظات" className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
            <button onClick={handleAddEquipment} className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-black">إرسال طلب المعدات</button>
        </div>
      )}

      {bookingHubTab === 'other' && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
          <h3 className="font-black">حجوزات أخرى</h3>
          <p className="text-xs text-zinc-500">سجّل نشاطًا أو طلبًا عامًا ببيان نصي؛ يُحفظ في مساحة العمل ويُرى لجميع الأدوار.</p>
          <input
            value={otherForm.title}
            onChange={(e) => setOtherForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="عنوان مختصر (اختياري)"
            className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
          />
          <input type="date" value={otherForm.date} onChange={(e) => setOtherForm((p) => ({ ...p, date: e.target.value }))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm [color-scheme:dark]" />
          <textarea
            value={otherForm.statement}
            onChange={(e) => setOtherForm((p) => ({ ...p, statement: e.target.value }))}
            placeholder="البيان — وصف نوع الحجز أو الموعد أو المطلوب"
            className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[90px]"
          />
          <button type="button" onClick={() => void handleAddOther()} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-black">
            حفظ الحجز
          </button>
          <div className="border-t border-white/10 pt-4 mt-4 space-y-2 max-h-[380px] overflow-auto">
            <h4 className="text-sm font-black text-zinc-300">السجل</h4>
            {[...filteredOtherBookings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((b) => {
              const canDel =
                b.createdById === currentUser.id || currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات';
              return (
                <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{b.title}</p>
                      {b.date ? <p className="text-xs text-zinc-400 mt-0.5">{b.date}</p> : null}
                      <p className="text-zinc-300 mt-2 whitespace-pre-wrap">{b.statement}</p>
                      <p className="text-[11px] text-zinc-500 mt-2">بواسطة {b.createdByName} · {new Date(b.createdAt).toLocaleString('ar-EG')}</p>
                    </div>
                    {canDel ? (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const ok = await removeOtherBooking(b.id);
                            if (!ok) toast.error('لا يمكن الحذف');
                            else toast.success('تم الحذف');
                          })();
                        }}
                        className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-black bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                      >
                        حذف
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredOtherBookings.length === 0 && <p className="text-sm text-zinc-500">لا توجد سجلات.</p>}
          </div>
        </div>
      )}

      {bookingHubTab === 'shoot' ? (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
          <h3 className="font-black mb-4">طلبات التصوير</h3>
          <div className="space-y-3 max-h-[420px] overflow-auto">
            {filteredShoot.map((b) => (
              <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  {b.leadId ? (
                    <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right font-bold hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                      {b.customerName}
                    </button>
                  ) : (
                    <p className="font-bold">{b.customerName}</p>
                  )}
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass(b.status)}`}>{b.status}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{b.date} - {b.time} - {b.location}</p>
                <p className="text-[11px] text-zinc-500 mt-1">بواسطة: {b.repName}</p>
                {canOwnerApprove && b.status === 'قيد المراجعة' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => { const ok = await updateShootBookingStatus(b.id, 'معتمد'); if (!ok) { toast.error('تعذر الاعتماد — تحقق من الشهر المحاسبي أو استحقاق المصروف على السيرفر'); return; } toast.success(b.estimatedCost && Number(b.estimatedCost) > 0 ? 'تم الاعتماد وتسجيل الاستحقاق للدفاتر — بانتظار إثبات بنود الإنتاج' : 'تم اعتماد طلب التصوير'); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                    <button onClick={() => { void (async () => { const ok = await updateShootBookingStatus(b.id, 'مرفوض'); if (!ok) { toast.error('تعذر الرفض'); return; } toast.info('تم رفض طلب التصوير'); })(); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                )}
                {canAccountantExecute && b.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteShootBookingClaim(b.id, 'كاش');
                      if (!ok) toast.error('تعذر التنفيذ');
                      else toast.success('تم التنفيذ كاش وتسجيل المطالبة مالياً');
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">تنفيذ كاش</button>
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteShootBookingClaim(b.id, 'تحويل');
                      if (!ok) toast.error('تعذر التنفيذ');
                      else toast.success('تم التنفيذ تحويل وتسجيل المطالبة مالياً');
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">تنفيذ تحويل</button>
                  </div>
                )}
                {b.estimatedCost ? <p className="text-[11px] text-zinc-400 mt-1">تكلفة تقديرية: {Number(b.estimatedCost).toLocaleString()} ج.م</p> : null}
                {b.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">الحالة المالية: {b.financialStatus}</p> : null}
                {canProductionSpend && b.financialStatus === 'بانتظار_تنفيذ_إنتاج' && (
                  <ProductionBookingSpendCompact
                    kind="shoot"
                    bookingId={b.id}
                    estimatedCost={b.estimatedCost}
                    accrualExpenseId={b.accrualExpenseId}
                    onSubmit={productionSubmitBookingSpendToAccountant}
                  />
                )}
              </div>
            ))}
            {filteredShoot.length === 0 && <p className="text-sm text-zinc-400">لا توجد طلبات تصوير.</p>}
          </div>
        </div>
      ) : null}

      {bookingHubTab === 'equipment' ? (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
          <h3 className="font-black mb-4">طلبات المعدات</h3>
          <div className="space-y-3 max-h-[420px] overflow-auto">
            {filteredEquipment.map((b) => (
              <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{b.equipmentName} x{b.quantity}</p>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass(b.status)}`}>{b.status}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {b.leadId ? (
                    <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                      {b.customerName}
                    </button>
                  ) : b.customerName} - من {b.fromDate} إلى {b.toDate}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">المتاح حاليًا: {equipmentAvailableByName.get(b.equipmentName) ?? 0}</p>
                <p className="text-[11px] text-zinc-500 mt-1">بواسطة: {b.repName}</p>
                {canOwnerApprove && b.status === 'قيد المراجعة' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => {
                        void (async () => {
                        const ok = await updateEquipmentBookingStatus(b.id, 'معتمد');
                        if (!ok) {
                          toast.error('لا يمكن الاعتماد: الكمية غير كافية، أو شهر مقفل، أو تعذّر مصروف الاستحقاق على الخادم');
                          return;
                        }
                        toast.success(b.estimatedCost && Number(b.estimatedCost) > 0 ? 'تم اعتماد الطلب؛ تسجل الاستحقاق للمحاسبة — أكمل بنود الإنتاج' : 'تم اعتماد الطلب وخصم الكمية من المتاح');
                        })();
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >
                      اعتماد
                    </button>
                    <button
                      onClick={() => {
                        void (async () => {
                        const ok = await updateEquipmentBookingStatus(b.id, 'مرفوض');
                        if (!ok) {
                          toast.error('تعذر تحديث حالة الطلب');
                          return;
                        }
                        toast.info('تم رفض طلب المعدات');
                        })();
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black"
                    >
                      رفض
                    </button>
                  </div>
                )}
                {canAccountantExecute && b.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteEquipmentBookingClaim(b.id, 'كاش');
                      if (!ok) toast.error('تعذر التنفيذ');
                      else toast.success('تم التنفيذ كاش وتسجيل المطالبة مالياً');
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">تنفيذ كاش</button>
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteEquipmentBookingClaim(b.id, 'تحويل');
                      if (!ok) toast.error('تعذر التنفيذ');
                      else toast.success('تم التنفيذ تحويل وتسجيل المطالبة مالياً');
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">تنفيذ تحويل</button>
                  </div>
                )}
                {b.estimatedCost ? <p className="text-[11px] text-zinc-400 mt-1">تكلفة تقديرية: {Number(b.estimatedCost).toLocaleString()} ج.م</p> : null}
                {b.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">الحالة المالية: {b.financialStatus}</p> : null}
                {canProductionSpend && b.financialStatus === 'بانتظار_تنفيذ_إنتاج' && (
                  <ProductionBookingSpendCompact
                    kind="equipment"
                    bookingId={b.id}
                    estimatedCost={b.estimatedCost}
                    accrualExpenseId={b.accrualExpenseId}
                    onSubmit={productionSubmitBookingSpendToAccountant}
                  />
                )}
              </div>
            ))}
            {filteredEquipment.length === 0 && <p className="text-sm text-zinc-400">لا توجد طلبات معدات.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TeamPerformanceHub = ({ onGoToTab }: { onGoToTab?: (tab: string) => void }) => {
  const { currentUser, leads, getRepSnapshots, reviewLeadActivity, updateMonthlyTarget } = useData();
  const snapshots = useMemo(
    () => getRepSnapshots().sort((a, b) => b.revenue - a.revenue),
    [getRepSnapshots]
  );
  const canEditTargets = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const exportPerformanceCsv = () => {
    const rows = [
      ['rep', 'assigned', 'active', 'won', 'lost', 'conversion', 'overdue', 'avg_response_mins', 'revenue'],
      ...snapshots.map(r => [
        r.repName,
        String(r.totalAssigned),
        String(r.activeLeads),
        String(r.wonDeals),
        String(r.lostDeals),
        r.conversionRate.toFixed(1),
        String(r.overdueLeads),
        String(r.avgResponseMins),
        String(r.revenue),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `team-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = useMemo(() => {
    const totalAssigned = snapshots.reduce((s, r) => s + r.totalAssigned, 0);
    const totalWon = snapshots.reduce((s, r) => s + r.wonDeals, 0);
    const totalOverdue = snapshots.reduce((s, r) => s + r.overdueLeads, 0);
    const avgResponse = snapshots.length > 0
      ? Math.round(snapshots.reduce((s, r) => s + r.avgResponseMins, 0) / snapshots.length)
      : 0;
    const teamConversion = totalAssigned > 0 ? ((totalWon / totalAssigned) * 100).toFixed(1) : '0.0';
    return { totalAssigned, totalWon, totalOverdue, avgResponse, teamConversion };
  }, [snapshots]);
  const managerInsights = useMemo(() => {
    const highRiskReps = snapshots.filter(
      r => r.overdueLeads >= 3 || r.callsTargetProgress < 60 || (r.totalAssigned >= 5 && r.conversionRate < 20)
    );
    const topRevenueRep = snapshots[0];
    return { highRiskReps, topRevenueRep };
  }, [snapshots]);
  const weightedForecast = useMemo(() => {
    const openLeads = leads.filter((l) => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة');
    const weightByStatus: Record<string, number> = {
      'جديد': 0.15,
      'قيد التواصل': 0.3,
      'عرض سعر': 0.55,
      'تفاوض': 0.75,
    };
    const weighted = openLeads.reduce((sum, l) => sum + (Number(l.budget) || 0) * (weightByStatus[l.status] || 0.1), 0);
    const pipeline = openLeads.reduce((sum, l) => sum + (Number(l.budget) || 0), 0);
    return { weighted, pipeline, openCount: openLeads.length };
  }, [leads]);
  const qaQueue = useMemo(() => {
    const rows: Array<{
      leadId: string;
      leadName: string;
      repName: string;
      activityId: string;
      action: string;
      evidenceRef?: string;
      createdAt: string;
      qaStatus?: 'pending' | 'approved' | 'rejected';
    }> = [];
    leads.forEach((lead) => {
      lead.timeline.forEach((a) => {
        if (!a.evidenceRef) return;
        rows.push({
          leadId: lead.id,
          leadName: lead.name,
          repName: a.userName,
          activityId: a.id,
          action: a.action,
          evidenceRef: a.evidenceRef,
          createdAt: a.createdAt,
          qaStatus: a.qaStatus,
        });
      });
    });
    return rows
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);
  }, [leads]);
  const qaPending = qaQueue.filter((q) => !q.qaStatus || q.qaStatus === 'pending');
  const qaApproved = qaQueue.filter((q) => q.qaStatus === 'approved').length;
  const qaRejected = qaQueue.filter((q) => q.qaStatus === 'rejected').length;
  const goLeads = (overdueOnly = false) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsOverdueOnly: overdueOnly }));
    if (onGoToTab) onGoToTab('leads');
  };
  const goRepLeads = (repId: string, overdueOnly = false) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsRepUserId: repId, leadsOverdueOnly: overdueOnly }));
    if (onGoToTab) onGoToTab('leads');
  };
  const goClient360 = (leadId: string) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="أداء فريق المبيعات" subtitle="لوحة تنفيذية مختصرة لاتخاذ القرار بسرعة" icon={BarChart3} />
      <div className="flex items-center gap-3">
        <button onClick={exportPerformanceCsv} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">تصدير تقرير الأداء CSV</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="ليدز مسندة" value={kpis.totalAssigned} icon={Users} color="blue" onClick={() => goLeads(false)} />
        <StatCard title="صفقات فائزة" value={kpis.totalWon} icon={Trophy} color="emerald" onClick={() => goLeads(false)} />
        <StatCard title="تحويل الفريق" value={`${kpis.teamConversion}%`} icon={Target} color="purple" onClick={() => goLeads(false)} />
        <StatCard title="ليدز متأخرة" value={kpis.totalOverdue} icon={AlertCircle} color="amber" onClick={() => goLeads(true)} />
        <StatCard title="متوسط الرد" value={`${kpis.avgResponse} دقيقة`} icon={Clock} color="indigo" onClick={() => goLeads(true)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniMetricCard title="Pipeline مفتوح" value={`${weightedForecast.pipeline.toLocaleString()} ج.م`} hint={`${weightedForecast.openCount} فرصة نشطة`} icon={Briefcase} tone="indigo" />
        <MiniMetricCard title="Forecast مرجح" value={`${Math.round(weightedForecast.weighted).toLocaleString()} ج.م`} hint="توقع الإيراد المتوقع" icon={TrendingUp} tone="emerald" />
        <MiniMetricCard title="صحة البيانات" value={leads.filter((l) => !l.followUpAt && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length} hint="ليدز نشطة بدون موعد متابعة" icon={ShieldCheck} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
          <h4 className="font-black text-lg mb-2">مخاطر تحتاج تدخل</h4>
          <p className="text-xs text-zinc-500 mb-4">الأولوية للمندوبين ذوي المتابعات المتأخرة أو ضعف تغطية المكالمات.</p>
          <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
            {managerInsights.highRiskReps.slice(0, 6).map((rep) => (
              <button key={rep.repId} type="button" onClick={() => goRepLeads(rep.repId, true)} className="w-full text-right rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 hover:border-rose-300/50 transition-all">
                <p className="text-sm font-black text-rose-100">{rep.repName}</p>
                <p className="text-[11px] text-zinc-300 mt-1">
                  متأخر: {rep.overdueLeads} · تحويل: {rep.conversionRate.toFixed(1)}% · تغطية مكالمات: {rep.callsTargetProgress.toFixed(1)}%
                </p>
              </button>
            ))}
            {managerInsights.highRiskReps.length === 0 && <p className="text-sm text-zinc-400">لا توجد حالات خطرة حاليًا.</p>}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
          <h4 className="font-black text-lg mb-2">أفضل أداء حالي</h4>
          <p className="text-xs text-zinc-500 mb-4">المندوب الأعلى إيرادًا هذا الشهر.</p>
          <button type="button" onClick={() => managerInsights.topRevenueRep && goRepLeads(managerInsights.topRevenueRep.repId, false)} className="w-full text-right rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 hover:border-emerald-300/45 transition-all">
            <p className="text-lg font-black text-emerald-200">{managerInsights.topRevenueRep?.repName || 'لا يوجد'}</p>
            <p className="text-sm text-zinc-200 mt-2">
              {managerInsights.topRevenueRep ? `${managerInsights.topRevenueRep.revenue.toLocaleString()} ج.م` : 'لا توجد بيانات كافية'}
            </p>
            <p className="text-[11px] text-zinc-400 mt-2">
              تحويل: {managerInsights.topRevenueRep ? `${managerInsights.topRevenueRep.conversionRate.toFixed(1)}%` : '—'}
            </p>
          </button>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h3 className="text-xl font-black">ترتيب المناديب حسب الإيراد الفعلي</h3>
          <p className="text-zinc-400 text-sm mt-1">يعتمد على الصفقات المغلقة فوز في النظام</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[980px]">
            <thead>
              <tr className="bg-[#0B1020]/80">
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">المندوب</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">المسند</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">النشط</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">فوز/خسارة</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">التحويل</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">الليدز المتأخرة</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">متوسط الرد</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">تقدم الهدف</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">آخر نشاط</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">الإيراد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {snapshots.map((rep) => (
                <tr
                  key={rep.repId}
                  onClick={() => goRepLeads(rep.repId, rep.overdueLeads > 0)}
                  className={trafficRowClass(
                    rep.overdueLeads >= 3 || (rep.totalAssigned >= 5 && rep.conversionRate < 20)
                      ? 'danger'
                      : rep.overdueLeads > 0 || rep.callsTargetProgress < 80
                        ? 'warn'
                        : 'safe'
                  ) + ' cursor-pointer'}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <img src={rep.avatar} alt="" className="w-9 h-9 rounded-xl border border-white/20" />
                      <span className="font-bold">{rep.repName}</span>
                    </div>
                  </td>
                  <td className="p-4 font-bold">{rep.totalAssigned}</td>
                  <td className="p-4">{rep.activeLeads}</td>
                  <td className="p-4">{rep.wonDeals} / {rep.lostDeals}</td>
                  <td className="p-4 text-[#A99FFF] font-black">{rep.conversionRate.toFixed(1)}%</td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-black ${rep.overdueLeads > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      {rep.overdueLeads}
                    </span>
                  </td>
                  <td className="p-4">{rep.avgResponseMins} د</td>
                  <td className="p-4">
                    <div className="space-y-1">
                      <div className="text-[11px]">ليدز: {rep.wonDeals}/{rep.leadsTarget}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#7C6BFF]" style={{ width: `${Math.min(100, rep.leadsTargetProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">مكالمات: {rep.callsCount}/{rep.callsTarget}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, rep.callsTargetProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">يومي: {rep.dailyCallsCount}/{rep.dailyCallsTarget}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, rep.dailyCallsProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">أسبوعي: {rep.weeklyCallsCount}/{rep.weeklyCallsTarget}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, rep.weeklyCallsProgress)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-zinc-400 text-xs">
                    {rep.lastActivityAt ? new Date(rep.lastActivityAt).toLocaleString('ar-EG') : 'لا يوجد'}
                  </td>
                  <td className="p-4 font-black">{rep.revenue.toLocaleString()} ج.م</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h4 className="font-black text-lg">مراجعة جودة التفاعل (QA)</h4>
            <div className="text-xs text-zinc-400">
              معلق: <span className="font-black text-amber-300">{qaPending.length}</span> | معتمد: <span className="font-black text-emerald-300">{qaApproved}</span> | مرفوض: <span className="font-black text-rose-300">{qaRejected}</span>
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto custom-scrollbar">
            {qaQueue.map((q) => (
              <div
                key={`${q.activityId}-${q.leadId}`}
                onClick={() => goClient360(q.leadId)}
                className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-indigo-300/35 transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-white truncate">{q.leadName} - {q.action}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{q.repName} - {new Date(q.createdAt).toLocaleString('ar-EG')}</p>
                  {q.evidenceRef && <a href={q.evidenceRef} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-indigo-300 underline">فتح الدليل</a>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {q.qaStatus === 'approved' && <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-emerald-500/20 text-emerald-300">معتمد</span>}
                  {q.qaStatus === 'rejected' && <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-rose-500/20 text-rose-300">مرفوض</span>}
                  {(!q.qaStatus || q.qaStatus === 'pending') && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); reviewLeadActivity(q.leadId, q.activityId, 'approved'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                      <button onClick={(e) => { e.stopPropagation(); reviewLeadActivity(q.leadId, q.activityId, 'rejected', window.prompt('سبب الرفض') || undefined); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {qaQueue.length === 0 && <p className="text-sm text-zinc-400">لا توجد تفاعلات موثقة للمراجعة.</p>}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h4 className="font-black text-lg mb-3">الأهداف الشهرية للمناديب</h4>
          <p className="text-zinc-400 text-sm mb-4">تحديد هدف ليدز وإيراد لكل مندوب ومتابعة نسبة الإنجاز.</p>
          <div className="space-y-4">
            {snapshots.map((rep) => (
              <div key={`${rep.repId}-target`} className="bg-[#0F1528]/70 border border-white/10 rounded-2xl p-4">
                <p className="font-bold mb-3">{rep.repName}</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">هدف الليدز</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.leadsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { leadsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">هدف الإيراد (ج.م)</p>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={rep.revenueTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { revenueTarget: Number(e.target.value) || 1000 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">مكالمات شهرية</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.callsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { callsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">مكالمات يومية</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.dailyCallsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { dailyCallsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                      placeholder="هدف يومي"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">مكالمات أسبوعية</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.weeklyCallsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { weeklyCallsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                      placeholder="هدف أسبوعي"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">
                  إنجاز الإيراد: {rep.revenueTargetProgress.toFixed(1)}% | إنجاز شهري: {rep.callsTargetProgress.toFixed(1)}% | يومي: {rep.dailyCallsProgress.toFixed(1)}% | أسبوعي: {rep.weeklyCallsProgress.toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App Logic & Navigation ---

/** تبويب مدير المبيعات: إضافة مندوبي مبيعات (يظهرون تلقائياً في الرئيسية) */
const ManagerSalesTeamPanel = () => {
  const { users, leads } = useData();
  const reps = useMemo(() => users.filter(u => u.role === 'مندوب'), [users]);
  const activeLeads = useMemo(
    () => leads.filter((l) => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة'),
    [leads]
  );

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title="فريق المبيعات" subtitle="لوحة مختصرة لإدارة الفريق والتغطية التشغيلية بدون عناصر إضافية." icon={UserPlus} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniMetricCard title="عدد المندوبين" value={reps.length} hint="إجمالي الفريق الحالي" icon={Users} tone="indigo" />
        <MiniMetricCard title="ليدز نشطة" value={activeLeads.length} hint="العملاء قيد المتابعة الآن" icon={Briefcase} tone="amber" />
        <MiniMetricCard title="متوسط الحمل" value={reps.length > 0 ? `${Math.ceil(activeLeads.length / reps.length)}` : '0'} hint="عميل نشط لكل مندوب" icon={Target} tone="emerald" />
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-8">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="text-lg font-black text-white">المناديب الحاليون ({reps.length})</h3>
          <p className="text-xs text-zinc-500">إضافة وتعديل الموظفين من صلاحيات المالك في الإعدادات.</p>
        </div>
        <div className="space-y-3 max-h-[460px] overflow-y-auto custom-scrollbar">
          {reps.map((rep) => {
            const assigned = activeLeads.filter((l) => l.assignedTo === rep.id).length;
            return (
              <div key={rep.id} className="flex items-center gap-4 bg-[#0F1528]/80 border border-white/10 rounded-2xl p-4">
                <img src={rep.avatar} alt="" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-white truncate">{rep.name}</p>
                  <p className="text-[11px] text-zinc-500">حمل التشغيل الحالي: {assigned} عميل نشط</p>
                </div>
                <span className="px-3 py-1 rounded-xl text-[11px] font-black bg-[#7C6BFF]/15 border border-[#7C6BFF]/30 text-[#c4bcff]">
                  نشط: {assigned}
                </span>
              </div>
            );
          })}
          {reps.length === 0 && <p className="text-sm text-zinc-500">لا يوجد مناديب بعد.</p>}
        </div>
      </div>
    </div>
  );
};

const ApprovalCenter = ({
  leads,
  expenses,
  shootBookings,
  equipmentBookings,
  meetingBookings,
  priceQuotes,
  custodyFunds,
  users = [],
  currentUserRole,
  onApproveExpense,
  onRejectExpense,
  onApproveShoot,
  onRejectShoot,
  onApproveEquipment,
  onRejectEquipment,
  onApproveMeeting,
  onRejectMeeting,
  onApprovePriceQuote,
  onRejectPriceQuote,
  onApproveCustodyRequest,
  onRejectCustodyRequest,
  onGoToTab,
  entityComments,
  setEntityComments,
  commentDrafts,
  setCommentDrafts,
  currentUserName,
}: any) => {
  const [quotePaymentForm, setQuotePaymentForm] = useState<Record<string, { initPayment: string; lines: PaymentInstallment[] }>>({});

  const getQPF = (qid: string) => quotePaymentForm[qid] || { initPayment: '', lines: [] };
  const setQPF = (qid: string, patch: Partial<{ initPayment: string; lines: PaymentInstallment[] }>) =>
    setQuotePaymentForm((prev) => ({ ...prev, [qid]: { ...getQPF(qid), ...patch } }));

  const goClient360 = (leadId?: string) => {
    if (!leadId) return;
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };
  const pendingExpenses = expenses.filter((e: Expense) => e.approvalStatus === 'قيد الاعتماد');
  const pendingShoot = shootBookings.filter((b: any) => b.status === 'قيد المراجعة');
  const pendingEquipment = equipmentBookings.filter((b: any) => b.status === 'قيد المراجعة');
  const pendingMeetings = meetingBookings.filter((b: any) => b.status === 'قيد المراجعة');
  const pendingQuotes = (priceQuotes as PriceQuote[]).filter((q) => q.status === 'قيد اعتماد المالك');
  const pendingCustodyRequest = (custodyFunds as CustodyFund[]).filter((c) => c.status === 'طلب_بانتظار_المالك');
  const ownerOnly = currentUserRole === 'مالك';
  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <SectionTitle title="مركز الاعتمادات" subtitle="اعتماد/رفض كل الطلبات من شاشة واحدة" icon={ShieldCheck} />
      <p className="text-sm text-zinc-300 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>مصروفات: <b className="text-amber-300">{pendingExpenses.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>تصوير: <b className="text-indigo-300">{pendingShoot.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>معدات: <b className="text-rose-300">{pendingEquipment.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>اجتماعات: <b className="text-indigo-200">{pendingMeetings.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>عروض أسعار: <b className="text-amber-200">{pendingQuotes.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>عهد إنتاج: <b className="text-[#A99FFF]">{pendingCustodyRequest.length}</b></span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">مصروفات</h4>
          {pendingExpenses.map((e: Expense) => {
            const submitter = expenseSubmitterDisplay(e, users);
            return (
            <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{e.title}</p>
              {submitter ? (
                <p className="text-[11px] text-zinc-500 mt-1">مقدّم الطلب: {submitter}</p>
              ) : null}
              <p className="text-xs text-zinc-400 mt-1">{e.amount.toLocaleString()} ج.م</p>
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveExpense(e.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                  <button onClick={() => onRejectExpense(e.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[e.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[e.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [e.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[e.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [e.id]: [...(prev[e.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [e.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
          {pendingExpenses.length === 0 && <p className="text-xs text-zinc-500">لا توجد طلبات.</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">طلبات تصوير</h4>
          {pendingShoot.map((b: any) => (
            <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              {b.leadId ? (
                <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right font-bold hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  {b.customerName}
                </button>
              ) : (
                <p className="font-bold">{b.customerName}</p>
              )}
              <p className="text-xs text-zinc-400 mt-1">{b.date} - {b.time} - {b.repName}</p>
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveShoot(b.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                  <button onClick={() => onRejectShoot(b.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[b.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[b.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [b.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[b.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [b.id]: [...(prev[b.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [b.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingShoot.length === 0 && <p className="text-xs text-zinc-500">لا توجد طلبات.</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">طلبات معدات</h4>
          {pendingEquipment.map((b: any) => (
            <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{b.equipmentName} x{b.quantity}</p>
              <p className="text-xs text-zinc-400 mt-1">{b.fromDate} - {b.toDate} - {b.repName}</p>
              {b.leadId ? (
                <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right text-xs text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  العميل: {b.customerName}
                </button>
              ) : null}
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveEquipment(b.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                  <button onClick={() => onRejectEquipment(b.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[b.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[b.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [b.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[b.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [b.id]: [...(prev[b.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [b.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingEquipment.length === 0 && <p className="text-xs text-zinc-500">لا توجد طلبات.</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">عروض أسعار (مالية)</h4>
          <p className="text-[11px] text-zinc-500">لا تُسجَّل عند المحاسب كفاتورة إلا بعد اعتمادك أنت كمالك.</p>
          {pendingQuotes.map((q: PriceQuote) => (
            <div key={q.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{q.title}</p>
              {q.leadId ? (
                <button type="button" onClick={() => goClient360(q.leadId)} className="cursor-pointer text-right text-xs text-zinc-400 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  {q.customerName}
                </button>
              ) : (
                <p className="text-xs text-zinc-400 mt-1">{q.customerName}</p>
              )}
              <p className="text-xs text-zinc-300 mt-1">
                {typeof q.productionCostAmount === 'number' && q.productionCostAmount > 0 && (q.companyMarginPercent ?? 0) > 0 && (
                  <span className="block text-teal-300/90">
                    بنود تكلفة: {q.productionCostAmount.toLocaleString('ar-EG')} ج.م — هامش شركة {q.companyMarginPercent}%
                  </span>
                )}
                {q.amount.toLocaleString('ar-EG')} ج.م قبل الضريبة
                {q.vatRate != null ? ` — ضريبة ${q.vatRate}%` : ''}
                {typeof q.totalAmount === 'number' ? ` — إجمالي ${q.totalAmount.toLocaleString('ar-EG')} ج.م` : ''} — {q.costCenter || 'عام'}
              </p>
              {q.pricedByName && <p className="text-[10px] text-teal-300/80 mt-0.5">سُعِّر بواسطة: {q.pricedByName}</p>}
              <p className="text-[10px] text-zinc-500 mt-1">من: {q.createdByName} {q.note && `— ${q.note}`}</p>
              {ownerOnly ? (
                <div className="mt-3 space-y-2">
                  {/* Payment schedule builder */}
                  <div className="bg-black/20 rounded-xl p-3 space-y-2 border border-white/10">
                    <p className="text-[11px] font-black text-zinc-300">شروط الدفع عند الاعتماد</p>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-zinc-400 whitespace-nowrap">دفعة أولى (ج.م)</label>
                      <input
                        type="number" min={0}
                        value={getQPF(q.id).initPayment}
                        onChange={(e) => setQPF(q.id, { initPayment: e.target.value })}
                        className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-xs"
                        placeholder="0 = لا يوجد دفعة الآن"
                      />
                    </div>
                    {getQPF(q.id).lines.map((ln, li) => (
                      <div key={ln.id} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                        <input type="date" value={ln.dueDate} onChange={(e) => setQPF(q.id, { lines: getQPF(q.id).lines.map((l, i) => i === li ? { ...l, dueDate: e.target.value } : l) })} className="bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-xs" />
                        <input type="number" min={0} placeholder="المبلغ" value={ln.amount || ''} onChange={(e) => setQPF(q.id, { lines: getQPF(q.id).lines.map((l, i) => i === li ? { ...l, amount: Number(e.target.value) } : l) })} className="bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-xs" />
                        <button type="button" onClick={() => setQPF(q.id, { lines: getQPF(q.id).lines.filter((_, i) => i !== li) })} className="rounded-lg bg-rose-500/20 text-rose-300 px-2 py-1 text-xs">×</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setQPF(q.id, { lines: [...getQPF(q.id).lines, { id: `inst-${Date.now()}`, dueDate: '', amount: 0 }] })} className="text-[11px] text-indigo-300 hover:underline">+ إضافة دفعة مجدولة</button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onApprovePriceQuote(q.id, getQPF(q.id).lines.filter(l => l.dueDate && l.amount > 0), Number(getQPF(q.id).initPayment) || 0)}
                      className="flex-1 px-2 py-1.5 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >اعتماد العرض — يُرسَل للمندوب</button>
                    <button onClick={() => onRejectPriceQuote(q.id)} className="px-2 py-1.5 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[q.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[q.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [q.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[q.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [q.id]: [...(prev[q.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [q.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingQuotes.length === 0 && <p className="text-xs text-zinc-500">لا توجد عروض معلقة.</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">طلبات اجتماعات/أماكن</h4>
          {pendingMeetings.map((m: any) => (
            <div key={m.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{m.title}</p>
              <p className="text-xs text-zinc-400 mt-1">{m.date} - {m.startTime} - {m.repName}</p>
              {m.leadId ? (
                <button type="button" onClick={() => goClient360(m.leadId)} className="cursor-pointer text-right text-xs text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  العميل: {leads.find((l: Lead) => l.id === m.leadId)?.name || m.leadId}
                </button>
              ) : null}
              {typeof m.estimatedCost === 'number' && m.estimatedCost > 0 ? (
                <p className="text-xs text-zinc-300 mt-1">تكلفة تقديرية: {m.estimatedCost.toLocaleString()} ج.م</p>
              ) : null}
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveMeeting(m.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد</button>
                  <button onClick={() => onRejectMeeting(m.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[m.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[m.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [m.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[m.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [m.id]: [...(prev[m.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [m.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingMeetings.length === 0 && <p className="text-xs text-zinc-500">لا توجد طلبات.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2 md:col-span-2">
          <h4 className="font-black">طلبات عهدة إنتاج</h4>
          {pendingCustodyRequest.map((c: CustodyFund) => (
            <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{c.title}</p>
              <p className="text-xs text-zinc-400 mt-1">{c.totalAmount.toLocaleString()} ج.م — {c.productionManagerName}</p>
              <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">{c.description || '—'}</p>
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => onApproveCustodyRequest(c.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">اعتماد الطلب</button>
                  <button type="button" onClick={() => onRejectCustodyRequest(c.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">رفض</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">بانتظار اعتماد المالك</p>
              )}
              {ownerOnly && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {(entityComments?.[c.id] || []).slice(-3).map((cmnt: any, idx: number) => (
                    <p key={idx} className="text-[11px] text-zinc-400">{cmnt.by}: {cmnt.text}</p>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <input
                      value={commentDrafts?.[c.id] || ''}
                      onChange={(ev) => setCommentDrafts?.((prev: any) => ({ ...prev, [c.id]: ev.target.value }))}
                      placeholder="أضف تعليق..."
                      className="flex-1 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (commentDrafts?.[c.id] || '').trim();
                        if (!txt) return;
                        setEntityComments?.((prev: any) => ({
                          ...prev,
                          [c.id]: [...(prev[c.id] || []), { by: currentUserName || '', text: txt, at: new Date().toISOString() }],
                        }));
                        setCommentDrafts?.((prev: any) => ({ ...prev, [c.id]: '' }));
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] bg-white/10 whitespace-nowrap"
                    >حفظ</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MAX_CUSTODY_ATTACH_BYTES = 48 * 1024;

/** شارة لونية لحالة العهدة في الجدول وتفاصيل مدير الإنتاج */
function custodyStatusBadgeClass(status: CustodyFund['status']): string {
  const base =
    'inline-flex max-w-full items-center rounded-lg px-2 py-0.5 text-[11px] font-black border whitespace-normal text-right leading-snug';
  switch (status) {
    case 'مسودة':
      return `${base} bg-zinc-600/35 text-zinc-100 border-white/10`;
    case 'طلب_بانتظار_المالك':
      return `${base} bg-amber-500/20 text-amber-100 border-amber-400/25`;
    case 'مرفوض_طلب':
      return `${base} bg-rose-500/20 text-rose-100 border-rose-400/30`;
    case 'بانتظار_دفع_محاسب':
      return `${base} bg-indigo-500/25 text-indigo-100 border-indigo-400/25`;
    case 'جاهزة_للاستلام':
      return `${base} bg-cyan-500/20 text-cyan-100 border-cyan-400/30`;
    case 'نشطة':
      return `${base} bg-emerald-500/20 text-emerald-100 border-emerald-400/25`;
    case 'تسوية_بانتظار_محاسب':
      return `${base} bg-violet-500/22 text-violet-100 border-violet-400/25`;
    case 'مرفوض_تسوية':
      return `${base} bg-rose-500/25 text-rose-100 border-rose-400/35`;
    case 'مقفلة':
      return `${base} bg-slate-600/40 text-slate-100 border-white/10`;
    default:
      return `${base} bg-zinc-700/50 text-zinc-200 border-white/10`;
  }
}

function custodyAttachmentHref(a: CustodySpendAttachment): string | null {
  if (!a.dataBase64) return null;
  const mime = a.mimeType || 'application/octet-stream';
  return `data:${mime};base64,${a.dataBase64}`;
}

/** عرض بنود التسوية للمحاسب مع روابط المرفقات */
const CustodySettlementReviewBlock = ({ lines }: { lines: CustodySpendLine[] }) => {
  if (lines.length === 0) return <p className="text-xs text-zinc-500">لا توجد بنود صرف مُرسلة.</p>;
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-white/10 bg-[#0B1020]/80">
      <table className="w-full text-right text-xs min-w-[640px]">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="p-2 font-black">البيان</th>
            <th className="p-2 font-black">المبلغ</th>
            <th className="p-2 font-black">الفئة</th>
            <th className="p-2 font-black">مركز التكلفة</th>
            <th className="p-2 font-black">ملاحظة</th>
            <th className="p-2 font-black">المستندات</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-white/5">
              <td className="p-2 text-zinc-200">{line.title || '—'}</td>
              <td className="p-2 text-emerald-300 font-bold">{Number(line.amount || 0).toLocaleString()}</td>
              <td className="p-2">{line.category}</td>
              <td className="p-2 text-zinc-400">{line.costCenter || '—'}</td>
              <td className="p-2 text-zinc-500 max-w-[160px] break-words">{line.note || '—'}</td>
              <td className="p-2">
                {(line.attachments?.length ?? 0) === 0 && <span className="text-amber-300/90">بدون مستند</span>}
                {(line.attachments ?? []).map((a) => {
                  const href = custodyAttachmentHref(a);
                  return (
                    <div key={a.id} className="mb-1">
                      {href ? (
                        <a href={href} download={a.fileName} className="text-[#A99FFF] underline font-bold">{a.fileName}</a>
                      ) : (
                        <span className="text-zinc-500">{a.fileName} (بلا نسخة محفوظة)</span>
                      )}
                    </div>
                  );
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ProductionCustodyDashboard = () => {
  const {
    currentUser,
    custodyFunds,
    expenses,
    priceQuotes,
    addExpense,
    managerReceiveCustody,
    managerUpdateCustodySpendLines,
    managerUpdateApprovedExpenseSpendLines,
    managerSubmitCustodySettlement,
    hardDeleteCustodyFund,
    hardDeleteExpense,
    productionPriceQuote,
    reassignPricingRequest,
    users,
  } = useData();
  type PricingLine = { id: string; desc: string; amount: string };
  const newLine = (): PricingLine => ({ id: `pl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, desc: '', amount: '' });
  type PricingDraft = { lines: PricingLine[]; vatRate: string; note: string; companyMarginPercent: string };
  const [pricingForm, setPricingForm] = useState<Record<string, PricingDraft>>({});
  const getPF = (id: string): PricingDraft => pricingForm[id] || { lines: [newLine()], vatRate: '14', note: '', companyMarginPercent: '0' };
  const setPF = (id: string, patch: Partial<PricingDraft>) =>
    setPricingForm((prev) => ({ ...prev, [id]: { ...getPF(id), ...patch } }));
  const setPFLine = (qid: string, lineId: string, patch: Partial<PricingLine>) =>
    setPF(qid, { lines: getPF(qid).lines.map((l) => l.id === lineId ? { ...l, ...patch } : l) });
  const addPFLine = (qid: string) => setPF(qid, { lines: [...getPF(qid).lines, newLine()] });
  const removePFLine = (qid: string, lineId: string) => {
    const remaining = getPF(qid).lines.filter((l) => l.id !== lineId);
    setPF(qid, { lines: remaining.length ? remaining : [newLine()] });
  };
  const calcPFTotal = (qid: string) => getPF(qid).lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  // default to pricing tab if there are pending pricing requests on first mount
  const otherProductionUsers = useMemo(
    () => users.filter((u) => u.role === 'مدير إنتاج' && u.id !== currentUser?.id),
    [users, currentUser?.id]
  );
  const [reassignTarget, setReassignTarget] = useState<Record<string, string>>({});

  const [prodActiveTab, setProdActiveTab] = useState<'requests' | 'pricing'>(() => {
    if (!currentUser?.id) return 'requests';
    const pending = (priceQuotes as PriceQuote[]).some(
      (q) => q.status === 'بانتظار التسعير' &&
        (q.productionAssignedId === currentUser.id || q.productionAssignedName === currentUser.name)
    );
    return pending ? 'pricing' : 'requests';
  });

  const myPricingQueue = useMemo(() => {
    if (!currentUser?.id) return [];
    return (priceQuotes as PriceQuote[]).filter(
      (q) =>
        q.status === 'بانتظار التسعير' &&
        (q.productionAssignedId === currentUser.id || q.productionAssignedName === currentUser.name)
    );
  }, [priceQuotes, currentUser?.id, currentUser?.name]);

  // switch to pricing tab automatically when new quotes arrive
  useEffect(() => {
    if (myPricingQueue.length > 0) setProdActiveTab('pricing');
  }, [myPricingQueue.length]);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [draftLines, setDraftLines] = useState<CustodySpendLine[]>([]);
  const [expenseSpendDraftLines, setExpenseSpendDraftLines] = useState<CustodySpendLine[]>([]);
  const [expenseSpendSaveBusy, setExpenseSpendSaveBusy] = useState(false);
  const [recvNote, setRecvNote] = useState('');
  const [expenseReqForm, setExpenseReqForm] = useState({
    title: '',
    category: 'تشغيل' as Expense['category'],
    amount: '',
    costCenter: 'تصوير',
    note: '',
  });
  const [expenseSubmitBusy, setExpenseSubmitBusy] = useState(false);

  const myFunds = useMemo(() => {
    const uid = currentUser?.id;
    if (!uid) return [];
    return custodyFunds.filter((f) => custodyFundBelongsToProductionManager(f, uid, currentUser?.name));
  }, [custodyFunds, currentUser?.id, currentUser?.name]);

  const myProductionExpenseRows = useMemo(() => {
    const uid = currentUser?.id;
    const uname = (currentUser?.name || '').trim();
    if (!uid) return [];
    return [...expenses]
      .filter((e) => {
        const sid = String(e.submittedById || '').trim();
        const uidStr = String(uid).trim();
        if (sid && sid === uidStr) return true;
        const v = (e.vendor || '').trim();
        if (v !== 'طلب مدير الإنتاج') return false;
        const sname = (e.submittedByName || '').trim();
        if (uname && sname === uname) return true;
        return false;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, currentUser?.id, currentUser?.name]);

  type ProductionFinanceRow =
    | { kind: 'custody'; rowKey: string; sortDate: string; title: string; amount: number; fund: CustodyFund }
    | { kind: 'expense'; rowKey: string; sortDate: string; title: string; amount: number; expense: Expense };

  const unifiedProductionRows = useMemo((): ProductionFinanceRow[] => {
    const custodyRows: ProductionFinanceRow[] = myFunds.map((f) => ({
      kind: 'custody',
      rowKey: `c:${f.id}`,
      sortDate: f.createdAt || '',
      title: f.title,
      amount: f.totalAmount,
      fund: f,
    }));
    const expenseRows: ProductionFinanceRow[] = myProductionExpenseRows.map((e) => ({
      kind: 'expense',
      rowKey: `e:${e.id}`,
      sortDate: e.date,
      title: e.title,
      amount: e.totalAmount ?? e.amount,
      expense: e,
    }));
    return [...custodyRows, ...expenseRows].sort(
      (a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()
    );
  }, [myFunds, myProductionExpenseRows]);

  const activeFund = useMemo(() => {
    if (!activeRowKey?.startsWith('c:')) return undefined;
    const id = activeRowKey.slice(2);
    return myFunds.find((f) => f.id === id);
  }, [activeRowKey, myFunds]);

  const activeExpense = useMemo(() => {
    if (!activeRowKey?.startsWith('e:')) return undefined;
    const id = activeRowKey.slice(2);
    return expenses.find((e) => e.id === id);
  }, [activeRowKey, expenses]);

  useEffect(() => {
    if (!activeRowKey?.startsWith('c:')) {
      setDraftLines([]);
      return;
    }
    const id = activeRowKey.slice(2);
    const f = myFunds.find((x) => x.id === id);
    if (f) setDraftLines(f.spendLines);
  }, [activeRowKey, myFunds, custodyFunds]);

  useEffect(() => {
    if (!activeRowKey?.startsWith('e:')) {
      setExpenseSpendDraftLines([]);
      return;
    }
    const id = activeRowKey.slice(2);
    const ex = expenses.find((e) => e.id === id);
    if (ex?.approvalStatus === 'معتمد') setExpenseSpendDraftLines(ex.productionSpendLines ?? []);
    else setExpenseSpendDraftLines([]);
  }, [activeRowKey, expenses]);

  const spendSum = useMemo(() => draftLines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [draftLines]);
  const expenseSpendSum = useMemo(
    () => expenseSpendDraftLines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [expenseSpendDraftLines],
  );

  const attachToLine = (lineId: string, file: File | null) => {
    if (!file) return;
    if (file.size > MAX_CUSTODY_ATTACH_BYTES) {
      toast.error('حجم الملف كبير؛ اختر ملفاً أصغر (حد أقصى تقريباً ٤٨ ك.ب)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',').slice(1).join(',') : dataUrl;
      const att: CustodySpendAttachment = {
        id: `ATT-${Math.random().toString(36).slice(2, 10)}`,
        fileName: file.name || 'مرفق',
        mimeType: file.type || 'application/octet-stream',
        dataBase64: base64,
      };
      setDraftLines((prev) =>
        prev.map((l) =>
          l.id === lineId ? { ...l, attachments: [...(l.attachments ?? []), att] } : l
        )
      );
      toast.success('تمت إضافة المستند للبند');
    };
    reader.onerror = () => toast.error('تعذر قراءة الملف');
    reader.readAsDataURL(file);
  };

  const removeAttachmentFromLine = (lineId: string, attId: string) => {
    setDraftLines((prev) =>
      prev.map((l) =>
        l.id !== lineId
          ? l
          : {
              ...l,
              attachments: (l.attachments ?? []).filter((a) => a.id !== attId),
            }
      )
    );
  };

  const addLine = () => {
    setDraftLines((prev) => [
      ...prev,
      {
        id: `CL-${Math.random().toString(36).slice(2, 8)}`,
        title: '',
        amount: 0,
        category: 'تشغيل',
        costCenter: 'عام',
        attachments: [],
      },
    ]);
  };

  const updateLine = (id: string, patch: Partial<CustodySpendLine>) => {
    setDraftLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => setDraftLines((prev) => prev.filter((l) => l.id !== id));

  const updateExpenseSpendLine = (lineId: string, p: Partial<CustodySpendLine>) => {
    setExpenseSpendDraftLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...p } : l)));
  };

  const attachToExpenseSpendLine = (lineId: string, file: File | null) => {
    if (!file) return;
    if (file.size > MAX_CUSTODY_ATTACH_BYTES) {
      toast.error('حجم الملف كبير؛ اختر ملفاً أصغر (حد أقصى تقريباً ٤٨ ك.ب)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',').slice(1).join(',') : dataUrl;
      const att: CustodySpendAttachment = {
        id: `ATT-${Math.random().toString(36).slice(2, 10)}`,
        fileName: file.name || 'مرفق',
        mimeType: file.type || 'application/octet-stream',
        dataBase64: base64,
      };
      setExpenseSpendDraftLines((prev) =>
        prev.map((l) =>
          l.id === lineId ? { ...l, attachments: [...(l.attachments ?? []), att] } : l,
        ),
      );
      toast.success('تمت إضافة المستند للبند');
    };
    reader.onerror = () => toast.error('تعذر قراءة الملف');
    reader.readAsDataURL(file);
  };

  const removeExpenseSpendAttachment = (lineId: string, attId: string) => {
    setExpenseSpendDraftLines((prev) =>
      prev.map((l) =>
        l.id !== lineId
          ? l
          : { ...l, attachments: (l.attachments ?? []).filter((a) => a.id !== attId) },
      ),
    );
  };

  const addExpenseSpendLine = () => {
    setExpenseSpendDraftLines((prev) => [
      ...prev,
      {
        id: `CL-${Math.random().toString(36).slice(2, 8)}`,
        title: '',
        amount: 0,
        category: 'تشغيل',
        costCenter: 'عام',
        attachments: [],
      },
    ]);
  };

  const removeExpenseSpendLine = (lineId: string) =>
    setExpenseSpendDraftLines((prev) => prev.filter((l) => l.id !== lineId));

  const saveExpenseSpendLines = async () => {
    if (!activeExpense || activeExpense.approvalStatus !== 'معتمد') return;
    if (expenseSpendSaveBusy) return;
    setExpenseSpendSaveBusy(true);
    try {
      const ok = await managerUpdateApprovedExpenseSpendLines(activeExpense.id, expenseSpendDraftLines);
      if (ok) toast.success('تم حفظ بنود الصرف والمرفقات');
      else toast.error('تعذر الحفظ — تحقق من المبلغ أو الصلاحية');
    } finally {
      setExpenseSpendSaveBusy(false);
    }
  };

  const saveLinesOnly = async () => {
    if (!activeFund) return;
    const ok = await managerUpdateCustodySpendLines(activeFund.id, draftLines);
    if (ok) toast.success('تم حفظ بنود الصرف');
    else toast.error('تعذر الحفظ — تحقق من حالة العهدة');
  };

  const submitSettlement = async () => {
    if (!activeFund) return;
    const ok = await managerSubmitCustodySettlement(activeFund.id, draftLines);
    if (ok) toast.success('تم إرسال التسوية للمحاسب لإقفال القيد');
    else toast.error('تعذر الإرسال — مجموع البنود يتجاوز العهدة أو الحالة غير مناسبة');
  };

  const statusLabel: Record<string, string> = {
    مسودة: 'مسودة',
    طلب_بانتظار_المالك: 'طلب بانتظار المالك',
    مرفوض_طلب: 'طلب مرفوض',
    بانتظار_دفع_محاسب: 'بانتظار دفع المحاسب',
    جاهزة_للاستلام: 'جاهزة للاستلام (بعد صرف المحاسب)',
    نشطة: 'نشطة — تسجيل الصرف',
    تسوية_بانتظار_محاسب: 'تسوية بانتظار المحاسب',
    مرفوض_تسوية: 'مرفوض تسوية',
    مقفلة: 'مقفلة',
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <SectionTitle
        title="لوحة الإنتاج"
        subtitle="طلبات التسعير من فريق المبيعات، وعهود وتمويل الإنتاج"
        icon={Briefcase}
      />

      {/* Tab navigation */}
      <div className="flex items-center gap-1 bg-[#0F1528]/70 border border-white/10 rounded-2xl p-1 w-fit">
        <button
          onClick={() => setProdActiveTab('requests')}
          className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${prodActiveTab === 'requests' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          عهدة ومصروفات
        </button>
        <button
          onClick={() => setProdActiveTab('pricing')}
          className={`relative px-5 py-2 rounded-xl text-sm font-black transition-all ${prodActiveTab === 'pricing' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-white'}`}
        >
          طلبات التسعير
          {myPricingQueue.length > 0 && (
            <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {myPricingQueue.length}
            </span>
          )}
        </button>
      </div>

      {/* ===== TAB: طلبات التسعير ===== */}
      {prodActiveTab === 'pricing' && (
        <div className="space-y-5">
          {myPricingQueue.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-12 text-center text-zinc-500">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              لا توجد طلبات تسعير معلقة
            </div>
          ) : (
            myPricingQueue.map((q: PriceQuote) => {
              const draft = getPF(q.id);
              const costSubtotal = calcPFTotal(q.id);
              const companyPct = Math.min(100, Math.max(0, Number(draft.companyMarginPercent) || 0));
              const preVatAmount = Math.round(costSubtotal * (1 + companyPct / 100));
              const companyMarginAmt = preVatAmount - costSubtotal;
              const vatAmt = Math.round(preVatAmount * (Number(draft.vatRate) || 0) / 100);
              const total = preVatAmount + vatAmt;
              return (
                <div key={q.id} className="bg-[#0F1528]/80 border border-amber-400/25 rounded-3xl p-6 space-y-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-black text-white text-lg">{q.title}</p>
                      <p className="text-sm text-zinc-400 mt-0.5">{q.customerName}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-zinc-700/60 text-zinc-300">{q.costCenter || 'عام'}</span>
                        <span className="text-[10px] text-zinc-500">أرسله: {q.createdByName}</span>
                      </div>
                      {q.note && (
                        <p className="text-xs text-amber-300/80 mt-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-1.5">
                          ملاحظات المندوب: {q.note}
                        </p>
                      )}
                    </div>
                    <span className="px-3 py-1 rounded-xl text-xs font-black bg-amber-500/20 text-amber-200 border border-amber-500/30 shrink-0">
                      بانتظار التسعير
                    </span>
                  </div>

                  {/* ===== تحويل للمدير آخر ===== */}
                  <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3 flex-wrap">
                    <ArrowLeftRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-xs text-zinc-400 shrink-0">تحويل لمدير إنتاج آخر:</span>
                    {otherProductionUsers.length === 0 ? (
                      <span className="text-xs text-zinc-600 italic">لا يوجد مدير إنتاج آخر مسجل في النظام حالياً</span>
                    ) : (
                      <>
                        <select
                          value={reassignTarget[q.id] || ''}
                          onChange={(e) => setReassignTarget((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          className="flex-1 min-w-[160px] bg-[#0B1020] border border-white/15 rounded-xl px-3 py-1.5 text-sm"
                        >
                          <option value="">— اختر مدير إنتاج —</option>
                          {otherProductionUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        <button
                          disabled={!reassignTarget[q.id]}
                          onClick={async () => {
                            const targetId = reassignTarget[q.id];
                            const targetUser = otherProductionUsers.find((u) => u.id === targetId);
                            if (!targetUser) return;
                            const ok = await reassignPricingRequest(q.id, targetUser.id, targetUser.name);
                            if (ok) {
                              toast.success(`تم تحويل الطلب إلى ${targetUser.name}`);
                              setReassignTarget((prev) => { const n = { ...prev }; delete n[q.id]; return n; });
                            } else {
                              toast.error('تعذر التحويل');
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl text-xs font-black bg-indigo-500/20 border border-indigo-500/35 text-indigo-200 hover:bg-indigo-500/30 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
                        >
                          تحويل
                        </button>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-zinc-200">بنود التسعير</p>
                      <button
                        onClick={() => addPFLine(q.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> إضافة بند
                      </button>
                    </div>
                    <div className="grid grid-cols-[1fr_160px_36px] gap-2 px-3 py-1">
                      <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">البند / الوصف</span>
                      <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest text-center">السعر (ج.م)</span>
                      <span />
                    </div>
                    {draft.lines.map((line, idx) => (
                      <div key={line.id} className="grid grid-cols-[1fr_160px_36px] gap-2 items-center bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2">
                        <input
                          value={line.desc}
                          onChange={(e) => setPFLine(q.id, line.id, { desc: e.target.value })}
                          placeholder={`بند ${idx + 1} — مثال: تصوير فيديو إعلاني`}
                          className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-600 w-full"
                        />
                        <input
                          type="number" min={0}
                          value={line.amount}
                          onChange={(e) => setPFLine(q.id, line.id, { amount: e.target.value })}
                          placeholder="0"
                          className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-1.5 text-sm text-center w-full"
                        />
                        <button onClick={() => removePFLine(q.id, line.id)} className="p-1.5 hover:bg-rose-500/20 rounded-lg text-zinc-500 hover:text-rose-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 space-y-1.5 mt-1">
                      <div className="flex items-center justify-between text-sm text-zinc-400">
                        <span>مجموع بنود التكلفة</span>
                        <span className="font-black text-white">{costSubtotal.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-zinc-400">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="shrink-0">نسبة الشركة (هامش)</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={draft.companyMarginPercent}
                              onChange={(e) => setPF(q.id, { companyMarginPercent: e.target.value })}
                              className="w-16 bg-[#0B1020] border border-white/15 rounded-lg px-2 py-0.5 text-xs text-center"
                            />
                            <span>%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="shrink-0">ضريبة القيمة المضافة</span>
                          <div className="flex items-center gap-1">
                            <input type="number" min={0} max={100} value={draft.vatRate} onChange={(e) => setPF(q.id, { vatRate: e.target.value })} className="w-16 bg-[#0B1020] border border-white/15 rounded-lg px-2 py-0.5 text-xs text-center" />
                            <span>%</span>
                          </div>
                        </div>
                      </div>
                      {companyPct > 0 && (
                        <div className="flex items-center justify-between text-xs text-teal-300/90">
                          <span>مبلغ هامش الشركة</span>
                          <span className="font-bold">{companyMarginAmt.toLocaleString('ar-EG')} ج.م</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm text-zinc-400 border-t border-white/5 pt-1.5">
                        <span>المبلغ قبل الضريبة (للعميل)</span>
                        <span className="font-black text-white">{preVatAmount.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-zinc-400">
                        <span>قيمة الضريبة</span>
                        <span className="font-black text-amber-300">{vatAmt.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                      <div className="border-t border-white/10 pt-1.5 flex items-center justify-between">
                        <span className="font-black text-white">الإجمالي الكلي</span>
                        <span className="font-black text-emerald-300 text-lg">{total.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">ملاحظة التسعير (اختياري)</label>
                    <input value={draft.note} onChange={(e) => setPF(q.id, { note: e.target.value })} placeholder="شرح التسعير أو أي تفاصيل إضافية..." className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (costSubtotal <= 0) { toast.error('أضف بند واحد على الأقل بسعر'); return; }
                      const ok = await productionPriceQuote(
                        q.id,
                        preVatAmount,
                        Number(draft.vatRate) || 14,
                        draft.note || undefined,
                        companyPct,
                        costSubtotal,
                      );
                      if (ok) { toast.success('تم إرسال السعر للمالك للاعتماد'); setPricingForm((p) => { const n = { ...p }; delete n[q.id]; return n; }); }
                      else toast.error('تعذر التسعير');
                    }}
                    className="w-full py-3 rounded-2xl bg-amber-500 text-black text-sm font-black hover:bg-amber-400 transition-colors"
                  >
                    إرسال السعر للمالك للاعتماد
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===== TAB: عهدة ومصروفات ===== */}
      {prodActiveTab === 'requests' && <>

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h4 className="font-black">جدول طلباتك (عهدة + مصروف)</h4>
          {unifiedProductionRows.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('هل أنت متأكد من حذف جميع الطلبات؟ لا يمكن التراجع.')) return;
                for (const row of unifiedProductionRows) {
                  if (row.kind === 'custody') await hardDeleteCustodyFund(row.fund.id);
                  else await hardDeleteExpense(row.expense.id);
                }
                toast.success('تم حذف جميع الطلبات');
              }}
              className="shrink-0 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-black text-rose-200 hover:bg-rose-500/25 transition-colors"
            >
              حذف الكل
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          الصفوف من نوع <strong className="text-zinc-300">«أمانة عهدة»</strong> تمرّ بمسار العهدة (مالك → محاسب صرف → استلامك → بنود صرف وتسوية). الصفوف <strong className="text-zinc-300">«طلب مصروف»</strong> نفس تمويل الإنتاج لكن تُثبَّت في الدفاتر كمصروف بعد اعتماد المالك وتنفيذ المحاسب — انقر أي صف للتفاصيل.
        </p>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-right text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="p-2 font-black">النوع</th>
                <th className="p-2 font-black">العنوان</th>
                <th className="p-2 font-black">المبلغ</th>
                <th className="p-2 font-black">الحالة</th>
                <th className="p-2 font-black">قيد صرف / ملاحظة</th>
                <th className="p-2 font-black">قيد إقفال</th>
                <th className="p-2 font-black"></th>
              </tr>
            </thead>
            <tbody>
              {unifiedProductionRows.map((row) => (
                <tr
                  key={row.rowKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveRowKey(row.rowKey);
                    setRecvNote('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveRowKey(row.rowKey);
                      setRecvNote('');
                    }
                  }}
                  className={`border-b border-white/5 cursor-pointer transition-colors hover:bg-white/[0.06] ${activeRowKey === row.rowKey ? 'bg-[#7C6BFF]/12' : ''}`}
                >
                  <td className="p-2">
                    <span
                      className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black border ${
                        row.kind === 'custody'
                          ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                          : 'border-sky-400/30 bg-sky-500/15 text-sky-200'
                      }`}
                    >
                      {row.kind === 'custody' ? 'أمانة عهدة' : 'طلب مصروف'}
                    </span>
                  </td>
                  <td className="p-2 font-bold text-white">{row.title}</td>
                  <td className="p-2 text-emerald-300">{row.amount.toLocaleString()} ج.م</td>
                  <td className="p-2">
                    {row.kind === 'custody' ? (
                      <span className={custodyStatusBadgeClass(row.fund.status)} title={statusLabel[row.fund.status] || row.fund.status}>
                        {statusLabel[row.fund.status] || row.fund.status}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-0.5 items-end">
                        <span
                          className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black ${
                            row.expense.approvalStatus === 'معتمد'
                              ? 'bg-emerald-500/20 text-emerald-200'
                              : row.expense.approvalStatus === 'مرفوض'
                                ? 'bg-rose-500/20 text-rose-200'
                                : 'bg-amber-500/20 text-amber-200'
                          }`}
                        >
                          اعتماد: {row.expense.approvalStatus}
                        </span>
                        <span className="text-[10px] text-zinc-500">دفع: {row.expense.status}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-teal-300/90">
                    {row.kind === 'custody' ? row.fund.journalEntryPaymentId ?? '—' : <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="p-2 text-emerald-300/90">
                    {row.kind === 'custody' ? row.fund.journalEntrySettlementId ?? row.fund.journalEntryId ?? '—' : <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!window.confirm('حذف هذا الطلب نهائياً؟')) return;
                        if (row.kind === 'custody') hardDeleteCustodyFund(row.fund.id).then((ok) => ok && toast.success('تم الحذف'));
                        else hardDeleteExpense(row.expense.id).then((ok) => ok && toast.success('تم الحذف'));
                      }}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-300 hover:bg-rose-500/20 transition-colors"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {myFunds.length === 0 && custodyFunds.length > 0 && (
          <p className="text-[11px] text-amber-300/90 pt-1">
            يوجد عهد في النظام لكن لا يوجد ما يطابق ملفك كمدير إنتاج (تأكد أن المحاسب اختارك في العهدة، أو أن الطلب صادر من حسابك). إن استمرت المشكلة أعد تحميل الصفحة بعد تسجيل الدخول.
          </p>
        )}
        {unifiedProductionRows.length === 0 && custodyFunds.length === 0 && myProductionExpenseRows.length === 0 && (
          <p className="text-sm text-zinc-500">لا توجد طلبات بعد — أرسل طلباً من النموذج أدناه.</p>
        )}
        {unifiedProductionRows.length === 0 && (custodyFunds.length > 0 || myProductionExpenseRows.length > 0) && (
          <p className="text-sm text-zinc-500">لا توجد صفوف تطابق ملفك في هذا الجدول الموحّد.</p>
        )}
        <p className="text-[11px] text-zinc-500 pt-1">حجوزات التصوير والمعدات والاجتماعات تُدار من تبويب «الحجوزات».</p>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">
        <h4 className="font-black">طلب تمويل إنتاج (يُسجَّل كمصروف — يظهر في الجدول الموحّد)</h4>
        <p className="text-[11px] text-zinc-500">
          نفس طلب التمويل الذي تعتبره «عهدة مصروف»: يمرّ على المالك ثم المحاسب، ويظهر في الجدول أعلاه ضمن «طلب مصروف».
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="بيان الطلب" value={expenseReqForm.title} onChange={(e) => setExpenseReqForm((p) => ({ ...p, title: e.target.value }))} />
          <input type="number" min={0} className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="المبلغ" value={expenseReqForm.amount} onChange={(e) => setExpenseReqForm((p) => ({ ...p, amount: e.target.value }))} />
          <select className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" value={expenseReqForm.category} onChange={(e) => setExpenseReqForm((p) => ({ ...p, category: e.target.value as Expense['category'] }))}>
            {(['رواتب', 'إيجارات', 'معدات', 'تسويق', 'تشغيل', 'ضيافة', 'نثريات', 'أخرى'] as const).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder="مركز تكلفة" value={expenseReqForm.costCenter} onChange={(e) => setExpenseReqForm((p) => ({ ...p, costCenter: e.target.value }))} />
          <textarea className="md:col-span-2 bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm min-h-[72px]" placeholder="ملاحظة" value={expenseReqForm.note} onChange={(e) => setExpenseReqForm((p) => ({ ...p, note: e.target.value }))} />
        </div>
        <button
          type="button"
          disabled={expenseSubmitBusy}
          onClick={() => {
            void (async () => {
            if (expenseSubmitBusy) return;
            setExpenseSubmitBusy(true);
            try {
            const ok = await addExpense({
              title: expenseReqForm.title,
              category: expenseReqForm.category,
              amount: Number(expenseReqForm.amount) || 0,
              costCenter: expenseReqForm.costCenter || 'تصوير',
              status: 'قيد الانتظار',
              vendor: 'طلب مدير الإنتاج',
              note: expenseReqForm.note || undefined,
              vatRate: 0,
            });
            if (ok) {
              toast.success('تم إرسال الطلب — سيظهر في الجدول الموحّد ضمن «طلب مصروف»');
              setExpenseReqForm({ title: '', category: 'تشغيل', amount: '', costCenter: 'تصوير', note: '' });
            }
            } finally {
              setExpenseSubmitBusy(false);
            }
            })();
          }}
          className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black disabled:opacity-50 disabled:pointer-events-none"
        >
          {expenseSubmitBusy ? 'جاري الإرسال…' : 'إرسال الطلب'}
        </button>
      </div>
      <div className="space-y-4">
          {!activeRowKey && unifiedProductionRows.length > 0 && (
            <p className="text-sm text-zinc-500">اختر صفاً في الجدول أعلاه لعرض التفاصيل؛ صفوف العهدة تفتح بنود الصرف والتصفية عند توفر الحالة.</p>
          )}
          {!activeRowKey && unifiedProductionRows.length === 0 && (
            <p className="text-sm text-zinc-500">لا توجد طلبات بعد؛ أرسل من النموذج أعلاه أو انتظر أن يربطك المحاسب بعهدة أمانة.</p>
          )}
          {activeExpense && (
            <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-black">تفاصيل طلب المصروف</h4>
                <span className="inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black border border-sky-400/30 bg-sky-500/15 text-sky-200">طلب مصروف</span>
              </div>
              <p className="text-sm text-zinc-300">{activeExpense.title}</p>
              <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                <span>المبلغ: {(activeExpense.totalAmount ?? activeExpense.amount).toLocaleString()} ج.م</span>
                <span>الفئة: {activeExpense.category}</span>
                <span>مركز تكلفة: {activeExpense.costCenter || '—'}</span>
                <span>اعتماد المالك: {activeExpense.approvalStatus}</span>
                <span>حالة الدفع: {activeExpense.status}</span>
                {activeExpense.vendor && <span>المورد: {activeExpense.vendor}</span>}
              </div>
              {activeExpense.note && <p className="text-xs text-zinc-500">ملاحظة: {activeExpense.note}</p>}
              <p className="text-[11px] text-zinc-500 pt-1">
                متابعة الاعتماد والدفع من تبويب المحاسب أو «مركز الاعتمادات» عند المالك. هذا السجل محاسبياً مصروفاً وليس مسار أمانة العهدة النقدية.
              </p>
              {activeExpense.approvalStatus === 'معتمد' && (
                <div className="pt-4 mt-4 border-t border-white/10 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="font-black text-sm text-white">بنود الصرف والمرفقات (بعد اعتماد المالك)</h5>
                    <p
                      className={`text-sm font-bold ${
                        expenseSpendSum > (activeExpense.totalAmount ?? activeExpense.amount) + 0.01
                          ? 'text-rose-400'
                          : 'text-emerald-300'
                      }`}
                    >
                      المجموع: {expenseSpendSum.toLocaleString()} / {(activeExpense.totalAmount ?? activeExpense.amount).toLocaleString()} ج.م
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    سجّل ما تم صرفه فعلياً وأرفق الفواتير؛ يُحفظ مع الطلب ويظهر عند إعادة فتحه. لا يتجاوز مجموع البنود مبلغ الطلب المعتمد.
                  </p>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-white/10">
                    <table className="w-full text-right text-xs min-w-[720px]">
                      <thead className="sticky top-0 bg-[#0B1020] z-10">
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="p-2 font-black">البيان</th>
                          <th className="p-2 font-black">المبلغ</th>
                          <th className="p-2 font-black">الفئة</th>
                          <th className="p-2 font-black">مركز التكلفة</th>
                          <th className="p-2 font-black">ملاحظة</th>
                          <th className="p-2 font-black">المستندات</th>
                          <th className="p-2 font-black" />
                        </tr>
                      </thead>
                      <tbody>
                        {expenseSpendDraftLines.map((line) => (
                          <tr key={line.id} className="border-b border-white/5 align-top">
                            <td className="p-2">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="البيان"
                                value={line.title}
                                onChange={(e) => updateExpenseSpendLine(line.id, { title: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-24">
                              <input
                                type="number"
                                min={0}
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                value={line.amount || ''}
                                onChange={(e) =>
                                  updateExpenseSpendLine(line.id, { amount: Number(e.target.value) || 0 })
                                }
                              />
                            </td>
                            <td className="p-2 w-28">
                              <select
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                value={line.category}
                                onChange={(e) =>
                                  updateExpenseSpendLine(line.id, {
                                    category: e.target.value as Expense['category'],
                                  })
                                }
                              >
                                {(
                                  [
                                    'رواتب',
                                    'إيجارات',
                                    'معدات',
                                    'تسويق',
                                    'تشغيل',
                                    'ضيافة',
                                    'نثريات',
                                    'أخرى',
                                  ] as const
                                ).map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 w-28">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="مركز تكلفة"
                                value={line.costCenter}
                                onChange={(e) => updateExpenseSpendLine(line.id, { costCenter: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-32">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="ملاحظة"
                                value={line.note || ''}
                                onChange={(e) => updateExpenseSpendLine(line.id, { note: e.target.value })}
                              />
                            </td>
                            <td className="p-2 min-w-[140px]">
                              <label className="block cursor-pointer text-[11px] text-[#A99FFF] font-black underline mb-1">
                                إضافة ملف
                                <input
                                  type="file"
                                  className="sr-only"
                                  accept="image/*,.pdf,.doc,.docx"
                                  onChange={(e) =>
                                    attachToExpenseSpendLine(line.id, e.target.files?.[0] ?? null)
                                  }
                                />
                              </label>
                              <div className="space-y-1">
                                {(line.attachments ?? []).map((att) => {
                                  const href = custodyAttachmentHref(att);
                                  return (
                                    <div key={att.id} className="flex flex-wrap items-center gap-1 justify-end">
                                      {href ? (
                                        <a
                                          href={href}
                                          download={att.fileName}
                                          className="text-[10px] text-teal-300 truncate max-w-[96px]"
                                          title={att.fileName}
                                        >
                                          {att.fileName}
                                        </a>
                                      ) : (
                                        <span className="text-[10px] text-zinc-500">{att.fileName}</span>
                                      )}
                                      <button
                                        type="button"
                                        className="text-[10px] text-rose-400 font-black"
                                        onClick={() => removeExpenseSpendAttachment(line.id, att.id)}
                                      >
                                        إزالة
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="p-2 w-12">
                              <button
                                type="button"
                                onClick={() => removeExpenseSpendLine(line.id)}
                                className="text-rose-400 text-xs font-black"
                              >
                                حذف
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={addExpenseSpendLine}
                      className="px-3 py-2 rounded-xl bg-white/10 text-sm font-black"
                    >
                      + بند
                    </button>
                    <button
                      type="button"
                      disabled={
                        expenseSpendSaveBusy ||
                        expenseSpendSum > (activeExpense.totalAmount ?? activeExpense.amount) + 0.01
                      }
                      onClick={() => void saveExpenseSpendLines()}
                      className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {expenseSpendSaveBusy ? 'جاري الحفظ…' : 'حفظ البنود والمرفقات'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeFund && (
            <>
              <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-black">تفاصيل</h4>
                  <span className={custodyStatusBadgeClass(activeFund.status)}>{statusLabel[activeFund.status] || activeFund.status}</span>
                </div>
                <p className="text-sm text-zinc-300">{activeFund.description || '—'}</p>
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  <span>المبلغ: {activeFund.totalAmount.toLocaleString()} ج.م</span>
                  {activeFund.paymentMethod && <span>طريقة دفع المحاسب: {activeFund.paymentMethod}</span>}
                  {activeFund.receivedMethod && <span>طريقة الاستلام: {activeFund.receivedMethod}</span>}
                  {activeFund.journalEntryPaymentId && <span className="text-teal-300">قيد صرف: {activeFund.journalEntryPaymentId}</span>}
                  {(activeFund.journalEntrySettlementId || activeFund.journalEntryId) && (
                    <span className="text-emerald-300">قيد إقفال: {activeFund.journalEntrySettlementId || activeFund.journalEntryId}</span>
                  )}
                </div>
                {activeFund.status === 'طلب_بانتظار_المالك' && (
                  <p className="text-xs text-amber-300/90 pt-2">الطلب عند المالك للاعتماد.</p>
                )}
                {activeFund.status === 'مرفوض_طلب' && activeFund.requestRejectReason && (
                  <p className="text-xs text-rose-300/90 pt-2">سبب الرفض: {activeFund.requestRejectReason}</p>
                )}
                {activeFund.status === 'بانتظار_دفع_محاسب' && (
                  <p className="text-xs text-indigo-300/90 pt-2">المالك اعتمد — بانتظار المحاسب لتسجيل الدفع وقيد الصرف.</p>
                )}
                {activeFund.status === 'نشطة' && activeFund.settlementRejectedReason && (
                  <p className="text-xs text-rose-300/90 pt-2">آخر رفض للتسوية من المحاسب: {activeFund.settlementRejectedReason}</p>
                )}
                {activeFund.status === 'جاهزة_للاستلام' && (
                  <div className="flex flex-wrap gap-2 items-end pt-2">
                    <input
                      value={recvNote}
                      onChange={(e) => setRecvNote(e.target.value)}
                      placeholder="ملاحظة (اختياري)"
                      className="flex-1 min-w-[160px] bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await managerReceiveCustody(activeFund.id, recvNote);
                        if (ok) toast.success('تم تأكيد استلام العهدة');
                        else toast.error('تعذر التسجيل');
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black"
                    >
                      تأكيد الاستلام
                    </button>
                  </div>
                )}
              </div>

              {(activeFund.status === 'نشطة' || activeFund.status === 'جاهزة_للاستلام') && (
                <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-black">جدول بنود الصرف والتصفية</h4>
                    <div className="flex flex-col items-end gap-0.5">
                      <p className={`text-sm font-bold ${spendSum > activeFund.totalAmount + 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
                        المجموع: {spendSum.toLocaleString()} / {activeFund.totalAmount.toLocaleString()} ج.م
                      </p>
                      {spendSum > activeFund.totalAmount + 0.01 && (
                        <span className="text-[10px] font-black text-amber-300/90">
                          زيادة {(spendSum - activeFund.totalAmount).toLocaleString()} ج.م ← دائن مستحقات موظف (2100)
                        </span>
                      )}
                      {activeFund.totalAmount > spendSum + 0.01 && (
                        <span className="text-[10px] font-black text-sky-300/90">
                          متبقي {(activeFund.totalAmount - spendSum).toLocaleString()} ج.م ← مدين صندوق إرجاع (1010)
                        </span>
                      )}
                    </div>
                  </div>
                  {activeFund.status === 'جاهزة_للاستلام' && (
                    <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/[0.07] px-3 py-2 text-[11px] text-cyan-100/95 leading-relaxed">
                      المحاسب سجّل الدفع — يمكنك الآن إدخال بيانات الصرف وإرفاق الفواتير ثم «حفظ البنود». زر «إرسال التسوية للمحاسب» يُفعّل بعد «تأكيد الاستلام» في الأعلى.
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">
                    لو الصرف أكثر من العهدة يُسجّل الفرق دائناً (ح/ 2100 مستحقات للموظف)؛ لو أقل يُردّ الباقي مديناً للصندوق ح/ 1010 — كلاهما تلقائي عند اعتماد المحاسب.
                  </p>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-white/10">
                    <table className="w-full text-right text-xs min-w-[720px]">
                      <thead className="sticky top-0 bg-[#0B1020] z-10">
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="p-2 font-black">البيان</th>
                          <th className="p-2 font-black">المبلغ</th>
                          <th className="p-2 font-black">الفئة</th>
                          <th className="p-2 font-black">مركز التكلفة</th>
                          <th className="p-2 font-black">ملاحظة</th>
                          <th className="p-2 font-black">المستندات</th>
                          <th className="p-2 font-black" />
                        </tr>
                      </thead>
                      <tbody>
                        {draftLines.map((line) => (
                          <tr key={line.id} className="border-b border-white/5 align-top">
                            <td className="p-2">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="البيان"
                                value={line.title}
                                onChange={(e) => updateLine(line.id, { title: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-24">
                              <input
                                type="number"
                                min={0}
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                value={line.amount || ''}
                                onChange={(e) => updateLine(line.id, { amount: Number(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2 w-28">
                              <select
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                value={line.category}
                                onChange={(e) => updateLine(line.id, { category: e.target.value as Expense['category'] })}
                              >
                                {(['رواتب', 'إيجارات', 'معدات', 'تسويق', 'تشغيل', 'ضيافة', 'نثريات', 'أخرى'] as const).map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 w-28">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="مركز تكلفة"
                                value={line.costCenter}
                                onChange={(e) => updateLine(line.id, { costCenter: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-32">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder="ملاحظة"
                                value={line.note || ''}
                                onChange={(e) => updateLine(line.id, { note: e.target.value })}
                              />
                            </td>
                            <td className="p-2 min-w-[140px]">
                              <label className="block cursor-pointer text-[11px] text-[#A99FFF] font-black underline mb-1">
                                إضافة ملف
                                <input type="file" className="sr-only" accept="image/*,.pdf,.doc,.docx" onChange={(e) => attachToLine(line.id, e.target.files?.[0] ?? null)} />
                              </label>
                              <div className="space-y-1">
                                {(line.attachments ?? []).map((att) => {
                                  const href = custodyAttachmentHref(att);
                                  return (
                                    <div key={att.id} className="flex flex-wrap items-center gap-1 justify-end">
                                      {href ? (
                                        <a href={href} download={att.fileName} className="text-[10px] text-teal-300 truncate max-w-[96px]" title={att.fileName}>
                                          {att.fileName}
                                        </a>
                                      ) : (
                                        <span className="text-[10px] text-zinc-500">{att.fileName}</span>
                                      )}
                                      <button type="button" className="text-[10px] text-rose-400 font-black" onClick={() => removeAttachmentFromLine(line.id, att.id)}>إزالة</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="p-2 w-12">
                              <button type="button" onClick={() => removeLine(line.id)} className="text-rose-400 text-xs font-black">حذف</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={addLine} className="px-3 py-2 rounded-xl bg-white/10 text-sm font-black">
                      + بند
                    </button>
                    <button type="button" onClick={saveLinesOnly} className="px-3 py-2 rounded-xl bg-white/10 text-sm font-black">
                      حفظ البنود
                    </button>
                    <button
                      type="button"
                      onClick={submitSettlement}
                      disabled={activeFund.status !== 'نشطة'}
                      className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      إرسال التسوية للمحاسب
                    </button>
                  </div>
                  {activeFund.status === 'جاهزة_للاستلام' && (
                    <p className="text-[11px] text-zinc-500">إرسال التسوية متاح بعد تأكيد استلام العهدة (الحالة تصبح «نشطة»).</p>
                  )}
                </div>
              )}

              {activeFund.status === 'تسوية_بانتظار_محاسب' && (
                <p className="text-sm text-amber-300/90">التسوية عند المحاسب لترحيل قيد الإقفال وإغلاق أمانة العهدة (1150).</p>
              )}
              {activeFund.status === 'مقفلة' && (
                <p className="text-sm text-emerald-300/90">تم إقفال العهدة{activeFund.journalEntrySettlementId || activeFund.journalEntryId ? ` — قيد الإقفال ${activeFund.journalEntrySettlementId || activeFund.journalEntryId}` : ''}.</p>
              )}
            </>
          )}
      </div>
      </>}
    </div>
  );
};

const SeoModuleHub = () => {
  const [seoTab, setSeoTab] = useState<'overview' | 'audit' | 'keywords' | 'content' | 'rankings' | 'backlinks' | 'reports'>('overview');
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'audit', label: 'Audit' },
    { id: 'keywords', label: 'Keywords' },
    { id: 'content', label: 'Content' },
    { id: 'rankings', label: 'Rankings' },
    { id: 'backlinks', label: 'Backlinks' },
    { id: 'reports', label: 'Reports' },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-2 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSeoTab(tab.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              seoTab === tab.id
                ? 'bg-[#7C6BFF] text-white'
                : 'bg-[#0F1528] border border-white/10 text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="rounded-2xl overflow-hidden border border-white/10">
        {seoTab === 'overview' && <SeoOverviewPage />}
        {seoTab === 'audit' && <SeoAuditPage />}
        {seoTab === 'keywords' && <SeoKeywordsPage />}
        {seoTab === 'content' && <SeoContentPage />}
        {seoTab === 'rankings' && <SeoRankingsPage />}
        {seoTab === 'backlinks' && <SeoBacklinksPage />}
        {seoTab === 'reports' && <SeoReportsPage />}
      </div>
    </div>
  );
};

const ROLE_TAB_ACCESS: Record<User['role'], string[]> = {
  'مالك': ['home', 'approvals', 'owner-dash', 'team-performance', 'leads', 'accountant', 'settings', 'bookings', 'linked-views', 'seo'],
  'مدير مبيعات': ['home', 'dashboard', 'leads', 'team-performance', 'bookings', 'manager-reps', 'linked-views'],
  'مندوب': ['home', 'dashboard', 'leads', 'performance', 'bookings', 'linked-views'],
  'محاسب': ['home', 'accountant', 'leads', 'bookings', 'linked-views'],
  'مدير إنتاج': ['home', 'production', 'bookings', 'leads', 'linked-views'],
};

const NavItems = ({ role, active, onChange, allowedTabs }: any) => {
  const common = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'leads', label: 'الليدز المتاحة', icon: Users },
  ];

  const manager = [
    ...common,
    { id: 'manager-reps', label: 'فريق المبيعات', icon: UserPlus },
    { id: 'bookings', label: 'الحجوزات', icon: Calendar },
    { id: 'team-performance', label: 'مراقبة المناديب', icon: BarChart3 },
    { id: 'linked-views', label: 'عروض البيانات', icon: Layers },
  ];

  const owner = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'approvals', label: 'مركز الاعتمادات', icon: ShieldCheck },
    { id: 'owner-dash', label: 'نظرة عامة', icon: LayoutDashboard },
    { id: 'bookings', label: 'الحجوزات', icon: Calendar },
    { id: 'team-performance', label: 'مراقبة الفريق', icon: BarChart3 },
    { id: 'leads', label: 'كافة الليدز', icon: Users },
    { id: 'accountant', label: 'الإدارة المالية', icon: Receipt },
    { id: 'settings', label: 'إعدادات النظام', icon: Settings },
    { id: 'linked-views', label: 'عروض البيانات', icon: Layers },
    { id: 'seo', label: 'SEO Intelligence', icon: TrendingUp },
  ];

  const accountant = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'accountant', label: 'الفواتير', icon: Receipt },
    { id: 'bookings', label: 'الحجوزات', icon: Calendar },
    { id: 'leads', label: 'العملاء', icon: Users },
    { id: 'linked-views', label: 'عروض البيانات', icon: Layers },
  ];

  const productionManager = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'production', label: 'تمويل الإنتاج', icon: Briefcase },
    { id: 'bookings', label: 'الحجوزات', icon: Calendar },
    { id: 'leads', label: 'العملاء', icon: Users },
  ];

  const rep = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'dashboard', label: 'مهامي', icon: Clock },
    { id: 'bookings', label: 'الحجوزات', icon: Calendar },
    { id: 'leads', label: 'عملائي', icon: Users },
    { id: 'performance', label: 'أدائي', icon: Trophy },
    { id: 'linked-views', label: 'عروض البيانات', icon: Layers },
  ];

  const items = (role === 'مالك' ? owner : role === 'مدير مبيعات' ? manager : role === 'محاسب' ? accountant : role === 'مدير إنتاج' ? productionManager : rep)
    .filter((item) => allowedTabs.includes(item.id));

  return (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={`premium-nav-item w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all font-bold ${
            active === item.id 
              ? 'premium-nav-active bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/30' 
              : 'text-zinc-400 hover:bg-white/5 hover:text-white'
          }`}
        >
          <item.icon className="w-5 h-5" />
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
};

/** عناوين التبويبات لشريط الجوال (الشريط الجانبي مخفي تحت lg بدون بديل سابقاً) */
const TAB_TITLE_AR: Record<string, string> = {
  home: 'الرئيسية',
  dashboard: 'لوحة التحكم',
  approvals: 'مركز الاعتمادات',
  'owner-dash': 'نظرة عامة',
  bookings: 'الحجوزات',
  'team-performance': 'مراقبة الفريق',
  leads: 'الليدز',
  accountant: 'الإدارة المالية',
  settings: 'إعدادات النظام',
  seo: 'SEO',
  production: 'تمويل الإنتاج',
  'manager-reps': 'فريق المبيعات',
  performance: 'أدائي',
  'linked-views': 'عروض البيانات',
};

const WelcomeGate = ({ onUnlock }: { onUnlock: () => void }) => {
  const [tapCount, setTapCount] = useState(0);

  const onSecretTap = () => {
    const n = tapCount + 1;
    setTapCount(n);
    if (n >= 4) {
      onUnlock();
    }
  };

  return (
    <div className="min-h-screen bg-[#080B13] font-['Cairo'] flex flex-col items-center justify-center p-8 relative overflow-hidden" dir="rtl">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full bg-rose-500/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-15%] w-[50%] h-[50%] rounded-full bg-[#7C6BFF]/12 blur-[100px]" />
      </div>
      <div className="relative z-10 flex flex-col items-center text-center max-w-lg">
        <p className="text-[11px] font-black uppercase tracking-[0.45em] text-zinc-500 mb-6">welcome</p>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-white tracking-tight mb-2">
          untold<span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-300 to-[#A99FFF]">stories</span>
        </h1>
        <p className="text-zinc-500 text-sm font-bold mb-10">Untold Stories</p>
        {/* منطقة ضغط سرية: لا إطار، لا وميض، شبه مختفية — المعرف فقط يعلم المكان */}
        <button
          type="button"
          onClick={onSecretTap}
          className="relative mt-6 flex h-[3.25rem] w-[3.25rem] shrink-0 cursor-default items-center justify-center rounded-full border-0 bg-transparent p-0 text-inherit shadow-none outline-none ring-0 focus:outline-none focus-visible:ring-0 active:opacity-100"
          aria-hidden
          tabIndex={-1}
        >
          <span
            className="pointer-events-none select-none text-[1.05rem] leading-none opacity-[0.14] grayscale saturate-50"
            role="presentation"
          >
            😄
          </span>
        </button>
        <button
          type="button"
          onClick={onUnlock}
          className="mt-10 text-sm font-bold text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white"
        >
          المتابعة إلى تسجيل الدخول
        </button>
      </div>
    </div>
  );
};

/** ترجمة أخطاء Supabase Auth الشائعة عند تسجيل الدخول (بدل رسائل إنجليزية خام). */
function mapSupabaseAuthErrorForLogin(raw: string): string {
  const r = String(raw || '').trim();
  if (!r) return 'فشل تسجيل الدخول';
  const low = r.toLowerCase();
  if (
    low.includes('rate limit') ||
    low.includes('too many requests') ||
    low.includes('over_request_rate') ||
    low.includes('email rate limit') ||
    low.includes('429')
  ) {
    return 'Supabase وقف الطلبات مؤقتاً (محاولات دخول أو إرسال بريد كثيرة). انتظر 2–5 دقائق ثم حاول مرة أخرى، أو جرّب نافذة تصفح خاص (Private).';
  }
  if (low.includes('email not confirmed') || low.includes('not confirmed')) {
    return 'الحساب موجود لكن البريد غير مؤكد في Supabase. من لوحة التحكم: Authentication → Users → اختر المستخدم وفعّل «Confirm user»، أو عطّل «Confirm email» من إعدادات مزود البريد في التطوير.';
  }
  if (
    low.includes('invalid login') ||
    low.includes('invalid credentials') ||
    low.includes('invalid grant') ||
    low.includes('wrong password')
  ) {
    return 'البريد أو كلمة المرور غير صحيحة. لو غيّرت كلمة المرور من لوحة Supabase، استخدم الجديدة؛ ولو نسيتها استخدم «Reset password» من نفس اللوحة.';
  }
  if (low.includes('user not found') || low.includes('no user')) {
    return 'لا يوجد حساب بهذا البريد في Supabase Authentication. أضف المستخدم من Authentication → Users بنفس البريد الموجود في جدول الموظفين.';
  }
  return r;
}

const LoginPage = () => {
  const { setCurrentUser, addAuditEvent } = useData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabaseMode = isSupabaseDirectMode();
  const dashAuthUsersUrl = supabaseMode ? getSupabaseDashboardAuthUsersUrl() : null;
  const dashEditorUrl = supabaseMode ? getSupabaseDashboardEditorUrl() : null;
  const dashSqlUrl = supabaseMode ? getSupabaseDashboardSqlUrl() : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isSupabaseDirectMode()) {
        const sb = getSupabase();
        const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (authErr || !authData.user?.email) {
          const raw = authErr?.message || '';
          setError(mapSupabaseAuthErrorForLogin(raw));
          return;
        }
        const em = authData.user.email.trim().toLowerCase();
        const { data: profile, error: profErr } = await sb
          .from('users')
          .select('id,email,name,role,avatar,base_salary,skills_json,stats_json,created_at,updated_at')
          .eq('email', em)
          .maybeSingle();
        if (profErr || !profile) {
          await sb.auth.signOut();
          const editor = getSupabaseDashboardEditorUrl();
          setError(
            `الدخول لـ Supabase نجح، لكن مفيش صف في جدول «الموظفين» (public.users) بنفس البريد، أو الـ RLS رفض القراءة.\n\n` +
              `اعمل واحدة من دول:\n` +
              `• من Table Editor: جدول users → تأكد إن فيه صف بالإيميل ده.\n` +
              `• أو نفّذ سكربت الإعداد لو ما عملتش (ملف supabase/sql/SUPABASE_SETUP_COPYPASTE.sql).` +
              (editor ? `\n\nرابط الجداول: ${editor}` : ''),
          );
          return;
        }
        localStorage.setItem('prod_system_supabase', '1');
        try {
          window.sessionStorage.removeItem('prod_system_force_logout_next');
        } catch {
          /* ignore */
        }
        const user = mapUserFromRow(profile as Record<string, unknown>);
        setCurrentUser(user);
        addAuditEvent({
          action: 'تسجيل دخول',
          entityType: 'system',
          details: `${user.name} (${user.role})`,
        });
        toast.success(`أهلاً بك يا ${user.name}`);
        return;
      }

      const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'فشل تسجيل الدخول');
        return;
      }
      if (!data?.token || !data?.user) {
        setError('استجابة غير صحيحة من الخادم');
        return;
      }
      localStorage.setItem('prod_system_jwt', data.token);
      try {
        window.sessionStorage.removeItem('prod_system_force_logout_next');
      } catch {
        /* ignore */
      }
      const user = normalizeUserFromApi(data.user as Record<string, unknown>);
      setCurrentUser(user);
      addAuditEvent({
        action: 'تسجيل دخول',
        entityType: 'system',
        details: `${user.name} (${user.role})`,
      });
      toast.success(`أهلاً بك يا ${user.name}`);
    } catch {
      if (isSupabaseDirectMode()) {
        setError('تعذر الاتصال بـ Supabase. تأكد من VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.local');
      } else {
        setError('تعذر الاتصال بالخادم. تأكد أن الباك اند يعمل على ' + getApiBaseUrl());
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="system-theme premium-login-shell cinematic-production min-h-screen bg-[#080B13] grid place-items-center p-6 font-['Cairo'] relative overflow-hidden" dir="rtl">
      <div className="premium-login-orb premium-login-orb-a absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-[#7C6BFF]/20 blur-[150px] rounded-full" />
      <div className="premium-login-orb premium-login-orb-b absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-indigo-500/10 blur-[150px] rounded-full" />

      <div
        className={`premium-login-card w-full mx-auto bg-white/[0.04] backdrop-blur-2xl border border-white/10 p-10 rounded-[2.5rem] shadow-2xl relative z-10 ${supabaseMode ? 'max-w-lg' : 'max-w-md'}`}
      >
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-black mx-auto rounded-3xl flex items-center justify-center shadow-2xl shadow-black/40 mb-6 overflow-hidden border border-white/10">
            <img src={SYSTEM_LOGO} alt={SYSTEM_NAME} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-black text-white mb-2">{SYSTEM_NAME}</h1>
          <p className="text-zinc-400 font-bold text-xs">
            {supabaseMode
              ? 'تسجيل الدخول عبر Supabase (مستخدم Authentication + صف في جدول الموظفين)'
              : 'تسجيل الدخول — عبر خادم التطبيق'}
          </p>
        </div>


        <form onSubmit={handleSubmit} className="space-y-4 text-right">
          <div>
            <label className="block text-xs font-black text-zinc-500 mb-1">البريد الإلكتروني</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="w-full rounded-2xl bg-[#0F1528] border border-white/10 px-4 py-3 text-white placeholder:text-zinc-600 focus:border-[#7C6BFF]/50 outline-none"
              placeholder="you@company.com"
              disabled={loading}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-black text-zinc-500 mb-1">كلمة المرور</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="w-full rounded-2xl bg-[#0F1528] border border-white/10 px-4 py-3 text-white placeholder:text-zinc-600 focus:border-[#7C6BFF]/50 outline-none"
              placeholder="••••••••"
              disabled={loading}
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-red-400 font-bold whitespace-pre-line break-words">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[#7C6BFF] hover:bg-[#6B5CE6] text-white font-black py-3.5 transition-colors disabled:opacity-50"
          >
            {loading ? 'جاري الدخول…' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
};

/** يطابق حقول User بعد استجابة /auth/login */
function normalizeUserFromApi(raw: Record<string, unknown>): User {
  const role = String(raw?.role || '').trim();
  const allowed: User['role'][] = ['مالك', 'مدير مبيعات', 'مندوب', 'محاسب', 'مدير إنتاج'];
  const r = (allowed as string[]).includes(role) ? (role as User['role']) : 'مندوب';
  const skills = Array.isArray(raw?.skills) ? (raw.skills as User['skills']) : [];
  const statsRaw = raw?.stats && typeof raw.stats === 'object' ? (raw.stats as Record<string, unknown>) : {};
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || 'موظف'),
    role: r,
    email: typeof raw?.email === 'string' ? raw.email : undefined,
    authSource: 'database',
    avatar:
      typeof raw?.avatar === 'string' && raw.avatar
        ? raw.avatar
        : 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    skills,
    baseSalary: typeof raw?.baseSalary === 'number' ? raw.baseSalary : undefined,
    stats: {
      dealsWon: Number(statsRaw.dealsWon) || 0,
      points: Number(statsRaw.points) || 0,
      avgResponseTime: typeof statsRaw.avgResponseTime === 'string' ? statsRaw.avgResponseTime : '0 min',
      revenue: typeof statsRaw.revenue === 'number' ? statsRaw.revenue : undefined,
    },
  };
}

const Root = () => {
  const {
    currentUser,
    logout,
    getSystemNotifications,
    refreshServerWorkspace,
    leads,
    invoices,
    expenses,
    users,
    shootBookings,
    equipmentBookings,
    meetingBookings,
    updateShootBookingStatus,
    updateEquipmentBookingStatus,
    updateMeetingBookingStatus,
    approveExpense,
    rejectExpense,
    priceQuotes,
    approvePriceQuote,
    rejectPriceQuote,
    custodyFunds,
    ownerApproveCustodyRequest,
    ownerRejectCustodyRequest,
    completeIntegrationConnect,
    markIntegrationError,
    syncExternalLeads,
    leadIngestionSettings,
    integrations,
    entityComments,
    setEntityComments,
    personalTodos,
    setPersonalTodos,
    uiVisualMode,
    setUiVisualMode,
    desktopNotifyWhenVisible,
    setDesktopNotifyWhenVisible,
  } = useData();
  const [activeTab, setActiveTab] = useState('home');
  const [tabHistory, setTabHistory] = useState<string[]>([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationsPanelSyncing, setNotificationsPanelSyncing] = useState(false);
  const notificationsBackgroundSyncAt = useRef(0);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [todoInput, setTodoInput] = useState('');
  /** تاريخ/وقت منفصلان — أوثق من datetime-local على ويندوز والوضع الداكن */
  const [todoDueDate, setTodoDueDate] = useState('');
  const [todoDueTime, setTodoDueTime] = useState('');
  const [personalTodoDueAlarm, setPersonalTodoDueAlarm] = useState<PersonalTodo[] | null>(null);
  const desktopNotifyWhenVisibleRef = useRef(desktopNotifyWhenVisible);
  useEffect(() => {
    desktopNotifyWhenVisibleRef.current = desktopNotifyWhenVisible;
  }, [desktopNotifyWhenVisible]);

  useEffect(() => {
    if (!personalTodoDueAlarm?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPersonalTodoDueAlarm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [personalTodoDueAlarm]);

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const parallaxFrameRef = useRef<number | null>(null);
  const notificationsAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [notificationsPanelPos, setNotificationsPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  /** بدون تخزين افتراضي: F5 يعيد شاشة الترحيب. بعد خروج صريح نضع وسماً للمرور مباشرة لشاشة الدخول. */
  const [welcomeUnlocked, setWelcomeUnlocked] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      if (window.sessionStorage.getItem('prod_system_skip_welcome_next_load') === '1') {
        window.sessionStorage.removeItem('prod_system_skip_welcome_next_load');
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const completeWelcomeGate = () => setWelcomeUnlocked(true);

  // عند تبديل الحساب فقط: إعادة التبويب للرئيسية. لا تربط بمرجع currentUser كامل —
  // وإلا كل استدعاء setCurrentUser (مثل اكتمال /auth/me بعد التخزين المحلي) يصفّر التبويب
  // فيبقى المستخدم عالقاً على الرئيسية وكأن الليدز/الخروج لا يعملان.
  useEffect(() => {
    setActiveTab('home');
    setTabHistory([]);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    const allowedTabs = ROLE_TAB_ACCESS[currentUser.role] || [];
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] || 'dashboard');
    }
  }, [currentUser, activeTab]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'مالك') return;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration_provider') as IntegrationProvider | null;
    const status = params.get('integration_status');
    if (!provider || !status) return;
    const providers: IntegrationProvider[] = ['facebook', 'instagram', 'google_ads', 'whatsapp', 'linkedin'];
    if (!providers.includes(provider)) return;
    if (status === 'success') {
      const account = params.get('integration_account') || undefined;
      const expiresAt = params.get('integration_expires_at') || undefined;
      completeIntegrationConnect(provider, { accountLabel: account, tokenExpiresAt: expiresAt });
      toast.success(`تم ربط ${provider} بنجاح — جاري جلب الليدز تلقائياً`);
      const pullChannel: Partial<Record<IntegrationProvider, ExternalLeadChannel>> = {
        facebook: 'facebook',
        instagram: 'facebook',
        google_ads: 'google',
        linkedin: 'linkedin',
      };
      const ch = pullChannel[provider];
      if (ch) {
        void (async () => {
          const n = await syncExternalLeads(ch, 15);
          if (n > 0) {
            toast.success(`تم إضافة ${n} ليد. افتح «الليدز» وستجد عمود المصدر يوضح القناة وحساب الربط.`);
          }
        })();
      }
    } else {
      const error = params.get('integration_error') || 'OAuth failed';
      markIntegrationError(provider, error);
      toast.error(`فشل ربط ${provider}`);
    }
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }, [currentUser, completeIntegrationConnect, markIntegrationError, syncExternalLeads]);

  /** مزامنة تلقائية للمالك: كل قناة مفعّل لها «المزامنة التلقائية» ومربوطة */
  useEffect(() => {
    if (!isServerDataMode()) return;
    if (!currentUser || currentUser.role !== 'مالك') return;
    const everyMs = 15 * 60 * 1000;
    const run = () => {
      void (async () => {
        const channels: ExternalLeadChannel[] = ['facebook', 'google', 'linkedin', 'email'];
        for (const ch of channels) {
          const cfg = leadIngestionSettings[ch];
          const oauthLinked =
            ch === 'facebook'
              ? integrations.some((i) => (i.provider === 'facebook' || i.provider === 'instagram') && i.connected)
              : ch === 'linkedin'
                ? integrations.some((i) => i.provider === 'linkedin' && i.connected)
                : ch === 'google'
                  ? integrations.some((i) => i.provider === 'google_ads' && i.connected)
                  : false;
          if (!cfg?.autoSync) continue;
          if (!cfg.connected && !oauthLinked) continue;
          await syncExternalLeads(ch, 6);
        }
      })();
    };
    const t0 = setTimeout(run, 90_000);
    const id = setInterval(run, everyMs);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  }, [currentUser?.id, currentUser?.role, leadIngestionSettings, integrations, syncExternalLeads]);

  const currentRole: User['role'] = currentUser?.role || 'مندوب';
  const currentUserId = currentUser?.id || '';
  const allowedTabs = ROLE_TAB_ACCESS[currentRole] || [];
  const handleTabChange = (tabId: string) => {
    if (!allowedTabs.includes(tabId)) {
      toast.error('ليس لديك صلاحية الوصول لهذه الصفحة');
      return;
    }
    setIsSidebarOpen(false);
    if (tabId === activeTab) return;
    setTabHistory(prev => {
      const last = prev[prev.length - 1];
      if (last === activeTab) return prev;
      return [...prev, activeTab].slice(-20);
    });
    setActiveTab(tabId);
  };
  const openFirstAllowedTab = (preferredTabs: string[], notAvailableMessage: string) => {
    const tab = preferredTabs.find((t) => allowedTabs.includes(t));
    if (!tab) {
      toast.info(notAvailableMessage);
      return;
    }
    handleTabChange(tab);
  };
  const openBookingsWithIntent = (quickFilter: BookingQuickFilter, notAvailableMessage: string) => {
    if (!allowedTabs.includes('bookings')) {
      toast.info(notAvailableMessage);
      return;
    }
    localStorage.setItem(BOOKING_INTENT_KEY, JSON.stringify({ tab: 'bookings', bookingQuickFilter: quickFilter }));
    window.dispatchEvent(new Event('booking-intent'));
    handleTabChange('bookings');
  };
  const handleHomeDataHealthClick = (key: 'leads-unassigned' | 'pending-approvals' | 'invoices-no-cc') => {
    if (key === 'leads-unassigned') {
      openFirstAllowedTab(['leads'], 'لا توجد صفحة متاحة لعرض الليدز في صلاحياتك الحالية');
      return;
    }
    if (key === 'pending-approvals') {
      if (currentRole === 'محاسب') {
        openAccountantSubTab('expenses', 'لا توجد صفحة متاحة لعرض الطلبات المنتظرة في صلاحياتك الحالية', { expenseQuickFilter: 'pending_approval' });
        return;
      }
      openFirstAllowedTab(
        ['approvals', 'bookings', 'accountant'],
        'لا توجد صفحة متاحة لعرض الطلبات المنتظرة في صلاحياتك الحالية'
      );
      return;
    }
    openAccountantSubTab('invoices', 'لا توجد صفحة متاحة لعرض الفواتير في صلاحياتك الحالية', { invoiceQuickFilter: 'missing_cost_center' });
  };
  const handleTodayFocusClick = (key: 'overdue-followups' | 'pending-approvals' | 'today-meetings') => {
    if (key === 'overdue-followups') {
      const intent: { tab: 'leads'; leadsAssignedFilter?: 'all' | 'mine' | 'unassigned'; leadsStatusFilter?: 'الكل' | LeadStatus; leadsOverdueOnly?: boolean; leadsRepUserId?: string; leadsClient360Id?: string } = {
        tab: 'leads',
        leadsOverdueOnly: true,
      };
      localStorage.setItem(NAV_INTENT_KEY, JSON.stringify(intent));
      openFirstAllowedTab(['leads'], 'لا توجد صفحة متاحة لعرض المتابعات المتأخرة في صلاحياتك الحالية');
      return;
    }
    if (key === 'pending-approvals') {
      openFirstAllowedTab(
        ['approvals', 'bookings', 'accountant'],
        'لا توجد صفحة متاحة لعرض الطلبات المنتظرة في صلاحياتك الحالية'
      );
      return;
    }
    openBookingsWithIntent('today', 'لا توجد صفحة متاحة لعرض اجتماعات اليوم في صلاحياتك الحالية');
  };
  const openAccountantSubTab = (
    financeTab: 'invoices' | 'expenses' | 'ledger' | 'reports' | 'coa' | 'journals' | 'reps' | 'codebook' | 'custody',
    notAvailableMessage: string,
    quick?: { invoiceQuickFilter?: InvoiceQuickFilter; expenseQuickFilter?: ExpenseQuickFilter }
  ) => {
    if (!allowedTabs.includes('accountant')) {
      toast.info(notAvailableMessage);
      return;
    }
    localStorage.setItem(FINANCE_INTENT_KEY, JSON.stringify({ tab: 'accountant', financeTab, ...quick }));
    window.dispatchEvent(new Event('finance-intent'));
    handleTabChange('accountant');
  };
  const handleGoBackTab = () => {
    const previous = tabHistory[tabHistory.length - 1];
    if (!previous) {
      toast.info('لا توجد صفحة سابقة');
      return;
    }
    if (!allowedTabs.includes(previous)) {
      setTabHistory(prev => prev.slice(0, -1));
      toast.info('الصفحة السابقة غير متاحة بصلاحياتك الحالية');
      return;
    }
    setTabHistory(prev => prev.slice(0, -1));
    setActiveTab(previous);
  };

  const personalTodoBellNotifications = useMemo((): SystemNotification[] => {
    if (!currentUserId) return [];
    const nowMs = Date.now();
    return personalTodos
      .filter((t) => !t.done && t.dueAt)
      .map((t) => {
        const due = new Date(t.dueAt!).getTime();
        if (!Number.isFinite(due) || due <= nowMs) return null;
        const minutesLeft = Math.ceil((due - nowMs) / 60000);
        if (minutesLeft > 60) return null;
        return {
          id: `bell-personal-todo-${t.id}`,
          level: 'medium' as const,
          title: 'مهمة شخصية قريبة',
          message: `«${t.text}» — الموعد خلال حوالي ${minutesLeft} دقيقة`,
          createdAt: new Date().toISOString(),
          targetUserId: currentUserId,
          entityType: 'system' as const,
          navigateTab: 'home',
        } as SystemNotification;
      })
      .filter((x): x is SystemNotification => x !== null);
  }, [personalTodos, currentUserId]);

  const notifications = useMemo(() => {
    try {
      const base = getSystemNotifications().filter(
        n =>
          (!n.targetRoles || n.targetRoles.includes(currentRole)) &&
          (!n.targetUserId || n.targetUserId === currentUserId)
      );
      const seen = new Set(base.map((n) => n.id));
      return [...base, ...personalTodoBellNotifications.filter((n) => !seen.has(n.id))];
    } catch {
      return personalTodoBellNotifications;
    }
  }, [getSystemNotifications, currentRole, currentUserId, personalTodoBellNotifications]);
  const criticalNotifications = useMemo(
    () => notifications.filter((n: any) => (n.priority || (n.level === 'high' ? 'critical' : 'normal')) === 'critical'),
    [notifications]
  );
  const normalNotifications = useMemo(
    () => notifications.filter((n: any) => (n.priority || (n.level === 'high' ? 'critical' : 'normal')) !== 'critical'),
    [notifications]
  );

  useEffect(() => {
    if (!isServerDataMode()) return;
    if (!currentUser || currentUser.authSource !== 'database') return;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      const t = Date.now();
      if (t - notificationsBackgroundSyncAt.current < 60_000) return;
      notificationsBackgroundSyncAt.current = t;
      void refreshServerWorkspace();
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [currentUser?.id, currentUser?.authSource, refreshServerWorkspace]);

  const resolveNotificationTab = (n: { navigateTab?: string; entityType?: string; title?: string; message?: string }) => {
    if (n.navigateTab && allowedTabs.includes(n.navigateTab)) return n.navigateTab;
    const text = `${n.title || ''} ${n.message || ''}`;
    let candidates: string[] = [];
    if (n.entityType === 'lead') candidates = ['leads', 'approvals', 'home'];
    else if (n.entityType === 'invoice') candidates = ['accountant', 'approvals', 'home'];
    else if (n.entityType === 'user') candidates = ['team-performance', 'manager-reps', 'settings', 'home'];
    else if (/عهد|اعتماد|موافقة|بانتظار|طلب/i.test(text)) candidates = ['approvals', 'accountant', 'production', 'bookings', 'home'];
    else candidates = ['home', 'approvals', 'accountant', 'leads', 'bookings'];
    return candidates.find((t) => allowedTabs.includes(t));
  };
  const resolveFinanceSubTab = (n: { entityType?: string; title?: string; message?: string }) => {
    const text = `${n.title || ''} ${n.message || ''}`;
    if (/مرتبات|حضور|انصراف|موظفين/i.test(text)) return 'reps' as const;
    if (/عهد|تسوية|أمانة/i.test(text)) return 'custody' as const;
    if (/مصروف|مصروفات|مورد/i.test(text)) return 'expenses' as const;
    if (/قيد|قيود|يومية|دفتر/i.test(text)) return 'journals' as const;
    if (n.entityType === 'invoice' || /فاتور|قسط|أقساط|تحصيل|ذمم/i.test(text)) return 'invoices' as const;
    return 'invoices' as const;
  };
  const handleNotificationClick = (n: { navigateTab?: string; entityType?: string; title?: string; message?: string }) => {
    const tab = resolveNotificationTab(n);
    if (!tab) {
      toast.info('لا يوجد تبويب متاح لهذا التنبيه ضمن صلاحياتك');
      return;
    }
    if (tab === 'leads') {
      const text = `${n.title || ''} ${n.message || ''}`;
      const intent: { tab: 'leads'; leadsAssignedFilter?: 'all' | 'mine' | 'unassigned'; leadsStatusFilter?: 'الكل' | LeadStatus; leadsOverdueOnly?: boolean; leadsRepUserId?: string; leadsClient360Id?: string } = { tab: 'leads' };
      if (/غير\s*مسند|غير\s*موزع|تنتظر\s*توزيع|بدون\s*تعيين/i.test(text)) {
        intent.leadsAssignedFilter = 'unassigned';
        intent.leadsStatusFilter = 'جديد';
      }
      if (/متأخر|متأخرة|تصعيد|بدون\s*متابعة|overdue/i.test(text)) {
        intent.leadsOverdueOnly = true;
      }
      localStorage.setItem(NAV_INTENT_KEY, JSON.stringify(intent));
    }
    if (tab === 'accountant') {
      const financeTab = resolveFinanceSubTab(n);
      const text = `${n.title || ''} ${n.message || ''}`;
      const quick: { invoiceQuickFilter?: InvoiceQuickFilter; expenseQuickFilter?: ExpenseQuickFilter } = {};
      if (/أقساط\s*متأخرة|متأخر.*قسط|overdue/i.test(text)) quick.invoiceQuickFilter = 'overdue_installments';
      else if (/تستحق\s*اليوم|مستحقة\s*اليوم/i.test(text)) quick.invoiceQuickFilter = 'due_today_installments';
      else if (/بدون\s*مركز\s*تكلفة/i.test(text)) quick.invoiceQuickFilter = 'missing_cost_center';
      if (/مصروفات\s*بانتظار\s*الاعتماد|تحتاج\s*اعتماد/i.test(text)) quick.expenseQuickFilter = 'pending_approval';
      localStorage.setItem(FINANCE_INTENT_KEY, JSON.stringify({ tab: 'accountant', financeTab, ...quick }));
      window.dispatchEvent(new Event('finance-intent'));
    }
    if (tab === 'bookings') {
      const text = `${n.title || ''} ${n.message || ''}`;
      let quick: BookingQuickFilter = 'all';
      if (/مطالبات\s*مالية|بانتظار\s*تنفيذ\s*محاسب/i.test(text)) quick = 'financial_claims_pending_execution';
      else if (/بانتظار\s*اعتماد|قيد\s*المراجعة|طلبات\s*اعتماد/i.test(text)) quick = 'pending_review';
      else if (/اجتماعات\s*اليوم|حجوزات\s*اليوم/i.test(text)) quick = 'today';
      localStorage.setItem(BOOKING_INTENT_KEY, JSON.stringify({ tab: 'bookings', bookingQuickFilter: quick }));
      window.dispatchEvent(new Event('booking-intent'));
    }
    handleTabChange(tab);
    setIsNotificationsOpen(false);
  };
  const safeLeads = Array.isArray(leads) ? leads : [];
  const safeInvoices = Array.isArray(invoices) ? invoices : [];
  const safeExpenses = Array.isArray(expenses) ? expenses : [];
  const safeShootBookings = Array.isArray(shootBookings) ? shootBookings : [];
  const safeEquipmentBookings = Array.isArray(equipmentBookings) ? equipmentBookings : [];
  const safeMeetingBookings = Array.isArray(meetingBookings) ? meetingBookings : [];
  const safePriceQuotes = Array.isArray(priceQuotes) ? priceQuotes : [];
  const roleClass =
    currentRole === 'مالك'
      ? 'role-owner'
      : currentRole === 'محاسب'
        ? 'role-accountant'
        : currentRole === 'مدير مبيعات'
          ? 'role-manager'
          : currentRole === 'مدير إنتاج'
            ? 'role-manager'
            : 'role-rep';
  const commandItems = useMemo(() => {
    const navItems = allowedTabs.map((tab) => ({ id: `tab-${tab}`, label: `الانتقال: ${tab}`, type: 'tab' as const, tabId: tab }));
    const leadItems = safeLeads.slice(0, 40).map((l) => ({
      id: `lead-${l.id || Math.random().toString(36).slice(2, 8)}`,
      label: `عميل: ${l.name || 'بدون اسم'} - ${l.company || 'بدون شركة'}`,
      type: 'lead' as const,
    }));
    const invoiceItems = safeInvoices.slice(0, 40).map((i) => {
      const amount = Number((i as any).amount);
      const amountLabel = Number.isFinite(amount) ? amount.toLocaleString() : '0';
      return {
        id: `inv-${i.id || Math.random().toString(36).slice(2, 8)}`,
        label: `فاتورة: ${i.customerName || 'بدون عميل'} - ${amountLabel} ج.م`,
        type: 'invoice' as const,
      };
    });
    const expenseItems = safeExpenses.slice(0, 40).map((e) => {
      const amount = Number((e as any).amount);
      const amountLabel = Number.isFinite(amount) ? amount.toLocaleString() : '0';
      return {
        id: `exp-${e.id || Math.random().toString(36).slice(2, 8)}`,
        label: `مصروف: ${e.title || 'بدون وصف'} - ${amountLabel} ج.م`,
        type: 'expense' as const,
      };
    });
    const q = commandQuery.trim().toLowerCase();
    return [...navItems, ...leadItems, ...invoiceItems, ...expenseItems]
      .filter((x) => !q || x.label.toLowerCase().includes(q))
      .slice(0, 18);
  }, [allowedTabs, safeLeads, safeInvoices, safeExpenses, commandQuery]);
  const dataHealth = useMemo(() => {
    const leadsNoAssignee = safeLeads.filter(l => !l.assignedTo).length;
    const pendingApprovals = safeExpenses.filter(e => e.approvalStatus === 'قيد الاعتماد').length
      + safeShootBookings.filter(b => b.status === 'قيد المراجعة').length
      + safeEquipmentBookings.filter(b => b.status === 'قيد المراجعة').length
      + safeMeetingBookings.filter(b => b.status === 'قيد المراجعة').length;
    const invoicesNoCostCenter = safeInvoices.filter(i => !i.costCenter || !i.costCenter.trim()).length;
    return { leadsNoAssignee, pendingApprovals, invoicesNoCostCenter };
  }, [safeLeads, safeExpenses, safeShootBookings, safeEquipmentBookings, safeMeetingBookings, safeInvoices]);
  const showSalesOpsHomeStrip = currentRole !== 'مدير إنتاج';
  const productionCustodyHome = useMemo(() => {
    if (!currentUserId) {
      return { request: 0, waitPay: 0, ready: 0, active: 0, settlement: 0, closed: 0 };
    }
    const mine = custodyFunds.filter((f) =>
      custodyFundBelongsToProductionManager(f, currentUserId, currentUser?.name)
    );
    return {
      request: mine.filter((f) => f.status === 'طلب_بانتظار_المالك').length,
      waitPay: mine.filter((f) => f.status === 'بانتظار_دفع_محاسب').length,
      ready: mine.filter((f) => f.status === 'جاهزة_للاستلام').length,
      active: mine.filter((f) => f.status === 'نشطة').length,
      settlement: mine.filter((f) => f.status === 'تسوية_بانتظار_محاسب').length,
      closed: mine.filter((f) => f.status === 'مقفلة').length,
    };
  }, [custodyFunds, currentUserId, currentUser?.name]);
  const todayDateKey = new Date().toISOString().slice(0, 10);
  const overdueFollowupsCount = safeLeads.filter(
    (l) => l.slaStatus !== 'مستقر' && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة'
  ).length;
  const todayMeetingsCount = safeShootBookings.filter((b) => b.date === todayDateKey).length
    + safeMeetingBookings.filter((m) => m.date === todayDateKey).length;
  const todayFocusItems = useMemo(() => {
    if (currentRole === 'محاسب') {
      const overdueInstallments = safeInvoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && inv.nextDueDate && inv.nextDueDate < todayDateKey).length;
      const dueTodayInstallments = safeInvoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && inv.nextDueDate === todayDateKey).length;
      const custodySettlementPending = custodyFunds.filter((f) => f.status === 'تسوية_بانتظار_محاسب').length;
      const financialClaimsPending = safeShootBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
        + safeEquipmentBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
        + safeMeetingBookings.filter((m) => m.financialStatus === 'بانتظار_تنفيذ_محاسب').length;
      return [
        { id: 'acc-overdue-installments', label: 'أقساط متأخرة', value: overdueInstallments, onClick: () => openAccountantSubTab('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية', { invoiceQuickFilter: 'overdue_installments' }) },
        { id: 'acc-due-today-installments', label: 'أقساط مستحقة اليوم', value: dueTodayInstallments, onClick: () => openAccountantSubTab('invoices', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية', { invoiceQuickFilter: 'due_today_installments' }) },
        { id: 'acc-financial-claims', label: 'مطالبات مالية بانتظار التنفيذ', value: financialClaimsPending, onClick: () => openBookingsWithIntent('financial_claims_pending_execution', 'لا توجد صفحة متاحة لعرض المطالبات المالية') },
        { id: 'acc-custody-settlement', label: 'تسويات عهدة بانتظار الإقفال', value: custodySettlementPending, onClick: () => openAccountantSubTab('custody', 'لا توجد صفحة الإدارة المالية في صلاحياتك الحالية') },
      ];
    }
    if (currentRole === 'مدير إنتاج') {
      const h = productionCustodyHome;
      const myTodayMeetings = safeMeetingBookings.filter((m) => m.date === todayDateKey && m.repId === currentUserId).length;
      const goProd = () => openFirstAllowedTab(['production'], 'لا توجد صفحة تمويل الإنتاج في صلاحياتك الحالية');
      return [
        { id: 'prod-custody-request', label: 'طلبات عهدة عند المالك', value: h.request, onClick: goProd },
        { id: 'prod-custody-waitpay', label: 'بانتظار دفع المحاسب', value: h.waitPay, onClick: goProd },
        { id: 'prod-custody-ready', label: 'عهد جاهزة للاستلام', value: h.ready, onClick: goProd },
        { id: 'prod-custody-active', label: 'عهد نشطة (تسجيل صرف)', value: h.active, onClick: goProd },
        { id: 'prod-custody-settlement', label: 'تسوية عند المحاسب للإقفال', value: h.settlement, onClick: goProd },
        { id: 'prod-today-meetings', label: 'اجتماعاتي اليوم', value: myTodayMeetings, onClick: () => openBookingsWithIntent('today', 'لا توجد صفحة متاحة لعرض اجتماعات اليوم في صلاحياتك الحالية') },
      ];
    }
    if (currentRole === 'مندوب') {
      const myOverdue = safeLeads.filter(
        (l) =>
          l.assignedTo === currentUserId &&
          l.slaStatus !== 'مستقر' &&
          l.status !== 'مغلق - فوز' &&
          l.status !== 'مغلق - خسارة'
      ).length;
      const myTodayFollowups = safeLeads.filter(
        (l) =>
          l.assignedTo === currentUserId &&
          Boolean(l.followUpAt) &&
          new Date(l.followUpAt!).toISOString().slice(0, 10) === todayDateKey
      ).length;
      const myTodayBookings = safeShootBookings.filter((b) => b.repId === currentUserId && b.date === todayDateKey).length
        + safeMeetingBookings.filter((m) => m.repId === currentUserId && m.date === todayDateKey).length;
      return [
        {
          id: 'rep-overdue-followups',
          label: 'متابعاتي المتأخرة',
          value: myOverdue,
          onClick: () => {
            localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsAssignedFilter: 'mine', leadsOverdueOnly: true }));
            openFirstAllowedTab(['leads', 'dashboard'], 'لا توجد صفحة متاحة لعرض المتابعات في صلاحياتك الحالية');
          },
        },
        { id: 'rep-today-followups', label: 'متابعات اليوم', value: myTodayFollowups, onClick: () => openFirstAllowedTab(['dashboard', 'leads'], 'لا توجد صفحة متاحة لعرض المتابعات في صلاحياتك الحالية') },
        { id: 'rep-today-bookings', label: 'حجوزاتي اليوم', value: myTodayBookings, onClick: () => openBookingsWithIntent('today', 'لا توجد صفحة متاحة لعرض الحجوزات في صلاحياتك الحالية') },
      ];
    }
    return [
      { id: 'ops-overdue-followups', label: 'المتابعات المتأخرة', value: overdueFollowupsCount, onClick: () => handleTodayFocusClick('overdue-followups') },
      { id: 'ops-pending-approvals', label: 'طلبات اعتماد', value: dataHealth.pendingApprovals, onClick: () => handleTodayFocusClick('pending-approvals') },
      { id: 'ops-today-meetings', label: 'اجتماعات اليوم', value: todayMeetingsCount, onClick: () => handleTodayFocusClick('today-meetings') },
    ];
  }, [
    currentRole,
    currentUserId,
    safeInvoices,
    custodyFunds,
    safeShootBookings,
    safeEquipmentBookings,
    safeMeetingBookings,
    productionCustodyHome,
    safeLeads,
    todayDateKey,
    overdueFollowupsCount,
    dataHealth.pendingApprovals,
    todayMeetingsCount,
  ]);

  /** تذكيرات قبل الموعد + عند حلول الموعد (نافذة وصوت) + توست ومركز التنبيهات */
  useEffect(() => {
    if (!currentUser) return;
    const runReminderPass = () => {
      let dueJustHit: PersonalTodo[] = [];
      setPersonalTodos((prev) => {
        let changed = false;
        const nowMs = Date.now();
        const next = prev.map((t) => {
          if (t.done || !t.dueAt) return t;
          const due = new Date(t.dueAt).getTime();
          if (!Number.isFinite(due)) return t;

          if (due <= nowMs && !t.dueAlarmEmitted) {
            dueJustHit.push(t);
            changed = true;
            return { ...t, dueAlarmEmitted: true };
          }

          if (due <= nowMs) return t;

          const msUntil = due - nowMs;
          if (msUntil <= 30 * 60 * 1000 && !t.reminder30Emitted) {
            const dt = new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
            toast.info(`تذكير (قبل أقل من نصف ساعة): «${t.text}» — الموعد ${dt}`, { duration: 12_000, id: `todo-rem30-${t.id}` });
            notifyDesktopPersonalTask(
              'تذكير مهمة شخصية',
              `«${t.text}» — خلال أقل من نصف ساعة (${dt})`,
              `todo-dsk-30-${t.id}`,
              desktopNotifyWhenVisibleRef.current,
            );
            changed = true;
            return { ...t, reminder30Emitted: true };
          }
          /* تنبيه «قبل الساعة» لا يُرسل لو أقل من 30 دقيقة متبقية — إلا إن ظهر ذلك التنبيه أولاً لتكرار رسالتين على نفس المهمة */
          if (msUntil > 30 * 60 * 1000 && msUntil <= 60 * 60 * 1000 && !t.reminder60Emitted) {
            const dt = new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
            toast.info(`تذكير (قبل أقل من ساعة): «${t.text}» — الموعد ${dt}`, { duration: 12_000, id: `todo-rem60-${t.id}` });
            notifyDesktopPersonalTask(
              'تذكير مهمة شخصية',
              `«${t.text}» — خلال أقل من ساعة (${dt})`,
              `todo-dsk-60-${t.id}`,
              desktopNotifyWhenVisibleRef.current,
            );
            changed = true;
            return { ...t, reminder60Emitted: true };
          }
          return t;
        });
        return changed ? next : prev;
      });
      if (dueJustHit.length > 0) {
        const lines = dueJustHit.map((t) => {
          const dt = t.dueAt
            ? new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
            : '';
          return `«${t.text}»${dt ? ` — ${dt}` : ''}`;
        });
        toast.info(`حان موعد المهمة: ${lines.join(' · ')}`, { duration: 20_000, id: `todo-due-${dueJustHit.map((t) => t.id).join('-')}` });
        for (const t of dueJustHit) {
          const dt = t.dueAt
            ? new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
            : '';
          notifyDesktopPersonalTask(
            'حان موعد مهمة شخصية',
            `«${t.text}»${dt ? ` — ${dt}` : ''}`,
            `todo-dsk-due-${t.id}`,
            desktopNotifyWhenVisibleRef.current,
          );
        }
        playPersonalTodoDueBeep().catch(() => {});
        setPersonalTodoDueAlarm(dueJustHit);
      }
    };
    runReminderPass();
    const id = window.setInterval(runReminderPass, 5_000);
    return () => clearInterval(id);
  }, [currentUser?.id]);

  const exportSnapshot = () => {
    const payload: Record<string, any> = {};
    Object.keys(localStorage)
      .filter((k) => k.startsWith('prod_system_'))
      .forEach((k) => {
        const v = localStorage.getItem(k);
        if (!v) {
          payload[k] = null;
          return;
        }
        try {
          payload[k] = JSON.parse(v);
        } catch {
          payload[k] = v;
        }
      });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `system-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const restoreSnapshot = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        Object.entries(parsed).forEach(([k, v]) => {
          if (!k.startsWith('prod_system_')) return;
          if (v === null || v === undefined) {
            localStorage.removeItem(k);
            return;
          }
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        });
        toast.success('تم استيراد النسخة الاحتياطية بنجاح');
        window.location.reload();
      } catch {
        toast.error('ملف النسخة الاحتياطية غير صالح');
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setIsCommandOpen(true);
      }
      if (event.key === 'Escape') setIsCommandOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  useEffect(() => {
    if (!isNotificationsOpen) return;
    const updatePosition = () => {
      const anchor = notificationsAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(360, Math.floor(window.innerWidth * 0.9));
      const margin = 12;
      const nextLeft = Math.max(margin, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin));
      const nextTop = rect.bottom + 10;
      setNotificationsPanelPos({ top: nextTop, left: nextLeft });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!isSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!currentUser) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shell = document.querySelector('.premium-shell') as HTMLElement | null;
    if (!shell) return;
    const applyParallax = (x: number, y: number) => {
      shell.style.setProperty('--parallax-x', x.toFixed(4));
      shell.style.setProperty('--parallax-y', y.toFixed(4));
    };
    const onMouseMove = (event: MouseEvent) => {
      const nx = ((event.clientX / window.innerWidth) - 0.5) * 2;
      const ny = ((event.clientY / window.innerHeight) - 0.5) * 2;
      if (parallaxFrameRef.current !== null) {
        cancelAnimationFrame(parallaxFrameRef.current);
      }
      parallaxFrameRef.current = window.requestAnimationFrame(() => applyParallax(nx, ny));
    };
    const onMouseLeaveWindow = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      if (parallaxFrameRef.current !== null) {
        cancelAnimationFrame(parallaxFrameRef.current);
      }
      parallaxFrameRef.current = window.requestAnimationFrame(() => applyParallax(0, 0));
    };
    applyParallax(0, 0);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseout', onMouseLeaveWindow);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseout', onMouseLeaveWindow);
      if (parallaxFrameRef.current !== null) {
        cancelAnimationFrame(parallaxFrameRef.current);
      }
      applyParallax(0, 0);
    };
  }, [currentUser]);

  if (!welcomeUnlocked) {
    return <WelcomeGate onUnlock={completeWelcomeGate} />;
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  return (
    <div className={`system-theme ${uiVisualMode === 'premium' ? 'premium-shell cinematic-production' : 'ui-classic'} ${isNotificationsOpen ? 'notifications-open' : ''} ${roleClass} tab-${activeTab} flex min-h-screen bg-[#080B13] text-slate-100 font-['Cairo'] overflow-x-hidden`} dir="rtl">
      <BulkUploadModal isOpen={isBulkModalOpen} onClose={() => setIsBulkModalOpen(false)} />
      {personalTodoDueAlarm && personalTodoDueAlarm.length > 0
        ? createPortal(
            <div
              className="fixed inset-0 z-[2147483000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md isolate pointer-events-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="personal-todo-alarm-title"
            >
              <div className="w-full max-w-md rounded-2xl border border-rose-400/50 bg-[#0f1528] shadow-[0_24px_80px_rgba(0,0,0,0.55)] p-6 text-right ring-2 ring-rose-500/30">
                <p id="personal-todo-alarm-title" className="text-lg font-black text-rose-100 mb-2">
                  حان موعد المهمة
                </p>
                <ul className="space-y-3 mb-6 max-h-[40vh] overflow-y-auto custom-scrollbar">
                  {personalTodoDueAlarm.map((t) => (
                    <li key={t.id} className="text-sm text-zinc-100 border border-white/10 rounded-xl px-3 py-2 bg-white/5">
                      <span className="font-bold block">«{t.text}»</span>
                      {t.dueAt ? (
                        <span className="text-[11px] text-amber-200/90 mt-1 block">
                          {new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void playPersonalTodoDueBeep()}
                    className="w-full py-2.5 rounded-xl border border-amber-400/40 bg-amber-500/15 text-amber-100 text-sm font-bold hover:bg-amber-500/25 transition-colors"
                  >
                    تشغيل الصوت مرة أخرى
                  </button>
                  <button
                    type="button"
                    onClick={() => setPersonalTodoDueAlarm(null)}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-500/40 to-rose-400/25 border border-rose-300/50 text-rose-50 font-black text-sm hover:from-rose-500/55 hover:to-rose-400/35 transition-all"
                  >
                    حسناً
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Sidebar */}
      <aside className="premium-sidebar-shell w-72 shrink-0 border-l border-white/10 bg-[#0C1120] sticky top-0 h-screen hidden lg:flex flex-col p-8 z-[100]">
        <div className="flex items-center gap-4 mb-12 px-2">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center shadow-xl shadow-black/40 overflow-hidden border border-white/10">
            <img src={SYSTEM_LOGO} alt={SYSTEM_NAME} className="w-full h-full object-cover" />
          </div>
          <span className="text-2xl font-black text-[#A99FFF]">The Untold Story</span>
        </div>
        <nav className="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
          <NavItems role={currentUser.role} active={activeTab} onChange={handleTabChange} allowedTabs={allowedTabs} />
        </nav>
        <div className="pt-8 border-t border-white/10">
           <div className="flex items-center gap-3 mb-6 px-2">
             <img src={currentUser.avatar} className="w-10 h-10 rounded-xl border-2 border-white/20" alt="" />
             <div className="min-w-0">
               <p className="text-sm font-bold truncate">{currentUser.name}</p>
               <p className="text-[10px] text-zinc-400 uppercase">{currentUser.role}</p>
             </div>
           </div>
          <button
            type="button"
            onClick={() => {
              logout();
              toast.info('تم تسجيل الخروج');
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-rose-500 hover:bg-rose-500/10 font-bold transition-all"
          >
             <LogOut className="w-5 h-5" />
             <span>تسجيل الخروج</span>
           </button>
        </div>
      </aside>

      {isSidebarOpen &&
        currentUser &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[60] bg-black/70 lg:hidden cursor-default border-0 p-0"
              aria-label="إغلاق القائمة"
              onClick={() => setIsSidebarOpen(false)}
            />
            <aside className="fixed top-0 bottom-0 right-0 z-[70] flex w-[min(20rem,92vw)] max-w-full flex-col border-l border-white/10 bg-[#0C1120] p-6 shadow-2xl lg:hidden">
              <div className="mb-6 flex shrink-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <img src={currentUser.avatar} className="h-10 w-10 shrink-0 rounded-xl border border-white/15" alt="" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{currentUser.name}</p>
                    <p className="text-[10px] text-zinc-400">{currentUser.role}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  className="shrink-0 rounded-xl p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
                  aria-label="إغلاق"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <nav className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
                <NavItems role={currentUser.role} active={activeTab} onChange={handleTabChange} allowedTabs={allowedTabs} />
              </nav>
              <div className="mt-6 shrink-0 border-t border-white/10 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsSidebarOpen(false);
                    logout();
                    toast.info('تم تسجيل الخروج');
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 font-bold text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  <LogOut className="h-5 w-5" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            </aside>
          </>,
          document.body
        )}

      {/* Main Content */}
      <main className="premium-main-layer flex-1 p-6 lg:p-12 max-w-[1600px] mx-auto w-full overflow-hidden">
        <div className="sticky top-0 z-[95] isolate -mx-6 -mt-6 mb-4 flex items-center gap-3 border-b border-white/10 bg-[#0C1120]/95 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-white hover:border-[#7C6BFF]/40"
            aria-label="فتح قائمة التنقل"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">التنقل</p>
            <p className="truncate text-sm font-black text-white">{TAB_TITLE_AR[activeTab] || activeTab}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              toast.info('تم تسجيل الخروج');
            }}
            title="تسجيل الخروج"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-400/35 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
            aria-label="تسجيل الخروج"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        {/* Header */}
        {(
        <header className="premium-header-shell relative z-[90] flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl font-black text-white">مرحباً، {currentUser.name.split(' ')[0]} 👋</h1>
            <p className="text-zinc-400 font-bold mt-1 uppercase text-xs tracking-widest">إليك آخر التحديثات في نظامك اليوم</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            {activeTab !== 'home' && (
              <>
                <button
                  onClick={() => setIsCommandOpen(true)}
                  title="بحث سريع"
                  className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-4 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 text-zinc-100 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all text-sm font-black leading-tight shrink-0 inline-flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  <span className="hidden lg:inline">بحث سريع /</span>
                  <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    بحث سريع
                  </span>
                </button>
                <button
                  onClick={handleGoBackTab}
                  title="رجوع للصفحة السابقة"
                  className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-4 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 text-zinc-100 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all text-sm font-black leading-tight shrink-0 inline-flex items-center justify-center gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span className="hidden lg:inline">رجوع للصفحة السابقة</span>
                  <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    رجوع
                  </span>
                </button>
              </>
            )}
            {currentUser.role === 'مندوب' && (
              <button 
                onClick={() => setIsBulkModalOpen(true)}
                title="رفع ملف ليدز"
                className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-5 bg-gradient-to-b from-white/[0.08] to-white/[0.03] text-zinc-100 rounded-xl font-bold inline-flex items-center justify-center gap-2.5 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all border border-white/15 shrink-0"
              >
                <FileUp className="w-5 h-5 text-[#A99FFF]" />
                <span className="hidden lg:inline">رفع ملف ليدز</span>
                <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  رفع ليدز
                </span>
              </button>
            )}
            <div className="relative shrink-0">
              {notifications.length > 0 && (
                <div className="absolute -top-1 -left-1 z-20 min-w-5 h-5 px-1 bg-rose-500 border-2 border-[#080B13] rounded-full flex items-center justify-center text-[10px] font-black shadow-lg shadow-rose-500/40">
                  {Math.min(9, notifications.length)}
                </div>
              )}
              <button
                ref={notificationsAnchorRef}
                onClick={() => {
                  setIsNotificationsOpen((v) => {
                    const opening = !v;
                    if (opening) {
                      void (async () => {
                        setNotificationsPanelSyncing(true);
                        try {
                          await refreshServerWorkspace();
                        } finally {
                          setNotificationsPanelSyncing(false);
                        }
                      })();
                    }
                    return opening;
                  });
                }}
                title="التنبيهات"
                className="premium-top-action group relative h-12 w-12 flex items-center justify-center bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 rounded-xl hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all"
              >
                <Bell className="w-6 h-6 text-zinc-300" />
                <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  التنبيهات
                </span>
              </button>
              {isNotificationsOpen && createPortal(
                <div
                  className="premium-notifications-panel fixed w-[360px] max-w-[90vw] bg-[#0B1020] border border-white/10 rounded-2xl shadow-2xl z-[9999] p-3"
                  style={{ top: notificationsPanelPos.top, left: notificationsPanelPos.left }}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <p className="text-sm font-black">مركز التنبيهات</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {isServerDataMode() && currentUser?.authSource === 'database' && (
                        <button
                          type="button"
                          disabled={notificationsPanelSyncing}
                          onClick={() => {
                            void (async () => {
                              setNotificationsPanelSyncing(true);
                              try {
                                const ok = await refreshServerWorkspace();
                                if (!ok) toast.error('تعذر تحديث البيانات من السيرفر');
                                else toast.success('تم تحديث التنبيهات من السيرفر');
                              } finally {
                                setNotificationsPanelSyncing(false);
                              }
                            })();
                          }}
                          className="text-[11px] font-bold text-cyan-300 hover:text-cyan-100 disabled:opacity-40"
                        >
                          {notificationsPanelSyncing ? 'جاري التحديث…' : 'تحديث'}
                        </button>
                      )}
                      <button type="button" onClick={() => setIsNotificationsOpen(false)} className="text-xs text-zinc-400 hover:text-white">إغلاق</button>
                    </div>
                  </div>
                  {notificationsPanelSyncing && (
                    <p className="text-[11px] text-zinc-500 mb-2">يتم مزامنة أحدث البيانات من السيرفر لعرض تنبيهات دقيقة…</p>
                  )}
                  {isServerDataMode() && currentUser?.authSource === 'database' && (
                    <p className="text-[10px] text-zinc-500 mb-2 leading-relaxed">
                      لا يوجد WebSocket: التحديث التلقائي عند العودة للتبويب أو التركيز تقريباً كل 60 ثانية، بالإضافة إلى زر
                      «تحديث» وفتح هذه اللوحة.
                    </p>
                  )}
                  <div className="mb-2 flex items-center gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-200 border border-rose-500/30">Critical: {criticalNotifications.length}</span>
                    <span className="px-2 py-1 rounded-lg bg-zinc-500/15 text-zinc-200 border border-zinc-500/30">Normal: {normalNotifications.length}</span>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`premium-notification-item w-full text-right rounded-xl border p-3 ${
                        n.level === 'high'
                          ? 'border-rose-500/30 bg-rose-500/10'
                          : n.level === 'medium'
                            ? 'border-amber-500/30 bg-amber-500/10'
                            : 'border-emerald-500/30 bg-emerald-500/10'
                      } hover:border-white/30 cursor-pointer`}>
                        <p className="text-sm font-bold">{n.title}</p>
                        <p className="text-xs text-zinc-300 mt-1">{n.message}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-[10px] text-zinc-500">{new Date(n.createdAt).toLocaleString('ar-EG')}</p>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${((n as any).priority || (n.level === 'high' ? 'critical' : 'normal')) === 'critical' ? 'bg-rose-500/20 text-rose-200' : 'bg-zinc-500/20 text-zinc-200'}`}>
                              {((n as any).priority || (n.level === 'high' ? 'critical' : 'normal')) === 'critical' ? 'Critical' : 'Normal'}
                            </span>
                            <p className="text-[10px] text-[#A99FFF] font-bold">فتح: {resolveNotificationTab(n) || '—'}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                    {notifications.length === 0 && (
                      <p className="text-xs text-zinc-400 text-center py-4">لا توجد تنبيهات جديدة</p>
                    )}
                  </div>
                </div>,
                document.body
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                toast.info('تم تسجيل الخروج');
              }}
              title="تسجيل الخروج"
              className="premium-top-action premium-top-danger group relative h-12 w-12 sm:w-auto sm:px-5 rounded-xl bg-gradient-to-r from-rose-500/30 to-rose-400/10 border border-rose-400/45 text-rose-100 hover:from-rose-500/40 hover:to-rose-300/20 hover:shadow-[0_10px_28px_rgba(244,63,94,0.35)] transition-all duration-300 font-bold inline-flex items-center justify-center gap-2 shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden lg:inline">تسجيل الخروج</span>
              <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                تسجيل الخروج
              </span>
            </button>
          </div>
        </header>
        )}
        {activeTab === 'home' && showSalesOpsHomeStrip && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleHomeDataHealthClick('leads-unassigned')}
              className="text-right bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.05] border border-white/15 rounded-2xl px-4 py-3.5 text-sm hover:border-rose-300/35 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(244,63,94,0.16)] transition-all duration-300"
            >
              <span className="text-zinc-300">ليدز بدون تعيين</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.leadsNoAssignee}</span>
            </button>
            <button
              type="button"
              onClick={() => handleHomeDataHealthClick('pending-approvals')}
              className="text-right bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.05] border border-white/15 rounded-2xl px-4 py-3.5 text-sm hover:border-rose-300/35 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(244,63,94,0.16)] transition-all duration-300"
            >
              <span className="text-zinc-300">طلبات تحتاج اعتماد</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.pendingApprovals}</span>
            </button>
            <button
              type="button"
              onClick={() => handleHomeDataHealthClick('invoices-no-cc')}
              className="text-right bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.05] border border-white/15 rounded-2xl px-4 py-3.5 text-sm hover:border-rose-300/35 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(244,63,94,0.16)] transition-all duration-300"
            >
              <span className="text-zinc-300">فواتير بدون مركز تكلفة</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.invoicesNoCostCenter}</span>
            </button>
          </div>
        )}
        {activeTab === 'home' && (
          <div className="mb-8 grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.06] border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.3)]">
              <p className="text-[11px] text-zinc-500 mb-3 tracking-widest font-black">تركيز اليوم</p>
              <div className="space-y-2 text-sm">
                {todayFocusItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.onClick}
                    className="w-full flex items-center justify-between text-right rounded-xl px-3 py-2 hover:bg-white/10 hover:border-rose-300/25 border border-transparent transition-all duration-300"
                  >
                    <span className="text-zinc-300">{item.label}</span>
                    <span className="font-black text-white text-lg">{item.value}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.06] border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.3)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-zinc-500 tracking-widest font-black">مهامي الشخصية</p>
                <span className="text-[11px] text-zinc-500">{personalTodos.filter(t => !t.done).length} مفتوحة</span>
              </div>
              <input value={todoInput} onChange={(e) => setTodoInput(e.target.value)} placeholder="نص المهمة..." className="w-full bg-black/20 border border-white/15 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-300/45 transition-all mb-2" />
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[10px] text-zinc-500 shrink-0 w-full sm:w-auto">الموعد (اختياري):</span>
                <input
                  type="date"
                  value={todoDueDate}
                  onChange={(e) => setTodoDueDate(e.target.value)}
                  className="flex-1 min-w-[120px] sm:min-w-[130px] bg-black/20 border border-white/15 rounded-xl px-2 py-2 text-[11px] focus:outline-none focus:border-rose-300/45 transition-all text-zinc-200 [color-scheme:dark]"
                />
                <input
                  type="time"
                  step={60}
                  value={todoDueTime}
                  onChange={(e) => setTodoDueTime(e.target.value)}
                  className="min-w-[100px] bg-black/20 border border-white/15 rounded-xl px-2 py-2 text-[11px] focus:outline-none focus:border-rose-300/45 transition-all text-zinc-200 [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setTodoDueDate('');
                    setTodoDueTime('');
                  }}
                  className="text-[10px] text-zinc-500 underline px-1"
                >
                  بدون وقت
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  const text = todoInput.trim();
                  if (!text) return;
                  if (!canonicalTodoUserId(currentUser?.id)) {
                    toast.error('تعذر حفظ المهمة: لا يوجد معرّف مستخدم نشط. أعد تسجيل الدخول.');
                    return;
                  }
                  let dueIso: string | undefined;
                  const dateT = todoDueDate.trim();
                  const timeT = todoDueTime.trim();
                  if (dateT || timeT) {
                    if (!dateT) {
                      toast.error('اختر التاريخ أو امسح الوقت بالكامل');
                      return;
                    }
                    if (!timeT) {
                      toast.error('اختر الساعة مع التاريخ');
                      return;
                    }
                    const d = new Date(`${dateT}T${timeT}`);
                    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
                      dueIso = d.toISOString();
                    } else {
                      toast.error('اختَر موعداً في المستقبل لتفعيل التذكيرات');
                      return;
                    }
                  }
                  setPersonalTodos((prev) => [
                    ...prev,
                    {
                      id: `todo-${Date.now()}`,
                      text,
                      done: false,
                      ...(dueIso
                        ? {
                            dueAt: dueIso,
                            reminder30Emitted: false,
                            reminder60Emitted: false,
                            dueAlarmEmitted: false,
                          }
                        : {}),
                    },
                  ]);
                  setTodoInput('');
                  setTodoDueDate('');
                  setTodoDueTime('');
                  toast.success(dueIso ? 'تم حفظ المهمة مع موعد وتذكيرات' : 'تم حفظ المهمة');
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500/30 to-rose-400/20 border border-rose-300/35 text-xs text-rose-100 font-black hover:from-rose-500/40 hover:to-rose-400/30 transition-all duration-300 mb-2"
              >
                إضافة المهمة
              </button>
              <div className="space-y-1 max-h-40 overflow-auto custom-scrollbar">
                {personalTodos.map((t) => {
                  let dueBadge: React.ReactNode = null;
                  if (t.dueAt) {
                    const dueMs = new Date(t.dueAt).getTime();
                    const over = Number.isFinite(dueMs) && dueMs <= Date.now();
                    const label = Number.isFinite(dueMs)
                      ? new Date(t.dueAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
                      : '';
                    dueBadge = (
                      <span className={`block text-[10px] mt-0.5 ${over ? 'text-rose-300' : 'text-amber-200/95'}`}>
                        {over ? 'تجاوز الموعد: ' : 'الموعد: '}
                        {label}
                      </span>
                    );
                  }
                  return (
                    <div key={t.id} className="flex items-start justify-between gap-2 text-xs bg-white/10 border border-white/10 rounded-xl px-3 py-2">
                      <div className="min-w-0 text-right">
                        <button type="button" onClick={() => setPersonalTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} className={`text-right ${t.done ? 'line-through text-zinc-500' : 'text-white font-bold'}`}>
                          {t.text}
                        </button>
                        {dueBadge}
                      </div>
                      <button type="button" onClick={() => setPersonalTodos((prev) => prev.filter((x) => x.id !== t.id))} className="text-rose-200 hover:text-rose-100 transition-colors shrink-0">حذف</button>
                    </div>
                  );
                })}
                {personalTodos.length === 0 && <p className="text-[11px] text-zinc-500">لا توجد مهام.</p>}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'home' && showSalesOpsHomeStrip && safeLeads.filter(l => (l.slaStatus === 'متأخر' || l.slaStatus === 'حرج') && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length > ALERT_MAX_OVERDUE_LEADS && (
          <div className="mb-6 bg-rose-500/15 border border-rose-500/30 rounded-2xl p-3 text-sm text-rose-200">
            تنبيه: عدد المتابعات المتأخرة تجاوز الحد المحدد في قواعد التنبيه.
          </div>
        )}

        {/* Dynamic Views */}
        <div key={activeTab} className="premium-tab-scene">
        {activeTab === 'approvals' && currentUser.role === 'مالك' && (
          <div className="space-y-6">
            <ApprovalCenter
              leads={safeLeads}
              expenses={safeExpenses}
              users={users}
              shootBookings={safeShootBookings}
              equipmentBookings={safeEquipmentBookings}
              meetingBookings={safeMeetingBookings}
              priceQuotes={safePriceQuotes}
              custodyFunds={custodyFunds}
              currentUserRole={currentUser.role}
              onApproveCustodyRequest={(id: string) => {
                void (async () => {
                const ok = await ownerApproveCustodyRequest(id);
                if (!ok) toast.error('تعذر الاعتماد');
                else toast.success('تم اعتماد الطلب — بانتظار دفع المحاسب');
                })();
              }}
              onRejectCustodyRequest={(id: string) => {
                void (async () => {
                const ok = await ownerRejectCustodyRequest(id);
                if (!ok) toast.error('تعذر الرفض');
                else toast.info('تم رفض طلب العهدة');
                })();
              }}
              onGoToTab={handleTabChange}
              entityComments={entityComments}
              setEntityComments={setEntityComments}
              commentDrafts={commentDrafts}
              setCommentDrafts={setCommentDrafts}
              currentUserName={currentUser.name}
              onApprovePriceQuote={(id: string, paymentSchedule?: PaymentInstallment[], initialPayment?: number) => {
                void (async () => {
                const ok = await approvePriceQuote(id, paymentSchedule, initialPayment);
                if (!ok) toast.error('تعذر الاعتماد — تحقق من صلاحية المالك أو إغلاق الشهر');
                else toast.success('تم اعتماد عرض السعر وتسجيل الفاتورة للمحاسب');
                })();
              }}
              onRejectPriceQuote={(id: string) => {
                void (async () => {
                const ok = await rejectPriceQuote(id);
                if (!ok) toast.error('تعذر الرفض');
                else toast.info('تم رفض عرض السعر');
                })();
              }}
              onApproveExpense={(id: string) => {
                void (async () => {
                const ok = await approveExpense(id);
                if (!ok) toast.error('تعذر اعتماد المصروف');
                else toast.success('تم اعتماد المصروف');
                })();
              }}
              onRejectExpense={(id: string) => {
                void (async () => {
                const ok = await rejectExpense(id);
                if (!ok) toast.error('تعذر رفض المصروف');
                else toast.info('تم رفض المصروف');
                })();
              }}
              onApproveShoot={(id: string) => {
                void (async () => {
                const ok = await updateShootBookingStatus(id, 'معتمد');
                if (!ok) toast.error('تعذر اعتماد طلب التصوير');
                else toast.success('تم اعتماد طلب التصوير');
                })();
              }}
              onRejectShoot={(id: string) => {
                void (async () => {
                const ok = await updateShootBookingStatus(id, 'مرفوض');
                if (!ok) toast.error('تعذر رفض طلب التصوير');
                else toast.info('تم رفض طلب التصوير');
                })();
              }}
              onApproveEquipment={(id: string) => {
                void (async () => {
                const ok = await updateEquipmentBookingStatus(id, 'معتمد');
                if (!ok) toast.error('تعذر اعتماد طلب المعدات');
                else toast.success('تم اعتماد طلب المعدات');
                })();
              }}
              onRejectEquipment={(id: string) => {
                void (async () => {
                const ok = await updateEquipmentBookingStatus(id, 'مرفوض');
                if (!ok) toast.error('تعذر رفض طلب المعدات');
                else toast.info('تم رفض طلب المعدات');
                })();
              }}
              onApproveMeeting={(id: string) => {
                void (async () => {
                const ok = await updateMeetingBookingStatus(id, 'معتمد');
                if (!ok) toast.error('تعذر اعتماد طلب الاجتماع/المكان');
                else toast.success('تم اعتماد طلب الاجتماع/المكان');
                })();
              }}
              onRejectMeeting={(id: string) => {
                void (async () => {
                const ok = await updateMeetingBookingStatus(id, 'مرفوض');
                if (!ok) toast.error('تعذر رفض طلب الاجتماع/المكان');
                else toast.info('تم رفض طلب الاجتماع/المكان');
                })();
              }}
            />
          </div>
        )}
        {activeTab === 'owner-dash' && (
          <OwnerDashboard
            onGoToTab={handleTabChange}
            openAccountantSubTab={openAccountantSubTab}
            openBookingsWithIntent={openBookingsWithIntent}
          />
        )}
        {activeTab === 'manager-reps' && currentUser.role === 'مدير مبيعات' && <ManagerSalesTeamPanel />}
        {activeTab === 'bookings' && <BookingCenter currentUser={currentUser} onGoToTab={handleTabChange} />}
        {activeTab === 'team-performance' && <TeamPerformanceHub onGoToTab={handleTabChange} />}
        {activeTab === 'accountant' && <AccountantView onGoToTab={handleTabChange} />}
        {activeTab === 'settings' && <SalesManagerSettings visualMode={uiVisualMode} onVisualModeChange={setUiVisualMode} />}
        
        {activeTab === 'dashboard' && currentUser.role !== 'مالك' && currentUser.role !== 'محاسب' && currentUser.role !== 'مدير إنتاج' && (
          <RepProfessionalDashboard currentUser={currentUser} onGoToTab={handleTabChange} />
        )}
        {activeTab === 'production' && currentUser.role === 'مدير إنتاج' && <ProductionCustodyDashboard />}
        {activeTab === 'performance' && currentUser.role === 'مندوب' && (
          <RepPerformanceView currentUser={currentUser} onGoToTab={handleTabChange} />
        )}

        {activeTab === 'leads' && <LeadsWorkspace />}
        {activeTab === 'linked-views' && <PageViewsHub />}
        {activeTab === 'seo' && currentUser.role === 'مالك' && <SeoModuleHub />}
        </div>
      </main>
      {isCommandOpen && (
        <div className="fixed inset-0 z-[240] bg-black/60 backdrop-blur-sm flex items-start justify-center p-6 pt-24" dir="rtl">
          <div className="w-full max-w-2xl bg-[#0B1020] border border-white/15 rounded-3xl p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-400">Command Bar</p>
              <button onClick={() => setIsCommandOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Esc</button>
            </div>
            <input
              autoFocus
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="اكتب للبحث السريع: عميل، فاتورة، مصروف أو تبويب..."
              className="w-full bg-[#111A32] border border-white/15 rounded-2xl px-4 py-3 text-sm"
            />
            <div className="mt-3 space-y-2 max-h-[380px] overflow-auto">
              {commandItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.type === 'tab' && item.tabId) handleTabChange(item.tabId);
                    else if (item.type === 'lead') handleTabChange('leads');
                    else if (item.type === 'invoice' || item.type === 'expense') handleTabChange('accountant');
                    setIsCommandOpen(false);
                    setCommandQuery('');
                  }}
                  className="w-full text-right bg-[#0F1528]/70 border border-white/10 rounded-xl px-3 py-2 text-sm hover:border-white/30"
                >
                  {item.label}
                </button>
              ))}
              {commandItems.length === 0 && <p className="text-xs text-zinc-500 p-2">لا توجد نتائج.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AppContent = () => {
  return <Root />;
};

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'حدث خطأ غير متوقع' };
  }

  componentDidCatch(error: Error) {
    console.error('AppErrorBoundary:', error);
  }

  resetLocalDemoData = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('prod_system_') || k.startsWith('prod_system'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#080B13] text-white flex items-center justify-center p-6" dir="rtl">
          <div className="w-full max-w-xl bg-white/[0.04] border border-white/15 rounded-3xl p-6 space-y-4">
            <h2 className="text-2xl font-black">حصل خطأ وتم إيقاف الصفحة لحمايتك</h2>
            <p className="text-sm text-zinc-300">
              غالبًا في بيانات محلية قديمة/غير متوافقة. اضغط الزر التالي لإصلاح البيانات المحلية وفتح النظام بشكل طبيعي.
            </p>
            <p className="text-xs text-rose-300">{this.state.message}</p>
            <button
              onClick={this.resetLocalDemoData}
              className="px-4 py-2 rounded-xl bg-rose-500 text-white font-black"
            >
              إصلاح البيانات المحلية الآن
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <DataProvider>
        <Toaster position="top-center" richColors theme="dark" />
        <AppContent />
      </DataProvider>
    </AppErrorBoundary>
  );
}

export default App;
