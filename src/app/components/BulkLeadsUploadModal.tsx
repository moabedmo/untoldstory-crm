import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { useData } from '../context/DataContext';
import { importLeadsCsvApi } from '@/lib/api/leadsApi';
import { isServerDataMode } from '@/config/dataSource';
import {
  parseSpreadsheetFile,
  spreadsheetRowsToBulkLeads,
  type SpreadsheetLeadRow,
} from '@/lib/spreadsheetLeadsImport';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
};

export function BulkLeadsUploadModal({ isOpen, onClose, onImported }: Props) {
  const { bulkAddLeads, currentUser, refreshServerWorkspace } = useData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<SpreadsheetLeadRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<{
    created: number;
    skippedDuplicates: number;
    failed: number;
  } | null>(null);

  const canImport =
    currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';

  const resetState = () => {
    setFileName('');
    setParsedRows([]);
    setParseErrors([]);
    setLastResult(null);
  };

  const handleClose = () => {
    if (uploading) return;
    resetState();
    onClose();
  };

  const handleFile = async (file: File | null) => {
    setLastResult(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      toast.error('الصيغ المدعومة: Excel (.xlsx, .xls) أو CSV');
      return;
    }
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file);
      setParsedRows(parsed.rows);
      setParseErrors(parsed.errors.slice(0, 10));
      if (parsed.rows.length === 0) {
        toast.error(parsed.errors[0] || 'لم يُعثر على صفوف صالحة في الملف');
      } else {
        toast.success(`تم قراءة ${parsed.rows.length} ليد من الملف`);
      }
    } catch {
      toast.error('تعذر قراءة الملف');
      setParsedRows([]);
    }
  };

  const runImport = async () => {
    if (!canImport) {
      toast.error('صلاحية الاستيراد للمالك أو مدير المبيعات فقط');
      return;
    }
    if (parsedRows.length === 0) {
      toast.error('اختر ملف Excel أو CSV صالح أولاً');
      return;
    }

    setUploading(true);
    try {
      if (isServerDataMode()) {
        const batchSize = 100;
        let totalCreated = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (let i = 0; i < parsedRows.length; i += batchSize) {
          const chunk = parsedRows.slice(i, i + batchSize).map((r) => ({
            name: r.name,
            company: r.company,
            phone: r.phone,
            email: r.email,
            status: r.status,
            budget: r.budget,
            companySize: r.companySize,
            category: r.category,
            linkedinRowIndex: r.fileRowIndex,
          }));
          const res = await importLeadsCsvApi({ source: 'excel', leads: chunk });
          totalCreated += res.created;
          totalSkipped += res.skippedDuplicates;
          totalFailed += res.failed;
        }

        setLastResult({
          created: totalCreated,
          skippedDuplicates: totalSkipped,
          failed: totalFailed,
        });

        if (totalCreated > 0) {
          toast.success(
            `تم استيراد ${totalCreated} ليد${totalSkipped ? ` — تخطي ${totalSkipped} مكرر` : ''}`,
          );
          try {
            await refreshServerWorkspace();
          } catch {
            /* ignore */
          }
          onImported?.();
        } else {
          toast.warning(
            totalSkipped > 0
              ? 'لم يُضف ليد جديد — الصفوف مكررة أو غير صالحة'
              : 'لم يُستورد أي ليد',
          );
        }
      } else {
        const bulk = spreadsheetRowsToBulkLeads(parsedRows);
        const { created, failed } = await bulkAddLeads(bulk);
        setLastResult({ created, skippedDuplicates: 0, failed });
        if (created > 0) {
          toast.success(`تم إضافة ${created} ليد وتوزيعها تلقائياً${failed ? ` (${failed} صف لم يُضف)` : ''}`);
          onImported?.();
        } else {
          toast.error('لم تُضف ليدز — تحقق من التكرار أو سياسة جودة البيانات');
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'فشل الاستيراد');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black">رفع ليدز من Excel / CSV</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="p-2 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {!canImport && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 mb-4">
            صلاحية الاستيراد متاحة للمالك ومدير المبيعات فقط.
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          disabled={!canImport || uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-slate-700 rounded-3xl p-10 text-center hover:border-emerald-500/50 transition-colors disabled:opacity-50"
        >
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileUp className="w-10 h-10 text-emerald-500" />
          </div>
          <p className="text-lg font-bold mb-2">اضغط لاختيار ملف Excel أو CSV</p>
          <p className="text-sm text-slate-500 uppercase tracking-widest font-black">
            {fileName || 'حتى 10MB — .xlsx .xls .csv'}
          </p>
          {parsedRows.length > 0 && (
            <p className="mt-4 text-emerald-400 text-sm font-bold">
              جاهز للاستيراد: {parsedRows.length} صف
            </p>
          )}
          {uploading && (
            <p className="mt-4 text-emerald-500 font-bold text-sm animate-pulse">
              جاري الاستيراد وتوزيع الليدز...
            </p>
          )}
        </button>

        <div className="mt-6 bg-blue-500/10 border border-blue-500/20 p-5 rounded-2xl flex items-start gap-3 text-blue-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-bold leading-relaxed">
            الأعمدة المدعومة: الاسم، الشركة، الموبايل/الجوال، البريد (اختياري إذا وُجد الجوال)، الميزانية،
            التصنيف، حجم الشركة — بالعربي أو الإنجليزي. الصف الأول = عناوين الأعمدة.
          </p>
        </div>

        {parseErrors.length > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-100 space-y-1 max-h-32 overflow-y-auto">
            {parseErrors.map((err) => (
              <p key={err}>{err}</p>
            ))}
          </div>
        )}

        {lastResult && (
          <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-1">
            <p className="font-black text-emerald-300 flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              نتيجة الاستيراد
            </p>
            <p className="text-sm">تم الإضافة: {lastResult.created}</p>
            {lastResult.skippedDuplicates > 0 && (
              <p className="text-sm">مكرر (تخطي): {lastResult.skippedDuplicates}</p>
            )}
            {lastResult.failed > 0 && <p className="text-sm">فشل/تخطي: {lastResult.failed}</p>}
          </div>
        )}

        <button
          type="button"
          disabled={!canImport || uploading || parsedRows.length === 0}
          onClick={() => void runImport()}
          className="mt-6 w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black disabled:opacity-50"
        >
          {uploading ? 'جاري الاستيراد...' : `استيراد ${parsedRows.length || ''} ليد`}
        </button>
      </div>
    </div>
  );
}
