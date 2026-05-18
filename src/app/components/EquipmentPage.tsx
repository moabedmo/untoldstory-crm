import {
  Camera,
  Video,
  Mic2,
  Lightbulb,
  Laptop,
  Monitor,
  Search,
  Plus,
  History,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { motion as Motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAppDirection } from '../hooks/useAppDirection';
import { useData } from '../context/DataContext';

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const DEFAULT_CATEGORIES = ['كاميرات', 'مثبتات', 'إضاءة', 'صوت', 'مونتاج', 'عام'];

export default function EquipmentPage() {
  const { t } = useTranslation();
  const { dateLocale } = useAppDirection();
  const { equipmentItems, addEquipmentItem, removeEquipmentItem, currentUser } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', category: 'كاميرات', quantity: '1' });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const canManageEquipment =
    currentUser?.role === 'مالك' || currentUser?.role === 'محاسب' || currentUser?.role === 'مدير إنتاج';

  const handleAddEquipment = () => {
    if (!canManageEquipment) {
      toast.error(t('equipmentPage.addForbidden'));
      return;
    }
    const name = addForm.name.trim();
    const category = addForm.category.trim();
    const totalQuantity = Math.max(1, Math.floor(Number(addForm.quantity) || 1));
    const ok = addEquipmentItem({ name, category, totalQuantity });
    if (!ok) {
      toast.error(t('equipmentPage.duplicateError'));
      return;
    }
    toast.success(t('equipmentPage.addSuccess'));
    setAddForm({ name: '', category: 'كاميرات', quantity: '1' });
    setAddOpen(false);
  };

  const handleDeleteEquipment = (id: string, name: string) => {
    if (!canManageEquipment) {
      toast.error(t('equipmentPage.deleteForbidden'));
      return;
    }
    if (!window.confirm(`حذف «${name}» نهائياً من قائمة المعدات؟`)) return;
    removeEquipmentItem(id);
  };

  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenuId]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return equipmentItems;
    return equipmentItems.filter((it) => it.name.toLowerCase().includes(q) || it.category.toLowerCase().includes(q));
  }, [equipmentItems, searchTerm]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of equipmentItems) {
      const c = it.category?.trim() || 'عام';
      map.set(c, (map.get(c) || 0) + (it.totalQuantity || 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [equipmentItems]);

  const iconFor = (label: string) => {
    if (/كامير|Camera/i.test(label)) return Camera;
    if (/ثبت|Ronin|Crane|Video/i.test(label)) return Video;
    if (/صوت|Mic|Zoom/i.test(label)) return Mic2;
    if (/ضوء|Light|Godox|Aputure/i.test(label)) return Lightbulb;
    if (/مونتاج|Mac|Laptop|Studio/i.test(label)) return Laptop;
    return Monitor;
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">{t('equipmentPage.pageTitle')}</h2>
          <p className="text-zinc-400">
            {t('equipmentPage.pageSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="p-2.5 bg-[#18181B] border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
            <History className="h-5 w-5" />
          </button>
          {canManageEquipment ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center justify-center gap-2 bg-[#6366F1] text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20"
            >
              <Plus className="h-5 w-5" />
              <span>{t('equipmentPage.addButton')}</span>
            </button>
          ) : (
            <span className="text-xs text-zinc-500 px-2">{t('equipmentPage.addRoleHint')}</span>
          )}
        </div>
      </div>

      {addOpen && canManageEquipment ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-equipment-title"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-[#18181B] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-equipment-title" className="text-lg font-bold text-white mb-1">
              {t('equipmentPage.addTitle')}
            </h3>
            <p className="text-xs text-zinc-400 mb-5">{t('equipmentPage.addModalHint')}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 mb-1">{t('equipmentPage.nameLabel')}</label>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t('equipmentPage.namePlaceholder')}
                  className="w-full bg-[#09090B] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 mb-1">{t('equipmentPage.categoryLabel')}</label>
                <input
                  list="equipment-categories"
                  value={addForm.category}
                  onChange={(e) => setAddForm((p) => ({ ...p, category: e.target.value }))}
                  placeholder={t('equipmentPage.categoryPlaceholder')}
                  className="w-full bg-[#09090B] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
                />
                <datalist id="equipment-categories">
                  {DEFAULT_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 mb-1">{t('equipmentPage.quantityLabel')}</label>
                <input
                  type="number"
                  min={1}
                  value={addForm.quantity}
                  onChange={(e) => setAddForm((p) => ({ ...p, quantity: e.target.value }))}
                  className="w-full bg-[#09090B] border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={handleAddEquipment}
                className="flex-1 rounded-xl bg-[#6366F1] py-2.5 text-sm font-bold text-white hover:bg-[#5254E2]"
              >
                {t('equipmentPage.saveEquipment')}
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {categoryStats.length === 0 ? (
          <div className="col-span-full text-center text-zinc-500 text-sm py-6 bg-[#18181B] border border-zinc-800 rounded-xl">{t('equipmentPage.noCategories')}</div>
        ) : (
          categoryStats.map(([label, count], i) => {
            const Icon = iconFor(label);
            return <CategoryCard key={label} icon={Icon} label={label} count={count} color={COLORS[i % COLORS.length]} />;
          })
        )}
      </div>

      <div className="bg-[#18181B] border border-zinc-800 rounded-2xl shadow-xl overflow-hidden p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder={t('equipmentPage.searchPlaceholder')}
              className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 pr-10 pl-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((item) => {
            const statusLabel = item.active ? t('equipmentPage.available') : t('equipmentPage.inactive');
            const statusClass = item.active ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700';
            return (
              <Motion.div key={item.id} layout className="group bg-[#09090B] border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-all">
                <div className="aspect-video relative overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                  <Camera className="h-14 w-14 text-zinc-600" />
                  <div className="absolute top-4 right-4">
                    <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${statusClass}`}>{statusLabel}</div>
                  </div>
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">{item.category}</p>
                      <h3 className="text-base font-bold text-white mb-1">{item.name}</h3>
                      <p className="text-xs text-zinc-500 font-medium">{t('equipmentPage.quantityLabel')}: {item.totalQuantity}</p>
                    </div>
                    {canManageEquipment ? (
                      <div className="relative shrink-0" ref={openMenuId === item.id ? menuRef : null}>
                        <button
                          type="button"
                          aria-expanded={openMenuId === item.id}
                          aria-haspopup="menu"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId((id) => (id === item.id ? null : item.id));
                          }}
                          className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800/80 rounded-lg transition-all"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openMenuId === item.id ? (
                          <div
                            role="menu"
                            className="absolute end-0 top-full z-50 mt-1 min-w-[168px] rounded-xl border border-zinc-700 bg-[#0c0c0e] py-1 shadow-xl shadow-black/50"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-rose-300 hover:bg-rose-500/10 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                if (!window.confirm(t('equipmentPage.deleteConfirm', { name: item.name }))) return;
                                removeEquipmentItem(item.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 shrink-0 opacity-90" />
                              {t('equipmentPage.deleteEquipment')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${item.active ? 'bg-[#10B981]' : 'bg-zinc-600'}`} />
                      <span className="text-xs text-zinc-400 font-medium">{item.active ? t('equipmentPage.activeInSystem') : t('equipmentPage.disabled')}</span>
                    </div>
                    <span className="text-[11px] font-bold text-zinc-600">{t('equipmentPage.addedOn', { date: formatDate(item.createdAt, dateLocale) })}</span>
                  </div>
                </div>
              </Motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

function CategoryCard({ icon: Icon, label, count, color }: { icon: typeof Camera; label: string; count: number; color: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-[#18181B] border border-zinc-800 p-4 rounded-xl flex flex-col items-center justify-center gap-3 group hover:border-[#6366F1]/50 transition-all cursor-default">
      <div
        className="h-10 w-10 rounded-lg flex items-center justify-center text-white transition-all"
        style={{ backgroundColor: `${color}33` }}
      >
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <div className="text-center">
        <p className="text-xs font-bold text-white mb-0.5">{label}</p>
        <p className="text-[10px] text-zinc-500 font-medium">{t('equipmentPage.unitsCount', { count })}</p>
      </div>
    </div>
  );
}
