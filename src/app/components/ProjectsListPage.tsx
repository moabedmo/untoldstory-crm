import { AlertCircle, Briefcase, Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  getProjectsDataAsync,
  addProject,
} from '@/lib/projects/projectStore';
import type { Project, ProjectStatus, ProjectsData } from '@/lib/projects/projectTypes';
import ProjectDetailPage from './ProjectDetailPage';

const STATUS_COLORS: Record<ProjectStatus, string> = {
  'مفتوحة': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'منتهية': 'bg-zinc-800 text-zinc-400 border-zinc-700',
  'تحت التحصيل': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

export default function ProjectsListPage() {
  const emptyData: ProjectsData = { projects: [], revenues: [], expenses: [], custodies: [] };
  const [data, setData] = useState<ProjectsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', code: '', clientName: '', startDate: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoadError(null);
    return getProjectsDataAsync()
      .then((d) => { setData(d); setLoadError(null); })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'تعذر تحميل الشغلانات';
        setLoadError(msg);
        toast.error(msg);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getProjectsDataAsync()
      .then((d) => { if (!cancelled) { setData(d); setLoadError(null); } })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'تعذر تحميل الشغلانات';
        setLoadError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const alerts = useMemo(() => {
    const items: { type: 'revenue' | 'custody'; message: string }[] = [];
    const now = new Date();
    for (const r of data.revenues) {
      if (r.status === 'مستحق' && new Date(r.date) < now) {
        const projName = data.projects.find((p) => p.code === r.projectCode)?.name || r.projectCode;
        items.push({ type: 'revenue', message: `إيراد متأخر: ${r.amount.toLocaleString('ar-EG')} ج.م — ${projName} (${r.date})` });
      }
    }
    for (const c of data.custodies) {
      if (c.status !== 'تم تسويتها') {
        const daysDiff = Math.floor((now.getTime() - new Date(c.openDate).getTime()) / 86400000);
        if (daysDiff > 30) {
          items.push({ type: 'custody', message: `عهدة مفتوحة منذ ${daysDiff} يوم: ${c.code} — ${c.holderName} (${c.amount.toLocaleString('ar-EG')} ج.م)` });
        }
      }
    }
    return items;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.projects;
    return data.projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q),
    );
  }, [data.projects, search]);

  const handleAdd = async () => {
    if (saving) return;
    if (!form.name.trim() || !form.code.trim() || !form.clientName.trim()) {
      toast.error('أدخل اسم الشغلانة والكود واسم العميل');
      return;
    }
    setSaving(true);
    try {
      const created = await addProject({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        clientName: form.clientName.trim(),
        startDate: form.startDate || new Date().toISOString().slice(0, 10),
        status: 'مفتوحة',
        notes: form.notes.trim(),
      });
      setData((prev) => ({
        ...prev,
        projects: [created, ...prev.projects.filter((p) => p.id !== created.id)],
      }));
      void refresh();
      setShowAdd(false);
      setForm({ name: '', code: '', clientName: '', startDate: '', notes: '' });
      toast.success('تم إنشاء الشغلانة بنجاح');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  const selectedProject = selectedProjectId ? data.projects.find((p) => p.id === selectedProjectId) : null;

  if (selectedProject) {
    return <ProjectDetailPage project={selectedProject} onBack={() => { setSelectedProjectId(null); refresh(); }} />;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">الشغلانات / المشاريع</h2>
          <p className="text-zinc-400">إدارة المشاريع والحركات المالية المرتبطة</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-[#6366F1] text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-[#5254E2] transition-all shadow-lg shadow-[#6366F1]/20"
        >
          <Plus className="h-5 w-5" />
          شغلانة جديدة
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 space-y-2">
          <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> تنبيهات ({alerts.length})</h3>
          {alerts.slice(0, 5).map((a, i) => (
            <p key={i} className="text-xs text-rose-300/80">• {a.message}</p>
          ))}
          {alerts.length > 5 && <p className="text-[10px] text-zinc-500">و {alerts.length - 5} تنبيهات أخرى...</p>}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['مفتوحة', 'تحت التحصيل', 'منتهية'] as ProjectStatus[]).map((s) => (
          <div key={s} className="bg-[#18181B] border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
            <span className="text-zinc-400 font-medium">{s}</span>
            <span className="bg-zinc-800 text-white px-2.5 py-0.5 rounded-lg text-sm font-bold">
              {data.projects.filter((p) => p.status === s).length}
            </span>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          placeholder="بحث بالاسم أو الكود أو العميل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#09090B] border border-zinc-800 rounded-xl py-2 pr-10 pl-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50"
        />
      </div>

      {loadError && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-200/90">{loadError}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); void refresh().finally(() => setLoading(false)); }}
            className="text-xs font-bold text-amber-300 hover:text-white px-3 py-1.5 rounded-lg border border-amber-500/30"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-[#18181B] border border-zinc-800 rounded-2xl p-12 text-center">
            <Briefcase className="h-12 w-12 text-zinc-700 mx-auto mb-3 animate-pulse" />
            <p className="text-zinc-500">جاري تحميل الشغلانات…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[#18181B] border border-zinc-800 rounded-2xl p-12 text-center">
            <Briefcase className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500">{data.projects.length === 0 ? 'لا توجد شغلانات بعد — اضغط «شغلانة جديدة» وأدخل الاسم والكود واسم العميل' : 'لا توجد نتائج'}</p>
          </div>
        ) : (
          filtered.map((p) => {
            const projRevenues = data.revenues.filter((r) => r.projectCode === p.code);
            const projExpenses = data.expenses.filter((e) => e.projectCode === p.code);
            const totalRev = projRevenues.filter((r) => r.status === 'محصل').reduce((s, r) => s + r.amount, 0);
            const totalExp = projExpenses.reduce((s, e) => s + e.amount, 0);
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className="w-full text-right bg-[#18181B] border border-zinc-800 rounded-2xl p-5 hover:border-[#6366F1]/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#6366F1]/10 flex items-center justify-center">
                      <Briefcase className="h-5 w-5 text-[#6366F1]" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-white group-hover:text-[#6366F1] transition-colors">{p.name}</p>
                      <p className="text-xs text-zinc-500">كود: {p.code} • عميل: {p.clientName}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                </div>
                <div className="flex items-center gap-6 text-xs text-zinc-500">
                  <span>إيرادات: <span className="text-emerald-400 font-bold">{totalRev.toLocaleString('ar-EG')}</span> ج.م</span>
                  <span>مصروفات: <span className="text-rose-400 font-bold">{totalExp.toLocaleString('ar-EG')}</span> ج.م</span>
                  <span>صافي: <span className={`font-bold ${totalRev - totalExp >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(totalRev - totalExp).toLocaleString('ar-EG')}</span> ج.م</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Add Modal */}
      {showAdd && createPortal(
        <div className="fixed inset-0 z-[400] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-[#18181B] text-white shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">شغلانة جديدة</h3>
              <button type="button" onClick={() => !saving && setShowAdd(false)} className="p-1 hover:bg-zinc-700 rounded-lg"><X className="h-5 w-5 text-zinc-400" /></button>
            </div>
            <p className="text-xs text-zinc-500 -mt-2">الحقول المطلوبة: اسم الشغلانة، الكود (فريد)، اسم العميل</p>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="اسم الشغلانة *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 w-full bg-[#09090B] border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50" />
              <input placeholder="كود الشغلانة * (مثال: HK001)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full bg-[#09090B] border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50" />
              <input placeholder="اسم العميل *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full bg-[#09090B] border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50" />
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full bg-[#09090B] border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50" />
              <input placeholder="ملاحظات (اختياري)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full bg-[#09090B] border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/50" />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={saving} onClick={() => setShowAdd(false)} className="px-4 py-2 text-zinc-400 font-bold text-sm disabled:opacity-50">إلغاء</button>
              <button type="button" disabled={saving} onClick={handleAdd} className="bg-[#6366F1] text-white px-5 py-2 rounded-xl font-bold text-sm hover:bg-[#5254E2] transition-all disabled:opacity-60">{saving ? 'جاري الإنشاء…' : 'إنشاء'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
