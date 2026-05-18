import type { PriceQuote } from '@/app/context/DataContext';

export type RepQuotePipelineStepState = 'done' | 'active' | 'pending' | 'failed';

export type RepQuotePipelineStep = {
  key: string;
  label: string;
  sub: string;
  state: RepQuotePipelineStepState;
};

export type RepQuotePipelineInfo = {
  steps: RepQuotePipelineStep[];
  statusLabel: string;
  statusHint: string;
  activeStepIndex: number;
  isTerminal: boolean;
  isFailure: boolean;
};

const PIPELINE_DEF = [
  { key: 'production', label: 'مدير الإنتاج', sub: 'التسعير' },
  { key: 'owner', label: 'اعتماد المالك', sub: 'المالية والدفع' },
  { key: 'client', label: 'تقديم للعميل', sub: 'موافقة العميل' },
  { key: 'done', label: 'إغلاق الصفقة', sub: 'فاتورة وأمر شغل' },
] as const;

/** مراحل مسار عرض السعر من منظور المندوب */
export function getRepQuotePipelineInfo(quote: PriceQuote): RepQuotePipelineInfo {
  const prodName = quote.productionAssignedName || 'مدير الإنتاج';
  const pricedAt = quote.pricedAt
    ? new Date(quote.pricedAt).toLocaleDateString('ar-EG')
    : null;

  let activeStepIndex = 0;
  let statusLabel = '';
  let statusHint = '';
  let isTerminal = false;
  let isFailure = false;

  switch (quote.status) {
    case 'بانتظار التسعير':
      activeStepIndex = 0;
      statusLabel = 'بانتظار تسعير الإنتاج';
      statusHint =
        quote.pricingNote?.includes('طلب تعديل من المالك') || quote.pricingNote?.includes('إعادة التسعير')
          ? `أُعيد من المالك للتعديل — عند ${prodName}`
          : `الطلب عند ${prodName} لتسعير البنود والهامش`;
      break;
    case 'قيد اعتماد المالك':
      activeStepIndex = 1;
      statusLabel = 'بانتظار اعتماد المالك';
      statusHint = pricedAt
        ? `تم التسعير ${pricedAt} — المالك يراجع المبلغ وشروط الدفع`
        : 'تم إرسال التسعير للمالك — بانتظار الاعتماد وتحديد الدفعات';
      break;
    case 'معتمد':
      activeStepIndex = 2;
      statusLabel = 'جاهز لتقديمه للعميل';
      statusHint = buildPaymentHint(quote);
      break;
    case 'مكتمل':
      activeStepIndex = 3;
      isTerminal = true;
      statusLabel = 'مكتمل — فاتورة وأمر شغل';
      statusHint = quote.invoiceId
        ? `تم تسجيل موافقة العميل — فاتورة ${quote.invoiceId}`
        : 'تم تسجيل موافقة العميل وإغلاق المسار';
      break;
    case 'مرفوض':
      activeStepIndex = 1;
      isTerminal = true;
      isFailure = true;
      statusLabel = 'مرفوض من المالك';
      statusHint = quote.approvedAt
        ? `رُفض بعد التسعير — ${new Date(quote.approvedAt).toLocaleDateString('ar-EG')}`
        : 'رُفض من المالك قبل تقديمه للعميل';
      break;
    case 'مغلق - رفض العميل':
      activeStepIndex = 2;
      isTerminal = true;
      isFailure = true;
      statusLabel = 'العميل رفض العرض';
      statusHint = quote.clientRejectionNote?.trim()
        ? `سبب الرفض: ${quote.clientRejectionNote.trim()}`
        : 'سُجّل رفض العميل بعد تقديم العرض';
      break;
    default:
      activeStepIndex = 0;
      statusLabel = quote.status;
      statusHint = '';
  }

  const steps: RepQuotePipelineStep[] = PIPELINE_DEF.map((def, idx) => {
    let state: RepQuotePipelineStepState = 'pending';
    if (isFailure) {
      if (quote.status === 'مرفوض') {
        if (idx < 1) state = 'done';
        else if (idx === 1) state = 'failed';
        else state = 'pending';
      } else if (quote.status === 'مغلق - رفض العميل') {
        if (idx < 2) state = 'done';
        else if (idx === 2) state = 'failed';
        else state = 'pending';
      }
    } else if (isTerminal && quote.status === 'مكتمل') {
      state = 'done';
    } else if (idx < activeStepIndex) {
      state = 'done';
    } else if (idx === activeStepIndex) {
      state = 'active';
    }
    return { ...def, state };
  });

  return { steps, statusLabel, statusHint, activeStepIndex, isTerminal, isFailure };
}

function buildPaymentHint(quote: PriceQuote): string {
  const parts: string[] = ['اعتمد المالك العرض — قدّمه للعميل وسجّل ردّه'];
  if (quote.initialPayment && quote.initialPayment > 0) {
    parts.push(`دفعة أولى مقترحة: ${quote.initialPayment.toLocaleString('ar-EG')} ج.م`);
  }
  if (quote.paymentSchedule?.length) {
    parts.push(`${quote.paymentSchedule.length} دفعة مجدولة من المالك`);
  }
  if (quote.approvedAt) {
    parts.push(`اعتُمد: ${new Date(quote.approvedAt).toLocaleDateString('ar-EG')}`);
  }
  return parts.join(' · ');
}

/** طلبات المندوب الظاهرة في مسار المتابعة (غير المعتمدة الجاهزة للعميل) */
export function isRepQuoteInPipeline(quote: PriceQuote, repUserId: string): boolean {
  if (quote.createdById !== repUserId) return false;
  return (
    quote.status === 'بانتظار التسعير' ||
    quote.status === 'قيد اعتماد المالك' ||
    quote.status === 'مرفوض' ||
    quote.status === 'مغلق - رفض العميل'
  );
}

export function sortRepQuotesByActivity(a: PriceQuote, b: PriceQuote): number {
  const ta = new Date(a.pricedAt || a.approvedAt || a.createdAt).getTime();
  const tb = new Date(b.pricedAt || b.approvedAt || b.createdAt).getTime();
  return tb - ta;
}
