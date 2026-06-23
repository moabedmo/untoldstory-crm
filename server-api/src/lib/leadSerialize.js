/** تحويل صف Lead من Prisma إلى شكل الواجهة */

export function leadToJson(row) {
  const timeline = Array.isArray(row.timelineJson)
    ? row.timelineJson
    : typeof row.timelineJson === 'string'
      ? JSON.parse(row.timelineJson || '[]')
      : [];
  return {
    id: row.id,
    customerCode: row.customerCode ?? undefined,
    name: row.name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    status: row.status,
    assignedTo: row.assignedToId ?? undefined,
    budget: row.budget,
    companySize: row.companySize,
    source: row.source,
    category: row.category,
    score: row.score,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    followUpAt: row.followUpAt ? row.followUpAt.toISOString() : undefined,
    lossReasonCode: row.lossReasonCode ?? undefined,
    slaStatus: row.slaStatus,
    timeline,
  };
}
