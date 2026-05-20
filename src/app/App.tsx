import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  LayoutDashboard, Users, Briefcase, Settings, Bell, Search, Plus, Phone, Mail, 
  MoreVertical, Filter, ArrowUpRight, Target, UserPlus, Trophy, Clock, LogOut, 
  Menu, X, ChevronRight, ChevronLeft, MessageSquare, CheckCircle2, TrendingUp, Building2, Home,
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
  PaymentInstallment,
  ClientPayment,
  CustodyFund,
  CustodySpendLine,
  CustodySpendAttachment,
  SystemNotification,
  DeleteLeadResult,
  canonicalTodoUserId,
  PersonalTodo,
  BookingSpendLine,
  custodyFundBelongsToProductionManager,
} from './context/DataContext';
import {
  ROLE_TAB_ACCESS,
  filterNotificationsForViewer,
  resolveNotificationTabForRole,
} from './context/notificationPermissions';
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
import {
  INBOUND_CHANNEL_SOURCES,
  inboundChannelLabel,
  isAutoImportedLeadSource,
  leadMatchesSourceFilter,
  leadSourceBadgeClass,
  leadSourceDisplayLabel,
  type LeadSourceFilter,
} from '@/lib/leadSource';
import { patchMyPasswordApi } from '@/lib/api/authPasswordApi';
import {
  getRepQuotePipelineInfo,
  isRepQuoteInPipeline,
  sortRepQuotesByActivity,
  type RepQuotePipelineStepState,
} from '@/lib/repQuotePipeline';
import PageViewsHub from './components/PageViewsHub';
import { useLeadRepUpdate } from './components/LeadRepUpdateModal';
import { BulkLeadsUploadModal } from './components/BulkLeadsUploadModal';
import { RepSkillsEditor } from './components/RepSkillsEditor';
import { REP_SKILL_PRESETS } from '@/lib/repSkills';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { useAppDirection } from './hooks/useAppDirection';
import { getNavLabel } from '@/lib/navLabels';
import { getLeadStatusLabel, getInvoiceStatusLabel, getExpenseStatusLabel, getApprovalStatusLabel, getSlaStatusLabel, getBookingStatusLabel, getExpenseCategoryLabel, getPaymentMethodLabel, getRoleLabel, getCoaAccountTypeLabel, getBookingFinancialStatusLabel, getCustodyStatusLabel } from '@/lib/i18nLabels';
import { useTranslation } from 'react-i18next';

// --- Shared Components ---
const SYSTEM_NAME = 'The Untold Story System';
const SYSTEM_LOGO = '/brand/the-untold-story-logo.png';
const WELCOME_WORDMARK = '/brand/the-untold-story-wordmark.png';
const ALERT_HIGH_EXPENSE = 50000;
const ALERT_MAX_OVERDUE_LEADS = 5;
const NAV_INTENT_KEY = 'prod_system_nav_intent';
const FINANCE_INTENT_KEY = 'prod_system_finance_intent';
const BOOKING_INTENT_KEY = 'prod_system_booking_intent';
type InvoiceQuickFilter = 'all' | 'overdue_installments' | 'due_today_installments' | 'missing_cost_center';
type ExpenseQuickFilter = 'all' | 'pending_approval';
type BookingQuickFilter = 'all' | 'today' | 'pending_review' | 'financial_claims_pending_execution';

