/**
 * إشعار اختياري للعميل عبر webhook (n8n / WhatsApp / email gateway).
 * عيّن VITE_CLIENT_NOTIFY_WEBHOOK_URL في .env.local
 */
export type ClientNotifyEvent =
  | { type: 'quote_approved'; quoteId: string; customerName: string; title: string; totalAmount?: number }
  | { type: 'quote_won'; quoteId: string; customerName: string; title: string; workOrderId?: string };

export async function notifyClientChannel(
  event: ClientNotifyEvent,
  webhookUrlOverride?: string,
): Promise<void> {
  const url = String(webhookUrlOverride || import.meta.env.VITE_CLIENT_NOTIFY_WEBHOOK_URL || '').trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, sentAt: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('[client-notify]', e);
  }
}
