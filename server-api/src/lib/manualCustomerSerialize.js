export function manualCustomerToJson(row) {
  return {
    id: row.id,
    customerCode: row.customerCode ?? undefined,
    name: row.name,
    company: row.company ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    sourceLabel: row.sourceLabel ?? undefined,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdByRole: row.createdByRole,
  };
}