/** أدوار يظهر لها الراتب في شاشة المحاسب وتعديله من المحاسب؛ المالك يضع الراتب لجميع الموظفين من جدول الإدارة */
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
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
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
    return Object.entries(counts).map(([name, value]) => ({
      name,
      label: getLeadStatusLabel(name, t),
      value,
      fill: '#10b981',
    }));
  }, [leads, t]);

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
    const company = escapeHtml(printBrandingSettings.companyName || t('ownerDash.defaultCompany'));
    const header = escapeHtml(printBrandingSettings.reportHeader || t('ownerDash.defaultHeader'));
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:48px;max-width:160px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString(dateLocale);
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const cur = t('common.currency');
    const rows = repPerformance
      .map((r) => `<tr><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.name)}</td><td style="padding:8px;border:1px solid #ddd;">${r.won}</td><td style="padding:8px;border:1px solid #ddd;">${r.revenue.toLocaleString(dateLocale)} ${cur}</td></tr>`)
      .join('');
    const html = `
      <html dir="${dateLocale.startsWith('ar') ? 'rtl' : 'ltr'}"><head><meta charset="utf-8" /><title>${escapeHtml(t('ownerDash.printTitle'))}</title>
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
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">${escapeHtml(t('ownerDash.printDate'))}: ${escapeHtml(printDate)}</p>` : ''}
        <h2>${escapeHtml(t('ownerDash.printSummary'))}</h2>
        <p>${escapeHtml(t('ownerDash.totalRevenue'))}: ${totalRevenue.toLocaleString(dateLocale)} ${cur}</p>
        <p>${escapeHtml(t('ownerDash.totalLeads'))}: ${leads.length}</p>
        <p>${escapeHtml(t('ownerDash.conversionRate'))}: ${conversionRate}%</p>
        <p>${escapeHtml(t('ownerDash.avgDealValue'))}: ${avgDealValue.toLocaleString(dateLocale)} ${cur}</p>
        <h3>${escapeHtml(t('ownerDash.printRepPerformance'))}</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <thead><tr><th style="padding:8px;border:1px solid #ddd;">${escapeHtml(t('ownerDash.printColRep'))}</th><th style="padding:8px;border:1px solid #ddd;">${escapeHtml(t('ownerDash.printColWon'))}</th><th style="padding:8px;border:1px solid #ddd;">${escapeHtml(t('ownerDash.printColRevenue'))}</th></tr></thead>
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
    openBookingsWithIntent?.('pending_review', t('errors.noPendingPage'));
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title={t('screens.ownerOverview.title')} subtitle={t('screens.ownerOverview.subtitle')} icon={LayoutDashboard} />
      <div className="flex items-center gap-3">
        <button onClick={printOwnerPdf} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">{t('ownerDash.pdfReport')}</button>
      </div>
      <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-2xl p-2 w-fit">
        <button
          onClick={() => setConversionMode('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black ${conversionMode === 'all' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}
        >
          {t('ownerDash.conversionAll')}
        </button>
        <button
          onClick={() => setConversionMode('closed')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black ${conversionMode === 'closed' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}
        >
          {t('ownerDash.conversionClosed')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MiniMetricCard title={t('ownerDash.openLeads')} value={ownerInsights.openLeads} hint={t('ownerDash.openLeadsHint')} icon={Briefcase} tone="amber" onClick={() => goLeads()} />
        <MiniMetricCard title={t('ownerDash.pendingRevenue')} value={`${ownerInsights.pendingRevenue.toLocaleString(dateLocale)} ${t('common.currency')}`} hint={t('ownerDash.pendingRevenueHint')} icon={Wallet} tone="indigo" onClick={() => openAccountantSubTab?.('invoices', t('errors.noFinancePage'))} />
        <MiniMetricCard title={t('ownerDash.lostRate')} value={`${ownerInsights.lostRate}%`} hint={t('ownerDash.lostRateHint')} icon={AlertCircle} tone={Number(ownerInsights.lostRate) > 45 ? 'rose' : 'emerald'} onClick={() => goLeads({ leadsStatusFilter: 'مغلق - خسارة' })} />
        <MiniMetricCard title={t('ownerDash.topRep')} value={ownerInsights.topRep?.name || t('ownerDash.none')} hint={ownerInsights.topRep ? `${ownerInsights.topRep.revenue.toLocaleString(dateLocale)} ${t('common.currency')}` : t('ownerDash.insufficientData')} icon={Trophy} tone="emerald" onClick={() => onGoToTab?.('team-performance')} />
      </div>
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
        <h4 className="font-black text-white mb-3">{t('ownerDash.dailyBrief')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <button type="button" onClick={() => openAccountantSubTab?.('invoices', t('errors.noFinancePage'))} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">{t('ownerDash.todayRevenue')}: <span className="font-black text-emerald-300">{ownerBrief.todayRevenue.toLocaleString(dateLocale)} {t('common.currency')}</span></button>
          <button type="button" onClick={goPendingApprovals} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">{t('ownerDash.pendingRequests')}: <span className="font-black text-amber-300">{ownerBrief.pendingApprovals}</span></button>
          <button type="button" onClick={() => goLeads()} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">{t('ownerDash.openPipeline')}: <span className="font-black text-indigo-300">{ownerBrief.pipelineAmount.toLocaleString(dateLocale)} {t('common.currency')}</span></button>
          <button type="button" onClick={() => goLeads({ leadsOverdueOnly: true })} className="text-right bg-[#0B1020] border border-white/10 rounded-xl p-3 hover:border-white/25 transition-all">{t('ownerDash.staleLeads')}: <span className="font-black text-rose-300">{ownerBrief.staleOpenLeads}</span></button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title={t('ownerDash.totalRevenue')} value={`${totalRevenue.toLocaleString(dateLocale)} ${t('common.currency')}`} icon={DollarSign} trend={12} color="emerald" onClick={() => openAccountantSubTab?.('invoices', t('errors.noFinancePage'))} />
        <StatCard title={t('ownerDash.totalLeads')} value={leads.length} icon={Users} trend={5} color="blue" onClick={() => goLeads()} />
        <StatCard title={t('ownerDash.conversionRate')} value={`${conversionRate}%`} icon={Target} trend={2} color="purple" onClick={() => onGoToTab?.('team-performance')} />
        <StatCard title={t('ownerDash.avgDealValue')} value={`${avgDealValue.toLocaleString(dateLocale)} ${t('common.currency')}`} icon={Wallet} trend={-1} color="amber" onClick={() => openAccountantSubTab?.('invoices', t('errors.noFinancePage'))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 p-8 rounded-[3rem]">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <Layers className="w-5 h-5 text-emerald-500" />
            {t('ownerDash.funnelTitle')}
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
                          <span className={`text-xs font-bold ${isLoss ? 'text-rose-300' : 'text-zinc-300'}`}>{stage.label}</span>
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
                    <span>{t('ownerDash.funnelTotal')}: <b className="text-zinc-300">{funnelData.reduce((s: number, d: any) => s + d.value, 0)}</b></span>
                    <span>{t('ownerDash.winRate')}: <b className="text-emerald-300">{total > 0 ? Math.round(((funnelData.find((d: any) => d.name === 'مغلق - فوز')?.value ?? 0) / total) * 100) : 0}%</b></span>
                    <span>{t('ownerDash.lossRate')}: <b className="text-rose-300">{total > 0 ? Math.round(((funnelData.find((d: any) => d.name === 'مغلق - خسارة')?.value ?? 0) / total) * 100) : 0}%</b></span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 p-8 rounded-[3rem]">
          <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-emerald-500" />
            {t('ownerDash.repPerformanceTitle')}
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
              <p className="text-[11px] text-zinc-400">{t('ownerDash.paidInvoices')}</p>
              <p className="text-lg font-black text-emerald-300">{ownerInsights.paidInvoicesCount}</p>
            </div>
            <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
              <p className="text-[11px] text-zinc-400">{t('ownerDash.collectionGap')}</p>
              <p className="text-lg font-black text-amber-300">{ownerInsights.pendingRevenue.toLocaleString(dateLocale)} {t('common.currency')}</p>
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
  const { t } = useTranslation();
  const { dateLocale, dir } = useAppDirection();
  const currency = t('common.currency');
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
      toast.error(t('finance.toastEmployeeName'));
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
      toast.error(t('finance.toastInvoiceFields'));
      return;
    }
    if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
      toast.error(t('finance.toastVatInvalid'));
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
      toast.error(t('finance.toastMonthClosedInvoice'));
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
    toast.success(t('finance.toastInvoiceCreated'));
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
      toast.error(t('finance.toastCodeNameRequired'));
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
    toast.success(t('finance.toastJournalCodeAdded'));
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
    toast.success(t('finance.toastJournalCodeApplied', { title: rule.title }));
  };

  const handleCreateExpense = async () => {
    const amount = Number(expenseForm.amount);
    const vatRate = Number(expenseForm.vatRate);
    if (!expenseForm.title.trim() || !amount || amount <= 0) {
      toast.error(t('finance.toastExpenseFields'));
      return;
    }
    if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
      toast.error(t('finance.toastVatInvalid'));
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
      toast.error(t('finance.toastMonthClosedExpense'));
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
    toast.success(t('finance.toastExpenseCreated'));
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
      toast.error(t('finance.toastCoaRequired'));
      return;
    }
    const created = addChartAccount({
      code: coaForm.code.trim(),
      name: coaForm.name.trim(),
      type: coaForm.type,
    });
    if (!created) {
      toast.error(t('finance.toastCoaDuplicate'));
      return;
    }
    setCoaForm({ code: '', name: '', type: 'expense' });
    toast.success(t('finance.toastCoaAdded'));
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
      toast.error(t('finance.toastJournalDesc'));
      return;
    }
    if (Math.abs(debit - credit) > 0.01 || debit <= 0 || credit <= 0) {
      toast.error(t('finance.toastJournalUnbalanced'));
      return;
    }
    const ok = await addManualJournalEntry({
      date: new Date(journalForm.date).toISOString(),
      description: journalForm.description.trim(),
      lines,
    });
    if (!ok) {
      toast.error(t('finance.toastJournalSaveFailed'));
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
    toast.success(t('finance.toastJournalSaved'));
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
    const company = escapeHtml(printBrandingSettings.companyName || t('repDash.printDefaultCompany'));
    const header = escapeHtml(printBrandingSettings.reportHeader || t('repDash.printDefaultHeader'));
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:44px;max-width:140px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString(dateLocale);
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const approvalStatus = isPayrollApproved(currentMonthKey) ? t('finance.payrollApproved') : t('finance.payrollNotApproved');
    const rows = filteredRepsFinance
      .map((r) => `
        <tr>
          <td>${escapeHtml(r.repName)}</td>
          <td>${r.attendanceDays}</td>
          <td>${r.lateAttendanceDays}</td>
          <td>${r.callsCount}/${r.callsTarget}</td>
          <td>${r.avgResponseMins} ${escapeHtml(t('finance.minutesShort'))}</td>
          <td>${r.overdueFollowUps}</td>
          <td>${r.penalties.totalPenalty.toLocaleString(dateLocale)} ${escapeHtml(currency)}</td>
          <td>${r.baseSalary.toLocaleString(dateLocale)} ${escapeHtml(currency)}</td>
          <td>${r.netSalary.toLocaleString(dateLocale)} ${escapeHtml(currency)}</td>
        </tr>
      `)
      .join('');
    const html = `
      <html dir="${dir}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t('finance.payrollPrintTitle', { month: currentMonthKey }))}</title>
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
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">${escapeHtml(t('finance.payrollPrintDate', { date: printDate }))}</p>` : ''}
        <h2>${escapeHtml(t('finance.payrollPrintTitle', { month: currentMonthKey }))}</h2>
        <p>${escapeHtml(t('finance.payrollPrintApprovalStatus', { status: approvalStatus, count: filteredRepsFinance.length }))}</p>
        <div class="cards">
          <div class="card">${escapeHtml(t('finance.payrollPrintCardBase'))}<b>${repsPayrollSummary.totalBase.toLocaleString(dateLocale)} ${escapeHtml(currency)}</b></div>
          <div class="card">${escapeHtml(t('finance.payrollPrintCardNet'))}<b>${repsPayrollSummary.totalNet.toLocaleString(dateLocale)} ${escapeHtml(currency)}</b></div>
          <div class="card">${escapeHtml(t('finance.payrollPrintCardPenalties'))}<b>${repsPayrollSummary.totalPenalties.toLocaleString(dateLocale)} ${escapeHtml(currency)}</b></div>
          <div class="card">${escapeHtml(t('finance.payrollPrintCardAttention'))}<b>${repsPayrollSummary.repsNeedAttention}</b></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t('finance.payrollPrintColRep'))}</th><th>${escapeHtml(t('finance.payrollPrintColAttendance'))}</th><th>${escapeHtml(t('finance.payrollPrintColLate'))}</th><th>${escapeHtml(t('finance.payrollPrintColCalls'))}</th><th>${escapeHtml(t('finance.payrollPrintColAvgResponse'))}</th><th>${escapeHtml(t('finance.payrollPrintColOverdue'))}</th><th>${escapeHtml(t('finance.payrollPrintColPenalties'))}</th><th>${escapeHtml(t('finance.payrollPrintColBase'))}</th><th>${escapeHtml(t('finance.payrollPrintColNet'))}</th>
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
        <SectionTitle title={t('screens.ownerApprovals.title')} subtitle={t('screens.ownerApprovals.subtitle')} icon={ShieldCheck} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-lg">{t('ownerApprovalsPanel.fromAccountantTitle')}</h4>
              <span className="text-xs text-zinc-400">
                {t('ownerApprovalsPanel.requestCount', { count: pendingPayrollRequestsForOwner.length + pendingCustodyFromAccountant.length + pendingExpensesFromAccountant.length })}
              </span>
            </div>
            <div className="space-y-3">
              {pendingPayrollRequestsForOwner.map((req) => (
                <div key={req.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">{t('ownerApprovalsPanel.payrollApprovalRequest', { month: req.monthKey })}</p>
                  <p className="text-xs text-zinc-300 mt-1">
                    {t('ownerApprovalsPanel.claimsTotal', { amount: req.claimsSummary.totalEstimatedAmount.toLocaleString(dateLocale), currency })}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={async () => {
                        const ok = await ownerApprovePayrollRequest(req.id);
                        if (!ok) { toast.error(t('finance.toastPayrollApproveFailed')); return; }
                        toast.success(t('finance.toastPayrollApproveSuccess'));
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >
                      {t('common.approve')}
                    </button>
                    <button
                      onClick={async () => {
                        const reason = window.prompt(t('finance.rejectReasonOptional')) || undefined;
                        const ok = await ownerRejectPayrollRequest(req.id, reason);
                        if (!ok) { toast.error(t('finance.toastPayrollRejectFailed')); return; }
                        toast.info(t('finance.toastPayrollRejectSuccess'));
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black"
                    >
                      {t('common.reject')}
                    </button>
                  </div>
                </div>
              ))}
              {pendingCustodyFromAccountant.map((c) => (
                <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">{t('ownerApprovalsPanel.custodyFromAccountant', { title: c.title })}</p>
                  <p className="text-xs text-zinc-400 mt-1">{t('ownerApprovalsPanel.directedTo', { amount: c.totalAmount.toLocaleString(dateLocale), currency, manager: c.productionManagerName })}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await ownerApproveCustodyRequest(c.id); if (!ok) { toast.error(t('finance.toastApproveFailed')); return; } toast.success(t('ownerApprovalsPanel.toastCustodyApproved')); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                    <button onClick={async () => { const ok = await ownerRejectCustodyRequest(c.id, window.prompt(t('finance.rejectReasonOptional')) || undefined); if (!ok) { toast.error(t('finance.toastRejectFailed')); return; } toast.info(t('ownerApprovalsPanel.toastCustodyRejected')); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                  </div>
                </div>
              ))}
              {pendingExpensesFromAccountant.map((e) => {
                const submitter = expenseSubmitterDisplay(e, users);
                return (
                <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">{t('ownerApprovalsPanel.expenseFromAccountant', { title: e.title })}</p>
                  <p className="text-xs text-zinc-400 mt-1">{(e.totalAmount ?? e.amount).toLocaleString(dateLocale)} {currency}</p>
                  {submitter ? (
                    <p className="text-[11px] text-zinc-500 mt-1">{t('ownerApprovalsPanel.submittedBy', { name: submitter })}</p>
                  ) : null}
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await approveExpense(e.id); if (!ok) { toast.error(t('ownerApprovalsPanel.toastExpenseApproveFailed')); return; } toast.success(t('ownerApprovalsPanel.toastExpenseApprovedShort')); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                    <button onClick={async () => { const ok = await rejectExpense(e.id); if (!ok) { toast.error(t('ownerApprovalsPanel.toastExpenseRejectFailed')); return; } toast.info(t('ownerApprovalsPanel.toastExpenseRejectedShort')); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                  </div>
                </div>
                );
              })}
              {pendingPayrollRequestsForOwner.length === 0 && pendingCustodyFromAccountant.length === 0 && pendingExpensesFromAccountant.length === 0 && (
                <p className="text-xs text-zinc-500">{t('ownerApprovalsPanel.noRequestsFromAccountant')}</p>
              )}
            </div>
          </div>

          <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-lg">{t('ownerApprovalsPanel.fromProductionTitle')}</h4>
              <span className="text-xs text-zinc-400">
                {t('ownerApprovalsPanel.requestCount', { count: pendingCustodyFromProduction.length + pendingExpensesFromProduction.length })}
              </span>
            </div>
            <div className="space-y-3">
              {pendingCustodyFromProduction.map((c) => (
                <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">{t('ownerApprovalsPanel.custodyRequest', { title: c.title })}</p>
                  <p className="text-xs text-zinc-400 mt-1">{c.totalAmount.toLocaleString(dateLocale)} {currency} — {c.productionManagerName}</p>
                  <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{c.description || '—'}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await ownerApproveCustodyRequest(c.id); if (!ok) { toast.error(t('finance.toastApproveFailed')); return; } toast.success(t('ownerApprovalsPanel.toastCustodyApproved')); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                    <button onClick={async () => { const ok = await ownerRejectCustodyRequest(c.id, window.prompt(t('finance.rejectReasonOptional')) || undefined); if (!ok) { toast.error(t('finance.toastRejectFailed')); return; } toast.info(t('ownerApprovalsPanel.toastCustodyRejected')); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                  </div>
                </div>
              ))}
              {pendingExpensesFromProduction.map((e) => {
                const submitter = expenseSubmitterDisplay(e, users);
                return (
                <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                  <p className="font-bold text-white">{t('ownerApprovalsPanel.productionExpenseRequest', { title: e.title })}</p>
                  <p className="text-xs text-zinc-400 mt-1">{(e.totalAmount ?? e.amount).toLocaleString(dateLocale)} {currency} — {e.costCenter}</p>
                  {submitter ? (
                    <p className="text-[11px] text-teal-300/90 mt-1 font-bold">{t('ownerApprovalsPanel.submittedBy', { name: submitter })}</p>
                  ) : null}
                  <div className="flex gap-2 mt-2">
                    <button onClick={async () => { const ok = await approveExpense(e.id); if (!ok) { toast.error(t('ownerApprovalsPanel.toastExpenseApproveFailed')); return; } toast.success(t('ownerApprovalsPanel.toastExpenseApprovedShort')); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                    <button onClick={async () => { const ok = await rejectExpense(e.id); if (!ok) { toast.error(t('ownerApprovalsPanel.toastExpenseRejectFailed')); return; } toast.info(t('ownerApprovalsPanel.toastExpenseRejectedShort')); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                  </div>
                </div>
                );
              })}
              {pendingCustodyFromProduction.length === 0 && pendingExpensesFromProduction.length === 0 && (
                <p className="text-xs text-zinc-500">{t('ownerApprovalsPanel.noRequestsFromProduction')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title={t('screens.finance.title')} subtitle={t('screens.finance.subtitle')} icon={Receipt} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">{t('finance.statCollected')}</p>
          <p className="text-2xl font-black text-emerald-500">{stats.receivablePaid.toLocaleString(dateLocale)} {currency}</p>
          <p className="text-[11px] text-zinc-500 mt-2">{t('finance.statCollectedHint', { count: invoices.filter(i => i.status === 'مدفوع').length })}</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">{t('finance.statReceivablePending')}</p>
          <p className="text-2xl font-black text-amber-500">{stats.receivablePending.toLocaleString(dateLocale)} {currency}</p>
          <p className="text-[11px] text-zinc-500 mt-2">{t('finance.statReceivablePendingHint', { count: invoices.filter(i => i.status === 'قيد الانتظار').length })}</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">{t('finance.statExpensesPaid')}</p>
          <p className="text-2xl font-black text-rose-400">{stats.expensesPaid.toLocaleString(dateLocale)} {currency}</p>
          <p className="text-[11px] text-zinc-500 mt-2">{t('finance.statExpensesPaidHint', { count: expenses.filter(e => e.status === 'مدفوع').length })}</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">{t('finance.statExpensesPending')}</p>
          <p className="text-2xl font-black text-amber-400">{stats.expensesPending.toLocaleString(dateLocale)} {currency}</p>
          <p className="text-[11px] text-zinc-500 mt-2">{t('finance.statExpensesPendingHint', { count: expenses.filter(e => e.approvalStatus === 'قيد الاعتماد').length })}</p>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2.5rem]">
          <p className="text-slate-500 font-bold text-[10px] uppercase mb-1 tracking-widest">{t('finance.statNetCash')}</p>
          <p className={`text-2xl font-black ${stats.netCash >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>{stats.netCash.toLocaleString(dateLocale)} {currency}</p>
          <p className="text-[11px] text-zinc-500 mt-2">{t('finance.statNetCashHint')}</p>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[2rem] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setActiveFinanceTab('invoices')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'invoices' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabInvoices')}</button>
          <button onClick={() => setActiveFinanceTab('expenses')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'expenses' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabExpenses')}</button>
          <button onClick={() => setActiveFinanceTab('ledger')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'ledger' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabLedger')}</button>
          <button onClick={() => setActiveFinanceTab('reports')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'reports' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabReports')}</button>
          <button onClick={() => setActiveFinanceTab('reps')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'reps' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabEmployees')}</button>
          <button onClick={() => setActiveFinanceTab('coa')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'coa' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabCoa')}</button>
          <button onClick={() => setActiveFinanceTab('codebook')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'codebook' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabCodebook')}</button>
          <button onClick={() => setActiveFinanceTab('journals')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'journals' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabJournals')}</button>
          <button onClick={() => setActiveFinanceTab('custody')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeFinanceTab === 'custody' ? 'bg-[#7C6BFF] text-white shadow-lg shadow-[#7C6BFF]/25' : 'bg-[#0F1528] border border-white/10 text-zinc-300 hover:border-[#7C6BFF]/35'}`}>{t('finance.tabCustody')}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
          <button onClick={() => (activeFinanceTab === 'reps' ? printPayrollReport() : window.print())} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">{t('finance.print')}</button>
          <button onClick={exportExecutiveReport} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">{t('finance.executiveReport')}</button>
          <button onClick={exportFinanceCsv} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200 hover:border-white/20 transition-all">{t('finance.exportCsv')}</button>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-[2rem] p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-300">{t('finance.currentMonth')}: <span className="font-black text-white">{currentMonthKey}</span></p>
        <span className={`px-3 py-1 rounded-lg text-xs font-black ${isMonthClosed(currentMonthKey) ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          {isMonthClosed(currentMonthKey) ? t('finance.monthClosed') : t('finance.monthOpen')}
        </span>
        {canCloseMonths && !isMonthClosed(currentMonthKey) && (
          <button
            onClick={async () => {
              const ok = await closeMonth(currentMonthKey);
              if (!ok) {
                toast.error(t('finance.toastMonthCloseFailed'));
                return;
              }
              toast.success(t('finance.toastMonthClosed'));
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            {t('finance.closeMonth')}
          </button>
        )}
        {canCloseMonths && isMonthClosed(currentMonthKey) && (
          <button
            onClick={async () => {
              const ok = await reopenMonth(currentMonthKey);
              if (!ok) {
                toast.error(t('finance.toastMonthReopenFailed'));
                return;
              }
              toast.success(t('finance.toastMonthReopened'));
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
          >
            {t('finance.reopenMonthDirect')}
          </button>
        )}
        <span className={`px-3 py-1 rounded-lg text-xs font-black ${closedFiscalYears.includes(currentYear) ? 'bg-rose-500/20 text-rose-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
          {t('finance.yearLabel', { year: currentYear })}: {closedFiscalYears.includes(currentYear) ? t('finance.yearClosed') : t('finance.yearOpen')}
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
                toast.error(t('finance.toastFiscalYearCloseFailed'));
                return;
              }
              toast.success(t('finance.toastFiscalYearClosed', { year: currentYear }));
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            {t('finance.closeYear')}
          </button>
        )}
        {canCloseMonths && closedFiscalYears.includes(currentYear) && (
          <button
            onClick={async () => {
              const ok = await reopenFiscalYear(currentYear);
              if (!ok) {
                toast.error(t('finance.toastFiscalYearReopenFailed'));
                return;
              }
              toast.success(t('finance.toastFiscalYearReopened', { year: currentYear }));
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
          >
            {t('finance.reopenYear')}
          </button>
        )}
        <span className="text-xs text-zinc-400">{t('finance.openingBalancesCount', { year: String(Number(currentYear) + 1), count: getOpeningBalances(String(Number(currentYear) + 1)).length })}</span>
      </div>
      <div className="bg-slate-900/40 border border-slate-800 rounded-[2rem] p-4 space-y-3">
        <p className="text-sm text-zinc-200 font-black">{t('finance.reopenRequestTitle')}</p>
        {canRequestMonthReopen && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2">
            <input
              value={reopenMonthReason}
              onChange={(e) => setReopenMonthReason(e.target.value)}
              placeholder={t('finance.reopenReasonPlaceholder')}
              className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-xs"
            />
            <button
              onClick={async () => {
                const ok = await requestMonthReopen(currentMonthKey, reopenMonthReason);
                if (!ok) {
                  toast.error(t('finance.toastMonthReopenSendFailed'));
                  return;
                }
                toast.success(t('finance.toastMonthReopenSent'));
                setReopenMonthReason('');
              }}
              className="px-3 py-2 rounded-xl text-xs font-black bg-indigo-500 text-white"
            >
              {t('finance.sendReopenRequest')}
            </button>
          </div>
        )}
        {currentUser?.role === 'مالك' && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">{t('finance.pendingForYou', { count: pendingMonthReopenRequests.length })}</p>
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
                        toast.error(t('finance.toastApproveFailed'));
                        return;
                      }
                      toast.success(t('finance.toastMonthReopenApproved', { monthKey: req.monthKey }));
                    }}
                    className="px-2 py-1 rounded-lg bg-emerald-500 text-slate-950 font-black"
                  >
                    {t('common.approve')}
                  </button>
                  <button
                    onClick={async () => {
                      const reason = window.prompt(t('finance.rejectReasonOptionalShort')) || '';
                      const ok = await ownerRejectMonthReopenRequest(req.id, reason);
                      if (!ok) {
                        toast.error(t('finance.toastRejectFailed'));
                        return;
                      }
                      toast.info(t('finance.toastRequestRejected'));
                    }}
                    className="px-2 py-1 rounded-lg bg-rose-500 text-white font-black"
                  >
                    {t('common.reject')}
                  </button>
                </div>
              </div>
            ))}
            {pendingMonthReopenRequests.length === 0 && <p className="text-xs text-zinc-500">{t('financeExtra.noReopenRequests')}</p>}
          </div>
        )}
      </div>

      {activeFinanceTab === 'invoices' && (
        <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-2xl p-4 text-sm text-zinc-200">
          <p className="font-black text-white mb-1">{t('finance.quotesNoticeTitle')}</p>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {t('finance.quotesNoticeBody')}
            {priceQuotes.filter(q => q.status === 'قيد اعتماد المالك').length > 0 && (
              <span className="block mt-2 text-amber-200/90">
                {t('finance.quotesPendingOwner', { count: priceQuotes.filter(q => q.status === 'قيد اعتماد المالك').length })}
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
                ? t('finance.panelInvoices')
                : activeFinanceTab === 'expenses'
                ? t('finance.panelExpenses')
                : activeFinanceTab === 'ledger'
                ? t('finance.panelLedger')
                : activeFinanceTab === 'reps'
                ? t('finance.panelEmployees')
                : activeFinanceTab === 'coa'
                ? t('finance.panelCoa')
                : activeFinanceTab === 'codebook'
                ? t('finance.panelCodebook')
                : activeFinanceTab === 'journals'
                ? t('finance.panelJournals')
                : activeFinanceTab === 'custody'
                ? t('finance.panelCustody')
                : t('finance.panelReports')}
            </h3>
            {activeFinanceTab === 'invoices' ? (
              <button onClick={() => setIsCreateInvoiceOpen(true)} className="bg-emerald-500 text-slate-950 px-6 py-2.5 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20">
                <Plus className="w-5 h-5" />
                {t('finance.createInvoice')}
              </button>
            ) : activeFinanceTab === 'expenses' ? (
              <button onClick={() => setIsCreateExpenseOpen(true)} className="bg-rose-500 text-white px-6 py-2.5 rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-rose-400 transition-all">
                <Plus className="w-5 h-5" />
                {t('finance.createExpense')}
              </button>
            ) : null}
          </div>
          {activeFinanceTab === 'invoices' && invoiceQuickFilter !== 'all' && (
            <div className="mx-8 mt-4 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2">
              <span className="text-xs text-amber-200 font-bold">{t('finance.invoiceFilterActive')}</span>
              <button onClick={() => setInvoiceQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">{t('finance.clearFilter')}</button>
            </div>
          )}
          {activeFinanceTab === 'expenses' && expenseQuickFilter !== 'all' && (
            <div className="mx-8 mt-4 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2">
              <span className="text-xs text-amber-200 font-bold">{t('finance.expenseFilterActive')}</span>
              <button onClick={() => setExpenseQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">{t('finance.clearFilter')}</button>
            </div>
          )}
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-2xl border border-white/5">
            {activeFinanceTab === 'invoices' && (
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/95">
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colNumber')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colSource')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colCustomer')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colBaseAmount')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colVat')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colTotal')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colCollected')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colRemaining')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colInstallmentDue')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colCostCenter')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colDate')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colStatus')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredInvoiceRows.map((inv, idx) => (
                    <tr key={inv.id} className={`border-r-2 ${inv.status === 'مدفوع' ? 'border-emerald-500/30' : inv.status === 'متأخر' ? 'border-rose-500/30' : 'border-amber-500/30'} ${idx % 2 === 0 ? 'bg-[#0E152B]/55' : 'bg-[#0B1224]/55'} hover:bg-[#1A2440]/55 transition-colors`}>
                      <td className="p-6 font-mono text-emerald-500 text-xs">{inv.id}</td>
                      <td className="p-6 text-[10px] font-bold">
                        <span className={`px-2 py-1 rounded-lg inline-block ${inv.recordOrigin === 'عرض_سعر_معتمد' ? 'bg-emerald-500/15 text-emerald-300' : inv.recordOrigin === 'يدوي_محاسب' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-500/15 text-zinc-400'}`}>
                          {inv.recordOrigin === 'عرض_سعر_معتمد' ? t('finance.originApprovedQuote') : inv.recordOrigin === 'يدوي_محاسب' ? t('finance.originManual') : t('finance.originMigration')}
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
                        <p className="text-[10px] text-zinc-500 mt-1">{t('finance.customerCode', { code: getCustomerCode(inv) })}</p>
                      </td>
                      <td className="p-6 font-black text-white">{inv.amount.toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-indigo-300">{(inv.vatAmount ?? 0).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 font-black text-emerald-300">{(inv.totalAmount ?? inv.amount).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-emerald-300 font-bold">{(inv.paidAmount ?? 0).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-amber-300 font-bold">{(inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0))).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-xs text-zinc-300">{inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString(dateLocale) : '—'}</td>
                      <td className="p-6 text-xs text-zinc-300">{inv.costCenter || t('finance.generalCostCenter')}</td>
                      <td className="p-6 text-xs text-slate-500 font-bold">{new Date(inv.date).toLocaleDateString(dateLocale)}</td>
                      <td className="p-6"><span className={`px-4 py-1.5 rounded-xl text-[9px] font-black inline-flex items-center gap-2 ${inv.status === 'مدفوع' ? 'bg-emerald-500/10 text-emerald-500' : inv.status === 'متأخر' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>{getInvoiceStatusLabel(inv.status, t)}</span></td>
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setInvoiceDetailsId(inv.id)}
                            data-tooltip={t('finance.viewInvoiceDetails')}
                            aria-label={t('finance.viewInvoiceDetails')}
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
                                toast.error(t('finance.toastInvoiceLockedMonth'));
                                return;
                              }
                              toast.success(t('finance.toastInvoiceStatusUpdated', { status: getInvoiceStatusLabel(nextStatus, t) }));
                              })();
                            }}
                            data-tooltip={t('finance.changeInvoiceStatusTooltip')}
                            aria-label={t('finance.changeInvoiceStatusTooltip')}
                            className="icon-tooltip p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white border border-slate-700/50"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              void (async () => {
                              const remaining = inv.remainingAmount ?? Math.max(0, (inv.totalAmount ?? inv.amount) - (inv.paidAmount ?? 0));
                              if (remaining <= 0) {
                                toast.info(t('finance.toastInvoiceFullyPaid'));
                                return;
                              }
                              const amountInput = window.prompt(t('finance.collectionAmountPrompt', { remaining: remaining.toLocaleString(dateLocale), currency }), String(remaining));
                              if (!amountInput) return;
                              const amount = Number(amountInput);
                              if (!Number.isFinite(amount) || amount <= 0) {
                                toast.error(t('finance.toastInvalidAmount'));
                                return;
                              }
                              const methodInput = window.prompt(t('finance.collectionMethodPrompt'), 'تحويل');
                              const method = methodInput === 'كاش' ? 'كاش' : 'تحويل';
                              const nextDueDate = window.prompt(t('finance.nextInstallmentPrompt'), inv.nextDueDate ? inv.nextDueDate.slice(0, 10) : '');
                              const ok = await recordInvoiceCollection(inv.id, {
                                amount,
                                method,
                                nextDueDate: nextDueDate?.trim() || undefined
                              });
                              if (!ok) {
                                toast.error(t('finance.toastCollectionFailed'));
                                return;
                              }
                              toast.success(t('finance.toastCollectionSaved'));
                              })();
                            }}
                            data-tooltip={t('finance.recordCollectionTooltip')}
                            aria-label={t('finance.recordCollectionTooltip')}
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
                    placeholder={t('finance.expenseCodeSearchPh')}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  />
                  <input
                    value={expenseKeywordFilter}
                    onChange={(e) => setExpenseKeywordFilter(e.target.value)}
                    placeholder={t('finance.expenseKeywordSearchPh')}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  />
                  <button
                    onClick={() => { setExpenseCodeFilter(''); setExpenseKeywordFilter(''); }}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs font-black text-zinc-200"
                  >
                    {t('finance.clearFilters')}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newExpenseViewName}
                    onChange={(e) => setNewExpenseViewName(e.target.value)}
                    placeholder={t('finance.savedViewNamePh')}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs min-w-[170px]"
                  />
                  <button
                    onClick={() => {
                      const name = newExpenseViewName.trim();
                      if (!name) { toast.error(t('finance.saveViewNameRequired')); return; }
                      setExpenseSavedViews(prev => [
                        ...prev,
                        { id: `view-${Date.now()}`, name, month: expenseMonthFilter, code: expenseCodeFilter, keyword: expenseKeywordFilter },
                      ]);
                      setNewExpenseViewName('');
                      toast.success(t('finance.viewSaved'));
                    }}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs font-black text-zinc-200"
                  >
                    {t('finance.saveCurrentView')}
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
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="px-2 py-1 rounded-lg bg-white/10 text-zinc-200">{t('finance.movementCount', { count: filteredExpenseSummary.count })}</span>
                  <span className="px-2 py-1 rounded-lg bg-rose-500/15 text-rose-300">{t('finance.expenseTotal', { amount: filteredExpenseSummary.total.toLocaleString(dateLocale), currency })}</span>
                  <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300">{t('finance.expensePaid', { amount: filteredExpenseSummary.paid.toLocaleString(dateLocale), currency })}</span>
                  <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300">{t('finance.expensePending', { amount: filteredExpenseSummary.pending.toLocaleString(dateLocale), currency })}</span>
                </div>
              </div>
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/95">
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colNumber')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colExpenseItem')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colCategory')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colBaseAmount')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colVat')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colTotal')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colCostCenter')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colSubmitter')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colApproval')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colStatus')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colPaymentMethod')}</th>
                    <th className="sticky top-0 z-20 p-4 text-[10px] font-black text-slate-400 uppercase bg-slate-950/95 backdrop-blur">{t('finance.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredExpenseRows.map((exp, idx) => (
                    <tr key={exp.id} className={`border-r-2 ${exp.approvalStatus === 'مرفوض' ? 'border-rose-500/30' : exp.status === 'مدفوع' ? 'border-emerald-500/30' : 'border-amber-500/30'} ${idx % 2 === 0 ? 'bg-[#0E152B]/55' : 'bg-[#0B1224]/55'} hover:bg-[#1A2440]/55 transition-colors`}>
                      <td className="p-6 text-xs font-mono text-rose-400">{exp.id}</td>
                      <td className="p-6">
                        <p className="font-bold">{exp.title}</p>
                        <p className="text-xs text-zinc-400">{exp.vendor || '-'}</p>
                        <p className="text-[10px] text-[#A99FFF] mt-1">{t('finance.expenseCodeLabel', { code: getExpenseCode(exp) })}</p>
                      </td>
                      <td className="p-6">
                        <p>{getExpenseCategoryLabel(exp.category, t)}</p>
                        <p className="text-[10px] text-zinc-500">{expenseCategoryCodeMap[exp.category] || 'EXP-OTH'}</p>
                      </td>
                      <td className="p-6 font-black">{exp.amount.toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-indigo-300">{(exp.vatAmount ?? 0).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 font-black text-rose-300">{(exp.totalAmount ?? exp.amount).toLocaleString(dateLocale)} {currency}</td>
                      <td className="p-6 text-xs text-zinc-300">{exp.costCenter || t('finance.generalCostCenter')}</td>
                      <td className="p-6 text-xs text-zinc-400">{expenseSubmitterDisplay(exp, users) || '—'}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${exp.approvalStatus === 'معتمد' ? 'bg-emerald-500/15 text-emerald-300' : exp.approvalStatus === 'مرفوض' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {getApprovalStatusLabel(exp.approvalStatus, t)}
                        </span>
                        {exp.approvedBy && <p className="text-[10px] text-zinc-500 mt-1">{exp.approvedBy}</p>}
                      </td>
                      <td className="p-6"><span className={`px-4 py-1.5 rounded-xl text-[9px] font-black inline-flex items-center gap-2 ${exp.status === 'مدفوع' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>{getExpenseStatusLabel(exp.status, t)}</span></td>
                      <td className="p-6 text-xs text-zinc-300">
                        {exp.status === 'مدفوع' ? (
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${exp.paymentMethod === 'كاش' ? 'bg-amber-500/20 text-amber-200' : exp.paymentMethod === 'بنك' ? 'bg-sky-500/20 text-sky-200' : 'bg-zinc-700/40 text-zinc-500'}`}>
                            {exp.paymentMethod === 'كاش' || exp.paymentMethod === 'بنك' ? getPaymentMethodLabel(exp.paymentMethod, t) : t('finance.paymentNotSet')}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          {canApproveExpenses && exp.approvalStatus === 'قيد الاعتماد' && (
                            <>
                              <button onClick={() => { void (async () => { const ok = await approveExpense(exp.id); if (!ok) { toast.error(t('finance.toastApproveExpenseFailed')); return; } toast.success(t('finance.toastExpenseApproved')); })(); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-500 text-slate-950">{t('common.approve')}</button>
                              <button onClick={() => { void (async () => { const ok = await rejectExpense(exp.id); if (!ok) { toast.error(t('finance.toastRejectExpenseFailed')); return; } toast.success(t('finance.toastExpenseRejected')); })(); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-rose-500 text-white">{t('common.reject')}</button>
                            </>
                          )}
                          <button
                            data-tooltip={t('finance.changeExpenseStatusTooltip')}
                            aria-label={t('finance.changeExpenseStatusTooltip')}
                            onClick={() => {
                              void (async () => {
                                const next = cycleExpenseStatus(exp.status);
                                if (next === 'مدفوع') {
                                  if (exp.approvalStatus !== 'معتمد') {
                                    toast.error(t('finance.toastExpenseApprovalRequired'));
                                    return;
                                  }
                                  setExpensePaymentPickId(exp.id);
                                  return;
                                }
                                const ok = await updateExpenseStatus(exp.id, next);
                                if (!ok) {
                                  toast.error(t('finance.toastExpenseLockedMonth'));
                                  return;
                                }
                                toast.success(t('finance.toastExpenseStatusUpdated', { status: getExpenseStatusLabel(next, t) }));
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
                      <td colSpan={12} className="p-6 text-center text-zinc-400 text-sm">{t('finance.noMatchingExpenses')}</td>
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
                    <h3 id="expense-pay-method-title" className="font-black text-lg text-white">{t('finance.recordPaymentTitle')}</h3>
                    <p className="text-sm text-zinc-400">{t('finance.recordPaymentHint')}</p>
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
                              toast.error(t('finance.toastExpensePayUpdateFailed'));
                              return;
                            }
                            toast.success(t('finance.toastExpensePaidCash'));
                          })();
                        }}
                      >
                        {getPaymentMethodLabel('كاش', t)}
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
                              toast.error(t('finance.toastExpensePayUpdateFailed'));
                              return;
                            }
                            toast.success(t('finance.toastExpensePaidBank'));
                          })();
                        }}
                      >
                        {getPaymentMethodLabel('بنك', t)}
                      </button>
                      <button type="button" className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-300" onClick={() => setExpensePaymentPickId(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              </>
            )}
            {activeFinanceTab === 'ledger' && (
              <table className="w-full text-right border-collapse">
                <thead><tr className="bg-slate-950/50"><th className="p-6 text-[10px] font-black text-slate-500 uppercase">{t('finance.ledgerColDate')}</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">{t('finance.ledgerColType')}</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">{t('finance.ledgerColDescription')}</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">{t('finance.ledgerColStatus')}</th><th className="p-6 text-[10px] font-black text-slate-500 uppercase">{t('finance.ledgerColMovement')}</th></tr></thead>
                <tbody className="divide-y divide-slate-800/50">
                  {ledgerRows.map(row => (
                    <tr key={`${row.type}-${row.id}`} className={trafficRowClass(row.sign === '+' ? 'safe' : row.sign === '-' ? 'danger' : 'warn')}>
                      <td className="p-6 text-xs text-zinc-400">{new Date(row.date).toLocaleDateString(dateLocale)}</td>
                      <td className="p-6">{row.type}</td>
                      <td className="p-6 font-bold">{row.title}</td>
                      <td className="p-6 text-sm">{row.status}</td>
                      <td className={`p-6 font-black ${row.sign === '+' ? 'text-emerald-400' : row.sign === '-' ? 'text-rose-400' : 'text-zinc-400'}`}>{row.sign === '0' ? '—' : `${row.sign}${row.amount.toLocaleString(dateLocale)} ${currency}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeFinanceTab === 'reps' && (
              <div ref={repsSectionRef} className="p-6 space-y-4">
                <div className="bg-[#0F1528]/70 border border-white/10 rounded-2xl p-4 text-sm text-zinc-300">
                  {t('finance.payrollPageHint')}
                </div>
                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-black">{t('finance.addEmployeeTitle')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      value={newEmployeeForm.name}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder={t('finance.employeeNamePh')}
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    />
                    <select
                      value={newEmployeeForm.role}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, role: e.target.value as User['role'] }))}
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="مندوب">{t('finance.roleSalesRep')}</option>
                      <option value="محاسب">{t('finance.roleAccountant')}</option>
                      <option value="مدير مبيعات">{t('finance.roleSalesManager')}</option>
                      <option value="مدير إنتاج">{t('finance.roleProductionManager')}</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={newEmployeeForm.baseSalary}
                      onChange={(e) => setNewEmployeeForm(prev => ({ ...prev, baseSalary: e.target.value }))}
                      disabled={!PAYROLL_SALARY_ROLES.includes(newEmployeeForm.role)}
                      placeholder={t('finance.baseSalaryPh')}
                      className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-50"
                    />
                    <button onClick={handleAddEmployeeFromAccountant} className="bg-[#7C6BFF] text-white rounded-xl px-3 py-2 text-sm font-black">
                      {t('finance.addEmployeeBtn')}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>{t('finance.totalEmployees', { count: users.length })}</span>
                    <span>•</span>
                    <span>{t('finance.repsCount', { count: users.filter(u => u.role === 'مندوب').length })}</span>
                    <span>•</span>
                    <span>{t('finance.accountantsCount', { count: users.filter(u => u.role === 'محاسب').length })}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <MiniMetricCard title={t('finance.payrollTotalBase')} value={`${repsPayrollSummary.totalBase.toLocaleString(dateLocale)} ${currency}`} hint={t('finance.payrollTotalBaseHint')} icon={Wallet} tone="indigo" />
                  <MiniMetricCard title={t('finance.payrollTotalNet')} value={`${repsPayrollSummary.totalNet.toLocaleString(dateLocale)} ${currency}`} hint={t('finance.payrollTotalNetHint')} icon={CheckCircle2} tone="emerald" />
                  <MiniMetricCard title={t('finance.payrollTotalPenalties')} value={`${repsPayrollSummary.totalPenalties.toLocaleString(dateLocale)} ${currency}`} hint={`${repsPayrollSummary.payrollGapPercent}%`} icon={AlertCircle} tone="rose" />
                  <MiniMetricCard title={t('finance.payrollNeedAttention')} value={repsPayrollSummary.repsNeedAttention} hint={t('finance.payrollNeedAttentionHint')} icon={Users} tone="amber" />
                </div>
                <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-3">
                  <span className={`px-3 py-1 rounded-lg text-xs font-black ${isPayrollApproved(currentMonthKey) ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                    {t('finance.payrollSheetStatus', { month: currentMonthKey, status: isPayrollApproved(currentMonthKey) ? t('finance.payrollApproved') : t('finance.payrollNotApproved') })}
                  </span>
                  {currentPayrollApproval && (
                    <span className="text-xs text-zinc-400">
                      {t('finance.payrollApprovedBy', { name: currentPayrollApproval.approvedByName, date: new Date(currentPayrollApproval.approvedAt).toLocaleString(dateLocale) })}
                    </span>
                  )}
                  <button
                    onClick={exportPayrollCsv}
                    className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200"
                  >
                    {t('finance.exportPayrollCsv')}
                  </button>
                  <button
                    onClick={printPayrollReport}
                    className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200"
                  >
                    {t('finance.printSavePdf')}
                  </button>
                  {currentUser?.role === 'محاسب' && !isPayrollApproved(currentMonthKey) && (
                    <>
                      <button
                        onClick={async () => {
                          const ok = await requestPayrollApproval(currentMonthKey, 'manual');
                          if (!ok) { toast.error(t('finance.toastPayrollRequestExists')); return; }
                          toast.success(t('finance.toastPayrollRequestSent', { month: currentMonthKey }));
                        }}
                        disabled={Boolean(currentPayrollRequest)}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-amber-500 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('finance.requestPayrollApproval')}
                      </button>
                      <div className="flex items-center gap-2 bg-[#0F1528] border border-white/10 rounded-xl px-2 py-1">
                        <span className="text-[11px] text-zinc-400">{t('finance.autoSendDay')}</span>
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
                          if (!ok) { toast.error(t('finance.toastPayrollApproveFailed')); return; }
                          toast.success(t('finance.toastPayrollApprovedMonth', { month: currentMonthKey }));
                        }}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-emerald-500 text-slate-950"
                      >
                        {t('finance.approveOwnerRequest')}
                      </button>
                      <button
                        onClick={async () => {
                          const reason = window.prompt(t('finance.rejectReasonOptional')) || undefined;
                          const ok = await ownerRejectPayrollRequest(currentPayrollRequest.id, reason);
                          if (!ok) { toast.error(t('finance.toastPayrollRejectFailed')); return; }
                          toast.info(t('finance.toastPayrollRejected'));
                        }}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
                      >
                        {t('finance.rejectRequest')}
                      </button>
                    </>
                  )}
                  {currentUser?.role === 'مالك' && isPayrollApproved(currentMonthKey) && (
                    <button
                      onClick={async () => {
                        const ok = await reopenPayroll(currentMonthKey);
                        if (!ok) {
                          toast.error(t('finance.toastPayrollRevokeFailed'));
                          return;
                        }
                        toast.info(t('finance.toastPayrollRevokeSuccess', { month: currentMonthKey }));
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
                    >
                      {t('finance.revokeApproval')}
                    </button>
                  )}
                </div>
                <div className="bg-[#0B1020]/50 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
                  <p className="font-black text-zinc-200">{t('finance.payrollApprovalPanelTitle')}</p>
                  {currentPayrollRequest ? (
                    <>
                      <p className="text-zinc-300">
                        {t('finance.payrollRequestPending', { name: currentPayrollRequest.requestedByName })}
                      </p>
                      <p className="text-zinc-400">
                        {t('finance.payrollClaimsSummary', {
                          exp: currentPayrollRequest.claimsSummary.pendingExpensesCount,
                          prod: currentPayrollRequest.claimsSummary.pendingProdClaimsCount,
                          custody: currentPayrollRequest.claimsSummary.pendingCustodyPaymentsCount,
                          total: currentPayrollRequest.claimsSummary.totalEstimatedAmount.toLocaleString(dateLocale),
                          currency,
                        })}
                      </p>
                    </>
                  ) : latestPayrollRequest ? (
                    <p className="text-zinc-400">
                      {t('finance.lastPayrollRequest', { status: latestPayrollRequest.status })}
                      {latestPayrollRequest.rejectReason ? t('finance.rejectReasonSuffix', { reason: latestPayrollRequest.rejectReason }) : ''}
                    </p>
                  ) : (
                    <p className="text-zinc-500">{t('finance.noPayrollRequestYet')}</p>
                  )}
                </div>
                <div className="bg-[#0B1020]/60 border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px]">
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={payrollSearch}
                      onChange={(e) => setPayrollSearch(e.target.value)}
                      placeholder={t('finance.payrollSearchPh')}
                      className="w-full bg-[#0F1528] border border-white/10 rounded-xl pr-9 pl-3 py-2 text-xs"
                    />
                  </div>
                  <select
                    value={payrollSort}
                    onChange={(e) => setPayrollSort(e.target.value as typeof payrollSort)}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="net_desc">{t('finance.sortNetDesc')}</option>
                    <option value="penalty_desc">{t('finance.sortPenaltyDesc')}</option>
                    <option value="response_asc">{t('finance.sortResponseAsc')}</option>
                    <option value="overdue_desc">{t('finance.sortOverdueDesc')}</option>
                    <option value="name_asc">{t('finance.sortNameAsc')}</option>
                  </select>
                  <select
                    value={payrollRoleFilter}
                    onChange={(e) => setPayrollRoleFilter(e.target.value as typeof payrollRoleFilter)}
                    className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="all">{t('finance.roleFilterAll')}</option>
                    {(['مالك', 'محاسب', 'مدير مبيعات', 'مدير إنتاج', 'مندوب'] as const).map((role) => (
                      <option key={role} value={role}>{t('finance.roleFilter', { role: getRoleLabel(role, t) })}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-zinc-400">{t('finance.rowsShown', { count: filteredRepsFinance.length })}</span>
                </div>
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-2xl border border-white/5">
                  <table className="w-full min-w-[1100px]">
                    <thead>
                      <tr className="bg-[#0B1020]/95">
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colEmployee')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colAttendance')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colCalls')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colAvgResponse')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colOverdueFollowUps')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colTotalPenalties')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colBaseSalary')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colNetSalary')}</th>
                        <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colMachineLog')}</th>
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
                            <div className="text-[10px] text-zinc-500 mt-1">{getRoleLabel(row.role as User['role'], t)}</div>
                          </td>
                          <td className="p-3 text-sm">
                            <div>{t('finance.attendanceDays', { count: row.attendanceDays })}</div>
                            <div className="text-rose-300 text-xs">{t('finance.lateAttendanceDays', { count: row.lateAttendanceDays })}</div>
                          </td>
                          <td className="p-3 text-sm">
                            <div className="font-bold">{row.callsTarget > 0 ? `${row.callsCount}/${row.callsTarget}` : '—'}</div>
                            <div className="w-28 h-1.5 bg-white/10 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-indigo-400" style={{ width: `${row.callsTarget > 0 ? Math.min(100, Math.round((row.callsCount / Math.max(1, row.callsTarget)) * 100)) : 0}%` }} />
                            </div>
                          </td>
                          <td className="p-3 text-sm">{row.callsTarget > 0 ? `${row.avgResponseMins} ${t('common.minutes')}` : '—'}</td>
                          <td className="p-3 text-sm">{row.callsTarget > 0 ? row.overdueFollowUps : '—'}</td>
                          <td className="p-3">
                            <div className="text-rose-300 font-black">{row.penalties.totalPenalty.toLocaleString(dateLocale)} {currency}</div>
                            <div className="text-[11px] text-zinc-500">
                              {t('finance.penaltyBreakdown', { resp: row.penalties.lateResponsePenalty, fup: row.penalties.followUpPenalty, calls: row.penalties.callsPenalty, att: row.penalties.attendancePenalty })}
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
                                  toast.error(t('finance.toastSalarySaveFailed'));
                                  return;
                                }
                                toast.success(t('finance.toastSalaryUpdated', { name: row.repName }));
                                })();
                              }}
                              className="w-28 bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                            />
                            <p className="text-[10px] text-zinc-500 mt-1">{currency}</p>
                          </td>
                          <td className="p-3 font-black text-emerald-300">{row.netSalary.toLocaleString(dateLocale)} {currency}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <button disabled={isPayrollApproved(currentMonthKey)} onClick={() => { void (async () => { const ok = await logAttendance(row.repId, 'in', 'machine'); if (!ok) { toast.error(t('finance.toastCheckInFailed')); return; } toast.success(t('finance.toastCheckInSuccess', { name: row.repName })); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black disabled:opacity-40 disabled:cursor-not-allowed">{t('finance.checkIn')}</button>
                              <button disabled={isPayrollApproved(currentMonthKey)} onClick={() => { void (async () => { const ok = await logAttendance(row.repId, 'out', 'machine'); if (!ok) { toast.error(t('finance.toastCheckOutFailed')); return; } toast.info(t('finance.toastCheckOutSuccess', { name: row.repName })); })(); }} className="px-2 py-1 rounded-lg text-xs bg-amber-500 text-slate-950 font-black disabled:opacity-40 disabled:cursor-not-allowed">{t('finance.checkOut')}</button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredRepsFinance.length === 0 && (
                    <div className="p-8 text-center text-zinc-400 text-sm">{t('finance.noPayrollResults')}</div>
                  )}
                </div>
              </div>
            )}
            {activeFinanceTab === 'coa' && (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input value={coaForm.code} onChange={(e) => setCoaForm(prev => ({ ...prev, code: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder={t('finance.coaCodePh')} />
                  <input value={coaForm.name} onChange={(e) => setCoaForm(prev => ({ ...prev, name: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder={t('finance.coaNamePh')} />
                  <select value={coaForm.type} onChange={(e) => setCoaForm(prev => ({ ...prev, type: e.target.value as ChartOfAccount['type'] }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
                    <option value="asset">{getCoaAccountTypeLabel('asset', t)}</option><option value="liability">{getCoaAccountTypeLabel('liability', t)}</option><option value="equity">{getCoaAccountTypeLabel('equity', t)}</option><option value="revenue">{getCoaAccountTypeLabel('revenue', t)}</option><option value="expense">{getCoaAccountTypeLabel('expense', t)}</option>
                  </select>
                  <button onClick={handleAddAccount} className="bg-indigo-500 text-white rounded-xl font-black text-sm">{t('finance.addCoaAccount')}</button>
                </div>
                <div className="space-y-2 max-h-80 overflow-auto">
                  {chartOfAccounts.map(acc => (
                    <div key={acc.code} className="grid grid-cols-5 gap-2 items-center bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2 text-sm">
                      <span className="font-mono text-zinc-300">{acc.code}</span>
                      <span className="font-bold">{acc.name}</span>
                      <span className="text-zinc-400">{getCoaAccountTypeLabel(acc.type, t)}</span>
                      <span className={`text-xs font-black ${acc.isSystem ? 'text-amber-300' : 'text-emerald-300'}`}>{acc.isSystem ? t('finance.coaSystem') : t('finance.coaCustom')}</span>
                      <button onClick={() => { const ok = removeChartAccount(acc.code); if (!ok) { toast.error(t('finance.toastCoaDeleteFailed')); return; } toast.success(t('finance.coaDeleted')); }} className="bg-rose-500/20 text-rose-300 rounded-lg px-3 py-1 text-xs font-black">
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeFinanceTab === 'codebook' && (
              <div className="p-6 space-y-6">
                <div className="bg-[#0B1020]/70 border border-amber-500/20 rounded-2xl p-4 space-y-3">
                  <h4 className="font-black mb-1">{t('finance.quotePolicyTitle')}</h4>
                  <p className="text-xs text-zinc-400">{t('finance.quotePolicyHint')}</p>
                  <textarea
                    value={accountingPolicy.policyNotes}
                    onChange={(e) => { void updateAccountingPolicy({ policyNotes: e.target.value }); }}
                    rows={3}
                    className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                  />
                  <div>
                    <label className="text-xs font-bold text-zinc-400">{t('finance.allowedCostCentersLabel')}</label>
                    <input
                      value={accountingPolicy.allowedCostCentersForQuotes.join(', ')}
                      onChange={(e) => {
                        void updateAccountingPolicy({
                          allowedCostCentersForQuotes: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                        });
                      }}
                      className="w-full mt-1 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder={t('finance.allowedCostCentersPh')}
                    />
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-xs text-zinc-400">{t('finance.alertAmountLabel', { currency })}</label>
                    <input
                      type="number"
                      value={accountingPolicy.minAmountHighlight || 0}
                      onChange={(e) => { void updateAccountingPolicy({ minAmountHighlight: Math.max(0, Number(e.target.value) || 0) }); }}
                      className="w-36 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    />
                    <span className="text-[10px] text-zinc-500">{t('finance.noAutoHighlight')}</span>
                  </div>
                </div>

                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4">
                  <h4 className="font-black mb-3">{t('finance.expenseCodesTitle')}</h4>
                  <p className="text-xs text-zinc-400 mb-4">{t('finance.expenseCodesHint')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {expenseCodingRules.map((rule) => (
                      <div key={`exp-code-${rule.category}`} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold">{getExpenseCategoryLabel(rule.category, t)}</p>
                          <p className="text-[11px] text-zinc-500">{t('finance.expenseCodeExample', { prefix: rule.prefix || 'EXP-OTH' })}</p>
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
                  <h4 className="font-black mb-3">{t('finance.customerCodeTitle')}</h4>
                  <p className="text-xs text-zinc-400 mb-3">{t('finance.customerCodeHint')}</p>
                  <div className="flex items-center gap-3">
                    <input
                      value={customerCodePrefix}
                      onChange={(e) => setCustomerCodePrefix(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                      className="w-40 bg-[#0B1020] border border-white/15 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder="CUS"
                    />
                    <span className="text-xs text-zinc-400">{t('finance.customerCodeExample', { code: (customerCodePrefix || 'CUS').toUpperCase() })}</span>
                  </div>
                </div>

                <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <h4 className="font-black">{t('finance.journalCodesTitle')}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      value={newJournalCoding.title}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, title: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder={t('finance.journalCodeNamePh')}
                    />
                    <select
                      value={newJournalCoding.accountCode}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, accountCode: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">{t('finance.selectAccount')}</option>
                      {chartOfAccounts.map(acc => <option key={`book-${acc.code}`} value={acc.code}>{acc.code} - {acc.name}</option>)}
                    </select>
                    <input
                      value={newJournalCoding.costCenter}
                      onChange={(e) => setNewJournalCoding(prev => ({ ...prev, costCenter: e.target.value }))}
                      className="bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm"
                      placeholder={t('finance.costCenterPh')}
                    />
                    <button onClick={handleAddJournalCodingRule} className="bg-[#7C6BFF] text-white rounded-xl px-3 py-2 text-sm font-black">
                      {t('finance.addJournalCode')}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {journalCodingRules.map(rule => (
                      <div key={rule.id} className="flex items-center justify-between gap-3 bg-[#0F1528]/70 border border-white/10 rounded-xl px-3 py-2">
                        <div>
                          <p className="font-bold">{rule.title}</p>
                          <p className="text-[11px] text-zinc-400">{rule.accountCode} | {rule.costCenter || t('finance.generalCostCenter')}</p>
                        </div>
                        <button
                          onClick={() => setJournalCodingRules(prev => prev.filter(r => r.id !== rule.id))}
                          className="px-2 py-1 rounded-lg text-xs font-black bg-rose-500/20 text-rose-300"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    ))}
                    {journalCodingRules.length === 0 && <p className="text-xs text-zinc-500">{t('finance.noJournalCodes')}</p>}
                  </div>
                </div>
              </div>
            )}
            {activeFinanceTab === 'journals' && (
              <div className="p-6 space-y-4">
                {journalCodingRules.length > 0 && (
                  <div className="bg-[#0B1020]/70 border border-white/10 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-400">{t('finance.applyReadyCode')}</span>
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
                  <input value={journalForm.description} onChange={(e) => setJournalForm(prev => ({ ...prev, description: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm md:col-span-2" placeholder={t('finance.journalDescPh')} />
                </div>
                <div className="space-y-2">
                  {journalForm.lines.map((line, idx) => (
                    <div key={`line-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <select value={line.accountCode} onChange={(e) => updateJournalLine(idx, { accountCode: e.target.value })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
                        {chartOfAccounts.map(acc => <option key={acc.code} value={acc.code}>{acc.code} - {acc.name}</option>)}
                      </select>
                      <input type="number" min={0} value={line.debit} onChange={(e) => updateJournalLine(idx, { debit: e.target.value, credit: '' })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder={t('finance.debitPh')} />
                      <input type="number" min={0} value={line.credit} onChange={(e) => updateJournalLine(idx, { credit: e.target.value, debit: '' })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder={t('finance.creditPh')} />
                      <input value={line.costCenter} onChange={(e) => updateJournalLine(idx, { costCenter: e.target.value })} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm" placeholder={t('finance.costCenterPh')} />
                      <button onClick={() => setJournalForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))} className="bg-rose-500/20 text-rose-300 rounded-xl px-3 py-2 text-xs font-black">{t('finance.deleteLine')}</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={addJournalLine} className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm font-black">{t('finance.addLine')}</button>
                  <button onClick={handleCreateJournal} className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black">{t('finance.saveJournal')}</button>
                  {journalFocusId && (
                    <button
                      onClick={() => setJournalFocusId(null)}
                      className="px-4 py-2 rounded-xl bg-[#0F1528] border border-white/10 text-sm font-black text-zinc-200"
                    >
                      {t('finance.showAllJournals')}
                    </button>
                  )}
                  <span className="text-xs text-zinc-400">{t('finance.balanceRequired')}</span>
                </div>
                {(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك') && manualJournalEntries.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(t('finance.deleteAllJournalsConfirm'))) return;
                        let deletedCount = 0;
                        for (const entry of [...manualJournalEntries]) {
                          const ok = await removeManualJournalEntry(entry.id);
                          if (ok) deletedCount++;
                        }
                        toast.success(t('finance.toastJournalsDeleted', { count: deletedCount }));
                      }}
                      className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-black text-rose-200 hover:bg-rose-500/25 transition-colors"
                    >
                      {t('finance.deleteAllJournalsBtn')}
                    </button>
                  </div>
                )}
                <div className="space-y-2 max-h-64 overflow-auto">
                  {displayedJournals.map(entry => (
                    <div key={entry.id} className={`rounded-xl p-3 ${journalFocusId === entry.id ? 'bg-indigo-500/10 border border-indigo-400/40' : 'bg-slate-950/40 border border-white/10'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black">{entry.id} - {entry.description}</p>
                          <p className="text-xs text-zinc-500">{new Date(entry.date).toLocaleDateString(dateLocale)}</p>
                        </div>
                        {(currentUser?.role === 'محاسب' || currentUser?.role === 'مالك') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await removeManualJournalEntry(entry.id);
                              if (!ok) {
                                toast.error(t('finance.toastJournalDeleteFailed'));
                              } else {
                                toast.success(t('finance.journalDeleted'));
                              }
                            }}
                            className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-500/25"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                      {entry.lines.map((line, li) => (
                        <div key={`${entry.id}-${li}`} className="grid grid-cols-4 gap-2 text-xs text-zinc-300">
                          <span>{line.accountCode}</span>
                          <span className="text-emerald-300">{line.debit.toLocaleString(dateLocale)}</span>
                          <span className="text-rose-300">{line.credit.toLocaleString(dateLocale)}</span>
                          <span>{line.costCenter || t('finance.generalCostCenter')}</span>
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
                    <h5 className="font-black text-lg">{t('finance.reportPnlTitle')}</h5>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.reportCollectedRevenue')}</span><span className="font-black text-emerald-400">{accountingReport.revenueRecognized.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.reportPaidExpenses')}</span><span className="font-black text-rose-400">{accountingReport.expenseRecognized.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="border-t border-white/10 pt-3 flex justify-between"><span className="font-black">{t('finance.reportOperatingProfit')}</span><span className={`font-black ${accountingReport.grossProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{accountingReport.grossProfit.toLocaleString(dateLocale)} {currency}</span></div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6 space-y-3">
                    <h5 className="font-black text-lg">{t('finance.reportVatTitle')}</h5>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.vatOutput')}</span><span className="font-black text-amber-300">{vatSummary.outputVat.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.vatInput')}</span><span className="font-black text-indigo-300">{vatSummary.inputVat.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="border-t border-white/10 pt-3 flex justify-between"><span className="font-black">{t('finance.netVat')}</span><span className={`font-black ${vatSummary.netVatPayable >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{vatSummary.netVatPayable.toLocaleString(dateLocale)} {currency}</span></div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6 space-y-3">
                    <h5 className="font-black text-lg">{t('finance.reportTrialBalanceQuick')}</h5>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.cashAccount')}</span><span className="font-black">{stats.netCash.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.receivables')}</span><span className="font-black text-amber-300">{accountingReport.receivables.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="flex justify-between text-zinc-300"><span>{t('finance.payables')}</span><span className="font-black text-rose-300">{accountingReport.payables.toLocaleString(dateLocale)} {currency}</span></div>
                    <div className="text-xs text-zinc-500 pt-2">{t('finance.reportOperationalHint')}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">{t('finance.trialBalanceTitle')}</h5>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl border border-white/5">
                      <table className="w-full text-right min-w-[520px]">
                        <thead>
                          <tr className="bg-[#0B1020]/95">
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colAccount')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colDebit')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colCredit')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95 backdrop-blur">{t('finance.colBalance')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {trialBalance.map((row, idx) => (
                            <tr key={row.account} className={`${idx % 2 === 0 ? 'bg-[#0E152B]/45' : 'bg-[#0B1224]/45'} hover:bg-[#1A2440]/45`}>
                              <td className="p-3 text-sm font-bold text-zinc-200">{row.account}</td>
                              <td className="p-3 text-sm text-emerald-300">{row.debit.toLocaleString(dateLocale)}</td>
                              <td className="p-3 text-sm text-rose-300">{row.credit.toLocaleString(dateLocale)}</td>
                              <td className={`p-3 text-sm font-black ${row.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.balance.toLocaleString(dateLocale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">{t('finance.costCenterProfitTitle')}</h5>
                    <div className="space-y-2 max-h-72 overflow-auto pr-1">
                      {costCenterSummary.map(row => (
                        <div key={row.name} className="grid grid-cols-4 gap-2 text-sm border-b border-white/5 pb-2">
                          <span className="font-bold text-zinc-200">{row.name}</span>
                          <span className="text-emerald-300">{row.revenue.toLocaleString(dateLocale)}</span>
                          <span className="text-rose-300">{row.expense.toLocaleString(dateLocale)}</span>
                          <span className={`${row.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.net.toLocaleString(dateLocale)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">{t('finance.profitabilityByCustomer')}</h5>
                    <p className="text-xs text-zinc-500 mb-3">{t('finance.profitabilityHint')}</p>
                    <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-white/5">
                      <table className="w-full min-w-[700px] text-right">
                        <thead>
                          <tr className="bg-[#0B1020]/95">
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">{t('finance.colCustomer')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">{t('finance.colRevenue')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">{t('finance.colAllocatedCost')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">{t('finance.colGrossProfit')}</th>
                            <th className="sticky top-0 z-20 p-3 text-[10px] uppercase tracking-widest text-zinc-400 bg-[#0B1020]/95">{t('finance.colMarginPct')}</th>
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
                              <td className="p-3 text-sm text-emerald-300">{row.revenue.toLocaleString(dateLocale)}</td>
                              <td className="p-3 text-sm text-rose-300">{row.allocatedExpense.toLocaleString(dateLocale)}</td>
                              <td className={`p-3 text-sm font-black ${row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{row.grossProfit.toLocaleString(dateLocale)}</td>
                              <td className={`p-3 text-sm font-black ${row.marginPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{row.marginPct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-slate-950/30 border border-white/10 rounded-2xl p-6">
                    <h5 className="font-black text-lg mb-4">{t('finance.cashflowCalendarTitle')}</h5>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 text-sm">{t('finance.expected7Days')}: <span className="font-black text-emerald-300">{nextWeekCashflow.toLocaleString(dateLocale)} {currency}</span></div>
                      <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 text-sm">{t('finance.expected30Days')}: <span className="font-black text-indigo-300">{monthCashflow.toLocaleString(dateLocale)} {currency}</span></div>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                      {cashflowCalendar.map((row) => (
                        <div key={`cf-${row.date}`} className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3 flex items-center justify-between text-sm">
                          <div>
                            <p className="font-bold text-zinc-200">{new Date(row.date).toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                            <p className="text-[11px] text-zinc-500">{t('finance.expectedInvoicesCount', { count: row.openInvoices })}</p>
                          </div>
                          <p className="font-black text-emerald-300">{row.expectedCollections.toLocaleString(dateLocale)} {currency}</p>
                        </div>
                      ))}
                      {cashflowCalendar.length === 0 && (
                        <p className="text-sm text-zinc-500 text-center py-8">{t('finance.noCashflow30Days')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeFinanceTab === 'custody' && (
              <div className="p-8 space-y-8">
                <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-6 space-y-4">
                  <h5 className="font-black text-lg">{t('finance.custodyCodingTitle')}</h5>
                  <p className="text-xs text-zinc-500">{t('finance.custodyCodingHint')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(['رواتب', 'إيجارات', 'معدات', 'تسويق', 'تشغيل', 'ضيافة', 'نثريات', 'أخرى'] as const).map((cat) => (
                      <div key={cat} className="flex items-center gap-2 bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2">
                        <span className="text-xs text-zinc-400 w-24">{getExpenseCategoryLabel(cat, t)}</span>
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
                  <h5 className="font-black text-lg">{t('finance.createCustodyTitle')}</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                      placeholder={t('finance.custodyTitlePh')}
                      value={custodyForm.title}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, title: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                      placeholder={t('finance.custodyAmountPh')}
                      value={custodyForm.totalAmount}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, totalAmount: e.target.value }))}
                    />
                    <select
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm md:col-span-2"
                      value={custodyForm.productionManagerId}
                      onChange={(e) => setCustodyForm((p) => ({ ...p, productionManagerId: e.target.value }))}
                    >
                      <option value="">{t('finance.selectProductionManager')}</option>
                      {users.filter((u) => u.role === 'مدير إنتاج').map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <textarea
                      className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm md:col-span-2 min-h-[80px]"
                      placeholder={t('finance.custodyDetailsPh')}
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
                        toast.success(t('finance.toastCustodyDraftCreated'));
                        setCustodyForm({ title: '', description: '', totalAmount: '', productionManagerId: '' });
                      } else toast.error(t('finance.toastCustodyDraftFailed'));
                      })();
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black"
                  >
                    {t('finance.saveCustodyDraft')}
                  </button>
                </div>
                <div className="space-y-3">
                  <h5 className="font-black text-lg">{t('finance.custodyLogTitle')}</h5>
                  {custodyFunds.length === 0 && <p className="text-sm text-zinc-500">{t('finance.noCustodyYet')}</p>}
                  {custodyFunds.map((cf) => (
                    <div key={cf.id} className="bg-[#0F1528]/80 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 w-full">
                      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                      <div>
                        <p className="font-bold text-white">{cf.title}</p>
                        <p className="text-xs text-zinc-400">{t('finance.custodyAmountSummary', { amount: cf.totalAmount.toLocaleString(dateLocale), currency, manager: cf.productionManagerName, status: getCustodyStatusLabel(cf.status, t) })}</p>
                        {cf.journalEntryPaymentId && <p className="text-[10px] text-teal-400 mt-1">{t('finance.custodyPaymentJournal', { id: cf.journalEntryPaymentId })}</p>}
                        {(cf.journalEntrySettlementId || cf.journalEntryId) && (
                          <p className="text-[10px] text-emerald-400 mt-1">{t('finance.custodySettlementJournal', { id: cf.journalEntrySettlementId || cf.journalEntryId })}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(cf.status === 'مسودة' || cf.status === 'مرفوض_طلب') && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await submitCustodyDraftToOwner(cf.id);
                              if (ok) toast.success(t('finance.toastCustodySubmitted'));
                              else toast.error(t('finance.toastCustodySubmitFailed'));
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[#7C6BFF] text-white text-xs font-black"
                          >
                            {t('finance.submitToOwner')}
                          </button>
                        )}
                        {cf.status === 'بانتظار_دفع_محاسب' && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRecordCustodyPayment(cf.id, 'كاش');
                                if (ok) toast.success(t('finance.toastCustodyPaidCash'));
                                else toast.error(t('finance.toastCustodyPayFailed'));
                              }}
                              className="px-3 py-1.5 rounded-xl bg-teal-500 text-slate-950 text-xs font-black"
                            >
                              {t('finance.payCashWithJournal')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRecordCustodyPayment(cf.id, 'تحويل');
                                if (ok) toast.success(t('finance.toastCustodyPaidTransfer'));
                                else toast.error(t('finance.toastCustodyPayFailed'));
                              }}
                              className="px-3 py-1.5 rounded-xl bg-indigo-500 text-white text-xs font-black"
                            >
                              {t('finance.payTransferWithJournal')}
                            </button>
                          </>
                        )}
                        {cf.status === 'تسوية_بانتظار_محاسب' && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantApproveCustodySettlement(cf.id);
                                if (ok) toast.success(t('finance.toastCustodySettlementApproved'));
                                else toast.error(t('finance.toastCustodySettlementFailed'));
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black"
                            >
                              {t('finance.approveSettlement')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await accountantRejectCustodySettlement(cf.id);
                                if (ok) toast.info(t('finance.toastCustodyReturned'));
                                else toast.error(t('finance.toastCustodyReturnFailed'));
                              }}
                              className="px-3 py-1.5 rounded-xl bg-rose-500/80 text-white text-xs font-black"
                            >
                              {t('finance.rejectReturn')}
                            </button>
                          </>
                        )}
                      </div>
                      </div>
                      {cf.status === 'تسوية_بانتظار_محاسب' && (
                        <div className="w-full pt-2 border-t border-white/10 space-y-2">
                          <p className="text-[11px] font-black text-amber-200/95">{t('finance.custodyReviewHint')}</p>
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
              {t('finance.monthlyCashflowTitle')}
            </h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[
                  { name: new Date(2024, 0, 1).toLocaleDateString(dateLocale, { month: 'long' }), income: 400000, expense: 190000 },
                  { name: new Date(2024, 1, 1).toLocaleDateString(dateLocale, { month: 'long' }), income: 650000, expense: 230000 },
                  { name: new Date(2024, 2, 1).toLocaleDateString(dateLocale, { month: 'long' }), income: stats.receivablePaid, expense: stats.expensesPaid },
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
                 <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">{t('finance.overdueReceivables')}</p>
                 <p className="text-xl font-black text-rose-400">{stats.receivableLate.toLocaleString(dateLocale)} {currency}</p>
               </div>
               <div className="text-left">
                 <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">{t('finance.netCashflow')}</p>
                 <p className={`text-xl font-black ${stats.netCash >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>{stats.netCash.toLocaleString(dateLocale)} {currency}</p>
               </div>
            </div>
          </div>

          <div className="bg-indigo-600 p-8 rounded-[3rem] text-white shadow-2xl shadow-indigo-600/20 relative overflow-hidden group">
            <div className="absolute top-[-20%] right-[-20%] w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-widest opacity-80 mb-2">{t('finance.accountAlertsTitle')}</p>
              <h5 className="text-xl font-black mb-4">{t('finance.accountAlertsBody', { receivable: stats.receivablePending.toLocaleString(dateLocale), expense: stats.expensesPending.toLocaleString(dateLocale), currency })}</h5>
              <button
                onClick={() => toast.info(t('finance.reviewRecordsToast'))}
                className="w-full bg-white text-indigo-600 py-3 rounded-2xl font-black text-sm hover:bg-slate-100 transition-all shadow-xl"
              >
                {t('finance.reviewRecords')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isCreateInvoiceOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">{t('finance.createInvoiceTitle')}</h3>
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
                      : t('finance.optionalLeadLink')}
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
                      {t('finance.optionalLeadLink')}
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
                <option value="قيد الانتظار">{getInvoiceStatusLabel('قيد الانتظار', t)}</option>
                <option value="مدفوع">{getInvoiceStatusLabel('مدفوع', t)}</option>
                <option value="متأخر">{getInvoiceStatusLabel('متأخر', t)}</option>
              </select>

              <input
                value={invoiceForm.customerName}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, customerName: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2"
                placeholder={t('finance.customerNamePh')}
              />

              <input
                type="number"
                min={1}
                value={invoiceForm.amount}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, amount: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
                placeholder={t('finance.baseAmountPh')}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={invoiceForm.vatRate}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, vatRate: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
                placeholder={t('finance.vatRatePh')}
              />
              <input
                value={invoiceForm.costCenter}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, costCenter: e.target.value }))}
                className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2"
                placeholder={t('finance.costCenterPh')}
              />
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={handleCreateInvoice}
                className="flex-1 bg-emerald-500 text-slate-950 py-3 rounded-2xl font-black"
              >
                {t('finance.saveInvoice')}
              </button>
              <button
                onClick={() => setIsCreateInvoiceOpen(false)}
                className="flex-1 bg-slate-800 border border-slate-700 py-3 rounded-2xl font-black"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreateExpenseOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">{t('finance.createExpenseTitle')}</h3>
              <button onClick={() => setIsCreateExpenseOpen(false)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input value={expenseForm.title} onChange={(e) => setExpenseForm(prev => ({ ...prev, title: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2" placeholder={t('finance.expenseDescPh')} />
              <select value={expenseForm.category} onChange={(e) => setExpenseForm(prev => ({ ...prev, category: e.target.value as any }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                {(['تشغيل', 'رواتب', 'إيجارات', 'معدات', 'تسويق', 'ضيافة', 'نثريات', 'أخرى'] as const).map((cat) => (
                  <option key={cat} value={cat}>{getExpenseCategoryLabel(cat, t)}</option>
                ))}
              </select>
              <select value={expenseForm.status} onChange={(e) => setExpenseForm(prev => ({ ...prev, status: e.target.value as any }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                <option value="قيد الانتظار">{getExpenseStatusLabel('قيد الانتظار', t)}</option><option value="مدفوع">{getExpenseStatusLabel('مدفوع', t)}</option>
              </select>
              <input type="number" min={0} max={100} value={expenseForm.vatRate} onChange={(e) => setExpenseForm(prev => ({ ...prev, vatRate: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder={t('finance.vatRatePh')} />
              <input value={expenseForm.costCenter} onChange={(e) => setExpenseForm(prev => ({ ...prev, costCenter: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder={t('finance.costCenterShortPh')} />
              <input value={expenseForm.vendor} onChange={(e) => setExpenseForm(prev => ({ ...prev, vendor: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder={t('finance.vendorPh')} />
              <input type="number" min={1} value={expenseForm.amount} onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm" placeholder={t('finance.amountPh')} />
              <textarea value={expenseForm.note} onChange={(e) => setExpenseForm(prev => ({ ...prev, note: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm md:col-span-2" placeholder={t('finance.notesOptionalPh')} />
              <div className="md:col-span-2 text-[11px] text-zinc-400">
                {t('finance.expectedAccountingCode')} <span className="font-mono text-[#A99FFF]">{expenseCategoryCodeMap[expenseForm.category] || 'EXP-OTH'}-{toFour(expenses.length + 1)}</span>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={handleCreateExpense} className="flex-1 bg-rose-500 text-white py-3 rounded-2xl font-black">{t('finance.saveExpense')}</button>
              <button onClick={() => setIsCreateExpenseOpen(false)} className="flex-1 bg-slate-800 border border-slate-700 py-3 rounded-2xl font-black">{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {invoiceDetails && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-[2.5rem] p-6">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h3 className="text-xl font-black">{t('finance.invoiceDetailsTitle', { id: invoiceDetails.id })}</h3>
                <p className="text-xs text-zinc-400 mt-1">{invoiceDetails.customerName} • {new Date(invoiceDetails.date).toLocaleDateString(dateLocale)}</p>
              </div>
              <button onClick={() => setInvoiceDetailsId(null)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('finance.invoiceTotal')}</p>
                <p className="font-black text-emerald-300">{(invoiceDetails.totalAmount ?? invoiceDetails.amount).toLocaleString(dateLocale)} {currency}</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('finance.collected')}</p>
                <p className="font-black text-emerald-400">{(invoiceDetails.paidAmount ?? 0).toLocaleString(dateLocale)} {currency}</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('finance.remaining')}</p>
                <p className="font-black text-amber-300">{(invoiceDetails.remainingAmount ?? 0).toLocaleString(dateLocale)} {currency}</p>
              </div>
              <div className="bg-[#0B1020]/70 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('finance.nextInstallmentDue')}</p>
                <p className="font-black text-zinc-200">{invoiceDetails.nextDueDate ? new Date(invoiceDetails.nextDueDate).toLocaleDateString(dateLocale) : '—'}</p>
              </div>
            </div>
            <div className="bg-[#0B1020]/60 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <h4 className="font-black text-sm">{t('finance.collectionsTitle')}</h4>
                <span className="text-xs text-zinc-400">{t('finance.collectionsCount', { count: (invoiceDetails.collections || []).length })}</span>
              </div>
              {(invoiceDetails.collections || []).length === 0 ? (
                <p className="p-4 text-sm text-zinc-400">{t('finance.noCollectionsYet')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="text-[10px] uppercase text-zinc-500">
                        <th className="px-4 py-3">{t('finance.colDate')}</th>
                        <th className="px-4 py-3">{t('finance.colMethod')}</th>
                        <th className="px-4 py-3">{t('finance.colAmount')}</th>
                        <th className="px-4 py-3">{t('finance.colJournalId')}</th>
                        <th className="px-4 py-3">{t('finance.colNote')}</th>
                        <th className="px-4 py-3">{t('finance.openJournal')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(invoiceDetails.collections || []).map((c) => (
                        <tr key={c.id} className="text-sm">
                          <td className="px-4 py-3 text-zinc-300">{new Date(c.date).toLocaleString(dateLocale)}</td>
                          <td className="px-4 py-3 text-indigo-300">{getPaymentMethodLabel(c.method, t)}</td>
                          <td className="px-4 py-3 font-black text-emerald-300">{c.amount.toLocaleString(dateLocale)} {currency}</td>
                          <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">{c.journalEntryId || '—'}</td>
                          <td className="px-4 py-3 text-zinc-400">{c.note || '—'}</td>
                          <td className="px-4 py-3">
                            {c.journalEntryId ? (
                              <button
                                onClick={() => {
                                  setJournalFocusId(c.journalEntryId || null);
                                  setActiveFinanceTab('journals');
                                  setInvoiceDetailsId(null);
                                  toast.success(t('finance.toastJournalOpened', { id: c.journalEntryId }));
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                              >
                                {t('finance.openJournal')}
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
  const { t } = useTranslation();
  const { dir } = useAppDirection();
  const { addPriceQuote, accountingPolicy, users } = useData();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('14');
  const [costCenter, setCostCenter] = useState('عام');
  const [note, setNote] = useState('');
  const [productionUserId, setProductionUserId] = useState('');

  const allowedCC = accountingPolicy.allowedCostCentersForQuotes;
  const productionUsers = useMemo(
    () => users.filter((u) => u.role === 'مدير إنتاج'),
    [users]
  );
  useEffect(() => {
    if (open && lead) {
      setTitle(`عرض سعر — ${lead.company}`);
      setAmount(String(lead.budget || ''));
      setVatRate('14');
      setCostCenter(allowedCC.includes('عام') ? 'عام' : allowedCC[0] || 'عام');
      setNote('');
      setProductionUserId(productionUsers[0]?.id || '');
    }
  }, [open, lead?.id, allowedCC.join(','), productionUsers]);

  useEffect(() => {
    if (!open) return;
    if (allowedCC.length > 0 && !allowedCC.includes(costCenter)) {
      setCostCenter(allowedCC[0]);
    }
  }, [allowedCC.join(','), open]);

  if (!open || !lead) return null;

  const selectedProdUser = productionUsers.find((u) => u.id === productionUserId);

  const submit = async () => {
    if (!title.trim()) { toast.error(t('quoteModal.toastQuoteTitleRequired')); return; }
    if (!productionUserId) {
      toast.error(t('quoteModal.toastProductionManagerRequired'));
      return;
    }
    const amt = 0;
    const vr = Number(vatRate);
    if (Number.isNaN(vr) || vr < 0 || vr > 100) { toast.error(t('quoteModal.toastInvalidVat')); return; }
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
      toast.error(t('quoteModal.toastQuoteSendError', { error: err instanceof Error ? err.message : String(err) }));
      return;
    }
    if (!ok) { toast.error(t('quoteModal.toastQuoteSendFailed')); return; }
    toast.success(t('quoteModal.toastQuoteSent', { name: selectedProdUser?.name || '' }));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[240] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir={dir}>
      <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#0B1020] shadow-2xl p-6 space-y-4">
        <div>
          <p className="text-xs text-zinc-500">{t('quoteModal.pipelineHint')}</p>
          <h3 className="text-lg font-black text-white mt-1">{lead.name} / {lead.company}</h3>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">{t('quoteModal.quoteTitleLabel')} <span className="text-rose-400">*</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm" placeholder={t('quoteModal.quoteTitlePh')} />
        </div>

        {productionUsers.length > 0 ? (
          <div>
            <label className="block text-xs font-bold text-zinc-400 mb-1">
              {t('quoteModal.productionManagerLabel')} <span className="text-rose-400">*</span>
            </label>
            <select
              value={productionUserId}
              onChange={(e) => setProductionUserId(e.target.value)}
              className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">{t('quoteModal.selectProductionManager')}</option>
              {productionUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({getRoleLabel(u.role, t)})</option>
              ))}
            </select>
            {selectedProdUser ? (
              <p className="text-[11px] text-amber-300/80 mt-1">
                {t('quoteModal.productionManagerHint', { name: selectedProdUser.name })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            {t('quoteModal.noProductionManager')}
          </p>
        )}

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">{t('quoteModal.costCenterLabel')}</label>
          <select value={costCenter} onChange={(e) => setCostCenter(e.target.value)} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm">
            {(allowedCC.length > 0 ? allowedCC : ['عام']).map((cc) => (
              <option key={cc} value={cc}>{cc === 'عام' ? t('finance.generalCostCenter') : cc}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-zinc-400 mb-1">{t('quoteModal.detailsNotesLabel')}</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm resize-y" placeholder={t('quoteModal.detailsNotesPh')} />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 border border-white/15">{t('common.cancel')}</button>
          <button
            type="button"
            onClick={submit}
            disabled={!productionUserId}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-amber-500 hover:bg-amber-400 transition-colors disabled:opacity-40"
          >
            {selectedProdUser ? t('quoteModal.submitToPricingNamed', { name: selectedProdUser.name }) : t('quoteModal.submitToPricing')}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Leads Workspace ---

const LEADS_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const LEADS_PAGE_SIZE_STORAGE_KEY = 'prod_system_leads_page_size';

function readLeadsPageSize(): number {
  try {
    const raw = localStorage.getItem(LEADS_PAGE_SIZE_STORAGE_KEY);
    const n = Number(raw);
    if ((LEADS_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n;
  } catch {
    /* ignore */
  }
  return 25;
}

const LeadsWorkspace = ({ onOpenBulkUpload }: { onOpenBulkUpload?: () => void }) => {
  const { leads, users, invoices, expenses, priceQuotes, shootBookings, equipmentBookings, meetingBookings, manualCustomers, currentUser, addLead, addManualCustomer, assignLead, assignLeadsBulk, updateLeadStatus, deleteLead, deleteLeadsBulk } = useData();
  const { t } = useTranslation();
  const { dir, dateLocale } = useAppDirection();
  const { openLeadUpdate, canUpdateLead, LeadRepUpdateModal } = useLeadRepUpdate();
  const [search, setSearch] = useState('');
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsPageSize, setLeadsPageSize] = useState(readLeadsPageSize);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const selectedLeadIdsRef = useRef(selectedLeadIds);
  selectedLeadIdsRef.current = selectedLeadIds;
  const [bulkAssignRepId, setBulkAssignRepId] = useState('');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'الكل' | LeadStatus>('الكل');
  const [sourceFilter, setSourceFilter] = useState<LeadSourceFilter>('all');
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
  const isLeadsDistributionHub =
    currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
  const canSubmitQuoteForLead = (lead: Lead) =>
    !!currentUser &&
    (currentUser.role === 'مدير مبيعات' ||
      (currentUser.role === 'مندوب' && lead.assignedTo === currentUser.id));

  const toastDeleteLeadResult = (r: DeleteLeadResult) => {
    if (r === 'deleted') toast.success(t('leads.deleted'));
    else if (r === 'blocked') toast.error(t('leads.deleteBlocked'));
    else if (r === 'forbidden') toast.error(t('leads.deleteForbidden'));
    else toast.error(t('leads.deleteFailed'));
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
    if (!isLeadsDistributionHub) return;
    try {
      const raw = localStorage.getItem(NAV_INTENT_KEY);
      if (raw) return;
    } catch {
      /* ignore */
    }
    setAssignedFilter('unassigned');
    setSourceFilter('all');
  }, [isLeadsDistributionHub, currentUser?.id]);

  useEffect(() => {
    const applyIntent = () => {
      try {
        const raw = localStorage.getItem(NAV_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as {
          tab?: string;
          leadsAssignedFilter?: 'all' | 'mine' | 'unassigned';
          leadsStatusFilter?: 'الكل' | LeadStatus;
          leadsSourceFilter?: LeadSourceFilter;
          leadsOverdueOnly?: boolean;
          leadsRepUserId?: string;
          leadsClient360Id?: string;
        };
        if (intent.tab !== 'leads') return;
        if (intent.leadsAssignedFilter) setAssignedFilter(intent.leadsAssignedFilter);
        if (intent.leadsStatusFilter) setStatusFilter(intent.leadsStatusFilter);
        if (intent.leadsSourceFilter) setSourceFilter(intent.leadsSourceFilter);
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
    window.addEventListener('prod-system-nav-intent', applyIntent);
    return () => {
      window.removeEventListener('storage', applyIntent);
      window.removeEventListener('focus', applyIntent);
      window.removeEventListener('prod-system-nav-intent', applyIntent);
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

    if (currentUser.role === 'مدير إنتاج') {
      const uid = String(currentUser.id).trim();
      const linkedLeadIds = new Set(
        priceQuotes
          .filter(
            (q) =>
              String(q.productionAssignedId || '').trim() === uid ||
              String(q.pricedById || '').trim() === uid,
          )
          .map((q) => q.leadId)
          .filter(Boolean),
      );
      result = result.filter((l) => linkedLeadIds.has(l.id));
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

    if (currentUser.role !== 'محاسب' && sourceFilter !== 'all') {
      result = result.filter((l) => leadMatchesSourceFilter(l.source, sourceFilter));
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
  }, [leads, invoices, priceQuotes, currentUser, assignedFilter, statusFilter, sourceFilter, overdueOnly, repUserFilterId, search]);

  const leadsPageCount = Math.max(1, Math.ceil(visibleLeads.length / leadsPageSize));
  const paginatedLeads = useMemo(() => {
    const start = (leadsPage - 1) * leadsPageSize;
    return visibleLeads.slice(start, start + leadsPageSize);
  }, [visibleLeads, leadsPage, leadsPageSize]);

  const pageLeadIds = useMemo(() => paginatedLeads.map((l) => l.id), [paginatedLeads]);
  const allPageLeadsSelected =
    pageLeadIds.length > 0 && pageLeadIds.every((id) => selectedLeadIds.has(id));
  const somePageLeadsSelected =
    pageLeadIds.some((id) => selectedLeadIds.has(id)) && !allPageLeadsSelected;

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleSelectCurrentPage = () => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (allPageLeadsSelected) {
        pageLeadIds.forEach((id) => next.delete(id));
      } else {
        pageLeadIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAllVisibleLeads = () => {
    setSelectedLeadIds(new Set(visibleLeads.map((l) => l.id)));
  };

  const clearLeadSelection = () => {
    setSelectedLeadIds(new Set());
    setBulkAssignRepId('');
  };

  const runBulkAssign = async (leadIds: string[], userId: string | undefined) => {
    const ids = [...new Set(leadIds.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length === 0) return;
    const rep = userId ? reps.find((r) => r.id === userId) : undefined;
    if (userId && !rep) {
      toast.error(t('leads.assignRepNotFound'));
      return;
    }
    const assignLabel = userId ? t('leads.assignTargetRep', { name: rep!.name }) : t('common.unassigned');
    const yes = window.confirm(
      ids.length === 1
        ? t('leads.assignConfirmOne', { target: assignLabel })
        : t('leads.assignConfirmMany', { count: ids.length, target: assignLabel }),
    );
    if (!yes) return;
    setBulkAssigning(true);
    try {
      const ok = await assignLeadsBulk(ids, userId);
      if (ok === 0) {
        toast.error(t('leads.assignFailed'));
        return;
      }
      if (ok < ids.length) {
        toast.warning(t('leads.assignPartial', { ok, total: ids.length }));
      } else {
        toast.success(
          ids.length === 1
            ? t('leads.assignDoneOne', { target: assignLabel })
            : t('leads.assignDoneMany', { count: ok, target: assignLabel }),
        );
      }
      clearLeadSelection();
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignRepId) {
      toast.error(t('leads.assignPickRep'));
      return;
    }
    const ids = Array.from(selectedLeadIdsRef.current);
    if (ids.length === 0) return;
    await runBulkAssign(ids, bulkAssignRepId);
  };

  const handleLeadAssignChange = (sourceLeadId: string, userId: string | undefined) => {
    const selected = selectedLeadIdsRef.current;
    const targetIds =
      selected.size > 0 && selected.has(sourceLeadId) ? Array.from(selected) : [sourceLeadId];
    if (targetIds.length > 1) {
      void runBulkAssign(targetIds, userId);
      return;
    }
    assignLead(sourceLeadId, userId);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedLeadIdsRef.current);
    if (ids.length === 0) return;
    const yes = window.confirm(
      ids.length === 1
        ? t('leads.deleteConfirmOne')
        : t('leads.deleteConfirmMany', { count: ids.length }),
    );
    if (!yes) return;
    setBulkDeleting(true);
    try {
      const result = await deleteLeadsBulk(ids);
      if (client360Lead && ids.includes(client360Lead.id)) {
        setClient360Lead(null);
      }
      if (result.deleted === 0) {
        if (result.blocked > 0) {
          toast.error(t('leads.deleteBulkBlocked'));
        } else {
          toast.error(t('leads.deleteBulkFailed'));
        }
        return;
      }
      if (result.blocked > 0 || result.failed > 0) {
        toast.warning(
          t('leads.deleteBulkPartial', {
            deleted: result.deleted,
            blocked: result.blocked,
            failed: result.failed,
          }),
        );
      } else {
        toast.success(t('leads.deleteBulkDone', { count: result.deleted }));
      }
      clearLeadSelection();
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleLeadsPageSizeChange = (size: number) => {
    setLeadsPageSize(size);
    setLeadsPage(1);
    try {
      localStorage.setItem(LEADS_PAGE_SIZE_STORAGE_KEY, String(size));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    setLeadsPage(1);
    setSelectedLeadIds(new Set());
  }, [search, statusFilter, sourceFilter, assignedFilter, overdueOnly, repUserFilterId, entityMode, currentUser?.id, leadsPageSize]);

  useEffect(() => {
    if (leadsPage > leadsPageCount) setLeadsPage(leadsPageCount);
  }, [leadsPage, leadsPageCount]);

  const inboundHubStats = useMemo(() => {
    if (!isLeadsDistributionHub) return null;
    const open = leads.filter(
      (l) => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة',
    );
    const unassigned = open.filter((l) => !l.assignedTo);
    const inboundUnassigned = unassigned.filter((l) => isAutoImportedLeadSource(l.source));
    const bySource = Object.fromEntries(
      INBOUND_CHANNEL_SOURCES.map((src) => [
        src,
        inboundUnassigned.filter((l) => leadMatchesSourceFilter(l.source, src)).length,
      ]),
    ) as Record<(typeof INBOUND_CHANNEL_SOURCES)[number], number>;
    return {
      openTotal: open.length,
      unassignedTotal: unassigned.length,
      inboundUnassignedTotal: inboundUnassigned.length,
      bySource,
    };
  }, [leads, isLeadsDistributionHub]);

  const handleCreateLead = () => {
    const budget = Number(leadForm.budget);
    if (!leadForm.name.trim() || !leadForm.company.trim() || !leadForm.phone.trim() || !budget || budget <= 0) {
      toast.error(t('leadForm.completeRequired'));
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
    toast.success(t('leadForm.addSuccess'));
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
      toast.error(t('settingsToasts.customerAddForbidden'));
      return;
    }
    setCustomerForm({ name: '', company: '', phone: '', email: '', sourceLabel: 'يدوي' });
    setIsAddLeadOpen(false);
    toast.success(t('settingsToasts.customerAdded'));
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

  useEffect(() => {
    if (!client360Lead) return;
    const main = document.querySelector('main.premium-main-layer') as HTMLElement | null;
    const prevOverflow = main?.style.overflow ?? '';
    if (main) main.style.overflow = 'hidden';
    return () => {
      if (main) main.style.overflow = prevOverflow;
    };
  }, [client360Lead]);

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
    <div className="animate-in fade-in duration-500" dir={dir}>
      <SectionTitle
        title={
          entityMode === 'customers'
            ? t('leads.titleCustomers')
            : isLeadsDistributionHub
              ? t('leads.titleAll')
              : t('leads.titleManage')
        }
        subtitle={
          entityMode === 'customers'
            ? t('leads.subtitleCustomers')
            : currentUser?.role === 'محاسب'
              ? t('leads.subtitleAccountant')
              : isLeadsDistributionHub
                ? t('leads.subtitleHub')
                : t('leads.subtitleDefault')
        }
        icon={Users}
      />

      <div className="bg-slate-900/40 border border-slate-800 rounded-[3rem] p-6 md:p-8 mb-6">
        {entityMode === 'leads' && isLeadsDistributionHub && inboundHubStats && (
          <div className="mb-5 rounded-2xl border border-[#7C6BFF]/25 bg-[#7C6BFF]/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-white">{t('leads.inboundTitle')}</p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-lg bg-white/10 text-zinc-200 font-bold">
                  {t('leads.unassignedCount', { count: inboundHubStats.unassignedTotal })}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-200 font-bold">
                  {t('leads.autoUnassignedCount', { count: inboundHubStats.inboundUnassignedTotal })}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAssignedFilter('unassigned');
                  setSourceFilter('all');
                  setStatusFilter('الكل');
                  setOverdueOnly(false);
                }}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-black border ${
                  assignedFilter === 'unassigned' && sourceFilter === 'all'
                    ? 'bg-[#7C6BFF] text-white border-[#7C6BFF]'
                    : 'bg-[#0F1528] text-zinc-300 border-white/15'
                }`}
              >
                {t('leads.allInboundUnassigned')}
              </button>
              {INBOUND_CHANNEL_SOURCES.map((src) => {
                const count = inboundHubStats.bySource[src];
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => {
                      setAssignedFilter('unassigned');
                      setSourceFilter(src);
                      setStatusFilter('الكل');
                      setOverdueOnly(false);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black border ${leadSourceBadgeClass(src)} ${
                      assignedFilter === 'unassigned' && sourceFilter === src ? 'ring-2 ring-white/40' : ''
                    }`}
                  >
                    {inboundChannelLabel(src)}
                    {count > 0 ? ` (${count})` : ''}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setAssignedFilter('all');
                  setSourceFilter('all');
                }}
                className="px-3 py-1.5 rounded-xl text-[11px] font-black bg-[#0F1528] text-zinc-400 border border-white/10"
              >
                {t('common.showAll')}
              </button>
            </div>
          </div>
        )}

        {canUseCustomerMode && (
          <div className="mb-4 flex gap-2">
            <button onClick={() => setEntityMode('leads')} className={`px-4 py-2 rounded-xl text-xs font-black ${entityMode === 'leads' ? 'bg-[#7C6BFF] text-white' : 'bg-[#0F1528] border border-white/10 text-zinc-300'}`}>{t('leads.tabLeads')}</button>
            <button onClick={() => setEntityMode('customers')} className={`px-4 py-2 rounded-xl text-xs font-black ${entityMode === 'customers' ? 'bg-[#7C6BFF] text-white' : 'bg-[#0F1528] border border-white/10 text-zinc-300'}`}>{t('leads.tabCustomers')}</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={entityMode === 'customers' ? t('leads.searchCustomers') : t('leads.searchLeads')}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl pr-11 pl-4 py-3 text-sm"
            />
          </div>

          {entityMode === 'leads' && currentUser?.role !== 'محاسب' && !isSalesManagerLeadDistribution && (<select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'الكل' | LeadStatus)}
            className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
          >
            <option value="الكل">{t('leads.allStatuses')}</option>
            {leadStatuses.map(status => (
              <option key={status} value={status}>{getLeadStatusLabel(status, t)}</option>
            ))}
          </select>)}

          {entityMode === 'leads' && currentUser?.role !== 'محاسب' && (<select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as LeadSourceFilter)}
            className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
          >
            <option value="all">{t('leads.allSources')}</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="google">Google</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email / Gmail</option>
            <option value="manual">{t('leads.sourceManual')}</option>
          </select>)}

          {entityMode === 'leads' && currentUser?.role !== 'محاسب' && (<select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value as 'all' | 'mine' | 'unassigned')}
            className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
          >
            <option value="all">{t('common.all')}</option>
            <option value="mine">{t('leads.filterMine')}</option>
            <option value="unassigned">{t('leads.filterUnassigned')}</option>
          </select>)}
        </div>

        {entityMode === 'leads' && overdueOnly && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2">
            <span className="text-xs text-rose-200 font-bold">{t('leads.overdueFilterActive')}</span>
            <button onClick={() => { setOverdueOnly(false); setRepUserFilterId(''); }} className="px-3 py-1.5 rounded-lg text-xs font-black bg-rose-500 text-white">
              {t('common.showAll')}
            </button>
          </div>
        )}
        {entityMode === 'leads' && repUserFilterId && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2">
            <span className="text-xs text-indigo-200 font-bold">{t('leads.repFilterActive', { name: users.find((u) => u.id === repUserFilterId)?.name || repUserFilterId })}</span>
            <button onClick={() => setRepUserFilterId('')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500 text-white">
              {t('leads.clearRepFilter')}
            </button>
          </div>
        )}

        {entityMode === 'leads' && canCreateLead && (
          <div className="mt-4 flex justify-end gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => onOpenBulkUpload?.()}
              className="bg-emerald-600 text-white px-6 py-3 rounded-2xl text-sm font-black inline-flex items-center gap-2 hover:bg-emerald-500 transition-colors"
            >
              <FileUp className="w-4 h-4" />
              {t('leads.uploadExcelCsv')}
            </button>
            <a
              href="/leads/import"
              className="bg-[#0A66C2] text-white px-6 py-3 rounded-2xl text-sm font-black inline-flex items-center gap-2 hover:bg-[#0958a8] transition-colors"
            >
              <FileUp className="w-4 h-4" />
              {t('leads.importLinkedIn')}
            </a>
            <button
              onClick={() => setIsAddLeadOpen(true)}
            className="bg-[#7C6BFF] text-white px-6 py-3 rounded-2xl text-sm font-black inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('leads.addLead')}
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
              {t('leads.addCustomer')}
            </button>
          </div>
        )}
      </div>

      {entityMode === 'leads' && canManageAssignment && selectedLeadIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#7C6BFF]/35 bg-[#7C6BFF]/10 p-4">
          <span className="text-sm font-black text-white">
            {t('leads.selectedCount', { count: selectedLeadIds.size })}
          </span>
          <button
            type="button"
            onClick={clearLeadSelection}
            className="px-3 py-1.5 rounded-xl text-xs font-black border border-white/20 text-zinc-200 hover:bg-white/10"
          >
            {t('leads.clearSelection')}
          </button>
          {selectedLeadIds.size < visibleLeads.length && (
            <button
              type="button"
              onClick={selectAllVisibleLeads}
              className="px-3 py-1.5 rounded-xl text-xs font-black border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/15"
            >
              {t('leads.selectAllResults', { count: visibleLeads.length })}
            </button>
          )}
          <select
            value={bulkAssignRepId}
            onChange={(e) => setBulkAssignRepId(e.target.value)}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-xs min-w-[160px]"
          >
            <option value="">{t('leads.chooseRep')}</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkAssignRepId || bulkAssigning || bulkDeleting}
            onClick={() => void handleBulkAssign()}
            className="px-4 py-2 rounded-xl text-xs font-black bg-[#7C6BFF] text-white disabled:opacity-50"
          >
            {bulkAssigning ? t('leads.assigning') : t('leads.assignCount', { count: selectedLeadIds.size })}
          </button>
          <button
            type="button"
            disabled={bulkAssigning || bulkDeleting}
            onClick={() => void handleBulkDelete()}
            className="px-4 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {bulkDeleting ? t('leads.deleting') : t('leads.deleteCount', { count: selectedLeadIds.size })}
          </button>
        </div>
      )}

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[950px]">
            <thead>
              {entityMode === 'leads' ? (
                <tr className="bg-[#0B1020]/80">
                  {canManageAssignment && (
                    <th className="p-5 w-12">
                      <input
                        type="checkbox"
                        checked={allPageLeadsSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageLeadsSelected;
                        }}
                        onChange={toggleSelectCurrentPage}
                        aria-label={t('leads.selectPageLeads')}
                        className="h-4 w-4 rounded border-white/30 bg-[#0F1528] accent-[#7C6BFF]"
                      />
                    </th>
                  )}
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colClient')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colDetails')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colCategory')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colRep')}</th>
                  {!isSalesManagerLeadDistribution && <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colStatus')}</th>}
                  {!isSalesManagerLeadDistribution && <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colActions')}</th>}
                </tr>
              ) : (
                <tr className="bg-[#0B1020]/80">
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colClient')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colSource')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colDebit')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colCredit')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colAccountStatus')}</th>
                  <th className="p-5 text-[10px] uppercase tracking-widest text-zinc-400">{t('leads.colActions')}</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-white/10">
              {entityMode === 'leads' ? paginatedLeads.map((lead) => {
                const assignedRep = users.find(u => u.id === lead.assignedTo);
                return (
                  <tr
                    key={lead.id}
                    className={`hover:bg-white/[0.03] transition-colors ${selectedLeadIds.has(lead.id) ? 'bg-[#7C6BFF]/10' : ''}`}
                  >
                    {canManageAssignment && (
                      <td className="p-5 w-12">
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={() => toggleLeadSelection(lead.id)}
                          aria-label={t('leads.selectLead', { name: lead.name })}
                          className="h-4 w-4 rounded border-white/30 bg-[#0F1528] accent-[#7C6BFF]"
                        />
                      </td>
                    )}
                    <td className="p-5">
                      <p className="font-black text-white">{lead.name}</p>
                      <p className="text-xs text-zinc-400 mt-1">{lead.company}</p>
                    </td>
                    <td className="p-5 text-sm">
                      <p>{lead.phone}</p>
                      <p className="text-xs text-zinc-400 mt-1">{lead.budget.toLocaleString(dateLocale)} {t('common.currency')}</p>
                      <span
                        className={`inline-block mt-1.5 text-[10px] font-black px-2 py-0.5 rounded-lg border ${leadSourceBadgeClass(lead.source)}`}
                      >
                        {leadSourceDisplayLabel(lead.source)}
                      </span>
                      {isSalesManagerLeadDistribution && canManageAssignment && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(t('leads.deleteConfirmNamed', { name: lead.name }))) return;
                            toastDeleteLeadResult(await deleteLead(lead.id));
                          }}
                          className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black bg-rose-500/15 text-rose-200 border border-rose-500/35 hover:bg-rose-500/25"
                        >
                          <Trash2 className="w-3 h-3" />
                          {t('leads.deleteLead')}
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
                          onChange={(e) => handleLeadAssignChange(lead.id, e.target.value || undefined)}
                          className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-xs min-w-[150px]"
                        >
                          <option value="">{t('common.noAssignee')}</option>
                          {salesManager && <option value={salesManager.id}>{t('common.atSalesManager')}</option>}
                          {reps.map(rep => (
                            <option key={rep.id} value={rep.id}>{rep.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm font-bold text-zinc-300">{assignedRep?.name || t('common.unassigned')}</span>
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
                              <option key={status} value={status}>{getLeadStatusLabel(status, t)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-zinc-200 font-bold">{getLeadStatusLabel(lead.status, t)}</span>
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
                              {t('leads.priceQuote')}
                            </button>
                          )}
                          {canUpdateLead(lead) && (
                            <button
                              type="button"
                              onClick={() => openLeadUpdate(lead)}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-[#7C6BFF] text-white border border-violet-400/40"
                            >
                              {t('leads.addUpdate')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setClient360Lead(lead);
                            }}
                            className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                          >
                            {t('leads.client360')}
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
                              {t('leads.statement')}
                            </button>
                          )}
                          {canManageAssignment && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(t('leads.deleteConfirmNamed', { name: lead.name }))) return;
                                toastDeleteLeadResult(await deleteLead(lead.id));
                              }}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-rose-500/15 text-rose-200 border border-rose-500/35 hover:bg-rose-500/25 inline-flex items-center gap-1"
                              title={t('leads.deleteLead')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {t('leads.delete')}
                            </button>
                          )}
                          <button
                            onClick={() => toast.info(new Date(lead.updatedAt).toLocaleString(dateLocale))}
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
                      {t('leads.externalSource', { label: c.sourceLabel })}
                    </span>
                  </td>
                  <td className="p-5 text-amber-300 font-black">{c.receivableDebit.toLocaleString(dateLocale)} {t('common.currency')}</td>
                  <td className="p-5 text-emerald-300 font-black">{c.payableCredit.toLocaleString(dateLocale)} {t('common.currency')}</td>
                  <td className="p-5">
                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${c.receivableDebit > 0 ? 'bg-amber-500/20 text-amber-300' : c.payableCredit > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-200'}`}>
                      {c.receivableDebit > 0 ? t('leads.debit') : c.payableCredit > 0 ? t('leads.credit') : t('leads.balanced')}
                    </span>
                  </td>
                  <td className="p-5">
                    <button
                      onClick={() => setStatementCustomer({ name: c.name, customerCode: c.customerCode, sourceLabel: c.sourceLabel, sourceType: c.sourceType })}
                      className="px-3 py-1.5 rounded-lg text-xs font-black bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                    >
                      {t('leads.statement')}
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
            {t('leads.noResults')}
          </div>
        )}

        {entityMode === 'leads' && visibleLeads.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/10 bg-[#0B1020]/50 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-zinc-400">
                {t('leads.showingRange', {
                  from: (leadsPage - 1) * leadsPageSize + 1,
                  to: Math.min(leadsPage * leadsPageSize, visibleLeads.length),
                  total: visibleLeads.length,
                })}
              </p>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="font-bold">{t('leads.perPage')}</span>
                <select
                  value={leadsPageSize}
                  onChange={(e) => handleLeadsPageSizeChange(Number(e.target.value))}
                  className="bg-[#0F1528] border border-white/15 rounded-lg px-2 py-1 text-xs text-zinc-200"
                >
                  {LEADS_PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {leadsPageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={leadsPage <= 1}
                  onClick={() => setLeadsPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-xl text-xs font-black border border-white/15 bg-white/5 disabled:opacity-40"
                >
                  {t('common.previous')}
                </button>
                <span className="text-xs text-zinc-300 font-bold px-2">
                  {leadsPage} / {leadsPageCount}
                </span>
                <button
                  type="button"
                  disabled={leadsPage >= leadsPageCount}
                  onClick={() => setLeadsPage((p) => Math.min(leadsPageCount, p + 1))}
                  className="px-3 py-1.5 rounded-xl text-xs font-black border border-white/15 bg-white/5 disabled:opacity-40"
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <PriceQuoteSubmitModal lead={quoteLead} open={!!quoteLead} onClose={() => setQuoteLead(null)} />

      {isAddLeadOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[220] flex items-center justify-center p-6">
          <div className="bg-[#0E1426] border border-white/10 w-full max-w-2xl rounded-[3rem] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black">{entityMode === 'customers' ? t('leadForm.addCustomerTitle') : t('leadForm.addLeadTitle')}</h3>
              <button onClick={() => setIsAddLeadOpen(false)} className="p-2 hover:bg-white/10 rounded-xl">
                <X className="w-6 h-6" />
              </button>
            </div>

            {entityMode === 'customers' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={customerForm.name} onChange={(e) => setCustomerForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('leadForm.customerName')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.company} onChange={(e) => setCustomerForm(prev => ({ ...prev, company: e.target.value }))} placeholder={t('leadForm.companyOptional')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.phone} onChange={(e) => setCustomerForm(prev => ({ ...prev, phone: e.target.value }))} placeholder={t('leadForm.phone')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.email} onChange={(e) => setCustomerForm(prev => ({ ...prev, email: e.target.value }))} placeholder={t('leadForm.emailOptional')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={customerForm.sourceLabel} onChange={(e) => setCustomerForm(prev => ({ ...prev, sourceLabel: e.target.value }))} placeholder={t('leadForm.sourceExample')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm md:col-span-2" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={leadForm.name} onChange={(e) => setLeadForm(prev => ({ ...prev, name: e.target.value }))} placeholder={t('leadForm.customerName')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.company} onChange={(e) => setLeadForm(prev => ({ ...prev, company: e.target.value }))} placeholder={t('leadForm.companyName')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.phone} onChange={(e) => setLeadForm(prev => ({ ...prev, phone: e.target.value }))} placeholder={t('leadForm.phone')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input value={leadForm.email} onChange={(e) => setLeadForm(prev => ({ ...prev, email: e.target.value }))} placeholder={t('leadForm.emailOptional')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <input type="number" min={1} value={leadForm.budget} onChange={(e) => setLeadForm(prev => ({ ...prev, budget: e.target.value }))} placeholder={t('leadForm.budget')} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm" />
                <select value={leadForm.source} onChange={(e) => setLeadForm(prev => ({ ...prev, source: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm">
                  <option value="يدوي">{t('leads.sourceManual')}</option>
                  <option value="facebook">facebook</option>
                  <option value="instagram">instagram</option>
                  <option value="google">google</option>
                  <option value="linkedin">linkedin</option>
                </select>

                <select value={leadForm.companySize} onChange={(e) => setLeadForm(prev => ({ ...prev, companySize: e.target.value as Lead['companySize'] }))} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm">
                  <option value="صغير">{t('leadForm.companySizeSmall')}</option>
                  <option value="متوسط">{t('leadForm.companySizeMedium')}</option>
                  <option value="كبير">{t('leadForm.companySizeLarge')}</option>
                </select>

                <select value={leadForm.category} onChange={(e) => setLeadForm(prev => ({ ...prev, category: e.target.value as LeadCategory }))} className="bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm">
                  {leadCategories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button onClick={entityMode === 'customers' ? handleAddManualCustomer : handleCreateLead} className="flex-1 bg-[#7C6BFF] text-white py-3 rounded-2xl font-black">{entityMode === 'customers' ? t('leadForm.saveCustomer') : t('leadForm.saveLead')}</button>
              <button onClick={() => setIsAddLeadOpen(false)} className="flex-1 bg-[#0F1528] border border-white/15 py-3 rounded-2xl font-black">{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
      {statementCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[230] flex items-center justify-center p-6">
          <div className="bg-[#0E1426] border border-white/10 w-full max-w-5xl rounded-[2.5rem] p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-black">{t('statement.title', { name: statementCustomer.name })}</h3>
                <p className="text-xs text-zinc-500 mt-1">{t('statement.meta', { code: customerStatementCode, source: statementCustomer.sourceLabel || t('statement.undefinedSource'), count: customerStatementTotals.count })}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportCustomerStatementCsv} className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">{t('statement.exportCsv')}</button>
                <button onClick={printCustomerStatement} className="px-3 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">{t('statement.printPdf')}</button>
                <button onClick={() => setStatementCustomer(null)} className="p-2 hover:bg-white/10 rounded-xl">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('statement.totalInvoices')}</p>
                <p className="text-lg font-black text-white">{customerStatementTotals.total.toLocaleString(dateLocale)} {t('common.currency')}</p>
              </div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('statement.collected')}</p>
                <p className="text-lg font-black text-emerald-300">{customerStatementTotals.paid.toLocaleString(dateLocale)} {t('common.currency')}</p>
              </div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-zinc-400">{t('statement.remainingInstallments')}</p>
                <p className="text-lg font-black text-amber-300">{customerStatementTotals.remaining.toLocaleString(dateLocale)} {t('common.currency')}</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full min-w-[980px] text-right">
                <thead>
                  <tr className="bg-[#0B1020]/80">
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colInvoiceId')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colDate')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colTotal')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colPaid')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colRemaining')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colDueDate')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colStatus')}</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colPayments')}</th>
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
                        <td className="p-4 text-xs text-zinc-300">{new Date(inv.date).toLocaleDateString(dateLocale)}</td>
                        <td className="p-4 font-black text-white">{total.toLocaleString(dateLocale)} {t('common.currency')}</td>
                        <td className="p-4 font-black text-emerald-300">{paid.toLocaleString(dateLocale)} {t('common.currency')}</td>
                        <td className="p-4 font-black text-amber-300">{remaining.toLocaleString(dateLocale)} {t('common.currency')}</td>
                        <td className="p-4 text-xs text-zinc-300">{inv.nextDueDate ? new Date(inv.nextDueDate).toLocaleDateString(dateLocale) : '—'}</td>
                        <td className="p-4 text-xs">
                          <span className={`px-2 py-1 rounded-lg font-black ${inv.status === 'مدفوع' ? 'bg-emerald-500/20 text-emerald-300' : inv.status === 'متأخر' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{inv.status}</span>
                        </td>
                        <td className="p-4 text-xs text-zinc-300">{t('statement.paymentCount', { count: (inv.collections || []).length })}</td>
                      </tr>
                    );
                  })}
                  {customerStatementInvoices.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-zinc-500">{t('statement.noInvoices')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <h4 className="font-black mb-3">{t('statement.paymentsSection')}</h4>
              <div className="overflow-x-auto max-h-[260px]">
                <table className="w-full min-w-[900px] text-right">
                  <thead>
                    <tr className="bg-[#0B1020]/80">
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colPayDate')}</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colInvoiceId')}</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colPayMethod')}</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colPayAmount')}</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colJournalId')}</th>
                      <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('statement.colNote')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {customerStatementCollections.map((col) => (
                      <tr key={col.id} className="hover:bg-white/[0.03]">
                        <td className="p-3 text-xs text-zinc-300">{new Date(col.date).toLocaleString(dateLocale)}</td>
                        <td className="p-3 font-mono text-xs text-indigo-300">{col.invoiceId}</td>
                        <td className="p-3 text-xs text-cyan-300">{col.method}</td>
                        <td className="p-3 font-black text-emerald-300">{col.amount.toLocaleString(dateLocale)} {t('common.currency')}</td>
                        <td className="p-3 font-mono text-[11px] text-zinc-400">{col.journalEntryId || '—'}</td>
                        <td className="p-3 text-xs text-zinc-400">{col.note || '—'}</td>
                      </tr>
                    ))}
                    {customerStatementCollections.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-5 text-center text-zinc-500">{t('statement.noPayments')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {client360Lead && client360Data && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-[350] flex items-center justify-center p-6"
          dir={dir}
          role="dialog"
          aria-modal="true"
          onClick={() => setClient360Lead(null)}
        >
          <div
            className="bg-[#0E1426] border border-white/10 w-full max-w-6xl rounded-[2.5rem] p-6 max-h-[90vh] overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-black">{t('client360.title', { name: client360Lead.name })}</h3>
                <p className="text-xs text-zinc-500 mt-1">{t('client360.subtitle', { company: client360Lead.company, phone: client360Lead.phone, statusLabel: t('leads.colStatus'), status: getLeadStatusLabel(client360Lead.status, t) })}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canUpdateLead(client360Lead) && (
                  <button
                    type="button"
                    onClick={() => openLeadUpdate(client360Lead)}
                    className="px-4 py-2 rounded-xl text-xs font-black bg-[#7C6BFF] text-white"
                  >
                    {t('client360.addUpdate')}
                  </button>
                )}
                <button type="button" onClick={() => setClient360Lead(null)} className="p-2 hover:bg-white/10 rounded-xl">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">{t('client360.totalInvoices')}</p><p className="text-lg font-black text-white">{client360Data.totalRevenue.toLocaleString(dateLocale)} {t('common.currency')}</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">{t('client360.collected')}</p><p className="text-lg font-black text-emerald-300">{client360Data.totalCollected.toLocaleString(dateLocale)} {t('common.currency')}</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">{t('client360.remaining')}</p><p className="text-lg font-black text-amber-300">{client360Data.totalRemaining.toLocaleString(dateLocale)} {t('common.currency')}</p></div>
              <div className="bg-[#0F1528] border border-white/10 rounded-xl p-3"><p className="text-[11px] text-zinc-400">{t('client360.evidenceCount')}</p><p className="text-lg font-black text-cyan-300">{client360Data.evidenceItems.length}</p></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {currentUser?.role !== 'محاسب' && (
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">{t('client360.recentComms')}</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Lead.timeline.slice(0, 10).map((a) => (
                    <div key={a.id} className="border border-white/10 rounded-lg p-2">
                      <p className="text-sm font-bold text-zinc-200">{a.action}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">{a.note || t('client360.noNote')}</p>
                    </div>
                  ))}
                </div>
              </div>
              )}
              {currentUser?.role !== 'محاسب' && (
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">{t('client360.evidenceArchive')}</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Data.evidenceItems.map((a) => (
                    <a key={a.id} href={a.evidenceRef} target="_blank" rel="noreferrer" className="block border border-cyan-500/25 rounded-lg p-2 hover:bg-cyan-500/10">
                      <p className="text-sm font-bold text-cyan-200">{a.action}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">{new Date(a.createdAt).toLocaleString(dateLocale)}</p>
                    </a>
                  ))}
                  {client360Data.evidenceItems.length === 0 && <p className="text-sm text-zinc-500">{t('client360.noEvidence')}</p>}
                </div>
              </div>
              )}
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">{t('client360.invoiceSummary')}</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {client360Data.leadInvoices.map((inv) => (
                    <div key={inv.id} className="border border-white/10 rounded-lg p-2 flex items-center justify-between text-sm">
                      <span className="text-zinc-200 font-bold">{inv.id}</span>
                      <span className="text-emerald-300">{Number(inv.totalAmount ?? inv.amount).toLocaleString(dateLocale)} {t('common.currency')}</span>
                      <span className="text-zinc-400">{inv.status}</span>
                    </div>
                  ))}
                  {client360Data.leadInvoices.length === 0 && <p className="text-sm text-zinc-500">{t('client360.noInvoices')}</p>}
                </div>
              </div>
              <div className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-4">
                <h4 className="font-black mb-3">{t('client360.opsStatus')}</h4>
                <div className="text-xs text-zinc-300 space-y-2">
                  <p>{t('client360.meetings')}: <span className="font-black text-indigo-300">{client360Data.leadMeetings.length}</span></p>
                  <p>{t('client360.shoots')}: <span className="font-black text-amber-300">{client360Data.leadShoots.length}</span></p>
                  <p>{t('client360.equipment')}: <span className="font-black text-cyan-300">{client360Data.leadEquipment.length}</span></p>
                  <p>{t('client360.linkedExpenses')}: <span className="font-black text-rose-300">{client360Data.leadExpenses.length}</span></p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <LeadRepUpdateModal />
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
  } = useData();
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
  const reps = useMemo(() => {
    const seen = new Set<string>();
    return users.filter((u) => u.role === 'مندوب').filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
  }, [users]);
  const [skillsRepId, setSkillsRepId] = useState('');
  useEffect(() => {
    if (reps.length === 0) {
      setSkillsRepId('');
      return;
    }
    if (!reps.some((r) => r.id === skillsRepId)) {
      setSkillsRepId(reps[0].id);
    }
  }, [reps, skillsRepId]);
  const skillsRep = reps.find((r) => r.id === skillsRepId) ?? null;
  const salesManager = users.find(u => u.role === 'مدير مبيعات');
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const canEditBranding = currentUser?.role === 'مالك';
  /** تعديل صف موظف من الجدول (لا يشمل حساب مالك آخر غير المستخدم الحالي) */
  const canOwnerEditEmployeeRow = (em: User) =>
    Boolean(canEditBranding && !(em.role === 'مالك' && em.id !== currentUser?.id));

  const skillOptions = REP_SKILL_PRESETS;
  const canEditRepSkills = currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';
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
  /** مسودة الصف من بيانات الموظف — تُستخدم داخل setEmployeeEdits(prev) حتى لا يُستبدل الراتب بمسودة قديمة من إغلاق سابق */
  const buildEmployeeRowDraft = (u: User) => ({
    name: u.name,
    role: u.role,
    avatar: u.avatar || '',
    email: (u.email || '').trim(),
    baseSalary: String(u.baseSalary ?? 0),
  });
  const [employeePwDraft, setEmployeePwDraft] = useState<Record<string, { pw: string; pw2: string }>>({});
  const [ownerPwdCurrent, setOwnerPwdCurrent] = useState('');
  const [ownerPwdNew, setOwnerPwdNew] = useState('');
  const [ownerPwdConfirm, setOwnerPwdConfirm] = useState('');
  const [ownerPwdSaving, setOwnerPwdSaving] = useState(false);
  const backupSystemData = async () => {
    if (isServerDataMode()) {
      if (isSupabaseDirectMode()) {
        toast.message('النسخ الاحتياطي JSON مرتبط بخادم Express — في وضع Supabase استخدم تصدير لوحة Supabase أو أدوات النسخ الاحتياطي');
        return;
      }
      const token = localStorage.getItem('prod_system_jwt');
      if (!token) {
        toast.error(t('settingsToasts.backupNoToken'));
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
        toast.success(t('settingsToasts.backupServerOk'));
      } catch {
        toast.error(t('settingsToasts.backupServerFailed'));
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
    toast.success(t('settingsToasts.backupLocalOk'));
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
        toast.success(t('settingsWork.restoreSuccess'));
        setTimeout(() => window.location.reload(), 700);
      } catch {
        toast.error(t('settingsWork.invalidBackupFile'));
      }
    };
    reader.readAsText(file);
  };

  const handleLogoUpload = (file: File) => {
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(t('settingsWork.logoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const logoDataUrl = String(reader.result || '');
      updatePrintBrandingSettings({ logoDataUrl });
      toast.success(t('settingsWork.logoUpdated'));
    };
    reader.readAsDataURL(file);
  };

  const handleEmployeeAvatarUpload = (file: File, userId?: string) => {
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(t('settingsWork.imageTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const avatarDataUrl = String(reader.result || '');
      if (userId) {
        const user = users.find((u) => u.id === userId);
        if (!user) return;
        setEmployeeEdits((prev) => {
          const d = prev[userId] ?? buildEmployeeRowDraft(user);
          return { ...prev, [userId]: { ...d, avatar: avatarDataUrl } };
        });
      } else {
        setNewEmployee((prev) => ({ ...prev, avatar: avatarDataUrl }));
      }
      toast.success(t('settingsWork.avatarUploaded'));
    };
    reader.readAsDataURL(file);
  };

  const ensureEdit = (u: User) => {
    setEmployeeEdits((prev) => {
      if (prev[u.id]) return prev;
      return {
        ...prev,
        [u.id]: buildEmployeeRowDraft(u),
      };
    });
  };

  const handleCreateEmployee = async () => {
    const clean = newEmployee.name.trim();
    if (!clean) {
      toast.error(t('finance.toastEmployeeName'));
      return;
    }
    const emailTrim = newEmployee.loginEmail.trim().toLowerCase();
    const pwd = newEmployee.password.trim();
    if (!isServerDataMode()) {
      toast.error(t('settingsToasts.buildRequired'));
      return;
    }
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast.error(t('settingsToasts.emailRequired'));
      return;
    }
    if (pwd.length > 0 && pwd.length < 8) {
      toast.error(t('settingsToasts.passwordMinOrEmpty'));
      return;
    }
    const ok = await addEmployee({
      name: clean,
      role: newEmployee.role,
      avatar: newEmployee.avatar.trim() || undefined,
      email: emailTrim,
      password: pwd.length >= 8 ? pwd : undefined,
      baseSalary: Math.max(0, Math.round(Number(String(newEmployee.baseSalary).replace(/,/g, '')) || 0)),
    });
    if (ok) setNewEmployee({ name: '', role: 'مندوب', avatar: '', loginEmail: '', password: '', baseSalary: '10000' });
  };

  const handleSaveEmployee = async (userId: string) => {
    const employee = users.find((u) => u.id === userId);
    if (!employee) return;
    const draft = employeeEdits[userId] ?? buildEmployeeRowDraft(employee);
    const emailTrim = (draft.email || '').trim().toLowerCase();
    if (canEditBranding && emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast.error(t('settingsToasts.emailInvalid'));
      return;
    }
    const salaryParsed = Math.max(0, Math.round(Number(String(draft.baseSalary).replace(/,/g, '')) || 0));
    const ok = await updateEmployeeProfile(userId, {
      name: draft.name,
      role: draft.role,
      avatar: draft.avatar,
      ...(canEditBranding ? { email: draft.email } : {}),
      ...(canEditBranding ? { baseSalary: salaryParsed } : {}),
    });
    if (!ok) {
      return;
    }
    toast.success(t('settingsToasts.employeeUpdated'));
  };

  const handleDeleteEmployee = async (userId: string, name: string) => {
    const yes = window.confirm(`تأكيد حذف الموظف: ${name} ؟`);
    if (!yes) return;
    const ok = await removeEmployee(userId);
    if (!ok) return;
    toast.success(t('settingsToasts.employeeDeleted'));
  };

  const handleSaveEmployeePassword = async (userId: string) => {
    const d = employeePwDraft[userId];
    if (!d?.pw || d.pw.length < 8) {
      toast.error(t('settingsToasts.passwordMin8'));
      return;
    }
    if (d.pw !== d.pw2) {
      toast.error(t('settingsWork.passwordMismatch'));
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
      toast.error(t('settingsToasts.serverOnly'));
      return;
    }
    if (ownerPwdNew.length < 8) {
      toast.error(t('settingsWork.newPasswordMin8'));
      return;
    }
    if (ownerPwdNew !== ownerPwdConfirm) {
      toast.error(t('settingsWork.passwordMismatch'));
      return;
    }
    setOwnerPwdSaving(true);
    try {
      await patchMyPasswordApi({ currentPassword: ownerPwdCurrent, newPassword: ownerPwdNew });
      setOwnerPwdCurrent('');
      setOwnerPwdNew('');
      setOwnerPwdConfirm('');
      toast.success(t('settingsWork.passwordUpdated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settingsWork.passwordUpdateFailed'));
    } finally {
      setOwnerPwdSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title={t('screens.workDistribution.title')} subtitle={t('screens.workDistribution.subtitle')} icon={Settings} />

      <EquipmentMasterMiniPanel />

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-lg font-black">{t('settingsWork.visualModeTitle')}</h3>
              <p className="text-xs text-zinc-400 mt-1">{t('settingsWork.visualModeHint')}</p>
            </div>
            <div className="inline-flex items-center gap-2 bg-[#0F1528]/80 border border-white/10 rounded-2xl p-1.5">
              <button
                type="button"
                onClick={() => onVisualModeChange?.('classic')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${visualMode === 'classic' ? 'bg-white/15 text-white border border-white/20' : 'text-zinc-300 hover:text-white'}`}
              >
                {t('settingsWork.classic')}
              </button>
              <button
                type="button"
                onClick={() => onVisualModeChange?.('premium')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${visualMode === 'premium' ? 'bg-[#7C6BFF] text-white border border-[#A99FFF]/45' : 'text-zinc-300 hover:text-white'}`}
              >
                {t('settingsWork.premium')}
              </button>
            </div>
          </div>
          <div className="pt-4 border-t border-white/10">
            <LanguageSwitcher />
          </div>
        </div>
      )}

      {canEditBranding && isServerDataMode() && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div>
            <h3 className="text-lg font-black flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-300/90" />
              {t('settingsWork.ownerPasswordTitle')}
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              {t('settingsWork.ownerPasswordHint')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="password"
              autoComplete="current-password"
              value={ownerPwdCurrent}
              onChange={(e) => setOwnerPwdCurrent(e.target.value)}
              placeholder={t('settingsWork.currentPassword')}
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={ownerPwdNew}
              onChange={(e) => setOwnerPwdNew(e.target.value)}
              placeholder={t('settingsWork.newPassword')}
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={ownerPwdConfirm}
              onChange={(e) => setOwnerPwdConfirm(e.target.value)}
              placeholder={t('settingsWork.confirmPassword')}
              className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={ownerPwdSaving || !ownerPwdCurrent.trim()}
            onClick={handleChangeOwnerPassword}
            className="px-4 py-2 rounded-xl text-sm font-black border border-amber-400/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {ownerPwdSaving ? t('settingsWork.saving') : t('settingsWork.savePassword')}
          </button>
        </div>
      )}

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h3 className="text-lg font-black">{t('settingsWork.leadSourcesTitle')}</h3>
              <p className="text-xs text-zinc-400 mt-1">
                {t('settingsWork.leadSourcesHint')}
              </p>
            </div>
            <div className="text-xs text-zinc-300 bg-white/5 px-3 py-2 rounded-xl border border-white/10 shrink-0">
              {t('settingsWork.recipientManager')} <span className="font-black">{salesManager?.name || t('common.unassigned')}</span>
            </div>
          </div>
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-[11px] text-indigo-100/90 leading-relaxed">
            {t('settingsWork.n8nFolderNote')}
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <button
              type="button"
              onClick={() => updateLeadIngestionSettings({ autoRouteToManager: !leadIngestionSettings.autoRouteToManager })}
              className={`px-3 py-2 rounded-xl border font-bold transition-all ${leadIngestionSettings.autoRouteToManager ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}
            >
              {t('settingsWork.autoRouteLabel')} {leadIngestionSettings.autoRouteToManager ? t('settingsWork.autoRouteOn') : t('settingsWork.autoRouteOff')}
            </button>
            {salesManager && (
              <button
                type="button"
                onClick={() => updateLeadIngestionSettings({ managerUserId: salesManager.id })}
                className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:border-white/30 transition-all"
              >
                {t('settingsWork.pinCurrentManager')}
              </button>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <p className="text-sm font-black text-zinc-200">{t('settingsWork.clientWebhookTitle')}</p>
            <p className="text-[11px] text-zinc-500">
              {t('settingsWork.clientWebhookHint')}
            </p>
            <input
              type="url"
              value={leadIngestionSettings.clientNotifyWebhookUrl || ''}
              onChange={(e) => updateLeadIngestionSettings({ clientNotifyWebhookUrl: e.target.value.trim() })}
              placeholder="https://n8n.example.com/webhook/client-notify"
              className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {canEditBranding && (
        <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem] space-y-5">
          <div>
            <h3 className="text-lg font-black">{t('settingsWork.enterpriseTitle')}</h3>
            <p className="text-xs text-zinc-400 mt-1">{t('settingsWork.enterpriseHint')}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">{t('settingsWork.workflowRulesTitle')}</p>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ quoteRequiresOwnerApproval: !workflowRulesSettings.quoteRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.quoteRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.quoteOwnerApproval')} {workflowRulesSettings.quoteRequiresOwnerApproval ? t('settingsWork.quoteApprovalRequired') : t('settingsWork.quoteApprovalFlexible')}
              </button>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ externalMeetingRequiresOwnerApproval: !workflowRulesSettings.externalMeetingRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.externalMeetingRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.externalMeetingApproval')} {workflowRulesSettings.externalMeetingRequiresOwnerApproval ? t('settingsWork.enabled') : t('settingsWork.disabled')}
              </button>
              <button type="button" onClick={() => updateWorkflowRulesSettings({ expenseRequiresOwnerApproval: !workflowRulesSettings.expenseRequiresOwnerApproval })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${workflowRulesSettings.expenseRequiresOwnerApproval ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.expenseOwnerApproval')} {workflowRulesSettings.expenseRequiresOwnerApproval ? t('settingsWork.enabled') : t('settingsWork.expenseAutoApprove')}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">{t('settingsWork.slaMatrixTitle')}</p>
              <label className="block text-xs text-zinc-300">{t('settingsWork.slaWarningAfter')}</label>
              <input type="number" min={5} value={slaEscalationSettings.warningAfterMinutes} onChange={(e) => updateSlaEscalationSettings({ warningAfterMinutes: Number(e.target.value) || 5 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
              <label className="block text-xs text-zinc-300">{t('settingsWork.slaCriticalAfter')}</label>
              <input type="number" min={10} value={slaEscalationSettings.criticalAfterMinutes} onChange={(e) => updateSlaEscalationSettings({ criticalAfterMinutes: Number(e.target.value) || 10 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
              <label className="block text-xs text-zinc-300">{t('settingsWork.slaReassignAfter')}</label>
              <input type="number" min={0} value={slaEscalationSettings.autoReassignAfterHours} onChange={(e) => updateSlaEscalationSettings({ autoReassignAfterHours: Number(e.target.value) || 0 })} className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-xs" />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="font-black text-sm">{t('settingsWork.leadQualityTitle')}</p>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ rejectDuplicateLeads: !leadDataQualitySettings.rejectDuplicateLeads })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.rejectDuplicateLeads ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.rejectDuplicateLeads')} {leadDataQualitySettings.rejectDuplicateLeads ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ duplicatePhone: !leadDataQualitySettings.duplicatePhone })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.duplicatePhone ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.matchDuplicatePhone')} {leadDataQualitySettings.duplicatePhone ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ duplicateEmail: !leadDataQualitySettings.duplicateEmail })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.duplicateEmail ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.matchDuplicateEmail')} {leadDataQualitySettings.duplicateEmail ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ requireCompany: !leadDataQualitySettings.requireCompany })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.requireCompany ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.companyRequired')} {leadDataQualitySettings.requireCompany ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => updateLeadDataQualitySettings({ requireBudget: !leadDataQualitySettings.requireBudget })} className={`w-full px-3 py-2 rounded-xl text-xs font-black border transition-all ${leadDataQualitySettings.requireBudget ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' : 'bg-white/5 border-white/10 text-zinc-300'}`}>
                {t('settingsWork.budgetRequired')} {leadDataQualitySettings.requireBudget ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900/40 border border-slate-800 p-6 rounded-[2rem]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-black">{t('settingsWork.employeesByRoleTitle')}</h3>
          {canEditBranding && (
            <div className="text-xs text-zinc-400">{t('settingsWork.ownerOnlyAdminHint')}</div>
          )}
        </div>
        {canEditBranding && (
          <div className="mb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
              <input
                value={newEmployee.name}
                onChange={(e) => setNewEmployee((p) => ({ ...p, name: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder={t('settingsWork.employeeNamePh')}
              />
              <select
                value={newEmployee.role}
                onChange={(e) => {
                  const role = e.target.value as User['role'];
                  setNewEmployee((p) => ({
                    ...p,
                    role,
                    baseSalary:
                      !p.baseSalary || p.baseSalary.trim() === '' ? '10000' : p.baseSalary,
                  }));
                }}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{getRoleLabel(r, t)}</option>
                ))}
              </select>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={newEmployee.baseSalary}
                onChange={(e) =>
                  setNewEmployee((p) => ({ ...p, baseSalary: e.target.value.replace(/[^\d]/g, '') }))
                }
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder={t('settingsWork.baseSalaryPh')}
              />
              <input
                type="email"
                autoComplete="off"
                value={newEmployee.loginEmail}
                onChange={(e) => setNewEmployee((p) => ({ ...p, loginEmail: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder={t('settingsWork.loginEmailPh')}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={newEmployee.password}
                onChange={(e) => setNewEmployee((p) => ({ ...p, password: e.target.value }))}
                className="bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
                placeholder={t('settingsWork.passwordOptionalPh')}
              />
              <label className="px-3 py-2 rounded-xl text-sm border border-white/10 bg-[#0F1528] text-zinc-200 cursor-pointer text-center flex items-center justify-center min-h-[42px]">
                {t('settingsWork.uploadPhoto')}
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
                  <span className="text-[11px] text-zinc-500 px-2">{t('settingsWork.noPhoto')}</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCreateEmployee}
                className="px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-black text-sm xl:col-span-1"
              >
                {t('settingsWork.addEmployeeAccount')}
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-right">
            <thead>
              <tr className="bg-[#0B1020]/80">
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colName')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colLoginEmail')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colRole')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colPhoto')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colBaseSalary')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colSkillsStatus')}</th>
                {canEditBranding && (
                  <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400 min-w-[170px]">{t('settingsWork.colNewPassword')}</th>
                )}
                {canEditBranding && <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('settingsWork.colOwnerActions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((employee) => {
                const draft = employeeEdits[employee.id] ?? buildEmployeeRowDraft(employee);
                return (
                  <tr key={employee.id} className={trafficRowClass(employee.role === 'مندوب' ? (employee.skills.length > 0 ? 'safe' : 'warn') : 'neutral')}>
                    <td className="p-3 font-bold">
                      {canOwnerEditEmployeeRow(employee) ? (
                        <input
                          value={draft.name}
                          onFocus={() => ensureEdit(employee)}
                          onChange={(e) =>
                            setEmployeeEdits((prev) => {
                              const d = prev[employee.id] ?? buildEmployeeRowDraft(employee);
                              return { ...prev, [employee.id]: { ...d, name: e.target.value } };
                            })
                          }
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
                            setEmployeeEdits((prev) => {
                              const d = prev[employee.id] ?? buildEmployeeRowDraft(employee);
                              return { ...prev, [employee.id]: { ...d, email: e.target.value } };
                            })
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
                              const d = prev[employee.id] ?? buildEmployeeRowDraft(employee);
                              const nextBase =
                                d.baseSalary && d.baseSalary.trim() !== ''
                                  ? d.baseSalary
                                  : String(employee.baseSalary ?? 10000);
                              return { ...prev, [employee.id]: { ...d, role, baseSalary: nextBase } };
                            });
                          }}
                          className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                        >
                          {roleOptions.map((r) => (
                            <option key={r} value={r}>
                              {getRoleLabel(r, t)}
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
                            {t('settingsWork.uploadShort')}
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
                      {canOwnerEditEmployeeRow(employee) ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={draft.baseSalary}
                            onFocus={() => ensureEdit(employee)}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => {
                                const d = prev[employee.id] ?? buildEmployeeRowDraft(employee);
                                return {
                                  ...prev,
                                  [employee.id]: { ...d, baseSalary: e.target.value.replace(/[^\d]/g, '') },
                                };
                              })
                            }
                            className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-mono w-full min-w-0"
                            placeholder="0"
                          />
                          <span className="text-[10px] text-zinc-500 shrink-0">{t('common.currency')}</span>
                        </div>
                      ) : (
                        `${(employee.baseSalary || 0).toLocaleString(dateLocale)} ${t('common.currency')}`
                      )}
                    </td>
                    <td className="p-3 text-xs text-zinc-300">
                      {employee.role === 'مندوب'
                        ? (employee.skills.length > 0 ? t('settingsWork.skillsReady', { count: employee.skills.length }) : t('settingsWork.skillsNeeded'))
                        : t('settingsWork.skillsNotRequired')}
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
                              placeholder={t('settingsWork.newPasswordShortPh')}
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
                              placeholder={t('settingsWork.confirmPasswordShortPh')}
                              className="bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveEmployeePassword(employee.id)}
                              className="px-2 py-1.5 rounded-lg text-[11px] font-black border border-amber-400/35 text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 transition-colors"
                            >
                              {t('settingsWork.saveEmployeePassword')}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                    {canEditBranding && (
                      <td className="p-3">
                        {employee.role === 'مالك' || employee.id === currentUser?.id ? (
                          <span className="text-[11px] text-zinc-500">
                            {employee.id === currentUser?.id ? t('settingsWork.ownerRowNote') : t('settingsWork.ownerAccountNote')}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleSaveEmployee(employee.id)} className="px-2 py-1 rounded-lg text-[11px] border border-emerald-400/30 text-emerald-200 bg-emerald-500/10">{t('settingsWork.saveRow')}</button>
                            <button type="button" onClick={() => handleDeleteEmployee(employee.id, employee.name)} className="px-2 py-1 rounded-lg text-[11px] border border-rose-400/30 text-rose-200 bg-rose-500/10">{t('settingsWork.deleteRow')}</button>
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
              {t('settingsWork.autoDistributionTitle')}
            </h3>
            <div className="w-12 h-6 bg-emerald-500 rounded-full relative">
              <div className="absolute left-7 top-1 w-4 h-4 bg-white rounded-full" />
            </div>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed mb-6 font-bold whitespace-pre-line">
            {t('settingsWork.autoDistributionBody')}
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem] space-y-5">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-3">
              <Users className="w-5 h-5 text-indigo-400" />
              {t('settingsWork.repSkillsTitle')}
            </h3>
            <p className="text-sm text-slate-500 mt-2 font-bold">
              {t('settingsWork.repSkillsHint')}
            </p>
          </div>
          {reps.length === 0 ? (
            <p className="text-sm text-zinc-500">{t('settingsWork.noRepsYet')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {reps.map((rep) => {
                  const selected = rep.id === skillsRepId;
                  return (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => setSkillsRepId(rep.id)}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black transition-all border ${
                        selected
                          ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-100'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      <img src={rep.avatar} className="w-7 h-7 rounded-lg border border-slate-700 object-cover" alt="" />
                      {rep.name}
                    </button>
                  );
                })}
              </div>
              {skillsRep && (
                <>
                  <div className="flex items-center gap-4 pt-1">
                    <img src={skillsRep.avatar} className="w-14 h-14 rounded-2xl border-2 border-slate-800 object-cover" alt="" />
                    <div>
                      <h4 className="font-black text-lg">{skillsRep.name}</h4>
                      <div className="flex gap-4 mt-1">
                        <span className="text-xs text-emerald-500 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {t('settingsWork.dealsWon', { count: skillsRep.stats.dealsWon })}
                        </span>
                        <span className="text-xs text-amber-500 font-bold flex items-center gap-1">
                          <Star className="w-3 h-3" /> {t('settingsWork.points', { count: skillsRep.stats.points })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <RepSkillsEditor
                    key={skillsRep.id}
                    rep={skillsRep}
                    canEdit={canEditRepSkills}
                    updateUserSkills={updateUserSkills}
                    presets={skillOptions}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem] space-y-4">
        <h3 className="text-xl font-black">{t('settingsWork.printBrandingTitle')}</h3>
        <p className="text-sm text-zinc-400">{t('settingsWork.printBrandingHint')}</p>
        {!canEditBranding && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200">
            {t('settingsWork.ownerOnlyBranding')}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={printBrandingSettings.companyName}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ companyName: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder={t('settingsWork.companyName')}
          />
          <div className="flex items-center gap-2 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2">
            <span className="text-xs text-zinc-400">{t('settingsWork.reportColor')}</span>
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
              {t('settingsWork.uploadLogo')}
            </button>
            {printBrandingSettings.logoDataUrl && canEditBranding && (
              <button
                onClick={() => updatePrintBrandingSettings({ logoDataUrl: '' })}
                className="px-3 py-2 rounded-xl text-sm font-black bg-rose-500/20 text-rose-300"
              >
                {t('settingsWork.removeLogo')}
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
            {t('settingsWork.showPrintDate')}
          </label>
          <label className="flex items-center gap-2 text-sm bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={printBrandingSettings.showPageNumbers}
              disabled={!canEditBranding}
              onChange={(e) => updatePrintBrandingSettings({ showPageNumbers: e.target.checked })}
            />
            {t('settingsWork.showPageNumbers')}
          </label>
        </div>
        <textarea
          value={printBrandingSettings.reportHeader}
          disabled={!canEditBranding}
          onChange={(e) => updatePrintBrandingSettings({ reportHeader: e.target.value })}
          className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px] disabled:opacity-60"
          placeholder={t('settingsWork.reportHeader')}
        />
        <textarea
          value={printBrandingSettings.reportFooter}
          disabled={!canEditBranding}
          onChange={(e) => updatePrintBrandingSettings({ reportFooter: e.target.value })}
          className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px] disabled:opacity-60"
          placeholder={t('settingsWork.reportFooter')}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={printBrandingSettings.signatureName || ''}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ signatureName: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder={t('settingsWork.signatureName')}
          />
          <input
            value={printBrandingSettings.signatureTitle || ''}
            disabled={!canEditBranding}
            onChange={(e) => updatePrintBrandingSettings({ signatureTitle: e.target.value })}
            className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm disabled:opacity-60"
            placeholder={t('settingsWork.signatureTitle')}
          />
        </div>
        {printBrandingSettings.logoDataUrl && (
          <div className="bg-[#0B1020]/60 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-zinc-400 mb-2">{t('settingsWork.logoPreview')}</p>
            <img src={printBrandingSettings.logoDataUrl} alt="company logo" className="h-16 w-auto object-contain" />
          </div>
        )}
      </div>
      <div className="bg-slate-900/40 border border-slate-800 p-8 rounded-[3rem]">
        <h3 className="text-xl font-black mb-4">{t('settingsWork.backupTitle')}</h3>
        <p className="text-sm text-zinc-400 mb-5">
          {t('settingsWork.backupBody')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={backupSystemData} className="px-4 py-2 rounded-xl text-sm font-black bg-[#7C6BFF] text-white">{t('settingsWork.downloadBackup')}</button>
          <button onClick={() => restoreInputRef.current?.click()} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">{t('settingsWork.restoreBackup')}</button>
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

const REP_QUOTE_STEP_DOT: Record<RepQuotePipelineStepState, string> = {
  done: 'bg-emerald-500 border-emerald-400',
  active: 'bg-indigo-500 border-indigo-300 ring-2 ring-indigo-400/40',
  pending: 'bg-zinc-700 border-zinc-600',
  failed: 'bg-rose-500 border-rose-400',
};

const RepQuotePipelineCard = ({
  quote,
  onOpenLead,
}: {
  quote: PriceQuote;
  onOpenLead: (leadId: string) => void;
}) => {
  const info = getRepQuotePipelineInfo(quote);
  const amountLabel =
    quote.status === 'بانتظار التسعير' && !(quote.amount > 0)
      ? 'بانتظار التسعير'
      : quote.amount > 0
        ? `${(quote.totalAmount ?? quote.amount).toLocaleString('ar-EG')} ج.م`
        : '—';

  return (
    <div className="bg-[#0F1528]/80 border border-white/10 rounded-2xl p-4 space-y-3 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => quote.leadId && onOpenLead(quote.leadId)}
            className="text-right font-black text-white text-sm hover:text-indigo-300 hover:underline underline-offset-2 transition-colors"
          >
            {quote.title}
          </button>
          <p className="text-xs text-zinc-400 mt-0.5">{quote.customerName}</p>
          <p className="text-[10px] text-zinc-500 mt-1">
            أُرسل {new Date(quote.createdAt).toLocaleDateString('ar-EG')}
            {quote.productionAssignedName ? ` · إنتاج: ${quote.productionAssignedName}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${
              info.isFailure
                ? 'bg-rose-500/15 text-rose-200 border-rose-500/35'
                : info.isTerminal
                  ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35'
                  : 'bg-indigo-500/15 text-indigo-200 border-indigo-500/35'
            }`}
          >
            {info.statusLabel}
          </span>
          <span className="text-[10px] text-zinc-400 font-bold">{amountLabel}</span>
        </div>
      </div>

      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex items-center min-w-[520px] gap-0">
          {info.steps.map((step, idx) => (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center gap-1 min-w-[72px] max-w-[88px]">
                <div
                  className={`h-3 w-3 rounded-full border-2 shrink-0 ${REP_QUOTE_STEP_DOT[step.state]}`}
                  title={step.label}
                />
                <span
                  className={`text-[9px] font-black text-center leading-tight ${
                    step.state === 'active'
                      ? 'text-indigo-200'
                      : step.state === 'done'
                        ? 'text-emerald-300/90'
                        : step.state === 'failed'
                          ? 'text-rose-300'
                          : 'text-zinc-500'
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-[8px] text-zinc-600 text-center leading-tight">{step.sub}</span>
              </div>
              {idx < info.steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 min-w-[12px] mb-4 rounded-full ${
                    step.state === 'done' && info.steps[idx + 1]?.state !== 'pending'
                      ? 'bg-emerald-500/60'
                      : step.state === 'failed'
                        ? 'bg-rose-500/40'
                        : 'bg-zinc-700'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {info.statusHint ? <p className="text-[11px] text-zinc-400 leading-relaxed">{info.statusHint}</p> : null}
    </div>
  );
};

const RepProfessionalDashboard = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const { t } = useTranslation();
  const { dateLocale, dir } = useAppDirection();
  const currency = t('common.currency');
  const { leads, logLeadInteraction, updateLeadStatus, setLeadFollowUp, printBrandingSettings, priceQuotes, repRecordClientAcceptance, repRecordClientRejection } = useData();
  const { openInteraction, openLeadUpdate, LeadRepUpdateModal } = useLeadRepUpdate();
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
    if (!lines.length) { toast.error(t('repDash.enterPaymentDetails')); return; }
    const payments: ClientPayment[] = lines.map((l) => ({
      id: l.id,
      amount: Math.round(Number(l.amount)),
      dueDate: l.dueDate,
      method: l.method,
      note: l.note.trim() || undefined,
    }));
    const ok = await repRecordClientAcceptance(clientRespQuote.id, payments);
    if (ok) {
      toast.success(t('repDash.acceptanceSaved'));
      setClientRespQuote(null);
    } else {
      toast.error(t('repDash.saveFailed'));
    }
  };

  const submitClientRejection = async () => {
    if (!clientRespQuote) return;
    const ok = await repRecordClientRejection(clientRespQuote.id, clientRejectionNote.trim() || undefined);
    if (ok) {
      toast.warning(t('repDash.rejectionSaved'));
      setClientRespQuote(null);
    } else {
      toast.error(t('repDash.saveFailed'));
    }
  };

  const myApprovedQuotes = useMemo(
    () => (priceQuotes as PriceQuote[]).filter((q) => q.status === 'معتمد' && q.createdById === currentUser.id),
    [priceQuotes, currentUser.id]
  );
  const myPipelineQuotes = useMemo(
    () =>
      (priceQuotes as PriceQuote[])
        .filter((q) => isRepQuoteInPipeline(q, currentUser.id))
        .sort(sortRepQuotesByActivity),
    [priceQuotes, currentUser.id],
  );
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [leadFilter, setLeadFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [showEndOfDayPanel, setShowEndOfDayPanel] = useState(false);
  const openLeadClient360 = (leadId: string) => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsClient360Id: leadId }));
    if (onGoToTab) onGoToTab('leads');
  };

  const myLeads = useMemo(
    () => leads.filter(l => l.assignedTo === currentUser.id).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [leads, currentUser.id]
  );

  const isConfirmedContactActivity = (activity: Activity) =>
    /(مكالمة|تحديث|إرسال واتساب|واتساب|تم التواصل|متابعة)/.test(activity.action);
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
    openInteraction(lead, action, defaultNote, toastType);
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
    toast.success(t('settingsToasts.wonClosed', { name: lead.name }));
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
      toast.error(t('settingsToasts.lossReasonRequired'));
      return;
    }
    const qualityChecks = window.prompt(
      'Quality Gate قبل الإغلاق (اكتب Y أو N)\n1) هل تم آخر محاولة تواصل؟\n2) هل تم تقديم عرض سعر/حل مناسب؟\n3) هل تم توثيق اعتراض العميل بوضوح؟\nمثال: Y,Y,N'
    ) || '';
    const checks = qualityChecks.split(',').map((x) => x.trim().toUpperCase());
    if (checks.length !== 3 || checks.some((x) => x !== 'Y' && x !== 'N')) {
      toast.error(t('settingsToasts.qaFormatInvalid'));
      return;
    }
    const passedChecks = checks.filter((x) => x === 'Y').length;
    if (passedChecks < 2) {
      toast.error(t('repDash.lossQaBlocked'));
      return;
    }
    const note = window.prompt(t('repDash.lossNotePrompt')) || '';
    if (!note.trim()) {
      toast.error(t('repDash.lossNoteRequired'));
      return;
    }
    updateLeadStatus(lead.id, 'مغلق - خسارة', `loss_reason=${reasonCode} | qa_gate=${checks.join('/') } | ${note.trim()}`);
    toast.warning(t('repDash.lossClosed', { name: lead.name }));
  };

  const completeFollowUpNow = (lead: Lead) => {
    logLeadInteraction(lead.id, 'متابعة مكتملة', 'تمت المتابعة بنجاح من لوحة المندوب');
    const next = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    setLeadFollowUp(lead.id, next);
    setFollowUpDrafts(prev => ({ ...prev, [lead.id]: new Date(next).toISOString().slice(0, 16) }));
    toast.success(t('repDash.followUpDone', { name: lead.name }));
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
    const company = escapeHtml(printBrandingSettings.companyName || t('repDash.printDefaultCompany'));
    const header = escapeHtml(printBrandingSettings.reportHeader || t('repDash.printDefaultHeader'));
    const footer = escapeHtml(printBrandingSettings.reportFooter || '');
    const primaryColor = printBrandingSettings.primaryColor || '#4F46E5';
    const logo = printBrandingSettings.logoDataUrl
      ? `<img src="${printBrandingSettings.logoDataUrl}" alt="logo" style="height:42px;max-width:130px;object-fit:contain;" />`
      : '';
    const printDate = new Date().toLocaleString(dateLocale);
    const signatureName = escapeHtml(printBrandingSettings.signatureName || '');
    const signatureTitle = escapeHtml(printBrandingSettings.signatureTitle || '');
    const filterLabel = leadFilter === 'all' ? t('repDash.printFilterAll') : leadFilter === 'today' ? t('repDash.printFilterToday') : t('repDash.printFilterOverdue');
    const rows = filteredLeads
      .map((lead) => {
        const latest = lead.timeline[0];
        const followUpLabel = lead.followUpAt ? new Date(lead.followUpAt).toLocaleString(dateLocale) : t('repDash.unspecified');
        return `
          <tr>
            <td>${escapeHtml(lead.name)}</td>
            <td>${escapeHtml(lead.company)}</td>
            <td>${escapeHtml(getLeadStatusLabel(lead.status, t))}</td>
            <td>${escapeHtml(getSlaStatusLabel(lead.slaStatus, t))}</td>
            <td>${escapeHtml(followUpLabel)}</td>
            <td>${escapeHtml(latest?.action || t('repDash.printNoAction'))}</td>
          </tr>
        `;
      })
      .join('');
    const html = `
      <html dir="${dir}">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t('repDash.printReportTitle', { name: currentUser.name }))}</title>
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
        ${printBrandingSettings.showPrintDate ? `<p style="margin:0 0 10px;color:#666;font-size:12px;">${escapeHtml(t('repDash.printDateLabel', { date: printDate }))}</p>` : ''}
        <h2>${escapeHtml(t('repDash.printReportTitle', { name: currentUser.name }))}</h2>
        <p class="meta">${escapeHtml(t('repDash.printFilterMeta', { filter: filterLabel, count: filteredLeads.length }))}</p>
        <div class="cards">
          <div class="card">${escapeHtml(t('repDash.printCardActive'))}<b>${kpis.active}</b></div>
          <div class="card">${escapeHtml(t('repDash.printCardContacted'))}<b>${kpis.contacted}</b></div>
          <div class="card">${escapeHtml(t('repDash.printCardWon'))}<b>${kpis.won}</b></div>
          <div class="card">${escapeHtml(t('repDash.printCardLost'))}<b>${kpis.lost}</b></div>
          <div class="card">${escapeHtml(t('repDash.printCardOverdue'))}<b>${kpis.followUpOverdue}</b></div>
        </div>
        <table>
          <thead>
            <tr><th>${escapeHtml(t('repDash.printColClient'))}</th><th>${escapeHtml(t('repDash.printColCompany'))}</th><th>${escapeHtml(t('repDash.printColStatus'))}</th><th>${escapeHtml(t('repDash.printColSla'))}</th><th>${escapeHtml(t('repDash.printColFollowUp'))}</th><th>${escapeHtml(t('repDash.printColLastAction'))}</th></tr>
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
      <SectionTitle title={t('screens.repDashboard.title')} subtitle={t('screens.repDashboard.subtitle')} icon={LayoutDashboard} />
      <div className="flex items-center gap-2">
        <button onClick={printRepReport} className="px-4 py-2 rounded-xl text-xs font-black bg-[#0F1528] border border-white/10 text-zinc-200">
          {t('repDash.printReport')}
        </button>
        <button
          onClick={() => setShowEndOfDayPanel((v) => !v)}
          className="px-4 py-2 rounded-xl text-xs font-black bg-amber-500/20 border border-amber-500/35 text-amber-200"
        >
          {t('repDash.endOfDay', { count: endOfDayPendingLeads.length })}
        </button>
      </div>

      {showEndOfDayPanel && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-black text-amber-200">{t('repDash.eodTitle')}</p>
              <p className="text-xs text-zinc-300 mt-1">{t('repDash.eodHint')}</p>
            </div>
            {endOfDayPendingLeads.length === 0 && (
              <span className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {t('repDash.eodAllDone')}
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
                      <p className="text-[11px] text-zinc-400 mt-1 truncate">{t('repDash.lastUpdate', { action: latest?.action || t('common.none'), date: latest?.createdAt ? ` - ${new Date(latest.createdAt).toLocaleString(dateLocale)}` : '' })}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => logCallDone(lead)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500 text-slate-950">{t('repDash.callBtn')}</button>
                      <button onClick={() => logWhatsApp(lead)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-indigo-500 text-white">{t('repDash.whatsappBtn')}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MiniMetricCard title={t('repDash.todayTasks')} value={queueSummary.dueToday} hint={t('repDash.todayTasksHint')} icon={Calendar} tone="indigo" onClick={() => setLeadFilter('today')} />
        <MiniMetricCard title={t('repDash.overdueNeedsAction')} value={queueSummary.overdue} hint={t('repDash.overdueHint')} icon={Bell} tone="rose" onClick={() => setLeadFilter('overdue')} />
        <MiniMetricCard title={t('repDash.noContact')} value={queueSummary.noContact} hint={t('repDash.noContactHint')} icon={Phone} tone="amber" onClick={() => setLeadFilter('all')} />
        <MiniMetricCard title={t('repDash.closeRate')} value={`${repRates.conversionAll.toFixed(1)}%`} hint={t('repDash.closeRateHint', { won: kpis.won, total: myLeads.length })} icon={Trophy} tone="emerald" />
      </div>

      {queueSummary.overdue > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-sm font-bold text-rose-200">
            {t('repDash.overdueBanner', { count: queueSummary.overdue })}
          </p>
          <button
            onClick={() => setLeadFilter('overdue')}
            className="px-4 py-2 rounded-xl text-xs font-black bg-rose-500 text-white"
          >
            {t('repDash.startOverdue')}
          </button>
        </div>
      )}

      {/* ===== مسار طلبات عروض الأسعار (إنتاج → مالك → عميل) ===== */}
      {myPipelineQuotes.length > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-[3rem] p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-lg font-black text-indigo-200">{t('repDash.quotePipelineTitle')}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {t('repDash.quotePipelineHint')}
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-indigo-500/25 text-indigo-200 border border-indigo-500/40">
              {t('repDash.quotesInProgress', { count: myPipelineQuotes.length })}
            </span>
          </div>
          <div className="space-y-3">
            {myPipelineQuotes.map((q) => (
              <RepQuotePipelineCard key={q.id} quote={q} onOpenLead={openLeadClient360} />
            ))}
          </div>
        </div>
      )}

      {/* ===== عروض معتمدة — بانتظار موافقة العميل ===== */}
      {myApprovedQuotes.length > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-[3rem] p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-lg font-black text-emerald-200">{t('repDash.approvedQuotesTitle')}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {t('repDash.approvedQuotesHint')}
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500/25 text-emerald-200 border border-emerald-500/40">
              {t('repDash.quotesCount', { count: myApprovedQuotes.length })}
            </span>
          </div>
          <div className="space-y-3">
            {myApprovedQuotes.map((q) => {
              const total = (q.totalAmount ?? q.amount).toLocaleString(dateLocale);
              const schedule = q.paymentSchedule && q.paymentSchedule.length > 0
                ? t('repDash.scheduledPayments', { count: q.paymentSchedule.length })
                : q.initialPayment && q.initialPayment > 0
                  ? t('repDash.initialPayment', { amount: q.initialPayment.toLocaleString(dateLocale), currency })
                  : t('repDash.singlePayment');
              return (
                <div key={q.id} className="bg-[#0F1528]/80 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-black text-white text-sm">{q.title}</p>
                    <p className="text-xs text-zinc-400 mt-1">{q.customerName}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {t('repDash.vatIncluded', { amount: total, currency })}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {schedule}
                      </span>
                      {q.approvedAt && (
                        <span className="text-[10px] text-zinc-500">
                          {t('repDash.approvedAt', { date: new Date(q.approvedAt).toLocaleDateString(dateLocale) })}
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
                      {t('repDash.recordClientResponse')}
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-6" dir={dir}>
          <div className="bg-[#0E1426] border border-white/10 rounded-[3rem] p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar space-y-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black">{t('repDash.clientResponseTitle')}</h3>
              <button onClick={() => setClientRespQuote(null)} className="p-2 hover:bg-white/10 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-white/5 rounded-2xl p-4 space-y-1">
              <p className="font-black text-white">{clientRespQuote.title}</p>
              <p className="text-xs text-zinc-400">{clientRespQuote.customerName}</p>
              <p className="text-sm font-black text-emerald-300 mt-1">{(clientRespQuote.totalAmount ?? clientRespQuote.amount).toLocaleString(dateLocale)} {currency}</p>
            </div>

            {/* اختيار وافق أم رفض */}
            {clientRespMode === null && (
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setClientRespMode('accepted')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all text-emerald-200"
                >
                  <CheckCircle2 className="w-10 h-10" />
                  <span className="font-black text-lg">{t('repDash.clientAccepted')}</span>
                  <span className="text-xs text-zinc-400 text-center">{t('repDash.clientAcceptedHint')}</span>
                </button>
                <button
                  onClick={() => setClientRespMode('rejected')}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 transition-all text-rose-200"
                >
                  <XCircle className="w-10 h-10" />
                  <span className="font-black text-lg">{t('repDash.clientRejected')}</span>
                  <span className="text-xs text-zinc-400 text-center">{t('repDash.clientRejectedHint')}</span>
                </button>
              </div>
            )}

            {/* فورم الموافقة — تفاصيل الدفع */}
            {clientRespMode === 'accepted' && (
              <div className="space-y-5">
                <p className="text-sm font-black text-emerald-200">{t('repDash.paymentDetailsTitle')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">{t('repDash.paymentType')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setClientPaymentType('single'); setClientPaymentLines([{ id: `cp-${Date.now()}`, amount: String(clientRespQuote.totalAmount ?? clientRespQuote.amount), dueDate: new Date().toISOString().slice(0, 10), method: clientPaymentMethod, note: '' }]); }}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentType === 'single' ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}
                      >{t('repDash.singleInstallment')}</button>
                      <button
                        onClick={() => setClientPaymentType('multi')}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentType === 'multi' ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}
                      >{t('repDash.multiInstallment')}</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">{t('repDash.defaultPaymentMethod')}</label>
                    <div className="flex gap-2">
                      <button onClick={() => { setClientPaymentMethod('كاش'); setClientPaymentLines((prev) => prev.map((l) => ({ ...l, method: 'كاش' }))); }} className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentMethod === 'كاش' ? 'bg-amber-500/25 border-amber-500/50 text-amber-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}>{t('repDash.cash')}</button>
                      <button onClick={() => { setClientPaymentMethod('تحويل'); setClientPaymentLines((prev) => prev.map((l) => ({ ...l, method: 'تحويل' }))); }} className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border transition-all ${clientPaymentMethod === 'تحويل' ? 'bg-blue-500/25 border-blue-500/50 text-blue-200' : 'bg-white/5 border-white/15 text-zinc-400'}`}>{t('repDash.bankTransfer')}</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {clientPaymentLines.map((line, idx) => (
                    <div key={line.id} className="bg-white/5 border border-white/10 rounded-xl p-3 grid grid-cols-4 gap-2 items-end">
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">{t('repDash.amountLabel', { currency })}</label>
                        <input type="number" min={1} value={line.amount} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, amount: e.target.value } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">{t('repDash.dueDate')}</label>
                        <input type="date" value={line.dueDate} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, dueDate: e.target.value } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 mb-1 block">{t('repDash.method')}</label>
                        <select value={line.method} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, method: e.target.value as 'كاش' | 'تحويل' } : l))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm">
                          <option value="كاش">كاش</option>
                          <option value="تحويل">تحويل</option>
                        </select>
                      </div>
                      <div className="flex items-end gap-1">
                        <input placeholder={t('repDash.notePlaceholder')} value={line.note} onChange={(e) => setClientPaymentLines((prev) => prev.map((l, i) => i === idx ? { ...l, note: e.target.value } : l))} className="flex-1 bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                        {clientPaymentLines.length > 1 && (
                          <button onClick={() => setClientPaymentLines((prev) => prev.filter((_, i) => i !== idx))} className="p-2 hover:bg-rose-500/20 rounded-xl text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                  {clientPaymentType === 'multi' && (
                    <button onClick={() => setClientPaymentLines((prev) => [...prev, { id: `cp-${Date.now()}`, amount: '', dueDate: new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0, 10), method: clientPaymentMethod, note: '' }])} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300 hover:bg-white/10 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> {t('repDash.addPayment')}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => setClientRespMode(null)} className="px-4 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300">{t('common.back')}</button>
                  <button onClick={submitClientAcceptance} className="px-6 py-2.5 rounded-xl text-sm font-black bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors">
                    {t('repDash.confirmAcceptance')}
                  </button>
                </div>
              </div>
            )}

            {/* فورم الرفض */}
            {clientRespMode === 'rejected' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">{t('repDash.rejectionReason')}</label>
                  <textarea
                    value={clientRejectionNote}
                    onChange={(e) => setClientRejectionNote(e.target.value)}
                    rows={3}
                    placeholder={t('repDash.rejectionPlaceholder')}
                    className="w-full bg-[#0F1528] border border-white/15 rounded-2xl px-4 py-3 text-sm resize-none"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => setClientRespMode(null)} className="px-4 py-2 rounded-xl text-xs font-black bg-white/5 border border-white/15 text-zinc-300">{t('common.back')}</button>
                  <button onClick={submitClientRejection} className="px-6 py-2.5 rounded-xl text-sm font-black bg-rose-500 text-white hover:bg-rose-400 transition-colors">
                    {t('repDash.confirmRejection')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-8">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <h3 className="text-xl font-black">{t('repDash.dailyQueueTitle')}</h3>
          <div className="flex items-center gap-2 bg-[#0F1528]/70 border border-white/10 rounded-xl p-1">
            <button onClick={() => setLeadFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'all' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>{t('common.all')}</button>
            <button onClick={() => setLeadFilter('today')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'today' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>{t('repDash.filterToday')}</button>
            <button onClick={() => setLeadFilter('overdue')} className={`px-3 py-1.5 rounded-lg text-xs font-black ${leadFilter === 'overdue' ? 'bg-[#7C6BFF] text-white' : 'text-zinc-300'}`}>{t('repDash.filterOverdue')}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-right">
            <thead>
              <tr className="bg-[#0B1020]/80 border-b border-white/10">
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colClient')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colDone')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colNote')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colNextAction')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colArchive')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colStatus')}</th>
                <th className="p-3 text-[10px] uppercase tracking-widest text-zinc-400">{t('repDash.colQuickActions')}</th>
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
                    <p className="text-[11px] text-zinc-400">{t('repDash.attachmentsCount', { count: leadArchive.length })}</p>
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
                    {leadArchive.length === 0 && <p className="text-[11px] text-zinc-500">{t('repDash.noArchiveYet')}</p>}
                  </div>
                </td>
                <td className="p-3 align-top">
                  <p className="text-sm font-bold text-zinc-100">{latest?.action || t('repDash.noContactYet')}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">{latest?.createdAt ? new Date(latest.createdAt).toLocaleString(dateLocale) : '—'}</p>
                  {latest?.evidenceRef && (
                    <a
                      href={latest.evidenceRef}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-[11px] text-indigo-300 mt-1 underline"
                    >
                      {t('repDash.contactEvidence')}
                    </a>
                  )}
                </td>
                <td className="p-3 align-top">
                  <p className="text-xs text-zinc-300 leading-5">{latest?.note?.trim() || t('repDash.noNote')}</p>
                </td>
                <td className="p-3 align-top">
                  <div className="space-y-2">
                    <p className={`text-xs font-bold ${isFollowUpOverdue ? 'text-rose-300' : 'text-zinc-200'}`}>
                      {lead.followUpAt ? new Date(lead.followUpAt).toLocaleString(dateLocale) : t('repDash.unspecified')}
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
                          toast.info(t('repDash.followUpCleared', { name: lead.name }));
                          return;
                        }
                        const iso = new Date(draftFollowUp).toISOString();
                        setLeadFollowUp(lead.id, iso);
                        toast.success(t('repDash.followUpSet', { name: lead.name }));
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-[#7C6BFF] text-white w-full"
                    >
                      {t('repDash.saveFollowUp')}
                    </button>
                  </div>
                </td>
                <td className="p-3 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${lead.status === 'مغلق - فوز' ? 'bg-emerald-500/20 text-emerald-300' : lead.status === 'مغلق - خسارة' ? 'bg-rose-500/20 text-rose-300' : 'bg-indigo-500/20 text-indigo-300'}`}>{getLeadStatusLabel(lead.status, t)}</span>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${lead.slaStatus === 'حرج' ? 'bg-rose-500/20 text-rose-300' : lead.slaStatus === 'متأخر' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{t('repDash.slaLabel', { status: getSlaStatusLabel(lead.slaStatus, t) })}</span>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${contacted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-500/20 text-zinc-300'}`}>{contacted ? t('repDash.documented') : t('repDash.notDocumented')}</span>
                  </div>
                </td>
                <td className="p-3 align-top">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => openLeadUpdate(lead)}
                      className="col-span-2 px-2 py-1.5 rounded-lg text-[11px] font-black bg-[#7C6BFF] text-white border border-violet-400/40"
                    >
                      {t('repDash.addUpdate')}
                    </button>
                    <button onClick={() => logCallDone(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500 text-slate-950">{t('repDash.callBtn')}</button>
                    <button onClick={() => logWhatsApp(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-indigo-500 text-white">{t('repDash.whatsappBtn')}</button>
                    <button onClick={() => logNoAnswer(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-amber-500 text-slate-950">{t('repDash.noAnswer')}</button>
                    <button onClick={() => completeFollowUpNow(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-cyan-500 text-slate-950">{t('repDash.followUp24h')}</button>
                    <button onClick={() => closeWon(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-[#7C6BFF] text-white">{t('repDash.won')}</button>
                    <button onClick={() => closeLost(lead)} className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-rose-500 text-white">{t('repDash.lost')}</button>
                  </div>
                  <button type="button" onClick={() => setQuoteLead(lead)} className="mt-1.5 w-full px-2 py-1.5 rounded-lg text-[11px] font-black bg-amber-500/20 text-amber-200 border border-amber-500/30">
                    {t('repDash.priceQuote')}
                  </button>
                </td>
              </tr>
            );
          })}
            </tbody>
          </table>
        </div>
        {filteredLeads.length === 0 && (
          <div className="text-center text-zinc-400 py-8">{t('repDash.noAssignedLeads')}</div>
        )}
      </div>
      <PriceQuoteSubmitModal lead={quoteLead} open={!!quoteLead} onClose={() => setQuoteLead(null)} />

      <LeadRepUpdateModal />
    </div>
  );
};

const RepPerformanceView = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
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
    ? t('repDash.scoreExcellent')
    : performanceScore >= 70
      ? t('repDash.scoreVeryGood')
      : performanceScore >= 55
        ? t('repDash.scoreGood')
        : t('repDash.scoreNeedsImprovement');
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
        <SectionTitle title={t('screens.repPerformanceEmpty.title')} subtitle={t('screens.repPerformanceEmpty.subtitle')} icon={Trophy} />
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
      <SectionTitle title={t('screens.repPerformance.title')} subtitle={t('screens.repPerformance.subtitle')} icon={Trophy} />

      <div className={`border rounded-[2rem] p-6 flex items-center justify-between gap-4 ${scoreColorClass}`}>
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-80">{t('repPerfView.performanceIndex')}</p>
          <p className="text-3xl font-black">{performanceScore}/100</p>
        </div>
        <div className="text-left">
          <p className="text-xs opacity-80">{t('repPerfView.currentRating')}</p>
          <p className="text-xl font-black">{scoreLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard title={t('repPerfView.conversion')} value={`${snapshot.conversionRate.toFixed(1)}%`} icon={Target} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.wonDeals')} value={snapshot.wonDeals} icon={CheckCircle2} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.lostDeals')} value={snapshot.lostDeals} icon={AlertCircle} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.avgResponse')} value={t('repPerfView.avgResponseUnit', { minutes: snapshot.avgResponseMins })} icon={Clock} onClick={() => goMyLeads(true)} />
        <StatCard title={t('repPerfView.revenue')} value={`${snapshot.revenue.toLocaleString(dateLocale)} ${t('common.currency')}`} icon={DollarSign} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.estCommission')} value={`${snapshot.estimatedCommission.toLocaleString(dateLocale)} ${t('common.currency')}`} icon={DollarSign} onClick={() => goMyLeads(false)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title={t('repPerfView.contactCoverage')} value={`${snapshot.confirmedContactCoverage.toFixed(1)}%`} icon={ShieldCheck} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.confirmedContacts')} value={snapshot.confirmedContacts} icon={MessageSquare} onClick={() => goMyLeads(false)} />
        <StatCard title={t('repPerfView.documentationQuality')} value={`${snapshot.documentationQualityScore.toFixed(1)}%`} icon={FileText} onClick={() => goMyLeads(false)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h3 className="text-lg font-black mb-4">{t('repPerfView.monthlyGoals')}</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>{t('repPerfView.wonLeadsTarget')}</span>
                <span className="font-black">{snapshot.wonDeals}/{snapshot.leadsTarget}</span>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#7C6BFF]" style={{ width: `${Math.min(100, snapshot.leadsTargetProgress)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>{t('repPerfView.revenueTarget')}</span>
                <span className="font-black">{snapshot.revenue.toLocaleString(dateLocale)} / {snapshot.revenueTarget.toLocaleString(dateLocale)} {t('common.currency')}</span>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, snapshot.revenueTargetProgress)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h3 className="text-lg font-black mb-4">{t('repPerfView.recentActivity')}</h3>
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
                <p className="text-[11px] text-zinc-500 mt-1">{new Date(entry.createdAt).toLocaleString(dateLocale)}</p>
              </button>
            ))}
            {lastActions.length === 0 && <p className="text-zinc-400 text-sm">{t('repPerfView.noActivityYet')}</p>}
          </div>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
        <h3 className="text-lg font-black mb-4">{t('repPerfView.quickAnalysis')}</h3>
        <p className="text-sm text-zinc-300">
          {t('repPerfView.analysisBody', { assigned: myLeads.length, won: closedWon.length })}
        </p>
        <p className="text-xs text-zinc-400 mt-3">
          {t('repPerfView.analysisFootnote')}
        </p>
      </div>
    </div>
  );
};

/** إضافة معدات رئيسية للحجوزات — يُزامن مع workspace-state في وضع السيرفر */
const EquipmentMasterMiniPanel = () => {
  const { t } = useTranslation();
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
        <h3 className="text-lg font-black">{t('equipmentPanel.title')}</h3>
        <p className="text-xs text-zinc-400 mt-1">
          {t('equipmentPanel.hint')}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">{t('equipmentPanel.nameLabel')}</label>
          <input
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder={t('equipmentPanel.namePlaceholder')}
            className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-[8rem] flex-1">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">{t('equipmentPanel.categoryLabel')}</label>
          <input
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            placeholder={t('equipmentPanel.categoryPlaceholder')}
            className="w-full bg-[#0F1528] border border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="w-28">
          <label className="block text-[10px] font-black text-zinc-500 mb-1">{t('equipmentPanel.quantityLabel')}</label>
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
              toast.error(t('equipmentPanel.duplicateError'));
              return;
            }
            setForm({ name: '', category: '', quantity: '1' });
            toast.success(t('equipmentPanel.addSuccess'));
          }}
          className="rounded-xl bg-[#7C6BFF] px-4 py-2 text-sm font-black text-white"
        >
          {t('equipmentPanel.add')}
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-[#0B1020]/60 divide-y divide-white/5">
        {equipmentItems.filter((e) => e.active).length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">{t('equipmentPanel.empty')}</p>
        ) : (
          equipmentItems
            .filter((e) => e.active)
            .map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-bold text-zinc-200">{e.name}</span>
                <span className="text-xs text-zinc-400">
                  {e.category} — {e.totalQuantity} {t('equipmentPanel.unitSuffix')}
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
  const { t } = useTranslation();
  const [rows, setRows] = useState([
    { description: '', amount: '', invoiceRef: '', vendor: '' },
  ]);
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-amber-400/35 space-y-2">
      <p className="text-[11px] font-black text-amber-200/95">{t('productionFund.bookingSpendHint')}</p>
      {accrualExpenseId ? (
        <p className="text-[10px] text-zinc-500">
          {t('productionFund.accrualExpenseRef')}{' '}
          <span className="font-mono text-cyan-400">{accrualExpenseId}</span>
        </p>
      ) : null}
      {rows.map((r, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 text-[11px]">
          <input
            value={r.description}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)))}
            placeholder={t('productionFund.descPh')}
            className="sm:col-span-4 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            type="number"
            min={0}
            value={r.amount}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
            placeholder={t('productionFund.amountPh')}
            className="sm:col-span-2 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            value={r.invoiceRef}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, invoiceRef: e.target.value } : row)))}
            placeholder={t('productionFund.invoiceRefPh')}
            className="sm:col-span-3 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <input
            value={r.vendor}
            onChange={(e) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, vendor: e.target.value } : row)))}
            placeholder={t('productionFund.vendorPh')}
            className="sm:col-span-2 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_x, i) => i !== idx)))}
            className="sm:col-span-1 rounded-lg border border-white/15 text-[10px] text-zinc-400 hover:bg-white/5 py-1"
          >
            {t('productionFund.removeLine')}
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { description: '', amount: '', invoiceRef: '', vendor: '' }])}
          className="text-[11px] font-black px-2 py-1 rounded-lg bg-white/10 text-zinc-200"
        >
          {t('productionFund.addLineBtn')}
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
                toast.error(t('productionFund.bookingLineRequired'));
                return;
              }
              const sum = lines.reduce((s, x) => s + x.amount, 0);
              const est = Math.max(0, Number(estimatedCost) || 0);
              if (est > 0 && sum > est * 1.05 + 0.01) {
                toast.error(t('productionFund.bookingOverEstimate'));
                return;
              }
              const ok = await onSubmit(kind, bookingId, lines);
              if (!ok) toast.error(t('productionFund.bookingSubmitFailed'));
              else {
                toast.success(t('productionFund.bookingSubmitSuccess'));
                setRows([{ description: '', amount: '', invoiceRef: '', vendor: '' }]);
              }
            })();
          }}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950"
        >
          {t('productionFund.sendToAccountant')}
        </button>
      </div>
    </div>
  );
};

const BookingCenter = ({ currentUser, onGoToTab }: { currentUser: User; onGoToTab?: (tab: string) => void }) => {
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
  const currency = t('common.currency');
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
  const visibleShoot = useMemo(() => {
    if (canViewAll || canAccountantExecute) return shootBookings;
    if (currentUser.role === 'مدير إنتاج') {
      const uid = String(currentUser.id).trim();
      return shootBookings.filter(
        (b) =>
          String(b.productionAssignedId || '').trim() === uid ||
          (b.workOrderFromQuote && String(b.productionAssignedId || '').trim() === uid),
      );
    }
    return shootBookings.filter((b) => b.repId === currentUser.id);
  }, [canViewAll, canAccountantExecute, shootBookings, currentUser.id, currentUser.role]);
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
      toast.error(t('bookingsToasts.shootIncomplete'));
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
    toast.success(t('bookingsToasts.shootSent'));
  };

  const handleAddEquipment = async () => {
    const quantity = Math.max(1, Number(equipmentForm.quantity) || 1);
    if (!equipmentForm.customerName.trim() || !equipmentForm.equipmentName.trim() || !equipmentForm.fromDate || !equipmentForm.toDate) {
      toast.error(t('bookingsToasts.equipmentIncomplete'));
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
      toast.error(t('bookingsToasts.equipmentConflict'));
      return;
    }
    setEquipmentForm({ leadId: '', customerName: '', equipmentName: '', quantity: '1', fromDate: '', toDate: '', estimatedCost: '', notes: '' });
    toast.success(t('bookingsToasts.equipmentSent'));
  };

  const handleAddMeeting = async () => {
    const duration = Math.max(15, Number(meetingForm.durationMins) || 60);
    if (!meetingForm.title.trim() || !meetingForm.date || !meetingForm.startTime) {
      toast.error(t('bookingsToasts.meetingIncomplete'));
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
      toast.error(t('bookingsToasts.meetingConflict'));
      return;
    }
    setMeetingForm({ leadId: '', title: '', date: '', startTime: '', durationMins: '60', venueType: 'داخل_المقر', estimatedCost: '', location: '', notes: '' });
    toast.success(t('bookingsToasts.meetingSaved'));
  };

  const handleAddOther = async () => {
    if (!otherForm.statement.trim()) {
      toast.error(t('bookingsToasts.otherDescRequired'));
      return;
    }
    const ok = await addOtherBooking({
      title: otherForm.title.trim(),
      statement: otherForm.statement.trim(),
      date: otherForm.date.trim() || undefined,
    });
    if (!ok) {
      toast.error(t('repDash.saveFailed'));
      return;
    }
    setOtherForm({ title: '', statement: '', date: '' });
    toast.success(t('bookingsToasts.otherSaved'));
  };

  const statusClass = (status: string) =>
    status === 'معتمد' || status === 'تم التسليم'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'مرفوض'
        ? 'bg-rose-500/15 text-rose-300'
        : 'bg-amber-500/15 text-amber-300';

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle
        title={t('screens.bookings.title')}
        subtitle={
          canOwnerApprove
            ? t('screens.bookings.subtitleOwner')
            : canAccountantExecute
              ? t('screens.bookings.subtitleAccountant')
              : t('screens.bookings.subtitleDefault')
        }
        icon={Calendar}
      />
      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white/[0.04] border border-white/10" dir="rtl">
        {([
          ['shoot', t('bookings.tabShoot')],
          ['equipment', t('bookings.tabEquipment')],
          ['meeting', t('bookings.tabMeeting')],
          ['other', t('bookings.tabOther')],
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
          <p className="text-xs text-amber-200 font-bold">{t('bookings.filterActive')}</p>
          <button onClick={() => setBookingQuickFilter('all')} className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 text-slate-950">{t('bookings.clearFilter')}</button>
        </div>
      )}

      {bookingHubTab === 'meeting' && !canAccountantExecute ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">{t('bookings.meetingCalendarTitle')}</h3>
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
                  {meetings.length > 4 && <p className="text-[10px] text-zinc-500">{t('bookings.moreMeetings', { count: meetings.length - 4 })}</p>}
                  {meetings.length === 0 && <p className="text-[10px] text-zinc-500">{t('bookings.noMeetingsDay')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'meeting' && !canReview && !canAccountantExecute && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
          <h3 className="font-black">{t('bookings.addMeetingTitle')}</h3>
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
            <option value="">{t('bookings.noLeadOptional')}</option>
            {myLeads.map((l) => (
              <option key={`meeting-lead-${l.id}`} value={l.id}>{l.name} - {l.company}</option>
            ))}
          </select>
          <input value={meetingForm.title} onChange={(e) => setMeetingForm(prev => ({ ...prev, title: e.target.value }))} placeholder={t('bookings.meetingTitlePlaceholder')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="date" value={meetingForm.date} onChange={(e) => setMeetingForm(prev => ({ ...prev, date: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="time" value={meetingForm.startTime} onChange={(e) => setMeetingForm(prev => ({ ...prev, startTime: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="number" min={15} step={15} value={meetingForm.durationMins} onChange={(e) => setMeetingForm(prev => ({ ...prev, durationMins: e.target.value }))} placeholder={t('bookings.durationMins')} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          </div>
          <select value={meetingForm.venueType} onChange={(e) => setMeetingForm(prev => ({ ...prev, venueType: e.target.value as 'داخل_المقر' | 'خارج_المقر', estimatedCost: e.target.value === 'خارج_المقر' ? prev.estimatedCost : '' }))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm [color-scheme:dark]">
            <option value="داخل_المقر">{t('bookings.venueInternal')}</option>
            <option value="خارج_المقر">{t('bookings.venueExternal')}</option>
          </select>
          {meetingForm.venueType === 'خارج_المقر' && (
            <input type="number" min={0} value={meetingForm.estimatedCost} onChange={(e) => setMeetingForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder={t('bookings.travelCostPlaceholder')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          )}
          <input value={meetingForm.location} onChange={(e) => setMeetingForm(prev => ({ ...prev, location: e.target.value }))} placeholder={t('bookings.locationOptional')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
          <textarea value={meetingForm.notes} onChange={(e) => setMeetingForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('bookings.notes')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
          <button onClick={handleAddMeeting} className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-sm font-black">{t('bookings.submitMeeting')}</button>
        </div>
      )}

      {bookingHubTab === 'meeting' ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">{t('bookings.upcomingMeetingsTitle')}</h3>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {upcomingMeetings.map((m) => (
            <div key={m.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{m.title}</p>
                <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-cyan-500/20 text-cyan-300">
                  {t('bookings.durationLabel', { mins: m.durationMins })}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">{m.date} - {m.startTime}{m.location ? ` - ${m.location}` : ''}</p>
              {m.leadId && (
                <button type="button" onClick={() => goClient360(m.leadId)} className="cursor-pointer text-right text-[11px] text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  {t('common.clientLabel', { name: leads.find((l) => l.id === m.leadId)?.name || m.leadId })}
                </button>
              )}
              <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.repLabel', { name: m.repName })}</p>
              <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.meetingType', { type: m.venueType || 'داخل_المقر' })}</p>
              {typeof m.estimatedCost === 'number' && m.estimatedCost > 0 ? <p className="text-[11px] text-zinc-400 mt-1">{t('bookings.estimatedCost', { amount: m.estimatedCost.toLocaleString(dateLocale), currency })}</p> : null}
              {m.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.financialStatus', { status: m.financialStatus })}</p> : null}
              {m.status ? <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.statusLabel', { status: m.status })}</p> : null}
              {canOwnerApprove && m.status === 'قيد المراجعة' && (
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => { void (async () => { const ok = await updateMeetingBookingStatus(m.id, 'معتمد'); if (!ok) { toast.error(t('bookings.approveFailed')); return; } toast.success(m.estimatedCost && Number(m.estimatedCost) > 0 ? t('bookings.meetingApprovedWithCost') : t('bookings.meetingApproved')); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                  <button onClick={() => { void (async () => { const ok = await updateMeetingBookingStatus(m.id, 'مرفوض'); if (!ok) { toast.error(t('bookings.rejectFailed')); return; } toast.info(t('bookings.meetingRejected')); })(); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              )}
              {canAccountantExecute && m.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => { void (async () => {
                    const ok = await accountantExecuteMeetingBookingClaim(m.id, 'كاش');
                    if (!ok) toast.error(t('bookings.executeFailed'));
                    else toast.success(t('bookings.executedCash'));
                  })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('bookings.executeCash')}</button>
                  <button onClick={() => { void (async () => {
                    const ok = await accountantExecuteMeetingBookingClaim(m.id, 'تحويل');
                    if (!ok) toast.error(t('bookings.executeFailed'));
                    else toast.success(t('bookings.executedTransfer'));
                  })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">{t('bookings.executeTransfer')}</button>
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
          {upcomingMeetings.length === 0 && <p className="text-sm text-zinc-400">{t('bookings.noMeetingsRegistered')}</p>}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'shoot' ? (
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
        <h3 className="font-black mb-4">{t('bookings.shootCalendarTitle')}</h3>
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
                  {bookings.length > 3 && <p className="text-[10px] text-zinc-500">{t('bookings.moreShootSlots', { count: bookings.length - 3 })}</p>}
                  {bookings.length === 0 && <p className="text-[10px] text-zinc-500">{t('bookings.noShootSlots')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      ) : null}

      {bookingHubTab === 'shoot' && !canReview && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
            <h3 className="font-black">{t('bookings.shootRequestTitle')}</h3>
            <select
              value={shootForm.leadId}
              onChange={(e) => {
                const lead = myLeads.find(l => l.id === e.target.value);
                setShootForm(prev => ({ ...prev, leadId: e.target.value, customerName: lead?.name || prev.customerName }));
              }}
              className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">{t('bookings.optionalLeadFromMyLeads')}</option>
              {myLeads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.company}</option>)}
            </select>
            <input value={shootForm.customerName} onChange={(e) => setShootForm(prev => ({ ...prev, customerName: e.target.value }))} placeholder={t('bookings.clientName')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={shootForm.date} onChange={(e) => setShootForm(prev => ({ ...prev, date: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
              <input type="time" value={shootForm.time} onChange={(e) => setShootForm(prev => ({ ...prev, time: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <input value={shootForm.location} onChange={(e) => setShootForm(prev => ({ ...prev, location: e.target.value }))} placeholder={t('bookings.shootLocation')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <input type="number" min={0} value={shootForm.estimatedCost} onChange={(e) => setShootForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder={t('bookings.estimatedCostFinancial')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <textarea value={shootForm.notes} onChange={(e) => setShootForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('bookings.notes')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
            <button onClick={handleAddShoot} className="px-4 py-2 rounded-xl bg-[#7C6BFF] text-white text-sm font-black">{t('bookings.submitShoot')}</button>
        </div>
      )}

      {bookingHubTab === 'equipment' && !canReview && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
            <h3 className="font-black">{t('bookings.equipmentRequestTitle')}</h3>
            <select
              value={equipmentForm.leadId}
              onChange={(e) => {
                const lead = myLeads.find(l => l.id === e.target.value);
                setEquipmentForm(prev => ({ ...prev, leadId: e.target.value, customerName: lead?.name || prev.customerName }));
              }}
              className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">{t('bookings.optionalLeadFromMyLeads')}</option>
              {myLeads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.company}</option>)}
            </select>
            <input value={equipmentForm.customerName} onChange={(e) => setEquipmentForm(prev => ({ ...prev, customerName: e.target.value }))} placeholder={t('bookings.clientName')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select value={equipmentForm.equipmentName} onChange={(e) => setEquipmentForm(prev => ({ ...prev, equipmentName: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm">
                <option value="">{t('bookings.selectEquipment')}</option>
                {equipmentItems.filter(e => e.active).map(e => (
                  <option key={e.id} value={e.name}>
                    {t('bookings.equipmentOption', { name: e.name, category: e.category, count: equipmentAvailableByName.get(e.name) ?? e.totalQuantity })}
                  </option>
                ))}
              </select>
              <input type="number" min={1} value={equipmentForm.quantity} onChange={(e) => setEquipmentForm(prev => ({ ...prev, quantity: e.target.value }))} placeholder={t('bookings.quantityPh')} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={equipmentForm.fromDate} onChange={(e) => setEquipmentForm(prev => ({ ...prev, fromDate: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
              <input type="date" value={equipmentForm.toDate} onChange={(e) => setEquipmentForm(prev => ({ ...prev, toDate: e.target.value }))} className="bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            </div>
            <input type="number" min={0} value={equipmentForm.estimatedCost} onChange={(e) => setEquipmentForm(prev => ({ ...prev, estimatedCost: e.target.value }))} placeholder={t('bookings.estimatedCostFinancial')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm" />
            <textarea value={equipmentForm.notes} onChange={(e) => setEquipmentForm(prev => ({ ...prev, notes: e.target.value }))} placeholder={t('bookings.notes')} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[70px]" />
            <button onClick={handleAddEquipment} className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-black">{t('bookings.submitEquipment')}</button>
        </div>
      )}

      {bookingHubTab === 'other' && (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 space-y-3">
          <h3 className="font-black">{t('bookings.otherBookingsTitle')}</h3>
          <p className="text-xs text-zinc-500">{t('bookings.otherBookingsHint')}</p>
          <input
            value={otherForm.title}
            onChange={(e) => setOtherForm((p) => ({ ...p, title: e.target.value }))}
            placeholder={t('bookings.shortTitlePh')}
            className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm"
          />
          <input type="date" value={otherForm.date} onChange={(e) => setOtherForm((p) => ({ ...p, date: e.target.value }))} className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm [color-scheme:dark]" />
          <textarea
            value={otherForm.statement}
            onChange={(e) => setOtherForm((p) => ({ ...p, statement: e.target.value }))}
            placeholder={t('bookings.statementPh')}
            className="w-full bg-[#0F1528] border border-white/15 rounded-xl px-3 py-2 text-sm min-h-[90px]"
          />
          <button type="button" onClick={() => void handleAddOther()} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-black">
            {t('bookings.saveOtherBooking')}
          </button>
          <div className="border-t border-white/10 pt-4 mt-4 space-y-2 max-h-[380px] overflow-auto">
            <h4 className="text-sm font-black text-zinc-300">{t('bookings.historyTitle')}</h4>
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
                      <p className="text-[11px] text-zinc-500 mt-2">{t('bookings.byAuthor', { name: b.createdByName, date: new Date(b.createdAt).toLocaleString(dateLocale) })}</p>
                    </div>
                    {canDel ? (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const ok = await removeOtherBooking(b.id);
                            if (!ok) toast.error(t('bookings.deleteFailed'));
                            else toast.success(t('bookings.deleted'));
                          })();
                        }}
                        className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-black bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                      >
                        {t('common.delete')}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredOtherBookings.length === 0 && <p className="text-sm text-zinc-500">{t('bookings.noRecords')}</p>}
          </div>
        </div>
      )}

      {bookingHubTab === 'shoot' ? (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
          <h3 className="font-black mb-4">{t('bookings.shootRequestsTitle')}</h3>
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
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass(b.status)}`}>{getBookingStatusLabel(b.status, t)}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{b.date} - {b.time} - {b.location}</p>
                <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.byRep', { name: b.repName })}</p>
                {canOwnerApprove && b.status === 'قيد المراجعة' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => { const ok = await updateShootBookingStatus(b.id, 'معتمد'); if (!ok) { toast.error(t('bookings.approveFailed')); return; } toast.success(b.estimatedCost && Number(b.estimatedCost) > 0 ? t('bookings.shootApprovedWithAccrual') : t('bookings.shootApproved')); })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                    <button onClick={() => { void (async () => { const ok = await updateShootBookingStatus(b.id, 'مرفوض'); if (!ok) { toast.error(t('bookings.rejectFailed')); return; } toast.info(t('bookings.shootRejected')); })(); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                  </div>
                )}
                {canAccountantExecute && b.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteShootBookingClaim(b.id, 'كاش');
                      if (!ok) toast.error(t('bookings.executeFailed'));
                      else toast.success(t('bookings.executedCash'));
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('bookings.executeCash')}</button>
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteShootBookingClaim(b.id, 'تحويل');
                      if (!ok) toast.error(t('bookings.executeFailed'));
                      else toast.success(t('bookings.executedTransfer'));
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">{t('bookings.executeTransfer')}</button>
                  </div>
                )}
                {b.estimatedCost ? <p className="text-[11px] text-zinc-400 mt-1">{t('bookings.estimatedCost', { amount: Number(b.estimatedCost).toLocaleString(dateLocale), currency })}</p> : null}
                {b.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.financialStatus', { status: getBookingFinancialStatusLabel(b.financialStatus, t) })}</p> : null}
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
            {filteredShoot.length === 0 && <p className="text-sm text-zinc-400">{t('bookings.noShootRequests')}</p>}
          </div>
        </div>
      ) : null}

      {bookingHubTab === 'equipment' ? (
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6">
          <h3 className="font-black mb-4">{t('bookings.equipmentRequestsTitle')}</h3>
          <div className="space-y-3 max-h-[420px] overflow-auto">
            {filteredEquipment.map((b) => (
              <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{b.equipmentName} x{b.quantity}</p>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass(b.status)}`}>{getBookingStatusLabel(b.status, t)}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {b.leadId ? (
                    <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                      {b.customerName}
                    </button>
                  ) : b.customerName} — {t('bookings.fromToDates', { from: b.fromDate, to: b.toDate })}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.equipmentAvailableNow', { count: equipmentAvailableByName.get(b.equipmentName) ?? 0 })}</p>
                <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.byRep', { name: b.repName })}</p>
                {canOwnerApprove && b.status === 'قيد المراجعة' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => {
                        void (async () => {
                        const ok = await updateEquipmentBookingStatus(b.id, 'معتمد');
                        if (!ok) {
                          toast.error(t('bookings.equipmentApproveFailed'));
                          return;
                        }
                        toast.success(b.estimatedCost && Number(b.estimatedCost) > 0 ? t('bookings.equipmentApprovedWithAccrual') : t('bookings.equipmentApproved'));
                        })();
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >
                      {t('common.approve')}
                    </button>
                    <button
                      onClick={() => {
                        void (async () => {
                        const ok = await updateEquipmentBookingStatus(b.id, 'مرفوض');
                        if (!ok) {
                          toast.error(t('bookings.equipmentRejectFailed'));
                          return;
                        }
                        toast.info(t('bookings.equipmentRejected'));
                        })();
                      }}
                      className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black"
                    >
                      {t('common.reject')}
                    </button>
                  </div>
                )}
                {canAccountantExecute && b.financialStatus === 'بانتظار_تنفيذ_محاسب' && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteEquipmentBookingClaim(b.id, 'كاش');
                      if (!ok) toast.error(t('bookings.executeFailed'));
                      else toast.success(t('bookings.executedCash'));
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('bookings.executeCash')}</button>
                    <button onClick={() => { void (async () => {
                      const ok = await accountantExecuteEquipmentBookingClaim(b.id, 'تحويل');
                      if (!ok) toast.error(t('bookings.executeFailed'));
                      else toast.success(t('bookings.executedTransfer'));
                    })(); }} className="px-2 py-1 rounded-lg text-xs bg-indigo-500 text-white font-black">{t('bookings.executeTransfer')}</button>
                  </div>
                )}
                {b.estimatedCost ? <p className="text-[11px] text-zinc-400 mt-1">{t('bookings.estimatedCost', { amount: Number(b.estimatedCost).toLocaleString(dateLocale), currency })}</p> : null}
                {b.financialStatus ? <p className="text-[11px] text-zinc-500 mt-1">{t('bookings.financialStatus', { status: getBookingFinancialStatusLabel(b.financialStatus, t) })}</p> : null}
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
            {filteredEquipment.length === 0 && <p className="text-sm text-zinc-400">{t('bookings.noEquipmentRequests')}</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TeamPerformanceHub = ({ onGoToTab }: { onGoToTab?: (tab: string) => void }) => {
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
  const currency = t('common.currency');
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
      <SectionTitle title={t('screens.teamPerformance.title')} subtitle={t('screens.teamPerformance.subtitle')} icon={BarChart3} />
      <div className="flex items-center gap-3">
        <button onClick={exportPerformanceCsv} className="px-4 py-2 rounded-xl text-sm font-black bg-[#0F1528] border border-white/10 text-zinc-200">{t('teamPerf.exportCsv')}</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title={t('teamPerf.assignedLeads')} value={kpis.totalAssigned} icon={Users} color="blue" onClick={() => goLeads(false)} />
        <StatCard title={t('teamPerf.wonDeals')} value={kpis.totalWon} icon={Trophy} color="emerald" onClick={() => goLeads(false)} />
        <StatCard title={t('teamPerf.teamConversion')} value={`${kpis.teamConversion}%`} icon={Target} color="purple" onClick={() => goLeads(false)} />
        <StatCard title={t('teamPerf.overdueLeads')} value={kpis.totalOverdue} icon={AlertCircle} color="amber" onClick={() => goLeads(true)} />
        <StatCard title={t('teamPerf.avgResponse')} value={`${kpis.avgResponse} ${t('common.minutes')}`} icon={Clock} color="indigo" onClick={() => goLeads(true)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniMetricCard title={t('teamPerf.openPipeline')} value={`${weightedForecast.pipeline.toLocaleString(dateLocale)} ${currency}`} hint={t('teamPerf.pipelineHint', { count: weightedForecast.openCount })} icon={Briefcase} tone="indigo" />
        <MiniMetricCard title={t('teamPerf.weightedForecast')} value={`${Math.round(weightedForecast.weighted).toLocaleString(dateLocale)} ${currency}`} hint={t('teamPerf.forecastHint')} icon={TrendingUp} tone="emerald" />
        <MiniMetricCard title={t('teamPerf.dataHealth')} value={leads.filter((l) => !l.followUpAt && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length} hint={t('teamPerf.dataHealthHint')} icon={ShieldCheck} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
          <h4 className="font-black text-lg mb-2">{t('teamPerf.riskTitle')}</h4>
          <p className="text-xs text-zinc-500 mb-4">{t('teamPerf.riskHint')}</p>
          <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
            {managerInsights.highRiskReps.slice(0, 6).map((rep) => (
              <button key={rep.repId} type="button" onClick={() => goRepLeads(rep.repId, true)} className="w-full text-right rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 hover:border-rose-300/50 transition-all">
                <p className="text-sm font-black text-rose-100">{rep.repName}</p>
                <p className="text-[11px] text-zinc-300 mt-1">
                  {t('teamPerf.riskRow', { overdue: rep.overdueLeads, conversion: rep.conversionRate.toFixed(1), calls: rep.callsTargetProgress.toFixed(1) })}
                </p>
              </button>
            ))}
            {managerInsights.highRiskReps.length === 0 && <p className="text-sm text-zinc-400">{t('teamPerf.noRiskReps')}</p>}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5">
          <h4 className="font-black text-lg mb-2">{t('teamPerf.topPerfTitle')}</h4>
          <p className="text-xs text-zinc-500 mb-4">{t('teamPerf.topPerfHint')}</p>
          <button type="button" onClick={() => managerInsights.topRevenueRep && goRepLeads(managerInsights.topRevenueRep.repId, false)} className="w-full text-right rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 hover:border-emerald-300/45 transition-all">
            <p className="text-lg font-black text-emerald-200">{managerInsights.topRevenueRep?.repName || t('common.none')}</p>
            <p className="text-sm text-zinc-200 mt-2">
              {managerInsights.topRevenueRep ? `${managerInsights.topRevenueRep.revenue.toLocaleString(dateLocale)} ${currency}` : t('teamPerf.insufficientData')}
            </p>
            <p className="text-[11px] text-zinc-400 mt-2">
              {t('teamPerf.conversionLabel', { value: managerInsights.topRevenueRep ? `${managerInsights.topRevenueRep.conversionRate.toFixed(1)}%` : '—' })}
            </p>
          </button>
        </div>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h3 className="text-xl font-black">{t('teamPerf.rankingTitle')}</h3>
          <p className="text-zinc-400 text-sm mt-1">{t('teamPerf.rankingSubtitle')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[980px]">
            <thead>
              <tr className="bg-[#0B1020]/80">
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colRep')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colAssigned')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colActive')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colWinLoss')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colConversion')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colOverdue')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colAvgResponse')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colTargetProgress')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colLastActivity')}</th>
                <th className="p-4 text-[10px] uppercase tracking-widest text-zinc-400">{t('teamPerf.colRevenue')}</th>
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
                  <td className="p-4">{rep.avgResponseMins} {t('common.minutesShort')}</td>
                  <td className="p-4">
                    <div className="space-y-1">
                      <div className="text-[11px]">{t('teamPerf.progressLeads', { won: rep.wonDeals, target: rep.leadsTarget })}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-[#7C6BFF]" style={{ width: `${Math.min(100, rep.leadsTargetProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">{t('teamPerf.progressCalls', { count: rep.callsCount, target: rep.callsTarget })}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, rep.callsTargetProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">{t('teamPerf.progressDaily', { count: rep.dailyCallsCount, target: rep.dailyCallsTarget })}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, rep.dailyCallsProgress)}%` }} />
                      </div>
                      <div className="text-[11px] text-zinc-400">{t('teamPerf.progressWeekly', { count: rep.weeklyCallsCount, target: rep.weeklyCallsTarget })}</div>
                      <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, rep.weeklyCallsProgress)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-zinc-400 text-xs">
                    {rep.lastActivityAt ? new Date(rep.lastActivityAt).toLocaleString(dateLocale) : t('common.none')}
                  </td>
                  <td className="p-4 font-black">{rep.revenue.toLocaleString(dateLocale)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h4 className="font-black text-lg">{t('teamPerf.qaTitle')}</h4>
            <div className="text-xs text-zinc-400">
              {t('teamPerf.qaPending')}: <span className="font-black text-amber-300">{qaPending.length}</span> | {t('teamPerf.qaApprovedCount')}: <span className="font-black text-emerald-300">{qaApproved}</span> | {t('teamPerf.qaRejectedCount')}: <span className="font-black text-rose-300">{qaRejected}</span>
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
                  <p className="text-[11px] text-zinc-400 truncate">{q.repName} - {new Date(q.createdAt).toLocaleString(dateLocale)}</p>
                  {q.evidenceRef && <a href={q.evidenceRef} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-indigo-300 underline">{t('teamPerf.openEvidence')}</a>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {q.qaStatus === 'approved' && <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-emerald-500/20 text-emerald-300">{t('teamPerf.approved')}</span>}
                  {q.qaStatus === 'rejected' && <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-rose-500/20 text-rose-300">{t('teamPerf.rejected')}</span>}
                  {(!q.qaStatus || q.qaStatus === 'pending') && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); reviewLeadActivity(q.leadId, q.activityId, 'approved'); }} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                      <button onClick={(e) => { e.stopPropagation(); reviewLeadActivity(q.leadId, q.activityId, 'rejected', window.prompt(t('teamPerf.rejectReasonPrompt')) || undefined); }} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {qaQueue.length === 0 && <p className="text-sm text-zinc-400">{t('teamPerf.noQaItems')}</p>}
          </div>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-6">
          <h4 className="font-black text-lg mb-3">{t('teamPerf.monthlyTargetsTitle')}</h4>
          <p className="text-zinc-400 text-sm mb-4">{t('teamPerf.monthlyTargetsHint')}</p>
          <div className="space-y-4">
            {snapshots.map((rep) => (
              <div key={`${rep.repId}-target`} className="bg-[#0F1528]/70 border border-white/10 rounded-2xl p-4">
                <p className="font-bold mb-3">{rep.repName}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.targetLeads')}</p>
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
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.targetRevenue', { currency })}</p>
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
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.targetCallsMonthly')}</p>
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
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.targetCallsDaily')}</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.dailyCallsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { dailyCallsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                      placeholder={t('teamPerf.dailyTargetPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.targetCallsWeekly')}</p>
                    <input
                      type="number"
                      min={1}
                      value={rep.weeklyCallsTarget}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { weeklyCallsTarget: Number(e.target.value) || 1 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                      placeholder={t('teamPerf.weeklyTargetPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-zinc-500 font-bold">{t('teamPerf.commissionPercent')}</p>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={rep.commissionPercent}
                      disabled={!canEditTargets}
                      onChange={(e) => { void updateMonthlyTarget(rep.repId, { commissionPercent: Number(e.target.value) || 0 }); }}
                      className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">
                  {t('teamPerf.revenueProgress', {
                    percent: rep.revenueTargetProgress.toFixed(1),
                    commission: rep.estimatedCommission.toLocaleString(dateLocale),
                    currency,
                    calls: rep.callsTargetProgress.toFixed(1),
                  })}
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
  const { t } = useTranslation();
  const { users, leads } = useData();
  const reps = useMemo(() => users.filter(u => u.role === 'مندوب'), [users]);
  const activeLeads = useMemo(
    () => leads.filter((l) => l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة'),
    [leads]
  );

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <SectionTitle title={t('screens.salesTeam.title')} subtitle={t('screens.salesTeam.subtitle')} icon={UserPlus} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniMetricCard title={t('managerSales.repCount')} value={reps.length} hint={t('managerSales.repCountHint')} icon={Users} tone="indigo" />
        <MiniMetricCard title={t('managerSales.activeLeads')} value={activeLeads.length} hint={t('managerSales.activeLeadsHint')} icon={Briefcase} tone="amber" />
        <MiniMetricCard title={t('managerSales.avgLoad')} value={reps.length > 0 ? `${Math.ceil(activeLeads.length / reps.length)}` : '0'} hint={t('managerSales.avgLoadHint')} icon={Target} tone="emerald" />
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-[3rem] p-8">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="text-lg font-black text-white">{t('managerSales.currentReps', { count: reps.length })}</h3>
          <p className="text-xs text-zinc-500">{t('managerSales.editInSettings')}</p>
        </div>
        <div className="space-y-3 max-h-[460px] overflow-y-auto custom-scrollbar">
          {reps.map((rep) => {
            const assigned = activeLeads.filter((l) => l.assignedTo === rep.id).length;
            return (
              <div key={rep.id} className="flex items-center gap-4 bg-[#0F1528]/80 border border-white/10 rounded-2xl p-4">
                <img src={rep.avatar} alt="" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-white truncate">{rep.name}</p>
                  <p className="text-[11px] text-zinc-500">{t('managerSales.workload', { count: assigned })}</p>
                </div>
                <span className="px-3 py-1 rounded-xl text-[11px] font-black bg-[#7C6BFF]/15 border border-[#7C6BFF]/30 text-[#c4bcff]">
                  {t('managerSales.activeBadge', { count: assigned })}
                </span>
              </div>
            );
          })}
          {reps.length === 0 && <p className="text-sm text-zinc-500">{t('managerSales.noReps')}</p>}
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
  onReturnPriceQuoteToProduction,
  onApproveCustodyRequest,
  onRejectCustodyRequest,
  onGoToTab,
  entityComments,
  setEntityComments,
  commentDrafts,
  setCommentDrafts,
  currentUserName,
}: any) => {
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
  const currency = t('common.currency');
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
      <SectionTitle title={t('screens.approvalsHub.title')} subtitle={t('screens.approvalsHub.subtitle')} icon={ShieldCheck} />
      <p className="text-sm text-zinc-300 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>{t('approvals.summaryExpenses')}: <b className="text-amber-300">{pendingExpenses.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>{t('approvals.summaryShoot')}: <b className="text-indigo-300">{pendingShoot.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>{t('approvals.summaryEquipment')}: <b className="text-rose-300">{pendingEquipment.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>{t('approvals.summaryMeetings')}: <b className="text-indigo-200">{pendingMeetings.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>{t('approvals.summaryQuotes')}: <b className="text-amber-200">{pendingQuotes.length}</b></span>
        <span className="text-zinc-600 hidden sm:inline">|</span>
        <span>{t('approvals.summaryCustody')}: <b className="text-[#A99FFF]">{pendingCustodyRequest.length}</b></span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">{t('approvals.sectionExpenses')}</h4>
          {pendingExpenses.map((e: Expense) => {
            const submitter = expenseSubmitterDisplay(e, users);
            return (
            <div key={e.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{e.title}</p>
              {submitter ? (
                <p className="text-[11px] text-zinc-500 mt-1">{t('common.submittedBy', { name: submitter })}</p>
              ) : null}
              <p className="text-xs text-zinc-400 mt-1">{e.amount.toLocaleString(dateLocale)} {currency}</p>
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveExpense(e.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                  <button onClick={() => onRejectExpense(e.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
          {pendingExpenses.length === 0 && <p className="text-xs text-zinc-500">{t('common.noRequests')}</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">{t('approvals.sectionShoot')}</h4>
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
                  <button onClick={() => onApproveShoot(b.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                  <button onClick={() => onRejectShoot(b.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingShoot.length === 0 && <p className="text-xs text-zinc-500">{t('common.noRequests')}</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">{t('approvals.sectionEquipment')}</h4>
          {pendingEquipment.map((b: any) => (
            <div key={b.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{b.equipmentName} x{b.quantity}</p>
              <p className="text-xs text-zinc-400 mt-1">{b.fromDate} - {b.toDate} - {b.repName}</p>
              {b.leadId ? (
                <button type="button" onClick={() => goClient360(b.leadId)} className="cursor-pointer text-right text-xs text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  {t('common.clientLabel', { name: b.customerName })}
                </button>
              ) : null}
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveEquipment(b.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                  <button onClick={() => onRejectEquipment(b.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingEquipment.length === 0 && <p className="text-xs text-zinc-500">{t('common.noRequests')}</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">{t('approvals.sectionQuotes')}</h4>
          <p className="text-[11px] text-zinc-500">{t('approvals.quotesAccountingNote')}</p>
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
                    {t('approvals.costItems', { cost: q.productionCostAmount.toLocaleString(dateLocale), currency, margin: q.companyMarginPercent })}
                  </span>
                )}
                {t('approvals.beforeVat', { amount: q.amount.toLocaleString(dateLocale), currency })}
                {q.vatRate != null ? t('approvals.vatLine', { rate: q.vatRate }) : ''}
                {typeof q.totalAmount === 'number' ? t('approvals.totalLine', { total: q.totalAmount.toLocaleString(dateLocale), currency }) : ''} — {q.costCenter || t('finance.generalCostCenter')}
              </p>
              {q.pricedByName && <p className="text-[10px] text-teal-300/80 mt-0.5">{t('approvals.pricedBy', { name: q.pricedByName })}</p>}
              <p className="text-[10px] text-zinc-500 mt-1">{t('approvals.fromCreator', { name: q.createdByName })}{q.note && ` — ${q.note}`}</p>
              {ownerOnly ? (
                <div className="mt-3 space-y-2">
                  <div className="bg-black/20 rounded-xl p-3 space-y-3 border border-white/10 min-w-0 overflow-visible">
                    <p className="text-[11px] font-black text-zinc-300">{t('approvals.paymentTermsTitle')}</p>
                    <div className="space-y-1.5 min-w-0">
                      <label className="text-[10px] text-zinc-500 block">{t('approvals.initialPaymentLabel', { currency })}</label>
                      <input
                        type="number"
                        min={0}
                        value={getQPF(q.id).initPayment}
                        onChange={(e) => setQPF(q.id, { initPayment: e.target.value })}
                        className="w-full min-w-0 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5 text-xs"
                        placeholder="0"
                      />
                    </div>
                    {getQPF(q.id).lines.length > 0 && (
                      <p className="text-[10px] text-zinc-500 font-bold">{t('approvals.scheduledPayments')}</p>
                    )}
                    <div className="space-y-2 min-w-0">
                      {getQPF(q.id).lines.map((ln, li) => (
                        <div key={ln.id} className="rounded-lg border border-white/10 bg-[#0B1020]/50 p-2.5 space-y-2 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black text-zinc-400">{t('approvals.installmentN', { n: li + 1 })}</span>
                            <button
                              type="button"
                              onClick={() => setQPF(q.id, { lines: getQPF(q.id).lines.filter((_, i) => i !== li) })}
                              className="shrink-0 rounded-lg bg-rose-500/20 text-rose-300 px-2 py-0.5 text-[10px] font-black"
                              aria-label={t('approvals.deleteInstallment')}
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                          <div className="space-y-1 min-w-0">
                            <label className="text-[10px] text-zinc-500 block">{t('approvals.dueDate')}</label>
                            <input
                              type="date"
                              value={ln.dueDate}
                              onChange={(e) =>
                                setQPF(q.id, {
                                  lines: getQPF(q.id).lines.map((l, i) =>
                                    i === li ? { ...l, dueDate: e.target.value } : l,
                                  ),
                                })
                              }
                              className="w-full min-w-0 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <label className="text-[10px] text-zinc-500 block">{t('approvals.amountLabel', { currency })}</label>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={ln.amount || ''}
                              onChange={(e) =>
                                setQPF(q.id, {
                                  lines: getQPF(q.id).lines.map((l, i) =>
                                    i === li ? { ...l, amount: Number(e.target.value) } : l,
                                  ),
                                })
                              }
                              className="w-full min-w-0 bg-[#0B1020] border border-white/10 rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setQPF(q.id, {
                          lines: [...getQPF(q.id).lines, { id: `inst-${Date.now()}`, dueDate: '', amount: 0 }],
                        })
                      }
                      className="w-full text-center py-2 rounded-lg border border-dashed border-indigo-400/35 text-[11px] font-black text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                    >
                      {t('approvals.addScheduledPayment')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onApprovePriceQuote(q.id, getQPF(q.id).lines.filter(l => l.dueDate && l.amount > 0), Number(getQPF(q.id).initPayment) || 0)}
                      className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black"
                    >{t('approvals.approveQuoteSendRep')}</button>
                    {(q.productionAssignedId || q.pricedById) && onReturnPriceQuoteToProduction ? (
                      <button
                        type="button"
                        onClick={() => {
                          const raw = window.prompt(t('approvals.returnToProductionPrompt'));
                          if (raw === null) return;
                          onReturnPriceQuoteToProduction(q.id, raw.trim() || undefined);
                        }}
                        className="px-2 py-1.5 rounded-lg text-xs bg-amber-500/25 border border-amber-400/40 text-amber-100 font-black hover:bg-amber-500/35 transition-colors"
                      >
                        {t('approvals.returnToProduction')}
                      </button>
                    ) : null}
                    <button onClick={() => onRejectPriceQuote(q.id)} className="px-2 py-1.5 rounded-lg text-xs bg-rose-500 text-white font-black shrink-0">{t('common.reject')}</button>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingQuotes.length === 0 && <p className="text-xs text-zinc-500">{t('approvals.noPendingQuotes')}</p>}
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2">
          <h4 className="font-black">{t('approvals.sectionMeetings')}</h4>
          {pendingMeetings.map((m: any) => (
            <div key={m.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{m.title}</p>
              <p className="text-xs text-zinc-400 mt-1">{m.date} - {m.startTime} - {m.repName}</p>
              {m.leadId ? (
                <button type="button" onClick={() => goClient360(m.leadId)} className="cursor-pointer text-right text-xs text-cyan-300 mt-1 hover:text-indigo-300 hover:underline underline-offset-2 transition-colors">
                  {t('common.clientLabel', { name: leads.find((l: Lead) => l.id === m.leadId)?.name || m.leadId })}
                </button>
              ) : null}
              {typeof m.estimatedCost === 'number' && m.estimatedCost > 0 ? (
                <p className="text-xs text-zinc-300 mt-1">{t('approvals.estimatedCost', { amount: m.estimatedCost.toLocaleString(dateLocale), currency })}</p>
              ) : null}
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => onApproveMeeting(m.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('common.approve')}</button>
                  <button onClick={() => onRejectMeeting(m.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pendingMeetings.length === 0 && <p className="text-xs text-zinc-500">{t('common.noRequests')}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-2 md:col-span-2">
          <h4 className="font-black">{t('approvals.sectionCustody')}</h4>
          {pendingCustodyRequest.map((c: CustodyFund) => (
            <div key={c.id} className="bg-[#0F1528]/70 border border-white/10 rounded-xl p-3">
              <p className="font-bold">{c.title}</p>
              <p className="text-xs text-zinc-400 mt-1">{t('approvals.custodyAmount', { amount: c.totalAmount.toLocaleString(dateLocale), currency, manager: c.productionManagerName })}</p>
              <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">{c.description || '—'}</p>
              {ownerOnly ? (
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => onApproveCustodyRequest(c.id)} className="px-2 py-1 rounded-lg text-xs bg-emerald-500 text-slate-950 font-black">{t('approvals.approveCustody')}</button>
                  <button type="button" onClick={() => onRejectCustodyRequest(c.id)} className="px-2 py-1 rounded-lg text-xs bg-rose-500 text-white font-black">{t('common.reject')}</button>
                </div>
              ) : (
                <p className="text-[10px] text-amber-300/90 mt-2">{t('common.awaitingOwner')}</p>
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
                      placeholder={t('common.addComment')}
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
                    >{t('common.save')}</button>
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
  const { t } = useTranslation();
  if (lines.length === 0) return <p className="text-xs text-zinc-500">{t('productionFund.noSpendLines')}</p>;
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-white/10 bg-[#0B1020]/80">
      <table className="w-full text-right text-xs min-w-[640px]">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="p-2 font-black">{t('productionFund.colDescription')}</th>
            <th className="p-2 font-black">{t('productionFund.colAmount')}</th>
            <th className="p-2 font-black">{t('productionFund.colCategory')}</th>
            <th className="p-2 font-black">{t('productionFund.colCostCenter')}</th>
            <th className="p-2 font-black">{t('productionFund.colNote')}</th>
            <th className="p-2 font-black">{t('productionFund.colDocuments')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-white/5">
              <td className="p-2 text-zinc-200">{line.title || '—'}</td>
              <td className="p-2 text-emerald-300 font-bold">{Number(line.amount || 0).toLocaleString()}</td>
              <td className="p-2">{getExpenseCategoryLabel(line.category, t)}</td>
              <td className="p-2 text-zinc-400">{line.costCenter || '—'}</td>
              <td className="p-2 text-zinc-500 max-w-[160px] break-words">{line.note || '—'}</td>
              <td className="p-2">
                {(line.attachments?.length ?? 0) === 0 && <span className="text-amber-300/90">{t('productionFund.noAttachment')}</span>}
                {(line.attachments ?? []).map((a) => {
                  const href = custodyAttachmentHref(a);
                  return (
                    <div key={a.id} className="mb-1">
                      {href ? (
                        <a href={href} download={a.fileName} className="text-[#A99FFF] underline font-bold">{a.fileName}</a>
                      ) : (
                        <span className="text-zinc-500">{a.fileName} {t('productionFund.noSavedCopy')}</span>
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
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'ar-EG';
  const {
    currentUser,
    custodyFunds,
    expenses,
    priceQuotes,
    shootBookings,
    addExpense,
    managerReceiveCustody,
    managerUpdateCustodySpendLines,
    managerUpdateApprovedExpenseSpendLines,
    managerSubmitCustodySettlement,
    hardDeleteCustodyFund,
    hardDeleteExpense,
    productionPriceQuote,
    reassignPricingRequest,
    productionUpdateWorkOrder,
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

  const myWorkOrders = useMemo(() => {
    if (!currentUser?.id) return [];
    const uid = String(currentUser.id).trim();
    return shootBookings
      .filter(
        (b) =>
          b.workOrderFromQuote &&
          String(b.productionAssignedId || '').trim() === uid &&
          b.status !== 'مكتمل' &&
          b.status !== 'مرفوض',
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [shootBookings, currentUser?.id]);

  const [prodActiveTab, setProdActiveTab] = useState<'requests' | 'pricing' | 'workorders'>(() => {
    if (!currentUser?.id) return 'requests';
    const uid = String(currentUser.id).trim();
    const uname = (currentUser.name || '').trim();
    const pending = (priceQuotes as PriceQuote[]).some(
      (q) =>
        q.status === 'بانتظار التسعير' &&
        (String(q.productionAssignedId || '').trim() === uid ||
          (uname && String(q.productionAssignedName || '').trim() === uname)),
    );
    return pending ? 'pricing' : 'requests';
  });

  const myPricingQueue = useMemo(() => {
    if (!currentUser?.id) return [];
    const uid = String(currentUser.id).trim();
    const uname = (currentUser.name || '').trim();
    return (priceQuotes as PriceQuote[]).filter(
      (q) =>
        q.status === 'بانتظار التسعير' &&
        (String(q.productionAssignedId || '').trim() === uid ||
          (uname && String(q.productionAssignedName || '').trim() === uname)),
    );
  }, [priceQuotes, currentUser?.id, currentUser?.name]);

  const quoteStatusLabel: Record<PriceQuote['status'], string> = {
    'بانتظار التسعير': t('productionFund.quoteStatusPricing'),
    'قيد اعتماد المالك': t('productionFund.quoteStatusOwner'),
    معتمد: t('productionFund.quoteStatusApproved'),
    مرفوض: t('productionFund.quoteStatusRejected'),
    مكتمل: t('productionFund.quoteStatusDone'),
    'مغلق - رفض العميل': t('productionFund.quoteStatusClientRejected'),
  };

  const myPricingArchive = useMemo(() => {
    if (!currentUser?.id) return [];
    const uid = String(currentUser.id).trim();
    const uname = (currentUser.name || '').trim();
    const touchedByMe = (q: PriceQuote) =>
      String(q.productionAssignedId || '').trim() === uid ||
      String(q.pricedById || '').trim() === uid ||
      (uname && String(q.productionAssignedName || '').trim() === uname);
    return (priceQuotes as PriceQuote[])
      .filter(
        (q) =>
          touchedByMe(q) &&
          q.status !== 'بانتظار التسعير' &&
          !!(q.productionAssignedId || q.pricedById),
      )
      .sort((a, b) => new Date(b.pricedAt || b.createdAt).getTime() - new Date(a.pricedAt || a.createdAt).getTime());
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
      toast.error(t('productionFund.fileTooLarge'));
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
      toast.success(t('productionFund.attachmentAdded'));
    };
    reader.onerror = () => toast.error(t('productionFund.fileReadFailed'));
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
      toast.error(t('productionFund.fileTooLarge'));
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
      toast.success(t('productionFund.attachmentAdded'));
    };
    reader.onerror = () => toast.error(t('productionFund.fileReadFailed'));
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
      if (ok) toast.success(t('productionFund.expenseSpendSaved'));
      else toast.error(t('productionFund.expenseSpendSaveFailed'));
    } finally {
      setExpenseSpendSaveBusy(false);
    }
  };

  const saveLinesOnly = async () => {
    if (!activeFund) return;
    const ok = await managerUpdateCustodySpendLines(activeFund.id, draftLines);
    if (ok) toast.success(t('productionFund.custodyLinesSaved'));
    else toast.error(t('productionFund.custodyLinesSaveFailed'));
  };

  const submitSettlement = async () => {
    if (!activeFund) return;
    const ok = await managerSubmitCustodySettlement(activeFund.id, draftLines);
    if (ok) toast.success(t('productionFund.settlementSent'));
    else toast.error(t('productionFund.settlementSendFailed'));
  };

  const statusLabel = (status: string) => getCustodyStatusLabel(status, t);

  return (
    <div className="animate-in fade-in duration-500 space-y-6">
      <SectionTitle
        title={t('productionFund.dashTitle')}
        subtitle={t('productionFund.dashSubtitle')}
        icon={Briefcase}
      />

      {/* Tab navigation */}
      <div className="flex items-center gap-1 bg-[#0F1528]/70 border border-white/10 rounded-2xl p-1 w-fit">
        <button
          onClick={() => setProdActiveTab('requests')}
          className={`px-5 py-2 rounded-xl text-sm font-black transition-all ${prodActiveTab === 'requests' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          {t('productionFund.tabRequests')}
        </button>
        <button
          onClick={() => setProdActiveTab('pricing')}
          className={`relative px-5 py-2 rounded-xl text-sm font-black transition-all ${prodActiveTab === 'pricing' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-white'}`}
        >
          {t('productionFund.tabPricing')}
          {myPricingQueue.length > 0 && (
            <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {myPricingQueue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setProdActiveTab('workorders')}
          className={`relative px-5 py-2 rounded-xl text-sm font-black transition-all ${prodActiveTab === 'workorders' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          {t('productionFund.tabWorkOrders')}
          {myWorkOrders.length > 0 && (
            <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {myWorkOrders.length}
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
              {t('productionFund.noPricingQueue')}
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
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-zinc-700/60 text-zinc-300">{q.costCenter || t('productionFund.generalCostCenter')}</span>
                        <span className="text-[10px] text-zinc-500">{t('productionFund.sentBy')} {q.createdByName}</span>
                      </div>
                      {q.note && (
                        <p className="text-xs text-amber-300/80 mt-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-1.5">
                          {t('productionFund.repNotePrefix')} {q.note}
                        </p>
                      )}
                    </div>
                    <span className="px-3 py-1 rounded-xl text-xs font-black bg-amber-500/20 text-amber-200 border border-amber-500/30 shrink-0">
                      {t('productionFund.awaitingPricingBadge')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3 flex-wrap">
                    <ArrowLeftRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-xs text-zinc-400 shrink-0">{t('productionFund.reassignToOther')}</span>
                    {otherProductionUsers.length === 0 ? (
                      <span className="text-xs text-zinc-600 italic">{t('productionFund.noOtherProdManager')}</span>
                    ) : (
                      <>
                        <select
                          value={reassignTarget[q.id] || ''}
                          onChange={(e) => setReassignTarget((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          className="flex-1 min-w-[160px] bg-[#0B1020] border border-white/15 rounded-xl px-3 py-1.5 text-sm"
                        >
                          <option value="">{t('productionFund.selectProdManager')}</option>
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
                              toast.success(t('productionFund.reassignSuccess', { name: targetUser.name }));
                              setReassignTarget((prev) => { const n = { ...prev }; delete n[q.id]; return n; });
                            } else {
                              toast.error(t('productionFund.reassignFailed'));
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl text-xs font-black bg-indigo-500/20 border border-indigo-500/35 text-indigo-200 hover:bg-indigo-500/30 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
                        >
                          {t('productionFund.reassign')}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-zinc-200">{t('productionFund.pricingLines')}</p>
                      <button
                        onClick={() => addPFLine(q.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> {t('productionFund.addPricingLine')}
                      </button>
                    </div>
                    <div className="grid grid-cols-[1fr_160px_36px] gap-2 px-3 py-1">
                      <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">{t('productionFund.lineDescription')}</span>
                      <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest text-center">{t('productionFund.linePrice', { currency: t('common.currency') })}</span>
                      <span />
                    </div>
                    {draft.lines.map((line, idx) => (
                      <div key={line.id} className="grid grid-cols-[1fr_160px_36px] gap-2 items-center bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2">
                        <input
                          value={line.desc}
                          onChange={(e) => setPFLine(q.id, line.id, { desc: e.target.value })}
                          placeholder={t('productionFund.linePlaceholder', { n: idx + 1 })}
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
                        <span>{t('productionFund.costLinesSubtotal')}</span>
                        <span className="font-black text-white">{costSubtotal.toLocaleString(dateLocale)} {t('common.currency')}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-zinc-400">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="shrink-0">{t('productionFund.companyMarginLabel')}</span>
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
                          <span className="shrink-0">{t('productionFund.vatLabel')}</span>
                          <div className="flex items-center gap-1">
                            <input type="number" min={0} max={100} value={draft.vatRate} onChange={(e) => setPF(q.id, { vatRate: e.target.value })} className="w-16 bg-[#0B1020] border border-white/15 rounded-lg px-2 py-0.5 text-xs text-center" />
                            <span>%</span>
                          </div>
                        </div>
                      </div>
                      {companyPct > 0 && (
                        <div className="flex items-center justify-between text-xs text-teal-300/90">
                          <span>{t('productionFund.companyMarginAmount')}</span>
                          <span className="font-bold">{companyMarginAmt.toLocaleString(dateLocale)} {t('common.currency')}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm text-zinc-400 border-t border-white/5 pt-1.5">
                        <span>{t('productionFund.preVatClient')}</span>
                        <span className="font-black text-white">{preVatAmount.toLocaleString(dateLocale)} {t('common.currency')}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-zinc-400">
                        <span>{t('productionFund.vatAmount')}</span>
                        <span className="font-black text-amber-300">{vatAmt.toLocaleString(dateLocale)} {t('common.currency')}</span>
                      </div>
                      <div className="border-t border-white/10 pt-1.5 flex items-center justify-between">
                        <span className="font-black text-white">{t('productionFund.grandTotal')}</span>
                        <span className="font-black text-emerald-300 text-lg">{total.toLocaleString(dateLocale)} {t('common.currency')}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">{t('productionFund.pricingNoteOptional')}</label>
                    <input value={draft.note} onChange={(e) => setPF(q.id, { note: e.target.value })} placeholder={t('productionFund.pricingNotePh')} className="w-full bg-[#0B1020] border border-white/15 rounded-xl px-3 py-2 text-sm" />
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (costSubtotal <= 0) { toast.error(t('productionFund.addLineWithPrice')); return; }
                      const ok = await productionPriceQuote(
                        q.id,
                        preVatAmount,
                        Number(draft.vatRate) || 14,
                        draft.note || undefined,
                        companyPct,
                        costSubtotal,
                      );
                      if (ok) { toast.success(t('productionFund.sendPriceSuccess')); setPricingForm((p) => { const n = { ...p }; delete n[q.id]; return n; }); }
                      else toast.error(t('productionFund.priceFailed'));
                    }}
                    className="w-full py-3 rounded-2xl bg-amber-500 text-black text-sm font-black hover:bg-amber-400 transition-colors"
                  >
                    {t('productionFund.sendPriceToOwner')}
                  </button>
                </div>
              );
            })
          )}
          {myPricingArchive.length > 0 && (
            <details className="group bg-[#0F1528]/60 border border-white/10 rounded-3xl overflow-hidden">
              <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 text-sm font-black text-zinc-200 hover:bg-white/[0.04] transition-colors [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  {t('productionFund.pricingArchiveTitle')}
                  <span className="text-[11px] font-black text-zinc-500 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">{myPricingArchive.length}</span>
                </span>
                <span className="text-[10px] text-zinc-500 font-normal max-w-[min(420px,55vw)] text-left">
                  {t('productionFund.pricingArchiveHint')}
                </span>
              </summary>
              <div className="border-t border-white/10 px-4 py-3 space-y-2 max-h-[min(420px,50vh)] overflow-y-auto custom-scrollbar">
                {myPricingArchive.map((q: PriceQuote) => (
                  <div key={q.id} className="flex flex-wrap items-start justify-between gap-2 bg-black/20 border border-white/5 rounded-2xl px-3 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white truncate">{q.title}</p>
                      <p className="text-zinc-500 truncate">{q.customerName}</p>
                      {q.pricingNote && /طلب تعديل من المالك/.test(q.pricingNote) && (
                        <p className="text-[10px] text-amber-200/90 mt-1 line-clamp-2 whitespace-pre-wrap">{q.pricingNote}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-left space-y-0.5">
                      <span className="inline-block px-2 py-0.5 rounded-lg text-[10px] font-black bg-zinc-700/50 text-zinc-300 border border-white/10">
                        {quoteStatusLabel[q.status] ?? q.status}
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        {typeof q.totalAmount === 'number' ? `${q.totalAmount.toLocaleString(dateLocale)} ${t('common.currency')}` : t('productionFund.beforeVatAmount', { amount: q.amount.toLocaleString(dateLocale), currency: t('common.currency') })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {prodActiveTab === 'workorders' && (
        <div className="space-y-4">
          {myWorkOrders.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-12 text-center text-zinc-500">
              {t('productionFund.noWorkOrders')}
            </div>
          ) : (
            myWorkOrders.map((b) => {
              const checklist = b.workOrderChecklist?.length
                ? b.workOrderChecklist
                : [
                    { id: 'wo-prep', label: t('productionFund.woTaskPrep'), done: false },
                    { id: 'wo-team', label: t('productionFund.woTaskTeam'), done: false },
                    { id: 'wo-shoot', label: t('productionFund.woTaskShoot'), done: false },
                    { id: 'wo-deliver', label: t('productionFund.woTaskDeliver'), done: false },
                  ];
              const allDone = checklist.every((t) => t.done);
              return (
              <div key={b.id} className="bg-emerald-500/10 border border-emerald-500/25 rounded-3xl p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-white">{b.customerName}</p>
                    <p className="text-xs text-zinc-400">{t('productionFund.fromApprovedQuote')} {b.repName}</p>
                    {b.priceQuoteId && <p className="text-[10px] text-zinc-500">{t('productionFund.quoteRef')} {b.priceQuoteId}</p>}
                  </div>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${b.status === 'مكتمل' ? 'bg-zinc-700/50 text-zinc-300 border-white/10' : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'}`}>
                    {b.status === 'مكتمل' ? t('productionFund.workOrderDone') : t('productionFund.workOrderActive')}
                  </span>
                </div>
                <p className="text-sm text-zinc-300">
                  {b.date} — {b.time} — {b.location}
                </p>
                {b.estimatedCost ? (
                  <p className="text-xs text-amber-200">{t('productionFund.estimatedCost', { amount: b.estimatedCost.toLocaleString(dateLocale), currency: t('common.currency') })}</p>
                ) : null}
                <div className="space-y-2">
                  <p className="text-xs font-black text-zinc-300">{t('productionFund.executionTasks')}</p>
                  {checklist.map((task) => (
                    <label key={task.id} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={task.done}
                        disabled={b.status === 'مكتمل'}
                        onChange={async (e) => {
                          const next = checklist.map((t) => (t.id === task.id ? { ...t, done: e.target.checked } : t));
                          const ok = await productionUpdateWorkOrder(b.id, { workOrderChecklist: next });
                          if (!ok) toast.error(t('productionFund.taskSaveFailed'));
                        }}
                        className="rounded border-white/20"
                      />
                      <span className={task.done ? 'line-through text-zinc-500' : ''}>{task.label}</span>
                    </label>
                  ))}
                </div>
                {b.notes ? (
                  <p className="text-xs text-zinc-400 whitespace-pre-wrap bg-black/20 rounded-xl p-3 border border-white/5">{b.notes}</p>
                ) : null}
                {b.status !== 'مكتمل' && (
                  <button
                    type="button"
                    disabled={!allDone}
                    onClick={async () => {
                      const ok = await productionUpdateWorkOrder(b.id, { markComplete: true, workOrderChecklist: checklist });
                      if (ok) toast.success(t('productionFund.workOrderClosed'));
                      else toast.error(allDone ? t('productionFund.closeWorkOrderFailed') : t('productionFund.completeTasksFirst'));
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-black bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
                  >
                    {t('productionFund.closeWorkOrder')}
                  </button>
                )}
              </div>
            ); })
          )}
        </div>
      )}

      {/* ===== TAB: عهدة ومصروفات ===== */}
      {prodActiveTab === 'requests' && <>

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h4 className="font-black">{t('productionFund.unifiedTableTitle')}</h4>
          {unifiedProductionRows.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t('productionFund.deleteAllConfirm'))) return;
                for (const row of unifiedProductionRows) {
                  if (row.kind === 'custody') await hardDeleteCustodyFund(row.fund.id);
                  else await hardDeleteExpense(row.expense.id);
                }
                toast.success(t('productionFund.deleteAllSuccess'));
              }}
              className="shrink-0 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-black text-rose-200 hover:bg-rose-500/25 transition-colors"
            >
              {t('productionFund.deleteAll')}
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          {t('productionFund.unifiedTableHint')}
        </p>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-right text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="p-2 font-black">{t('productionFund.colType')}</th>
                <th className="p-2 font-black">{t('productionFund.colTitle')}</th>
                <th className="p-2 font-black">{t('productionFund.colAmount')}</th>
                <th className="p-2 font-black">{t('productionFund.colStatus')}</th>
                <th className="p-2 font-black">{t('productionFund.colPaymentJournal')}</th>
                <th className="p-2 font-black">{t('productionFund.colClosingJournal')}</th>
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
                      {row.kind === 'custody' ? t('productionFund.custodyTrust') : t('productionFund.expenseRequest')}
                    </span>
                  </td>
                  <td className="p-2 font-bold text-white">{row.title}</td>
                  <td className="p-2 text-emerald-300">{row.amount.toLocaleString()} {t('common.currency')}</td>
                  <td className="p-2">
                    {row.kind === 'custody' ? (
                      <span className={custodyStatusBadgeClass(row.fund.status)} title={statusLabel(row.fund.status)}>
                        {statusLabel(row.fund.status)}
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
                          {t('productionFund.approvalLabel')} {getApprovalStatusLabel(row.expense.approvalStatus, t)}
                        </span>
                        <span className="text-[10px] text-zinc-500">{t('productionFund.paymentLabel')} {getExpenseStatusLabel(row.expense.status, t)}</span>
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
                        if (!window.confirm(t('productionFund.deleteConfirm'))) return;
                        if (row.kind === 'custody') hardDeleteCustodyFund(row.fund.id).then((ok) => ok && toast.success(t('productionFund.deleted')));
                        else hardDeleteExpense(row.expense.id).then((ok) => ok && toast.success(t('productionFund.deleted')));
                      }}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-300 hover:bg-rose-500/20 transition-colors"
                    >
                      {t('productionFund.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {myFunds.length === 0 && custodyFunds.length > 0 && (
          <p className="text-[11px] text-amber-300/90 pt-1">
            {t('productionFund.custodyMismatchHint')}
          </p>
        )}
        {unifiedProductionRows.length === 0 && custodyFunds.length === 0 && myProductionExpenseRows.length === 0 && (
          <p className="text-sm text-zinc-500">{t('productionFund.noRequestsYet')}</p>
        )}
        {unifiedProductionRows.length === 0 && (custodyFunds.length > 0 || myProductionExpenseRows.length > 0) && (
          <p className="text-sm text-zinc-500">{t('productionFund.noMatchingRows')}</p>
        )}
        <p className="text-[11px] text-zinc-500 pt-1">{t('productionFund.bookingsTabHint')}</p>
      </div>

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">
        <h4 className="font-black">{t('productionFund.expenseFundingTitle')}</h4>
        <p className="text-[11px] text-zinc-500">
          {t('productionFund.expenseFundingHint')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder={t('productionFund.requestTitlePh')} value={expenseReqForm.title} onChange={(e) => setExpenseReqForm((p) => ({ ...p, title: e.target.value }))} />
          <input type="number" min={0} className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder={t('productionFund.amountPh')} value={expenseReqForm.amount} onChange={(e) => setExpenseReqForm((p) => ({ ...p, amount: e.target.value }))} />
          <select className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" value={expenseReqForm.category} onChange={(e) => setExpenseReqForm((p) => ({ ...p, category: e.target.value as Expense['category'] }))}>
            {(['رواتب', 'إيجارات', 'معدات', 'تسويق', 'تشغيل', 'ضيافة', 'نثريات', 'أخرى'] as const).map((c) => (
              <option key={c} value={c}>{getExpenseCategoryLabel(c, t)}</option>
            ))}
          </select>
          <input className="bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm" placeholder={t('productionFund.costCenterPh')} value={expenseReqForm.costCenter} onChange={(e) => setExpenseReqForm((p) => ({ ...p, costCenter: e.target.value }))} />
          <textarea className="md:col-span-2 bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm min-h-[72px]" placeholder={t('productionFund.notePh')} value={expenseReqForm.note} onChange={(e) => setExpenseReqForm((p) => ({ ...p, note: e.target.value }))} />
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
              toast.success(t('productionFund.submitSuccess'));
              setExpenseReqForm({ title: '', category: 'تشغيل', amount: '', costCenter: 'تصوير', note: '' });
            }
            } finally {
              setExpenseSubmitBusy(false);
            }
            })();
          }}
          className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black disabled:opacity-50 disabled:pointer-events-none"
        >
          {expenseSubmitBusy ? t('productionFund.submitting') : t('productionFund.submitRequest')}
        </button>
      </div>
      <div className="space-y-4">
          {!activeRowKey && unifiedProductionRows.length > 0 && (
            <p className="text-sm text-zinc-500">{t('productionFund.selectRowHint')}</p>
          )}
          {!activeRowKey && unifiedProductionRows.length === 0 && (
            <p className="text-sm text-zinc-500">{t('productionFund.noRequestsEmptyHint')}</p>
          )}
          {activeExpense && (
            <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-black">{t('productionFund.expenseDetailTitle')}</h4>
                <span className="inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black border border-sky-400/30 bg-sky-500/15 text-sky-200">{t('productionFund.expenseRequest')}</span>
              </div>
              <p className="text-sm text-zinc-300">{activeExpense.title}</p>
              <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                <span>{t('productionFund.labelAmount')} {(activeExpense.totalAmount ?? activeExpense.amount).toLocaleString(dateLocale)} {t('common.currency')}</span>
                <span>{t('productionFund.labelCategory')} {getExpenseCategoryLabel(activeExpense.category, t)}</span>
                <span>{t('productionFund.labelCostCenter')} {activeExpense.costCenter || '—'}</span>
                <span>{t('productionFund.labelOwnerApproval')} {getApprovalStatusLabel(activeExpense.approvalStatus, t)}</span>
                <span>{t('productionFund.labelPaymentStatus')} {getExpenseStatusLabel(activeExpense.status, t)}</span>
                {activeExpense.vendor && <span>{t('productionFund.labelVendor')} {activeExpense.vendor}</span>}
              </div>
              {activeExpense.note && <p className="text-xs text-zinc-500">{t('productionFund.labelNote')} {activeExpense.note}</p>}
              <p className="text-[11px] text-zinc-500 pt-1">
                {t('productionFund.expenseTrackingHint')}
              </p>
              {activeExpense.approvalStatus === 'معتمد' && (
                <div className="pt-4 mt-4 border-t border-white/10 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="font-black text-sm text-white">{t('productionFund.spendLinesTitle')}</h5>
                    <p
                      className={`text-sm font-bold ${
                        expenseSpendSum > (activeExpense.totalAmount ?? activeExpense.amount) + 0.01
                          ? 'text-rose-400'
                          : 'text-emerald-300'
                      }`}
                    >
                      {t('productionFund.spendTotal', { sum: expenseSpendSum.toLocaleString(dateLocale), max: (activeExpense.totalAmount ?? activeExpense.amount).toLocaleString(dateLocale), currency: t('common.currency') })}
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    {t('productionFund.expenseSpendHint')}
                  </p>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-white/10">
                    <table className="w-full text-right text-xs min-w-[720px]">
                      <thead className="sticky top-0 bg-[#0B1020] z-10">
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="p-2 font-black">{t('productionFund.colDescription')}</th>
                          <th className="p-2 font-black">{t('productionFund.colAmount')}</th>
                          <th className="p-2 font-black">{t('productionFund.colCategory')}</th>
                          <th className="p-2 font-black">{t('productionFund.colCostCenter')}</th>
                          <th className="p-2 font-black">{t('productionFund.colNote')}</th>
                          <th className="p-2 font-black">{t('productionFund.colDocuments')}</th>
                          <th className="p-2 font-black" />
                        </tr>
                      </thead>
                      <tbody>
                        {expenseSpendDraftLines.map((line) => (
                          <tr key={line.id} className="border-b border-white/5 align-top">
                            <td className="p-2">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.colDescription')}
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
                                    {getExpenseCategoryLabel(c, t)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 w-28">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.costCenterPh')}
                                value={line.costCenter}
                                onChange={(e) => updateExpenseSpendLine(line.id, { costCenter: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-32">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.notePh')}
                                value={line.note || ''}
                                onChange={(e) => updateExpenseSpendLine(line.id, { note: e.target.value })}
                              />
                            </td>
                            <td className="p-2 min-w-[140px]">
                              <label className="block cursor-pointer text-[11px] text-[#A99FFF] font-black underline mb-1">
                                {t('productionFund.addFile')}
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
                                        {t('productionFund.removeAttachment')}
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
                                {t('common.delete')}
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
                      {t('productionFund.addLineBtn')}
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
                      {expenseSpendSaveBusy ? t('settingsWork.saving') : t('productionFund.saveLinesAttachments')}
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
                  <h4 className="font-black">{t('productionFund.custodyDetailTitle')}</h4>
                  <span className={custodyStatusBadgeClass(activeFund.status)}>{statusLabel(activeFund.status)}</span>
                </div>
                <p className="text-sm text-zinc-300">{activeFund.description || '—'}</p>
                <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                  <span>{t('productionFund.labelAmount')} {activeFund.totalAmount.toLocaleString(dateLocale)} {t('common.currency')}</span>
                  {activeFund.paymentMethod && <span>{t('productionFund.labelAccountantPayMethod')} {activeFund.paymentMethod}</span>}
                  {activeFund.receivedMethod && <span>{t('productionFund.labelReceiveMethod')} {activeFund.receivedMethod}</span>}
                  {activeFund.journalEntryPaymentId && <span className="text-teal-300">{t('productionFund.paymentJournal')} {activeFund.journalEntryPaymentId}</span>}
                  {(activeFund.journalEntrySettlementId || activeFund.journalEntryId) && (
                    <span className="text-emerald-300">{t('productionFund.closingJournal')} {activeFund.journalEntrySettlementId || activeFund.journalEntryId}</span>
                  )}
                </div>
                {activeFund.status === 'طلب_بانتظار_المالك' && (
                  <p className="text-xs text-amber-300/90 pt-2">{t('productionFund.awaitingOwner')}</p>
                )}
                {activeFund.status === 'مرفوض_طلب' && activeFund.requestRejectReason && (
                  <p className="text-xs text-rose-300/90 pt-2">{t('productionFund.rejectReason')} {activeFund.requestRejectReason}</p>
                )}
                {activeFund.status === 'بانتظار_دفع_محاسب' && (
                  <p className="text-xs text-indigo-300/90 pt-2">{t('productionFund.awaitingAccountantPay')}</p>
                )}
                {activeFund.status === 'نشطة' && activeFund.settlementRejectedReason && (
                  <p className="text-xs text-rose-300/90 pt-2">{t('productionFund.settlementRejected')} {activeFund.settlementRejectedReason}</p>
                )}
                {activeFund.status === 'جاهزة_للاستلام' && (
                  <div className="flex flex-wrap gap-2 items-end pt-2">
                    <input
                      value={recvNote}
                      onChange={(e) => setRecvNote(e.target.value)}
                      placeholder={t('productionFund.notePh')}
                      className="flex-1 min-w-[160px] bg-[#0B1020] border border-white/10 rounded-xl px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await managerReceiveCustody(activeFund.id, recvNote);
                        if (ok) toast.success(t('productionFund.receiveSuccess'));
                        else toast.error(t('productionFund.receiveFailed'));
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black"
                    >
                      {t('productionFund.confirmReceive')}
                    </button>
                  </div>
                )}
              </div>

              {(activeFund.status === 'نشطة' || activeFund.status === 'جاهزة_للاستلام') && (
                <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-black">{t('productionFund.spendSettlementTable')}</h4>
                    <div className="flex flex-col items-end gap-0.5">
                      <p className={`text-sm font-bold ${spendSum > activeFund.totalAmount + 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {t('productionFund.spendTotal', { sum: spendSum.toLocaleString(dateLocale), max: activeFund.totalAmount.toLocaleString(dateLocale), currency: t('common.currency') })}
                      </p>
                      {spendSum > activeFund.totalAmount + 0.01 && (
                        <span className="text-[10px] font-black text-amber-300/90">
                          {t('productionFund.spendOverageLine', { amount: (spendSum - activeFund.totalAmount).toLocaleString(dateLocale), currency: t('common.currency') })}
                        </span>
                      )}
                      {activeFund.totalAmount > spendSum + 0.01 && (
                        <span className="text-[10px] font-black text-sky-300/90">
                          {t('productionFund.spendRemainderLine', { amount: (activeFund.totalAmount - spendSum).toLocaleString(dateLocale), currency: t('common.currency') })}
                        </span>
                      )}
                    </div>
                  </div>
                  {activeFund.status === 'جاهزة_للاستلام' && (
                    <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/[0.07] px-3 py-2 text-[11px] text-cyan-100/95 leading-relaxed">
                      {t('productionFund.readyPickupHint')}
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">
                    {t('productionFund.spendOverageHint')}
                  </p>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-white/10">
                    <table className="w-full text-right text-xs min-w-[720px]">
                      <thead className="sticky top-0 bg-[#0B1020] z-10">
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="p-2 font-black">{t('productionFund.colDescription')}</th>
                          <th className="p-2 font-black">{t('productionFund.colAmount')}</th>
                          <th className="p-2 font-black">{t('productionFund.colCategory')}</th>
                          <th className="p-2 font-black">{t('productionFund.colCostCenter')}</th>
                          <th className="p-2 font-black">{t('productionFund.colNote')}</th>
                          <th className="p-2 font-black">{t('productionFund.colDocuments')}</th>
                          <th className="p-2 font-black" />
                        </tr>
                      </thead>
                      <tbody>
                        {draftLines.map((line) => (
                          <tr key={line.id} className="border-b border-white/5 align-top">
                            <td className="p-2">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.colDescription')}
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
                                  <option key={c} value={c}>{getExpenseCategoryLabel(c, t)}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 w-28">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.costCenterPh')}
                                value={line.costCenter}
                                onChange={(e) => updateLine(line.id, { costCenter: e.target.value })}
                              />
                            </td>
                            <td className="p-2 w-32">
                              <input
                                className="w-full bg-[#0F1528] border border-white/10 rounded-lg px-2 py-1 text-xs"
                                placeholder={t('productionFund.notePh')}
                                value={line.note || ''}
                                onChange={(e) => updateLine(line.id, { note: e.target.value })}
                              />
                            </td>
                            <td className="p-2 min-w-[140px]">
                              <label className="block cursor-pointer text-[11px] text-[#A99FFF] font-black underline mb-1">
                                {t('productionFund.addFile')}
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
                                      <button type="button" className="text-[10px] text-rose-400 font-black" onClick={() => removeAttachmentFromLine(line.id, att.id)}>{t('productionFund.removeAttachment')}</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="p-2 w-12">
                              <button type="button" onClick={() => removeLine(line.id)} className="text-rose-400 text-xs font-black">{t('productionFund.removeLine')}</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={addLine} className="px-3 py-2 rounded-xl bg-white/10 text-sm font-black">
                      {t('productionFund.addLineBtn')}
                    </button>
                    <button type="button" onClick={saveLinesOnly} className="px-3 py-2 rounded-xl bg-white/10 text-sm font-black">
                      {t('productionFund.saveLinesOnly')}
                    </button>
                    <button
                      type="button"
                      onClick={submitSettlement}
                      disabled={activeFund.status !== 'نشطة'}
                      className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-black disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {t('productionFund.submitSettlementBtn')}
                    </button>
                  </div>
                  {activeFund.status === 'جاهزة_للاستلام' && (
                    <p className="text-[11px] text-zinc-500">{t('productionFund.settlementAfterReceive')}</p>
                  )}
                </div>
              )}

              {activeFund.status === 'تسوية_بانتظار_محاسب' && (
                <p className="text-sm text-amber-300/90">{t('productionFund.settlementAtAccountant')}</p>
              )}
              {activeFund.status === 'مقفلة' && (
                <p className="text-sm text-emerald-300/90">
                  {t('productionFund.custodyClosed', {
                    journal:
                      activeFund.journalEntrySettlementId || activeFund.journalEntryId
                        ? t('productionFund.custodyClosedJournal', {
                            id: activeFund.journalEntrySettlementId || activeFund.journalEntryId,
                          })
                        : '',
                  })}
                </p>
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

const NavItems = ({ role, active, onChange, allowedTabs }: any) => {
  const { t } = useTranslation();

  const owner = [
    { id: 'home', icon: Home },
    { id: 'approvals', icon: ShieldCheck },
    { id: 'owner-dash', icon: LayoutDashboard },
    { id: 'bookings', icon: Calendar },
    { id: 'team-performance', icon: BarChart3 },
    { id: 'leads', icon: Users },
    { id: 'accountant', icon: Receipt },
    { id: 'settings', icon: Settings },
    { id: 'linked-views', icon: Layers },
    { id: 'seo', icon: TrendingUp },
  ];

  const manager = [
    { id: 'home', icon: Home },
    { id: 'dashboard', icon: LayoutDashboard },
    { id: 'leads', icon: Users },
    { id: 'manager-reps', icon: UserPlus },
    { id: 'bookings', icon: Calendar },
    { id: 'team-performance', icon: BarChart3 },
    { id: 'linked-views', icon: Layers },
  ];

  const accountant = [
    { id: 'home', icon: Home },
    { id: 'accountant', icon: Receipt },
    { id: 'bookings', icon: Calendar },
    { id: 'leads', icon: Users },
    { id: 'linked-views', icon: Layers },
  ];

  const productionManager = [
    { id: 'home', icon: Home },
    { id: 'production', icon: Briefcase },
    { id: 'bookings', icon: Calendar },
    { id: 'leads', icon: Users },
  ];

  const rep = [
    { id: 'home', icon: Home },
    { id: 'dashboard', icon: Clock },
    { id: 'bookings', icon: Calendar },
    { id: 'leads', icon: Users },
    { id: 'performance', icon: Trophy },
    { id: 'linked-views', icon: Layers },
  ];

  const items = (role === 'مالك' ? owner : role === 'مدير مبيعات' ? manager : role === 'محاسب' ? accountant : role === 'مدير إنتاج' ? productionManager : rep)
    .filter((item) => allowedTabs.includes(item.id))
    .map((item) => ({ ...item, label: getNavLabel(item.id, role, t) }));

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

const WelcomeGate = ({ onUnlock }: { onUnlock: () => void }) => {
  const { dir } = useAppDirection();
  const { t } = useTranslation();
  const [tapCount, setTapCount] = useState(0);

  const onSecretTap = () => {
    const n = tapCount + 1;
    setTapCount(n);
    if (n >= 4) {
      onUnlock();
    }
  };

  return (
    <div className="min-h-screen bg-black font-['Cairo'] flex flex-col items-center justify-center p-8 relative overflow-hidden" dir={dir}>
      <LanguageSwitcher compact className="absolute top-4 end-4 z-20" />
      <div className="relative z-10 flex flex-col items-center justify-center text-center w-full max-w-2xl">
        <img
          src={WELCOME_WORDMARK}
          alt="The Untold Story"
          className="w-full max-w-[min(92vw,520px)] h-auto object-contain select-none"
          draggable={false}
        />
        <button
          type="button"
          onClick={onSecretTap}
          className="mt-10 flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none focus:outline-none active:scale-95 transition-transform"
          aria-label={t('welcome.openLogin')}
        >
          <span className="select-none text-4xl leading-none" role="presentation">
            😄
          </span>
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
  const { t } = useTranslation();
  const { dir } = useAppDirection();
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
        toast.success(t('login.welcome', { name: user.name }));
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
      toast.success(t('login.welcome', { name: user.name }));
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
    <div className="system-theme premium-login-shell cinematic-production min-h-screen bg-[#080B13] grid place-items-center p-6 font-['Cairo'] relative overflow-hidden" dir={dir}>
      <LanguageSwitcher compact className="absolute top-4 end-4 z-20" />
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
          {!supabaseMode && (
            <p className="text-zinc-400 font-bold text-xs">{t('login.subtitleApi')}</p>
          )}
        </div>


        <form onSubmit={handleSubmit} className="space-y-4 text-start">
          <div>
            <label className="block text-xs font-black text-zinc-500 mb-1">{t('login.email')}</label>
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
            <label className="block text-xs font-black text-zinc-500 mb-1">{t('login.password')}</label>
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
            {loading ? t('login.submitting') : t('login.submit')}
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
    baseSalary: (() => {
      const v = raw.baseSalary ?? raw['base_salary'];
      if (v == null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    })(),
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
    ownerReturnPriceQuoteToProduction,
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
    leadIngestionSettings,
    entityComments,
    setEntityComments,
    personalTodos,
    setPersonalTodos,
    uiVisualMode,
    setUiVisualMode,
    desktopNotifyWhenVisible,
    setDesktopNotifyWhenVisible,
  } = useData();
  const { t, i18n } = useTranslation();
  const { dir, isRtl, dateLocale } = useAppDirection();
  const roleLabel = (role: User['role']) => t(`roles.${role}`);
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
      const uid = String(currentUserId || '').trim();
      const base = filterNotificationsForViewer(getSystemNotifications(), currentRole, uid);
      const seen = new Set(base.map((n) => n.id));
      const personalFiltered = filterNotificationsForViewer(personalTodoBellNotifications, currentRole, uid);
      return [...base, ...personalFiltered.filter((n) => !seen.has(n.id))];
    } catch {
      return filterNotificationsForViewer(personalTodoBellNotifications, currentRole, String(currentUserId || '').trim());
    }
  }, [getSystemNotifications, currentRole, currentUserId, personalTodoBellNotifications, i18n.language]);
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

  useEffect(() => {
    const onNavIntent = () => {
      try {
        const raw = localStorage.getItem(NAV_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as { tab?: string };
        if (intent.tab === 'leads' && allowedTabs.includes('leads')) {
          handleTabChange('leads');
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('prod-system-nav-intent', onNavIntent);
    return () => window.removeEventListener('prod-system-nav-intent', onNavIntent);
  }, [allowedTabs, handleTabChange]);

  const resolveNotificationTab = (n: {
    navigateTab?: string;
    entityType?: SystemNotification['entityType'];
    title?: string;
    message?: string;
  }) => resolveNotificationTabForRole(n, allowedTabs);
  const resolveFinanceSubTab = (n: { entityType?: string; title?: string; message?: string }) => {
    const text = `${n.title || ''} ${n.message || ''}`;
    if (/مرتبات|حضور|انصراف|موظفين/i.test(text)) return 'reps' as const;
    if (/عهد|تسوية|أمانة/i.test(text)) return 'custody' as const;
    if (/مصروف|مصروفات|مورد/i.test(text)) return 'expenses' as const;
    if (/قيد|قيود|يومية|دفتر/i.test(text)) return 'journals' as const;
    if (n.entityType === 'invoice' || /فاتور|قسط|أقساط|تحصيل|ذمم/i.test(text)) return 'invoices' as const;
    return 'invoices' as const;
  };
  const handleNotificationClick = (n: Pick<SystemNotification, 'navigateTab' | 'entityType' | 'title' | 'message'>) => {
    const tab = resolveNotificationTab(n);
    if (!tab) {
      toast.info('لا يوجد تبويب متاح لهذا التنبيه ضمن صلاحياتك');
      return;
    }
    if (tab === 'leads') {
      const text = `${n.title || ''} ${n.message || ''}`;
      const intent: {
        tab: 'leads';
        leadsAssignedFilter?: 'all' | 'mine' | 'unassigned';
        leadsStatusFilter?: 'الكل' | LeadStatus;
        leadsSourceFilter?: LeadSourceFilter;
        leadsOverdueOnly?: boolean;
        leadsRepUserId?: string;
        leadsClient360Id?: string;
      } = { tab: 'leads' };
      if (/غير\s*مسند|غير\s*موزع|تنتظر\s*توزيع|بدون\s*تعيين|القنوات\s*المربوطة|وارد/i.test(text)) {
        intent.leadsAssignedFilter = 'unassigned';
        intent.leadsStatusFilter = 'جديد';
      }
      if (/facebook|فيسبوك/i.test(text)) intent.leadsSourceFilter = 'facebook';
      else if (/instagram|إنستجرام|انستجرام/i.test(text)) intent.leadsSourceFilter = 'instagram';
      else if (/linkedin|لينكد/i.test(text)) intent.leadsSourceFilter = 'linkedin';
      else if (/gmail|email|بريد|إيميل/i.test(text)) intent.leadsSourceFilter = 'email';
      else if (/google|جوجل|sheet/i.test(text)) intent.leadsSourceFilter = 'google';
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
    const role = currentUser?.role ?? 'مالك';
    const navItems = allowedTabs.map((tab) => ({
      id: `tab-${tab}`,
      label: t('command.goToTab', { label: getNavLabel(tab, role, t) }),
      type: 'tab' as const,
      tabId: tab,
    }));
    const leadItems = safeLeads.slice(0, 40).map((l) => ({
      id: `lead-${l.id || Math.random().toString(36).slice(2, 8)}`,
      label: t('command.lead', { label: `${l.name || t('command.noName')} - ${l.company || t('command.noName')}` }),
      type: 'lead' as const,
    }));
    const invoiceItems = safeInvoices.slice(0, 40).map((i) => {
      const amount = Number((i as any).amount);
      const amountLabel = Number.isFinite(amount) ? amount.toLocaleString(dateLocale) : '0';
      return {
        id: `inv-${i.id || Math.random().toString(36).slice(2, 8)}`,
        label: t('command.invoice', { label: `${i.customerName || t('command.noName')} - ${amountLabel} ${t('common.currency')}` }),
        type: 'invoice' as const,
      };
    });
    const expenseItems = safeExpenses.slice(0, 40).map((e) => {
      const amount = Number((e as any).amount);
      const amountLabel = Number.isFinite(amount) ? amount.toLocaleString(dateLocale) : '0';
      return {
        id: `exp-${e.id || Math.random().toString(36).slice(2, 8)}`,
        label: t('command.expense', { label: `${e.title || t('command.noName')} - ${amountLabel} ${t('common.currency')}` }),
        type: 'expense' as const,
      };
    });
    const q = commandQuery.trim().toLowerCase();
    return [...navItems, ...leadItems, ...invoiceItems, ...expenseItems]
      .filter((x) => !q || x.label.toLowerCase().includes(q))
      .slice(0, 18);
  }, [allowedTabs, safeLeads, safeInvoices, safeExpenses, commandQuery, t, currentUser?.role, dateLocale]);
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
    const errFinance = t('errors.noFinancePage');
    const errBookings = t('errors.noBookingsPage');
    const errProduction = t('errors.noProductionPage');
    const errFollowups = t('errors.noFollowupsPage');
    const errMeetings = t('errors.noMeetingsPage');
    const errClaims = t('errors.noFinancialClaimsPage');
    if (currentRole === 'محاسب') {
      const overdueInstallments = safeInvoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && inv.nextDueDate && inv.nextDueDate < todayDateKey).length;
      const dueTodayInstallments = safeInvoices.filter((inv) => Number(inv.remainingAmount || 0) > 0 && inv.nextDueDate === todayDateKey).length;
      const custodySettlementPending = custodyFunds.filter((f) => f.status === 'تسوية_بانتظار_محاسب').length;
      const financialClaimsPending = safeShootBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
        + safeEquipmentBookings.filter((b) => b.financialStatus === 'بانتظار_تنفيذ_محاسب').length
        + safeMeetingBookings.filter((m) => m.financialStatus === 'بانتظار_تنفيذ_محاسب').length;
      return [
        { id: 'acc-overdue-installments', label: t('homeFocus.accOverdueInstallments'), value: overdueInstallments, onClick: () => openAccountantSubTab('invoices', errFinance, { invoiceQuickFilter: 'overdue_installments' }) },
        { id: 'acc-due-today-installments', label: t('homeFocus.accDueTodayInstallments'), value: dueTodayInstallments, onClick: () => openAccountantSubTab('invoices', errFinance, { invoiceQuickFilter: 'due_today_installments' }) },
        { id: 'acc-financial-claims', label: t('homeFocus.accFinancialClaims'), value: financialClaimsPending, onClick: () => openBookingsWithIntent('financial_claims_pending_execution', errClaims) },
        { id: 'acc-custody-settlement', label: t('homeFocus.accCustodySettlement'), value: custodySettlementPending, onClick: () => openAccountantSubTab('custody', errFinance) },
      ];
    }
    if (currentRole === 'مدير إنتاج') {
      const h = productionCustodyHome;
      const myTodayMeetings = safeMeetingBookings.filter((m) => m.date === todayDateKey && m.repId === currentUserId).length;
      const goProd = () => openFirstAllowedTab(['production'], errProduction);
      return [
        { id: 'prod-custody-request', label: t('homeFocus.prodCustodyRequest'), value: h.request, onClick: goProd },
        { id: 'prod-custody-waitpay', label: t('homeFocus.prodCustodyWaitPay'), value: h.waitPay, onClick: goProd },
        { id: 'prod-custody-ready', label: t('homeFocus.prodCustodyReady'), value: h.ready, onClick: goProd },
        { id: 'prod-custody-active', label: t('homeFocus.prodCustodyActive'), value: h.active, onClick: goProd },
        { id: 'prod-custody-settlement', label: t('homeFocus.prodCustodySettlement'), value: h.settlement, onClick: goProd },
        { id: 'prod-today-meetings', label: t('homeFocus.prodTodayMeetings'), value: myTodayMeetings, onClick: () => openBookingsWithIntent('today', errMeetings) },
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
          label: t('homeFocus.repOverdueFollowups'),
          value: myOverdue,
          onClick: () => {
            localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'leads', leadsAssignedFilter: 'mine', leadsOverdueOnly: true }));
            openFirstAllowedTab(['leads', 'dashboard'], errFollowups);
          },
        },
        { id: 'rep-today-followups', label: t('homeFocus.repTodayFollowups'), value: myTodayFollowups, onClick: () => openFirstAllowedTab(['dashboard', 'leads'], errFollowups) },
        { id: 'rep-today-bookings', label: t('homeFocus.repTodayBookings'), value: myTodayBookings, onClick: () => openBookingsWithIntent('today', errBookings) },
      ];
    }
    return [
      { id: 'ops-overdue-followups', label: t('homeFocus.opsOverdueFollowups'), value: overdueFollowupsCount, onClick: () => handleTodayFocusClick('overdue-followups') },
      { id: 'ops-pending-approvals', label: t('homeFocus.opsPendingApprovals'), value: dataHealth.pendingApprovals, onClick: () => handleTodayFocusClick('pending-approvals') },
      { id: 'ops-today-meetings', label: t('homeFocus.opsTodayMeetings'), value: todayMeetingsCount, onClick: () => handleTodayFocusClick('today-meetings') },
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
    t,
    i18n.language,
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
    <div className={`system-theme ${uiVisualMode === 'premium' ? 'premium-shell cinematic-production' : 'ui-classic'} ${isNotificationsOpen ? 'notifications-open' : ''} ${roleClass} tab-${activeTab} flex h-screen max-h-screen bg-[#080B13] text-slate-100 font-['Cairo'] overflow-hidden`} dir={dir}>
      <BulkLeadsUploadModal isOpen={isBulkModalOpen} onClose={() => setIsBulkModalOpen(false)} />
      {personalTodoDueAlarm && personalTodoDueAlarm.length > 0
        ? createPortal(
            <div
              className="fixed inset-0 z-[2147483000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md isolate pointer-events-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="personal-todo-alarm-title"
            >
              <div className="w-full max-w-md rounded-2xl border border-rose-400/50 bg-[#0f1528] shadow-[0_24px_80px_rgba(0,0,0,0.55)] p-6 text-start ring-2 ring-rose-500/30">
                <p id="personal-todo-alarm-title" className="text-lg font-black text-rose-100 mb-2">
                  {t('personalTodo.dueTitle')}
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
                    {t('personalTodo.playSoundAgain')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPersonalTodoDueAlarm(null)}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-500/40 to-rose-400/25 border border-rose-300/50 text-rose-50 font-black text-sm hover:from-rose-500/55 hover:to-rose-400/35 transition-all"
                  >
                    {t('common.ok')}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Sidebar */}
      <aside className="premium-sidebar-shell w-72 shrink-0 self-start border-e border-white/10 bg-[#0C1120] sticky top-0 h-screen max-h-screen hidden lg:flex flex-col p-8 z-[100]">
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
               <p className="text-[10px] text-zinc-400 uppercase">{roleLabel(currentUser.role)}</p>
             </div>
           </div>
          <button
            type="button"
            onClick={() => {
              logout();
              toast.info(t('common.logoutDone'));
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-rose-500 hover:bg-rose-500/10 font-bold transition-all"
          >
             <LogOut className="w-5 h-5" />
             <span>{t('common.logout')}</span>
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
              aria-label={t('nav.closeMenu')}
              onClick={() => setIsSidebarOpen(false)}
            />
            <aside className="fixed top-0 bottom-0 end-0 z-[70] flex w-[min(20rem,92vw)] max-w-full flex-col border-e border-white/10 bg-[#0C1120] p-6 shadow-2xl lg:hidden">
              <div className="mb-6 flex shrink-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <img src={currentUser.avatar} className="h-10 w-10 shrink-0 rounded-xl border border-white/15" alt="" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{currentUser.name}</p>
                    <p className="text-[10px] text-zinc-400">{roleLabel(currentUser.role)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  className="shrink-0 rounded-xl p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
                  aria-label={t('common.close')}
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
                    toast.info(t('common.logoutDone'));
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 font-bold text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  <LogOut className="h-5 w-5" />
                  <span>{t('common.logout')}</span>
                </button>
              </div>
            </aside>
          </>,
          document.body
        )}

      {/* Main Content */}
      <main className="premium-main-layer flex-1 min-h-0 p-6 lg:p-12 max-w-[1600px] mx-auto w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="sticky top-0 z-[95] isolate -mx-6 -mt-6 mb-4 flex items-center gap-3 border-b border-white/10 bg-[#0C1120]/95 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-white hover:border-[#7C6BFF]/40"
            aria-label={t('nav.openMenu')}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('nav.navigation')}</p>
            <p className="truncate text-sm font-black text-white">{getNavLabel(activeTab, currentUser.role, t)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              toast.info(t('common.logoutDone'));
            }}
            title={t('common.logout')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-400/35 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
            aria-label={t('common.logout')}
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        {/* Header */}
        {(
        <header className="premium-header-shell relative z-[90] flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl font-black text-white">{t('header.greeting', { name: currentUser.name.split(' ')[0] })}</h1>
            <p className="text-zinc-400 font-bold mt-1 uppercase text-xs tracking-widest">{t('header.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <LanguageSwitcher compact />
            {activeTab !== 'home' && (
              <>
                <button
                  onClick={() => setIsCommandOpen(true)}
                  title={t('header.quickSearch')}
                  className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-4 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 text-zinc-100 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all text-sm font-black leading-tight shrink-0 inline-flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  <span className="hidden lg:inline">{t('header.quickSearchSlash')}</span>
                  <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    {t('header.quickSearch')}
                  </span>
                </button>
                <button
                  onClick={handleGoBackTab}
                  title={t('header.goBack')}
                  className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-4 rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 text-zinc-100 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all text-sm font-black leading-tight shrink-0 inline-flex items-center justify-center gap-2"
                >
                  {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  <span className="hidden lg:inline">{t('header.goBack')}</span>
                  <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    {t('common.back')}
                  </span>
                </button>
              </>
            )}
            {(currentUser.role === 'مالك' || currentUser.role === 'مدير مبيعات') && (
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(true)}
                title={t('common.uploadExcel')}
                className="premium-top-action group relative h-12 w-12 sm:w-auto sm:px-5 bg-gradient-to-b from-white/[0.08] to-white/[0.03] text-zinc-100 rounded-xl font-bold inline-flex items-center justify-center gap-2.5 hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all border border-white/15 shrink-0"
              >
                <FileUp className="w-5 h-5 text-[#A99FFF]" />
                <span className="hidden lg:inline">{t('common.uploadExcel')}</span>
                <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  {t('common.uploadExcel')}
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
                title={t('header.notifications')}
                className="premium-top-action group relative h-12 w-12 flex items-center justify-center bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 rounded-xl hover:border-rose-300/40 hover:shadow-[0_10px_24px_rgba(244,63,94,0.15)] transition-all"
              >
                <Bell className="w-6 h-6 text-zinc-300" />
                <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  {t('header.notifications')}
                </span>
              </button>
              {isNotificationsOpen && createPortal(
                <div
                  className="premium-notifications-panel fixed w-[360px] max-w-[90vw] bg-[#E8EAED] border border-zinc-300/80 rounded-2xl shadow-2xl z-[9999] p-3 text-zinc-900"
                  style={{ top: notificationsPanelPos.top, left: notificationsPanelPos.left }}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <p className="text-sm font-black text-zinc-900">{t('notifications.hub')}</p>
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
                                if (!ok) toast.error(t('notifications.syncFailed'));
                                else toast.success(t('notifications.syncDone'));
                              } finally {
                                setNotificationsPanelSyncing(false);
                              }
                            })();
                          }}
                          className="text-[11px] font-bold text-cyan-700 hover:text-cyan-900 disabled:opacity-40"
                        >
                          {notificationsPanelSyncing ? t('common.refreshing') : t('common.refresh')}
                        </button>
                      )}
                      <button type="button" onClick={() => setIsNotificationsOpen(false)} className="text-xs text-zinc-600 hover:text-zinc-900">{t('common.close')}</button>
                    </div>
                  </div>
                  {notificationsPanelSyncing && (
                    <p className="text-[11px] text-zinc-600 mb-2">{t('notifications.syncing')}</p>
                  )}
                  {isServerDataMode() && currentUser?.authSource === 'database' && (
                    <p className="text-[10px] text-zinc-600 mb-2 leading-relaxed">
                      {t('notifications.syncHint')}
                    </p>
                  )}
                  <div className="mb-2 flex items-center gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 border border-rose-300">{t('notifications.critical')}: {criticalNotifications.length}</span>
                    <span className="px-2 py-1 rounded-lg bg-zinc-200 text-zinc-800 border border-zinc-400">{t('notifications.normal')}: {normalNotifications.length}</span>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`premium-notification-item w-full text-right rounded-xl border p-3 ${
                        n.level === 'high'
                          ? 'border-rose-300 bg-white'
                          : n.level === 'medium'
                            ? 'border-amber-300 bg-white'
                            : 'border-emerald-300 bg-white'
                      } hover:border-zinc-400 hover:shadow-md cursor-pointer`}>
                        <p className="text-sm font-bold text-zinc-900">{n.title}</p>
                        <p className="text-xs text-zinc-700 mt-1">{n.message}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-[10px] text-zinc-500">{new Date(n.createdAt).toLocaleString(dateLocale)}</p>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${((n as any).priority || (n.level === 'high' ? 'critical' : 'normal')) === 'critical' ? 'bg-rose-100 text-rose-800' : 'bg-zinc-200 text-zinc-700'}`}>
                              {((n as any).priority || (n.level === 'high' ? 'critical' : 'normal')) === 'critical' ? t('notifications.critical') : t('notifications.normal')}
                            </span>
                            <p className="text-[10px] text-violet-700 font-bold">{t('notifications.openTab', { tab: resolveNotificationTab(n) ? getNavLabel(resolveNotificationTab(n)!, currentUser.role, t) : '—' })}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                    {notifications.length === 0 && (
                      <p className="text-xs text-zinc-600 text-center py-4">{t('notifications.empty')}</p>
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
                toast.info(t('common.logoutDone'));
              }}
              title={t('common.logout')}
              className="premium-top-action premium-top-danger group relative h-12 w-12 sm:w-auto sm:px-5 rounded-xl bg-gradient-to-r from-rose-500/30 to-rose-400/10 border border-rose-400/45 text-rose-100 hover:from-rose-500/40 hover:to-rose-300/20 hover:shadow-[0_10px_28px_rgba(244,63,94,0.35)] transition-all duration-300 font-bold inline-flex items-center justify-center gap-2 shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden lg:inline">{t('common.logout')}</span>
              <span className="lg:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 top-[110%] whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1020]/95 px-2 py-1 text-[10px] text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                {t('common.logout')}
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
              <span className="text-zinc-300">{t('home.unassignedLeads')}</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.leadsNoAssignee}</span>
            </button>
            <button
              type="button"
              onClick={() => handleHomeDataHealthClick('pending-approvals')}
              className="text-right bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.05] border border-white/15 rounded-2xl px-4 py-3.5 text-sm hover:border-rose-300/35 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(244,63,94,0.16)] transition-all duration-300"
            >
              <span className="text-zinc-300">{t('home.pendingApprovals')}</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.pendingApprovals}</span>
            </button>
            <button
              type="button"
              onClick={() => handleHomeDataHealthClick('invoices-no-cc')}
              className="text-right bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.05] border border-white/15 rounded-2xl px-4 py-3.5 text-sm hover:border-rose-300/35 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(244,63,94,0.16)] transition-all duration-300"
            >
              <span className="text-zinc-300">{t('home.invoicesNoCostCenter')}</span>
              <span className="font-black text-2xl text-white block mt-1">{dataHealth.invoicesNoCostCenter}</span>
            </button>
          </div>
        )}
        {activeTab === 'home' && (
          <div className="mb-8 grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-rose-500/[0.06] border border-white/15 rounded-3xl p-5 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.3)]">
              <p className="text-[11px] text-zinc-500 mb-3 tracking-widest font-black">{t('home.todayFocus')}</p>
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
                <p className="text-[11px] text-zinc-500 tracking-widest font-black">{t('header.personalTasks')}</p>
                <span className="text-[11px] text-zinc-500">{t('personalTodo.openCount', { count: personalTodos.filter((item) => !item.done).length })}</span>
              </div>
              <input value={todoInput} onChange={(e) => setTodoInput(e.target.value)} placeholder={t('personalTodo.placeholder')} className="w-full bg-black/20 border border-white/15 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-rose-300/45 transition-all mb-2" />
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[10px] text-zinc-500 shrink-0 w-full sm:w-auto">{t('personalTodo.dueOptional')}</span>
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
                  {t('personalTodo.noTime')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  const text = todoInput.trim();
                  if (!text) return;
                  if (!canonicalTodoUserId(currentUser?.id)) {
                    toast.error(t('personalTodo.saveFailedNoUser'));
                    return;
                  }
                  let dueIso: string | undefined;
                  const dateT = todoDueDate.trim();
                  const timeT = todoDueTime.trim();
                  if (dateT || timeT) {
                    if (!dateT) {
                      toast.error(t('personalTodo.pickDateOrClearTime'));
                      return;
                    }
                    if (!timeT) {
                      toast.error(t('personalTodo.pickTimeWithDate'));
                      return;
                    }
                    const d = new Date(`${dateT}T${timeT}`);
                    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
                      dueIso = d.toISOString();
                    } else {
                      toast.error(t('personalTodo.futureDueRequired'));
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
                  toast.success(dueIso ? t('personalTodo.savedWithReminder') : t('personalTodo.saved'));
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500/30 to-rose-400/20 border border-rose-300/35 text-xs text-rose-100 font-black hover:from-rose-500/40 hover:to-rose-400/30 transition-all duration-300 mb-2"
              >
                {t('personalTodo.addTask')}
              </button>
              <div className="space-y-1 max-h-40 overflow-auto custom-scrollbar">
                {personalTodos.map((todo) => {
                  let dueBadge: React.ReactNode = null;
                  if (todo.dueAt) {
                    const dueMs = new Date(todo.dueAt).getTime();
                    const over = Number.isFinite(dueMs) && dueMs <= Date.now();
                    const label = Number.isFinite(dueMs)
                      ? new Date(todo.dueAt).toLocaleString(dateLocale, { dateStyle: 'short', timeStyle: 'short' })
                      : '';
                    dueBadge = (
                      <span className={`block text-[10px] mt-0.5 ${over ? 'text-rose-300' : 'text-amber-200/95'}`}>
                        {over ? t('personalTodoExtra.overduePrefix') : t('personalTodoExtra.duePrefix')}
                        {label}
                      </span>
                    );
                  }
                  return (
                    <div key={todo.id} className="flex items-start justify-between gap-2 text-xs bg-white/10 border border-white/10 rounded-xl px-3 py-2">
                      <div className="min-w-0 text-right">
                        <button type="button" onClick={() => setPersonalTodos((prev) => prev.map((x) => (x.id === todo.id ? { ...x, done: !x.done } : x)))} className={`text-right ${todo.done ? 'line-through text-zinc-500' : 'text-white font-bold'}`}>
                          {todo.text}
                        </button>
                        {dueBadge}
                      </div>
                      <button type="button" onClick={() => setPersonalTodos((prev) => prev.filter((x) => x.id !== todo.id))} className="text-rose-200 hover:text-rose-100 transition-colors shrink-0">{t('personalTodoExtra.delete')}</button>
                    </div>
                  );
                })}
                {personalTodos.length === 0 && <p className="text-[11px] text-zinc-500">{t('personalTodo.noTasks')}</p>}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'home' && showSalesOpsHomeStrip && safeLeads.filter(l => (l.slaStatus === 'متأخر' || l.slaStatus === 'حرج') && l.status !== 'مغلق - فوز' && l.status !== 'مغلق - خسارة').length > ALERT_MAX_OVERDUE_LEADS && (
          <div className="mb-6 bg-rose-500/15 border border-rose-500/30 rounded-2xl p-3 text-sm text-rose-200">
            {t('homeAlerts.overdueThreshold')}
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
                else toast.success('تم اعتماد عرض السعر — يُعاد للمندوب لتقديمه للعميل');
                })();
              }}
              onRejectPriceQuote={(id: string) => {
                void (async () => {
                const ok = await rejectPriceQuote(id);
                if (!ok) toast.error('تعذر الرفض');
                else toast.info('تم رفض عرض السعر');
                })();
              }}
              onReturnPriceQuoteToProduction={(id: string, ownerNote?: string) => {
                void (async () => {
                  const ok = await ownerReturnPriceQuoteToProduction(id, ownerNote);
                  if (!ok) toast.error('تعذر الإرجاع — تحقق من مسار الإنتاج أو الاتصال بالخادم');
                  else toast.success('أُعيد العرض لمدير الإنتاج لإعادة التسعير');
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
        
        {activeTab === 'dashboard' && currentUser.role === 'مندوب' && (
          <RepProfessionalDashboard currentUser={currentUser} onGoToTab={handleTabChange} />
        )}
        {activeTab === 'dashboard' && currentUser.role === 'مدير مبيعات' && (
          <TeamPerformanceHub onGoToTab={handleTabChange} />
        )}
        {activeTab === 'production' && currentUser.role === 'مدير إنتاج' && <ProductionCustodyDashboard />}
        {activeTab === 'performance' && currentUser.role === 'مندوب' && (
          <RepPerformanceView currentUser={currentUser} onGoToTab={handleTabChange} />
        )}

        {activeTab === 'leads' && <LeadsWorkspace onOpenBulkUpload={() => setIsBulkModalOpen(true)} />}
        {activeTab === 'linked-views' && <PageViewsHub />}
        {activeTab === 'seo' && currentUser.role === 'مالك' && <SeoModuleHub />}
        </div>
      </main>
      {isCommandOpen && (
        <div className="fixed inset-0 z-[240] bg-black/60 backdrop-blur-sm flex items-start justify-center p-6 pt-24" dir="rtl">
          <div className="w-full max-w-2xl bg-[#0B1020] border border-white/15 rounded-3xl p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-400">{t('command.title')}</p>
              <button onClick={() => setIsCommandOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Esc</button>
            </div>
            <input
              autoFocus
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder={t('command.placeholder')}
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
              {commandItems.length === 0 && <p className="text-xs text-zinc-500 p-2">{t('command.noResults')}</p>}
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

