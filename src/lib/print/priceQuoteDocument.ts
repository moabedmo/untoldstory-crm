import type { PriceQuote, PriceQuoteLineItem, PrintBrandingSettings } from '@/app/context/DataContext';
import { getPrintBrandingLogoSrc } from '@/lib/supabase/brandingLogoStorage';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolveQuoteLineItems(quote: PriceQuote): PriceQuoteLineItem[] {
  if (Array.isArray(quote.lineItems) && quote.lineItems.length > 0) return quote.lineItems;
  const cost = quote.productionCostAmount ?? quote.amount;
  if (cost > 0) {
    return [{ id: 'main', description: quote.title || 'بنود الإنتاج', amount: cost }];
  }
  return [];
}

export type PriceQuotePrintLabels = {
  documentTitle: string;
  quoteNo: string;
  date: string;
  customer: string;
  project: string;
  costCenter: string;
  itemDescription: string;
  amount: string;
  subtotal: string;
  companyMargin: string;
  beforeVat: string;
  vat: string;
  vatRate: string;
  grandTotal: string;
  notes: string;
  preparedBy: string;
  currency: string;
  validNote: string;
};

export function buildPriceQuotePrintHtml(options: {
  quote: PriceQuote;
  branding: PrintBrandingSettings;
  labels: PriceQuotePrintLabels;
  dir: 'rtl' | 'ltr';
  locale: string;
}): string {
  const { quote, branding, labels, dir, locale } = options;
  const primary = branding.primaryColor || '#4F46E5';
  const logoSrc = getPrintBrandingLogoSrc(branding);
  const company = escapeHtml(branding.companyName || 'The Untold Story');
  const header = escapeHtml(branding.reportHeader || labels.documentTitle);
  const footer = escapeHtml(branding.reportFooter || '');
  const signatureName = escapeHtml(branding.signatureName || '');
  const signatureTitle = escapeHtml(branding.signatureTitle || '');
  const printDate = new Date().toLocaleString(locale);
  const lines = resolveQuoteLineItems(quote);
  const costSubtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const marginPct = Math.min(100, Math.max(0, Number(quote.companyMarginPercent) || 0));
  const preVat =
    quote.amount > 0
      ? quote.amount
      : Math.round(costSubtotal * (1 + marginPct / 100));
  const marginAmt = Math.max(0, preVat - costSubtotal);
  const vatRate = typeof quote.vatRate === 'number' ? quote.vatRate : 14;
  const vatAmt = quote.vatAmount ?? Math.round(preVat * (vatRate / 100));
  const total = quote.totalAmount ?? preVat + vatAmt;

  const rowsHtml = lines
    .map(
      (line, i) => `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e8eaf0;color:#64748b;font-size:12px;">${i + 1}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e8eaf0;color:#0f172a;font-weight:600;">${escapeHtml(line.description)}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e8eaf0;text-align:${dir === 'rtl' ? 'left' : 'right'};font-weight:700;color:#0f172a;white-space:nowrap;">
          ${Number(line.amount || 0).toLocaleString(locale)} ${escapeHtml(labels.currency)}
        </td>
      </tr>`,
    )
    .join('');

  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="logo" style="height:56px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-size:22px;font-weight:900;color:${primary};letter-spacing:-0.02em;">${company}</div>`;

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${dir === 'rtl' ? 'ar' : 'en'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(labels.documentTitle)} — ${escapeHtml(quote.id)}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1e293b; margin: 0; background: #fff; }
    .page { max-width: 820px; margin: 0 auto; }
    .hero { background: linear-gradient(135deg, ${primary} 0%, ${primary}dd 55%, #0f172a 100%); color: #fff; border-radius: 16px; padding: 28px 32px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .hero-meta { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-size: 12px; opacity: 0.92; }
    .hero-meta strong { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; margin-bottom: 4px; }
    .badge { display: inline-block; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 6px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; margin-top: 8px; }
    .card { border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; margin-top: 22px; box-shadow: 0 8px 30px rgba(15,23,42,0.06); }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f8fafc; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 12px 14px; text-align: ${dir === 'rtl' ? 'right' : 'left'}; border-bottom: 2px solid #e2e8f0; }
    .totals { padding: 18px 22px; background: #f8fafc; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #475569; }
    .totals-row.grand { border-top: 2px solid ${primary}; margin-top: 8px; padding-top: 12px; font-size: 18px; font-weight: 900; color: #0f172a; }
    .notes { margin-top: 18px; padding: 16px 18px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; font-size: 12px; color: #92400e; white-space: pre-wrap; }
    .footer { margin-top: 28px; padding-top: 18px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .sig { margin-top: 36px; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
    .sig-line { width: 200px; border-top: 2px solid #0f172a; margin-top: 48px; padding-top: 8px; font-size: 12px; }
    @media print { .page { max-width: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div>${logoBlock}<div style="margin-top:10px;font-size:13px;opacity:0.9;">${header}</div></div>
      <div class="hero-meta">
        <div><strong>${escapeHtml(labels.quoteNo)}</strong>${escapeHtml(quote.id)}</div>
        <div style="margin-top:10px;"><strong>${escapeHtml(labels.date)}</strong>${escapeHtml(printDate)}</div>
        <span class="badge">${escapeHtml(labels.documentTitle)}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px;">
      <div style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:6px;">${escapeHtml(labels.customer)}</div>
        <div style="font-weight:800;font-size:15px;color:#0f172a;">${escapeHtml(quote.customerName)}</div>
      </div>
      <div style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:6px;">${escapeHtml(labels.project)}</div>
        <div style="font-weight:800;font-size:15px;color:#0f172a;">${escapeHtml(quote.title)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:6px;">${escapeHtml(labels.costCenter)}: ${escapeHtml(quote.costCenter || '—')}</div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th style="width:48px;">#</th>
            <th>${escapeHtml(labels.itemDescription)}</th>
            <th style="text-align:${dir === 'rtl' ? 'left' : 'right'};">${escapeHtml(labels.amount)}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="3" style="padding:20px;text-align:center;color:#94a3b8;">—</td></tr>`}
        </tbody>
      </table>
      <div class="totals">
        <div class="totals-row"><span>${escapeHtml(labels.subtotal)}</span><span>${costSubtotal.toLocaleString(locale)} ${escapeHtml(labels.currency)}</span></div>
        ${marginPct > 0 ? `<div class="totals-row"><span>${escapeHtml(labels.companyMargin)} (${marginPct}%)</span><span>${marginAmt.toLocaleString(locale)} ${escapeHtml(labels.currency)}</span></div>` : ''}
        <div class="totals-row"><span>${escapeHtml(labels.beforeVat)}</span><span>${preVat.toLocaleString(locale)} ${escapeHtml(labels.currency)}</span></div>
        <div class="totals-row"><span>${escapeHtml(labels.vat)} (${vatRate}%)</span><span>${vatAmt.toLocaleString(locale)} ${escapeHtml(labels.currency)}</span></div>
        <div class="totals-row grand"><span>${escapeHtml(labels.grandTotal)}</span><span style="color:${primary};">${total.toLocaleString(locale)} ${escapeHtml(labels.currency)}</span></div>
      </div>
    </div>

    ${quote.note || quote.pricingNote ? `<div class="notes"><strong>${escapeHtml(labels.notes)}</strong><br/>${escapeHtml([quote.note, quote.pricingNote].filter(Boolean).join('\n\n'))}</div>` : ''}

    <div class="sig">
      <div style="font-size:12px;color:#64748b;">${escapeHtml(labels.preparedBy)} <strong style="color:#0f172a;">${escapeHtml(quote.pricedByName || quote.createdByName)}</strong></div>
      ${signatureName ? `<div class="sig-line"><strong>${signatureName}</strong>${signatureTitle ? `<br/><span style="color:#64748b;">${signatureTitle}</span>` : ''}</div>` : ''}
    </div>

    <div class="footer">
      <span>${footer || labels.validNote}</span>
      ${branding.showPrintDate ? `<span>${escapeHtml(labels.date)}: ${escapeHtml(printDate)}</span>` : ''}
    </div>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

export function openPriceQuotePrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}
