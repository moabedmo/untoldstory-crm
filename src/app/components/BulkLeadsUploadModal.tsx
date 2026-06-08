import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bell, CheckCircle2, FileUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useData } from '../context/DataContext';
import { useAppDirection } from '../hooks/useAppDirection';
import { importLeadsCsvApi } from '@/lib/api/leadsApi';
import { isServerDataMode } from '@/config/dataSource';
const SYSTEM_LOGO = '/brand/the-untold-story-logo.png';
import {
  parseSpreadsheetFile,
  spreadsheetRowsToBulkLeads,
  type SpreadsheetLeadRow,
} from '@/lib/spreadsheetLeadsImport';
import type { TFunction } from 'i18next';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
};

type ImportResult = {
  created: number;
  skippedDuplicates: number;
  failed: number;
};

type ImportProgress = {
  total: number;
  processed: number;
  created: number;
  skippedDuplicates: number;
  failed: number;
  batchIndex: number;
  batchCount: number;
};

function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function notifyImportFinished(result: ImportResult, t: TFunction, lang: 'ar' | 'en') {
  const { created, skippedDuplicates, failed } = result;
  let summary: string;
  if (created > 0) {
    summary = t('bulkUpload.toastSuccess', {
      created,
      skipped: skippedDuplicates
        ? t('bulkUpload.toastSkippedPart', { count: skippedDuplicates })
        : '',
      failed: failed ? t('bulkUpload.toastFailedPart', { count: failed }) : '',
    });
  } else if (skippedDuplicates > 0) {
    summary = t('bulkUpload.toastNoNewDup', { count: skippedDuplicates });
  } else if (failed > 0) {
    summary = t('bulkUpload.toastNoNewFail', { count: failed });
  } else {
    summary = t('bulkUpload.toastNoNew');
  }

  if (created > 0) {
    toast.success(summary, { duration: 12_000, id: 'bulk-leads-import-done' });
  } else {
    toast.warning(summary, { duration: 10_000, id: 'bulk-leads-import-done' });
  }

  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(
      created > 0 ? t('bulkUpload.notifyTitleOk') : t('bulkUpload.notifyTitleWarn'),
      {
        body: summary,
        tag: 'bulk-leads-import',
        lang,
        icon: typeof window !== 'undefined' ? `${window.location.origin}${SYSTEM_LOGO}` : undefined,
      },
    );
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

export function BulkLeadsUploadModal({ isOpen, onClose, onImported }: Props) {
  const { bulkAddLeads, currentUser, refreshServerWorkspace } = useData();
  const { t } = useTranslation();
  const { dir, dateLocale, lang } = useAppDirection();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<SpreadsheetLeadRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [importFinished, setImportFinished] = useState(false);

  const IMPORT_BATCH_SIZE = 100;

  const canImport =
    currentUser?.role === 'مالك' || currentUser?.role === 'مدير مبيعات';

  const resetState = () => {
    setFileName('');
    setParsedRows([]);
    setParseErrors([]);
    setLastResult(null);
    setImportFinished(false);
    setImportProgress(null);
  };

  const handleClose = () => {
    if (uploading) return;
    resetState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, uploading]);

  const handleFile = async (file: File | null) => {
    setLastResult(null);
    setImportFinished(false);
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      toast.error(t('bulkUpload.invalidFormat'));
      return;
    }
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheetFile(file);
      setParsedRows(parsed.rows);
      setParseErrors(parsed.errors.slice(0, 10));
      if (parsed.rows.length === 0) {
        toast.error(parsed.errors[0] || t('bulkUpload.noValidRows'));
      } else {
        toast.success(
          parsed.sheetsParsed && parsed.sheetsParsed > 1
            ? t('bulkUpload.readOkSheets', {
                count: parsed.rows.length,
                sheets: parsed.sheetsParsed,
              })
            : t('bulkUpload.readOk', { count: parsed.rows.length }),
        );
      }
    } catch {
      toast.error(t('bulkUpload.readFail'));
      setParsedRows([]);
    }
  };

  const runImport = async () => {
    if (!canImport) {
      toast.error(t('bulkUpload.importForbidden'));
      return;
    }
    if (parsedRows.length === 0) {
      toast.error(t('bulkUpload.pickValidFirst'));
      return;
    }

    if (browserNotificationsSupported() && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }

    const total = parsedRows.length;
    const batchCount = Math.max(1, Math.ceil(total / IMPORT_BATCH_SIZE));
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    setUploading(true);
    setImportFinished(false);
    setImportProgress({
      total,
      processed: 0,
      created: 0,
      skippedDuplicates: 0,
      failed: 0,
      batchIndex: 0,
      batchCount,
    });

    try {
      let result: ImportResult;

      if (isServerDataMode()) {
        for (let i = 0; i < total; i += IMPORT_BATCH_SIZE) {
          const batchIndex = Math.floor(i / IMPORT_BATCH_SIZE) + 1;
          const chunk = parsedRows.slice(i, i + IMPORT_BATCH_SIZE).map((r) => ({
            name: r.name,
            company: r.company,
            phone: r.phone,
            email: r.email,
            status: r.status,
            budget: r.budget,
            companySize: r.companySize,
            category: r.category,
            linkedinRowIndex: r.fileRowIndex,
            ...(r.leadDate ? { leadDate: r.leadDate } : {}),
          }));
          const res = await importLeadsCsvApi({ source: 'excel', leads: chunk });
          totalCreated += res.created;
          totalSkipped += res.skippedDuplicates;
          totalFailed += res.failed;
          const processed = Math.min(i + chunk.length, total);
          setImportProgress({
            total,
            processed,
            created: totalCreated,
            skippedDuplicates: totalSkipped,
            failed: totalFailed,
            batchIndex,
            batchCount,
          });
        }

        result = {
          created: totalCreated,
          skippedDuplicates: totalSkipped,
          failed: totalFailed,
        };

        if (totalCreated > 0) {
          try {
            await refreshServerWorkspace();
          } catch {
            /* ignore */
          }
          onImported?.();
        }
      } else {
        const bulk = spreadsheetRowsToBulkLeads(parsedRows);
        for (let i = 0; i < bulk.length; i += IMPORT_BATCH_SIZE) {
          const batchIndex = Math.floor(i / IMPORT_BATCH_SIZE) + 1;
          const chunk = bulk.slice(i, i + IMPORT_BATCH_SIZE);
          const { created, failed } = await bulkAddLeads(chunk);
          totalCreated += created;
          totalFailed += failed;
          const processed = Math.min(i + chunk.length, total);
          setImportProgress({
            total,
            processed,
            created: totalCreated,
            skippedDuplicates: 0,
            failed: totalFailed,
            batchIndex,
            batchCount,
          });
        }
        result = { created: totalCreated, skippedDuplicates: 0, failed: totalFailed };
        if (totalCreated > 0) {
          try {
            await refreshServerWorkspace();
          } catch {
            /* ignore */
          }
          onImported?.();
        }
      }

      setLastResult(result);
      setImportFinished(true);
      notifyImportFinished(result, t, lang);
      panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('bulkUpload.importFail'));
    } finally {
      setUploading(false);
      setImportProgress(null);
    }
  };

  const progressPercent =
    importProgress && importProgress.total > 0
      ? Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))
      : 0;
  const progressRemaining = importProgress ? Math.max(0, importProgress.total - importProgress.processed) : 0;

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[360] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md isolate"
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-leads-import-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg max-h-[min(92vh,720px)] overflow-y-auto custom-scrollbar rounded-[2rem] border border-emerald-500/25 bg-[#0E1426] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0E1426]/95 backdrop-blur-md px-6 py-4 rounded-t-[2rem]">
          <h2 id="bulk-leads-import-title" className="text-xl font-black text-white">
            {t('bulkUpload.title')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {uploading && importProgress && (
            <div
              className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-3"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-emerald-200">{t('bulkUpload.uploading')}</p>
                <p className="text-lg font-black text-white tabular-nums">{progressPercent}%</p>
              </div>
              <div className="h-3 rounded-full bg-black/40 overflow-hidden border border-white/10">
                <div
                  className="h-full bg-gradient-to-l from-emerald-400 to-emerald-600 transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <p className="text-zinc-300">
                  <span className="text-zinc-500 block mb-0.5">{t('bulkUpload.processed')}</span>
                  <span className="font-black text-white tabular-nums">
                    {importProgress.processed.toLocaleString(dateLocale)} /{' '}
                    {importProgress.total.toLocaleString(dateLocale)}
                  </span>
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500 block mb-0.5">{t('bulkUpload.remaining')}</span>
                  <span className="font-black text-amber-200 tabular-nums">
                    {progressRemaining.toLocaleString(dateLocale)}
                  </span>
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500 block mb-0.5">{t('bulkUpload.addedSoFar')}</span>
                  <span className="font-black text-emerald-300 tabular-nums">
                    {importProgress.created.toLocaleString(dateLocale)}
                  </span>
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500 block mb-0.5">{t('bulkUpload.batch')}</span>
                  <span className="font-black text-white tabular-nums">
                    {importProgress.batchIndex} / {importProgress.batchCount}
                  </span>
                </p>
              </div>
              {(importProgress.skippedDuplicates > 0 || importProgress.failed > 0) && (
                <p className="text-[11px] text-zinc-400">
                  {t('bulkUpload.progressSkippedFailed', {
                    skipped: importProgress.skippedDuplicates.toLocaleString(dateLocale),
                    failed: importProgress.failed.toLocaleString(dateLocale),
                  })}
                </p>
              )}
            </div>
          )}

          {importFinished && lastResult && (
            <div
              className={`rounded-2xl border p-4 space-y-2 ${
                lastResult.created > 0
                  ? 'border-emerald-400/40 bg-emerald-500/15'
                  : 'border-amber-400/40 bg-amber-500/15'
              }`}
              role="alert"
            >
              <p
                className={`font-black flex items-center gap-2 text-sm ${
                  lastResult.created > 0 ? 'text-emerald-200' : 'text-amber-200'
                }`}
              >
                {lastResult.created > 0 ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                ) : (
                  <Bell className="w-5 h-5 shrink-0" />
                )}
                {lastResult.created > 0 ? t('bulkUpload.doneSuccess') : t('bulkUpload.doneWarning')}
              </p>
              <p className="text-sm text-zinc-100">{t('bulkUpload.added', { count: lastResult.created })}</p>
              {lastResult.skippedDuplicates > 0 && (
                <p className="text-sm text-zinc-300">{t('bulkUpload.skippedDup', { count: lastResult.skippedDuplicates })}</p>
              )}
              {lastResult.failed > 0 && (
                <p className="text-sm text-zinc-300">{t('bulkUpload.failed', { count: lastResult.failed })}</p>
              )}
              <p className="text-[11px] text-zinc-400 pt-1">
                {t('bulkUpload.alertHint', {
                  osNotify:
                    browserNotificationsSupported() && Notification.permission === 'granted'
                      ? t('bulkUpload.osNotify')
                      : '',
                })}
              </p>
            </div>
          )}

          {!canImport && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              {t('bulkUpload.forbidden')}
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
            className="w-full border-2 border-dashed border-white/15 rounded-2xl p-8 text-center hover:border-emerald-500/50 transition-colors disabled:opacity-50"
          >
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileUp className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-base font-bold text-white mb-1">{t('bulkUpload.pickFile')}</p>
            <p className="text-xs text-zinc-500 font-bold">
              {fileName || t('bulkUpload.fileHint')}
            </p>
            {parsedRows.length > 0 && (
              <p className="mt-3 text-emerald-400 text-sm font-bold">
                {t('bulkUpload.readyRows', { count: parsedRows.length })}
              </p>
            )}
            {uploading && importProgress && (
              <p className="mt-3 text-emerald-300 font-bold text-sm tabular-nums">
                {t('bulkUpload.importingPct', { pct: progressPercent })} — {importProgress.processed.toLocaleString(dateLocale)} /{' '}
                {importProgress.total.toLocaleString(dateLocale)}
              </p>
            )}
          </button>

          <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl flex items-start gap-3 text-blue-200">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-bold leading-relaxed">{t('bulkUpload.formatHint')}</p>
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-100 space-y-1 max-h-32 overflow-y-auto">
              {parseErrors.map((err) => (
                <p key={err}>{err}</p>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              disabled={!canImport || uploading || parsedRows.length === 0}
              onClick={() => void runImport()}
              className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black disabled:opacity-50"
            >
              {uploading && importProgress
                ? t('bulkUpload.importingPct', { pct: progressPercent })
                : t('bulkUpload.importBtn', { count: parsedRows.length || 0 })}
            </button>
            {importFinished && (
              <button
                type="button"
                onClick={handleClose}
                className="sm:w-auto px-6 py-3.5 rounded-xl font-black border border-white/20 text-zinc-200 hover:bg-white/10"
              >
                {t('common.close')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
