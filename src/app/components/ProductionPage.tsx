import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Camera,
  Play,
  MoreVertical,
  Plus,
  Filter,
  Trash2,
} from 'lucide-react';
import { motion as Motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useData } from '../context/DataContext';
import { useAppDirection } from '../hooks/useAppDirection';

type ProdFilter = 'الكل' | 'جاري' | 'مجدول' | 'مكتمل' | 'معلق';

type ProdCard = {
  id: string;
  title: string;
  client: string;
  statusKey: ProdFilter;
  date: string;
  time: string;
  location: string;
  team: string;
  type: string;
};

function statusToFilter(status: string | undefined): ProdFilter {
  const s = status || '';
  if (s === 'مكتمل' || s === 'تم التسليم') return 'مكتمل';
  if (s === 'مرفوض') return 'معلق';
  if (s === 'معتمد') return 'مجدول';
  if (s === 'قيد المراجعة') return 'جاري';
  return 'جاري';
}

function formatLocaleDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

const NAV_INTENT_KEY = 'prod_system_nav_intent';

export default function ProductionPage() {
  const { t } = useTranslation();
  const { dateLocale, dir } = useAppDirection();
  const { currentUser, shootBookings, equipmentBookings, meetingBookings, removeShootBooking, removeEquipmentBooking, removeMeetingBooking } = useData();
  const [filter, setFilter] = useState<ProdFilter>('الكل');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  const scopedShoot = useMemo(() => {
    if (currentUser?.role !== 'مدير إنتاج') return shootBookings;
    const uid = String(currentUser.id).trim();
    return shootBookings.filter(
      (b) =>
        String(b.productionAssignedId || '').trim() === uid ||
        b.repId === uid,
    );
  }, [shootBookings, currentUser?.id, currentUser?.role]);

  const goBookingsTab = () => {
    localStorage.setItem(NAV_INTENT_KEY, JSON.stringify({ tab: 'bookings' }));
    window.dispatchEvent(new CustomEvent('prod-system-nav-intent'));
    toast.info(t('productionPage.goBookingsToast'));
  };

  const cards = useMemo<ProdCard[]>(() => {
    const out: ProdCard[] = [];
    for (const b of scopedShoot) {
      out.push({
        id: `sh-${b.id}`,
        title: t('productionPage.shootTitle', { name: b.customerName }),
        client: b.customerName,
        statusKey: statusToFilter(b.status),
        date: formatLocaleDate(b.date, dateLocale),
        time: b.time,
        location: b.location,
        team: b.repName,
        type: t('productionPage.typeShoot'),
      });
    }
    for (const b of equipmentBookings) {
      out.push({
        id: `eq-${b.id}`,
        title: `${b.equipmentName} ×${b.quantity}`,
        client: b.customerName,
        statusKey: statusToFilter(b.status),
        date: `${formatLocaleDate(b.fromDate, dateLocale)} – ${formatLocaleDate(b.toDate, dateLocale)}`,
        time: '—',
        location: b.notes || '—',
        team: b.repName,
        type: t('productionPage.typeEquipment'),
      });
    }
    for (const b of meetingBookings) {
      out.push({
        id: `mt-${b.id}`,
        title: b.title,
        client: b.leadId ? t('productionPage.leadPrefix', { id: b.leadId.slice(0, 6) }) : '—',
        statusKey: statusToFilter(b.status),
        date: formatLocaleDate(b.date, dateLocale),
        time: b.startTime,
        location: b.location || (b.venueType === 'داخل_المقر' ? t('productionPage.venueInternal') : t('productionPage.venueExternal')),
        team: b.repName,
        type: t('productionPage.typeMeeting'),
      });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }, [scopedShoot, equipmentBookings, meetingBookings, dateLocale, t]);

  const filterLabels: Record<ProdFilter, string> = {
    'الكل': t('productionPage.filterAll'),
    'جاري': t('productionPage.filterActive'),
    'مجدول': t('productionPage.filterScheduled'),
    'مكتمل': t('productionPage.filterDone'),
    'معلق': t('productionPage.filterPending'),
  };

  const visible = useMemo(() => {
    if (filter === 'الكل') return cards;
    return cards.filter((c) => c.statusKey === filter);
  }, [cards, filter]);

  const visualStatus = (c: ProdCard): 'in_progress' | 'completed' | 'scheduled' => {
    if (c.statusKey === 'مكتمل') return 'completed';
    if (c.statusKey === 'معلق') return 'scheduled';
    return 'in_progress';
  };

  return (
    <div className="space-y-8 pb-12" dir={dir}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">{t('productionPage.title')}</h2>
          <p className="text-zinc-400">{t('screens.bookings.subtitleDefault')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="p-2.5 bg-[#18181B] border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
            <Calendar className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goBookingsTab}
            className="flex items-center justify-center gap-2 bg-[#6366F1] text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20"
          >
            <Plus className="h-5 w-5" />
            <span>{t('productionPage.newSession')}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto pb-2">
        {(['الكل', 'جاري', 'مجدول', 'مكتمل', 'معلق'] as ProdFilter[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all border ${
              filter === status ? 'bg-[#6366F1] text-white border-[#6366F1]' : 'bg-[#18181B] text-zinc-400 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            {filterLabels[status]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-[#18181B] border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 text-sm">{t('productionPage.noFilterMatches')}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {visible.map((prod) => {
            const vs = visualStatus(prod);
            return (
              <Motion.div
                key={prod.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#18181B] border border-zinc-800 rounded-2xl p-6 shadow-xl hover:border-zinc-700 transition-all group"
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="flex gap-4">
                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center shadow-lg ${
                        vs === 'in_progress' ? 'bg-[#10B981]/10 text-[#10B981]' : vs === 'completed' ? 'bg-zinc-800 text-zinc-500' : 'bg-[#6366F1]/10 text-[#6366F1]'
                      }`}
                    >
                      {vs === 'in_progress' ? <Play className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">{prod.title}</h3>
                      <p className="text-xs text-zinc-500 font-medium">{prod.client}</p>
                    </div>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                      vs === 'in_progress' ? 'bg-[#10B981]/10 text-[#10B981] animate-pulse' : vs === 'completed' ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-800 text-[#6366F1]'
                    }`}
                  >
                    {filterLabels[prod.statusKey]}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#09090B] border border-zinc-800/50">
                    <Calendar className="h-4 w-4 text-zinc-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{t('productionPage.colDate')}</p>
                      <p className="text-sm text-white font-bold">{prod.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#09090B] border border-zinc-800/50">
                    <Clock className="h-4 w-4 text-zinc-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{t('productionPage.colTime')}</p>
                      <p className="text-sm text-white font-bold">{prod.time}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#09090B] border border-zinc-800/50">
                    <MapPin className="h-4 w-4 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{t('productionPage.colLocation')}</p>
                      <p className="text-sm text-white font-bold truncate">{prod.location}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#09090B] border border-zinc-800/50">
                    <Users className="h-4 w-4 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{t('productionPage.colOwner')}</p>
                      <p className="text-sm text-white font-bold truncate">{prod.team}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                  <span className="text-[11px] font-bold text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-lg">{prod.type}</span>
                  <div className="flex gap-2 relative" ref={openMenuId === prod.id ? menuRef : null}>
                    <button type="button" className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all">
                      <Filter className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === prod.id ? null : prod.id); }}
                      className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {openMenuId === prod.id && (
                      <div className="absolute left-0 bottom-full mb-1 z-50 bg-[#18181B] border border-zinc-700 rounded-xl shadow-2xl min-w-[130px] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            void (async () => {
                              const rawId = prod.id.replace(/^(sh|eq|mt)-/, '');
                              let ok = false;
                              if (prod.id.startsWith('sh-')) ok = await removeShootBooking(rawId);
                              else if (prod.id.startsWith('eq-')) ok = await removeEquipmentBooking(rawId);
                              else if (prod.id.startsWith('mt-')) ok = await removeMeetingBooking(rawId);
                              if (ok) toast.success(t('productionPage.deleteSuccess'));
                              else toast.error(t('productionPage.deleteFailed'));
                            })();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t('productionPage.deleteRequest')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
