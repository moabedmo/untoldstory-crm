export function accountingPolicyToJson(row) {
  let allowed = [];
  if (Array.isArray(row.allowedCostCentersJson)) allowed = row.allowedCostCentersJson;
  else if (typeof row.allowedCostCentersJson === 'string') {
    try {
      allowed = JSON.parse(row.allowedCostCentersJson || '[]');
    } catch {
      allowed = [];
    }
  }
  return {
    policyNotes: row.policyNotes || '',
    allowedCostCentersForQuotes: allowed,
    minAmountHighlight: typeof row.minAmountHighlight === 'number' ? row.minAmountHighlight : 0,
  };
}
