export function invoiceToJson(row) {
  let collections = [];
  if (Array.isArray(row.collectionsJson)) collections = row.collectionsJson;
  else if (typeof row.collectionsJson === 'string') {
    try {
      collections = JSON.parse(row.collectionsJson || '[]');
    } catch {
      collections = [];
    }
  }
  return {
    id: row.id,
    customerCode: row.customerCode ?? undefined,
    leadId: row.leadId ?? '',
    customerName: row.customerName,
    amount: row.amount,
    vatRate: row.vatRate ?? undefined,
    vatAmount: row.vatAmount ?? undefined,
    totalAmount: row.totalAmount ?? undefined,
    costCenter: row.costCenter ?? undefined,
    status: row.status,
    date: row.date.toISOString(),
    recordOrigin: row.recordOrigin ?? undefined,
    priceQuoteId: row.priceQuoteId ?? undefined,
    paidAmount: row.paidAmount ?? undefined,
    remainingAmount: row.remainingAmount ?? undefined,
    nextDueDate: row.nextDueDate ? row.nextDueDate.toISOString() : undefined,
    collections,
  };
}
