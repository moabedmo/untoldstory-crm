import {
  Target,
  Search,
  Plus,
  Phone,
  Clock,
  CheckCircle2,
  TrendingUp,
  UserPlus,
  X,
  ArrowRight,
} from 'lucide-react';
import { motion as Motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useData, Lead, LeadStatus, DeleteLeadResult } from '../context/DataContext';
import type { TFunction } from 'i18next';
import { getLeadStatusLabel } from '@/lib/i18nLabels';
import { useAppDirection } from '../hooks/useAppDirection';
import {
  leadMatchesSourceFilter,
  leadSourceDisplayLabel,
  type LeadSourceFilter,
} from '@/lib/leadSource';
import * as Dialog from '@radix-ui/react-dialog';

const STATUS_FILTERS: Array<'all' | LeadStatus> = [
  'all',
  'جديد',
  'قيد التواصل',
  'عرض سعر',
  'تفاوض',
  'مغلق - فوز',
  'مغلق - خسارة',
];

const SOURCE_FILTERS: Array<{ id: LeadSourceFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'leadsLegacy.allSources' },
  { id: 'facebook', labelKey: 'Facebook' },
  { id: 'instagram', labelKey: 'Instagram' },
  { id: 'google', labelKey: 'Google' },
];

function getStatusStyle(status: string) {
  switch (status) {
    case 'جديد':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    case 'قيد التواصل':
      return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
    case 'عرض سعر':
    case 'تفاوض':
      return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
    case 'مغلق - فوز':
      return 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20';
    case 'مغلق - خسارة':
      return 'bg-red-500/10 text-red-500 border-red-500/20';
    default:
      return 'bg-zinc-800 text-zinc-400 border-zinc-700';
  }
}

function getStatusLabel(status: string, t: TFunction) {
  if (status === 'all') return t('common.all');
  return getLeadStatusLabel(status, t);
}

