import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useData, type Lead } from '../context/DataContext';
import { REP_INTERACTION_PLAYBOOKS, REP_LEAD_UPDATE_ACTIONS } from '../../lib/repInteractionPlaybooks';

type ChannelType = 'call' | 'chat' | 'other';
type EvidenceType = 'recording' | 'chat_export' | 'link' | 'note_only';

type ModalState = {
  isOpen: boolean;
  lead: Lead | null;
  action: string;
  note: string;
  channelType: ChannelType;
  evidenceType: EvidenceType;
  evidenceRef: string;
  durationSeconds: string;
  toastType: 'success' | 'info';
};

const emptyModal = (): ModalState => ({
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

export function useLeadRepUpdate() {
  const { logLeadInteraction, currentUser } = useData();
  const [modal, setModal] = useState<ModalState>(emptyModal);

  const canUpdateLead = useCallback(
    (lead: Lead) =>
      !!currentUser &&
      (currentUser.role === 'مالك' ||
        currentUser.role === 'مدير مبيعات' ||
        (currentUser.role === 'مندوب' && lead.assignedTo === currentUser.id)),
    [currentUser],
  );

  const openInteraction = useCallback(
    (lead: Lead, action: string, defaultNote = '', toastType: 'success' | 'info' = 'success') => {
      if (!canUpdateLead(lead)) {
        toast.error('لا يمكنك تسجيل تحديث على ليد غير مسند إليك.');
        return;
      }
      const inferredChannel: ChannelType = /(مكالمة|اتصال)/.test(action)
        ? 'call'
        : /(واتساب|شات)/.test(action)
          ? 'chat'
          : 'other';
      setModal({
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
    },
    [canUpdateLead],
  );

  const openLeadUpdate = useCallback(
    (lead: Lead) => {
      openInteraction(lead, 'تحديث — اتصال بالعميل', '', 'success');
    },
    [openInteraction],
  );

  const applyPlaybookTemplate = (templateId: string) => {
    if (!templateId) return;
    const templates = REP_INTERACTION_PLAYBOOKS[modal.channelType] || [];
    const picked = templates.find((t) => t.id === templateId);
    if (!picked) return;
    setModal((prev) => ({ ...prev, note: picked.text }));
  };

  const submit = () => {
    if (!modal.lead) return;
    const note = modal.note.trim();
    if (!note) {
      toast.error('اكتب ملخص التواصل أو التحديث قبل الحفظ.');
      return;
    }
    logLeadInteraction(modal.lead.id, modal.action, note, {
      channelType: modal.channelType,
      evidenceType: modal.evidenceType,
      evidenceRef: modal.evidenceRef.trim() || undefined,
      durationSeconds: modal.durationSeconds ? Number(modal.durationSeconds) || undefined : undefined,
    });
    if (modal.toastType === 'info') {
      toast.info(`تم حفظ التحديث: ${modal.lead.name}`);
    } else {
      toast.success(`تم حفظ التحديث: ${modal.lead.name}`);
    }
    setModal(emptyModal());
  };

  const LeadRepUpdateModal = () => {
    if (!modal.isOpen || !modal.lead) return null;
    return createPortal(
      <div
        className="fixed inset-0 z-[350] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
        dir="rtl"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-[#0B1020] shadow-2xl">
          <motion.div
            className="px-6 py-5 border-b border-white/10"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-xs text-zinc-400">سجل تحديث على الليد</p>
            <h3 className="text-lg font-black text-white mt-1">
              {modal.lead.name} — {modal.lead.company}
            </h3>
          </motion.div>
          <motion.div className="p-6 space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <label className="block text-sm font-bold text-zinc-200">نوع التحديث</label>
            <select
              value={modal.action}
              onChange={(e) => {
                const picked = REP_LEAD_UPDATE_ACTIONS.find((a) => a.value === e.target.value);
                setModal((prev) => ({
                  ...prev,
                  action: e.target.value,
                  channelType: picked?.channel ?? prev.channelType,
                }));
              }}
              className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-sm text-zinc-100"
            >
              {REP_LEAD_UPDATE_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.value}
                </option>
              ))}
              {![...REP_LEAD_UPDATE_ACTIONS.map((a) => a.value)].includes(modal.action) && modal.action ? (
                <option value={modal.action}>{modal.action}</option>
              ) : null}
            </select>

            <label className="block text-sm font-bold text-zinc-200">ملخص التواصل / التحديث</label>
            <select
              defaultValue=""
              onChange={(e) => {
                applyPlaybookTemplate(e.target.value);
                e.currentTarget.value = '';
              }}
              className="w-full bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs text-zinc-200"
            >
              <option value="">قالب جاهز (اختياري)</option>
              {(REP_INTERACTION_PLAYBOOKS[modal.channelType] || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <textarea
              value={modal.note}
              onChange={(e) => setModal((prev) => ({ ...prev, note: e.target.value }))}
              rows={5}
              autoFocus
              placeholder="ماذا حدث في هذه المكالمة أو المتابعة؟ ما طلبه العميل؟ وما الخطوة التالية؟"
              className="w-full bg-[#111A32] border border-white/15 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:border-[#7C6BFF] resize-y"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select
                value={modal.channelType}
                onChange={(e) =>
                  setModal((prev) => ({ ...prev, channelType: e.target.value as ChannelType }))
                }
                className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
              >
                <option value="call">مكالمة</option>
                <option value="chat">شات/واتساب</option>
                <option value="other">أخرى</option>
              </select>
              <select
                value={modal.evidenceType}
                onChange={(e) =>
                  setModal((prev) => ({ ...prev, evidenceType: e.target.value as EvidenceType }))
                }
                className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
              >
                <option value="note_only">بدون مرفق</option>
                <option value="recording">رابط تسجيل مكالمة</option>
                <option value="chat_export">رابط محادثة</option>
                <option value="link">رابط مرجعي</option>
              </select>
              <input
                value={modal.evidenceRef}
                onChange={(e) => setModal((prev) => ({ ...prev, evidenceRef: e.target.value }))}
                placeholder="رابط الدليل (اختياري)"
                className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs md:col-span-2"
              />
              <input
                type="number"
                min={0}
                value={modal.durationSeconds}
                onChange={(e) => setModal((prev) => ({ ...prev, durationSeconds: e.target.value }))}
                placeholder="مدة المكالمة بالثواني (اختياري)"
                className="bg-[#111A32] border border-white/15 rounded-xl px-3 py-2 text-xs"
              />
            </div>
          </motion.div>
          <motion.div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal(emptyModal())}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 border border-white/15 text-zinc-200"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={submit}
              className="px-4 py-2 rounded-xl text-sm font-black bg-[#7C6BFF] text-white"
            >
              حفظ في سجل الليد
            </button>
          </motion.div>
        </div>
      </div>,
      document.body,
    );
  };

  return { openInteraction, openLeadUpdate, canUpdateLead, LeadRepUpdateModal };
}
