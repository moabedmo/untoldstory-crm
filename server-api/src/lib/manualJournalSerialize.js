export function manualJournalToJson(row) {
  let lines = [];
  if (Array.isArray(row.linesJson)) lines = row.linesJson;
  else if (typeof row.linesJson === 'string') {
    try {
      lines = JSON.parse(row.linesJson || '[]');
    } catch {
      lines = [];
    }
  }
  return {
    id: row.id,
    date: row.date.toISOString(),
    description: row.description,
    lines,
  };
}