export default function LeadsPage({ isSalesRep = false }: { isSalesRep?: boolean }) {
  const { t } = useTranslation();
  const { dir, dateLocale } = useAppDirection();
  const currency = t('common.currency');
  const { leads, users, currentUser, addLead, assignLead, deleteLead } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<LeadSourceFilter>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const currentUserId = currentUser?.id ?? '';

  const displayLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.company.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === 'all' || lead.status === activeFilter;
    const matchesSource = leadMatchesSourceFilter(lead.source, sourceFilter);
    const matchesRole = !isSalesRep || lead.assignedTo === currentUserId;
    return matchesSearch && matchesFilter && matchesSource && matchesRole;
  });

  const handleAddLead = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) {
      toast.error(t('leadsLegacy.addForbidden'));
      return;
    }
    const formData = new FormData(e.currentTarget);
    const budget = Number(formData.get('value')) || 0;
    addLead({
      name: String(formData.get('name') || '').trim(),
      company: String(formData.get('company') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      source: String(formData.get('source') || 'يدوي'),
      status: 'جديد',
      budget,
      companySize: 'متوسط',
      category: 'سوشيال ميديا',
    });
    setIsAddModalOpen(false);
    toast.success(t('leadsLegacy.addSuccess'));
  };

  const handleAssign = (userId: string) => {
    if (!selectedLead) return;
    if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) {
      toast.error(t('leadsLegacy.assignForbidden'));
      return;
    }
    assignLead(selectedLead.id, userId);
    setIsAssignModalOpen(false);
    setSelectedLead(null);
    toast.success(t('leadsLegacy.assignSuccess'));
  };

  const salesReps = users.filter((u) => u.role === 'مندوب');

  return (
    <div className="space-y-8 pb-12" dir={dir}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">{isSalesRep ? t('leadsLegacy.myLeads') : t('leadsLegacy.allLeads')}</h2>
          <p className="text-zinc-400">{t('leads.subtitleDefault')}</p>
        </div>
        <Dialog.Root open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
          <Dialog.Trigger asChild>
            <button className="flex items-center justify-center gap-2 bg-[#6366F1] text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20">
              <Plus className="h-5 w-5" />
              <span>{t('leadsLegacy.addLead')}</span>
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200" />
            <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-[#18181B] border border-zinc-800 rounded-2xl shadow-2xl p-6 z-50 animate-in zoom-in-95 duration-200 focus:outline-none">
              <div className="flex items-center justify-between mb-6">
                <Dialog.Title className="text-xl font-bold text-white">{t('leadsLegacy.addLead')}</Dialog.Title>
                <Dialog.Description className="sr-only">{t('leadsLegacy.addLeadDesc')}</Dialog.Description>
                <Dialog.Close className="text-zinc-500 hover:text-white transition-colors">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>
              <form onSubmit={handleAddLead} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.fullName')}</label>
                    <input name="name" required className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.company')}</label>
                    <input name="company" required className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.phone')}</label>
                    <input name="phone" required className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.email')}</label>
                    <input name="email" type="email" required className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.source')}</label>
                    <select name="source" className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all">
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="google">Google</option>
                      <option value="يدوي">{t('leadsLegacy.sourceManual')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400">{t('leadsLegacy.expectedBudget', { currency })}</label>
                    <input name="value" type="number" defaultValue="0" className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 px-4 text-sm text-white focus:ring-2 focus:ring-[#6366F1]/50 outline-none transition-all" />
                  </div>
                </div>
                <div className="pt-4">
                  <button type="submit" className="w-full bg-[#6366F1] text-white py-2.5 rounded-xl font-bold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20">
                    {t('leadsLegacy.saveData')}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <LeadStatCard title={t('leadsLegacy.totalLeads')} value={leads.length.toString()} trend="+3" icon={Target} color="text-blue-500" />
        <LeadStatCard
          title={t('leadsLegacy.newLeads')}
          value={leads.filter((l) => l.status === 'جديد').length.toString()}
          trend="-2"
          icon={Clock}
          color="text-yellow-500"
        />
        <LeadStatCard
          title={t('leadsLegacy.wonClosed')}
          value={leads.filter((l) => l.status === 'مغلق - فوز').length.toString()}
          trend="+1"
          icon={CheckCircle2}
          color="text-[#10B981]"
        />
        <LeadStatCard
          title={t('leadsLegacy.totalBudgets')}
          value={leads.reduce((acc, curr) => acc + (Number(curr.budget) || 0), 0).toLocaleString()}
          trend="+2%"
          icon={TrendingUp}
          color="text-purple-500"
        />
      </div>

      <div className="bg-[#18181B] border border-zinc-800 rounded-2xl shadow-xl overflow-hidden p-6">
        <div className="flex flex-col gap-3 mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder={t('leadsLegacy.searchPlaceholder')}
              className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 pr-10 pl-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border whitespace-nowrap ${
                  activeFilter === filter ? 'bg-[#6366F1] text-white border-[#6366F1]' : 'bg-[#09090B] text-zinc-500 border-zinc-800 hover:text-white'
                }`}
              >
                {filter === 'all' ? t('common.all') : getStatusLabel(filter, t)}
              </button>
            ))}
          </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setSourceFilter(filter.id)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border whitespace-nowrap ${
                  sourceFilter === filter.id ? 'bg-[#1877F2] text-white border-[#1877F2]' : 'bg-[#09090B] text-zinc-500 border-zinc-800 hover:text-white'
                }`}
              >
                {filter.labelKey.startsWith('leadsLegacy.') ? t(filter.labelKey) : filter.labelKey}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-zinc-900/50 text-zinc-500 text-xs font-bold uppercase border-b border-zinc-800">
                <th className="px-6 py-4">{t('leadsLegacy.colClient')}</th>
                <th className="px-6 py-4">{t('leadsLegacy.colSource')}</th>
                <th className="px-6 py-4">{t('leadsLegacy.colStatus')}</th>
                <th className="px-6 py-4">{t('leadsLegacy.colBudget')}</th>
                {!isSalesRep && <th className="px-6 py-4">{t('leadsLegacy.colAssignee')}</th>}
                <th className="px-6 py-4">{t('leadsLegacy.colDate')}</th>
                <th className="px-6 py-4 text-left">{t('leadsLegacy.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {displayLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-zinc-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-zinc-800 flex items-center justify-center text-sm font-bold text-white group-hover:bg-[#6366F1] transition-all">
                        {(lead.name && lead.name[0]) || '?'}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{lead.name}</p>
                        <p className="text-xs text-zinc-500">{lead.company}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 max-w-[14rem]">
                    <span
                      title={lead.source}
                      className="text-[10px] leading-snug bg-zinc-800 text-zinc-200 px-2 py-1 rounded-lg font-bold line-clamp-2 block whitespace-normal"
                    >
                      {leadSourceDisplayLabel(lead.source)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${getStatusStyle(lead.status)}`}>
                      {getStatusLabel(lead.status, t)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-zinc-300">{(Number(lead.budget) || 0).toLocaleString(dateLocale)} {currency}</td>
                  {!isSalesRep && (
                    <td className="px-6 py-4">
                      {lead.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-[#6366F1]/20 border border-[#6366F1]/30 flex items-center justify-center text-[10px] font-bold text-[#6366F1]">
                            {(users.find((t) => t.id === lead.assignedTo)?.name || '?')[0]}
                          </div>
                          <span className="text-xs text-zinc-400">{users.find((t) => t.id === lead.assignedTo)?.name || '—'}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedLead(lead);
                            setIsAssignModalOpen(true);
                          }}
                          className="flex items-center gap-1 text-[10px] font-bold text-[#6366F1] hover:underline"
                        >
                          <UserPlus className="h-3 w-3" />
                          {t('leadsLegacy.assignBtn')}
                        </button>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4 text-xs text-zinc-500">{new Date(lead.createdAt).toLocaleDateString(dateLocale)}</td>
                  <td className="px-6 py-4 text-left">
                    <div className="flex items-center gap-2">
                      <button onClick={() => toast.success(t('leadsLegacy.callingLead', { name: lead.name }))} className="p-2 text-zinc-500 hover:text-[#10B981] transition-all">
                        <Phone className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!(currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات')) {
                            toast.error(t('leadsLegacy.deleteForbidden'));
                            return;
                          }
                          if (!window.confirm(t('leadsLegacy.deleteConfirm', { name: lead.name }))) return;
                          const r: DeleteLeadResult = await deleteLead(lead.id);
                          if (r === 'deleted') toast.success(t('leadsLegacy.deleteSuccess'));
                          else if (r === 'blocked') toast.error(t('leadsLegacy.deleteBlocked'));
                          else if (r === 'forbidden') toast.error(t('leadsLegacy.deleteForbidden'));
                          else toast.error(t('leadsLegacy.deleteFailed'));
                        }}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-all"
                        title={t('leadsLegacy.deleteLead')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayLeads.length === 0 && (
            <div className="py-20 text-center">
              <div className="h-20 w-20 bg-zinc-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-10 w-10 text-zinc-600" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{t('leadsLegacy.noResults')}</h3>
              <p className="text-zinc-500 text-sm">{t('leadsLegacy.noResultsHint')}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-[#18181B] border border-zinc-800 rounded-2xl shadow-2xl p-6 z-50 animate-in zoom-in-95 duration-200 focus:outline-none">
            <div className="flex items-center justify-between mb-6">
              <Dialog.Title className="text-xl font-bold text-white">{t('leadsLegacy.assignDialogTitle')}</Dialog.Title>
              <Dialog.Description className="sr-only">{t('leadsLegacy.assignDialogDesc')}</Dialog.Description>
              <Dialog.Close className="text-zinc-500 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
            <div className="space-y-3">
              {salesReps.map((rep) => (
                <button
                  key={rep.id}
                  onClick={() => handleAssign(rep.id)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-[#09090B] border border-zinc-800 hover:border-[#6366F1] hover:bg-[#6366F1]/5 transition-all group text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-white group-hover:bg-[#6366F1]">
                      {rep.name[0]}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{rep.name}</p>
                      <p className="text-[10px] text-zinc-500">{t('leadsLegacy.salesRepRole')}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-[#6366F1]" />
                </button>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function LeadStatCard({ title, value, trend, icon: Icon, color }: any) {
  const isPositive = trend.startsWith('+');
  return (
    <div className="bg-[#18181B] border border-zinc-800 p-6 rounded-2xl shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className={`h-10 w-10 rounded-xl bg-zinc-800 flex items-center justify-center ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
            isPositive ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-red-500/10 text-red-500'
          }`}
        >
          {trend}
        </span>
      </div>
      <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
      <h4 className="text-2xl font-bold text-white">{value}</h4>
    </div>
  );
}
