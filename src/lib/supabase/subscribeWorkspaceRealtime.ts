import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  Lead,
  User,
  ManualCustomer,
  Expense,
  PriceQuote,
  ManualJournalEntry,
  AuditEvent,
  AttendanceRecord,
} from '@/app/context/DataContext';
import { getSupabase } from '@/lib/supabase/client';
import {
  mapLeadFromRow,
  mapUserFromRow,
  mapManualCustomerFromRow,
  mapExpenseFromRow,
  mapPriceQuoteFromRow,
  mapManualJournalFromRow,
  mapAuditFromRow,
  mapAttendanceFromRow,
  mapAccountingPolicyFromRow,
  mapDocJsonRow,
} from '@/lib/supabase/postgrestMappers';

export type WorkspaceRealtimeHandlers = {
  onLeadUpsert: (lead: Lead) => void;
  onLeadDelete: (id: string) => void;
  onUserUpsert: (user: User) => void;
  onUserDelete: (id: string) => void;
  onManualCustomerUpsert: (customer: ManualCustomer) => void;
  onManualCustomerDelete: (id: string) => void;
  onInvoiceRowUpsert: (raw: Record<string, unknown>) => void;
  onInvoiceDelete: (id: string) => void;
  onExpenseUpsert: (expense: Expense) => void;
  onExpenseDelete: (id: string) => void;
  onPriceQuoteUpsert: (quote: PriceQuote) => void;
  onPriceQuoteDelete: (id: string) => void;
  onManualJournalUpsert: (entry: ManualJournalEntry) => void;
  onManualJournalDelete: (id: string) => void;
  onAuditUpsert: (event: AuditEvent) => void;
  onAttendanceUpsert: (record: AttendanceRecord) => void;
  onAttendanceDelete: (id: string) => void;
  onDocJsonUpsert: (table: string, id: string, doc: Record<string, unknown>) => void;
  onDocJsonDelete: (table: string, id: string) => void;
  onWorkspaceDocReplace: (doc: Record<string, unknown>) => void;
  onAccountingPolicyReplace: (pol: ReturnType<typeof mapAccountingPolicyFromRow>) => void;
  onConfigTablesChanged: () => void;
};

function bindRowEvents(
  channel: RealtimeChannel,
  table: string,
  handlers: {
    onUpsert: (row: Record<string, unknown>) => void;
    onDelete: (id: string) => void;
  },
): void {
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
      const row = payload.new as Record<string, unknown> | null;
      if (row?.id != null) handlers.onUpsert(row);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
      const row = payload.new as Record<string, unknown> | null;
      if (row?.id != null) handlers.onUpsert(row);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
      const row = payload.old as { id?: string } | null;
      if (row?.id) handlers.onDelete(String(row.id));
    });
}

export function subscribeWorkspaceRealtime(handlers: WorkspaceRealtimeHandlers): RealtimeChannel {
  const sb = getSupabase();
  const channel = sb.channel('workspace-live-sync');

  bindRowEvents(channel, 'leads', {
    onUpsert: (row) => handlers.onLeadUpsert(mapLeadFromRow(row)),
    onDelete: handlers.onLeadDelete,
  });

  bindRowEvents(channel, 'users', {
    onUpsert: (row) => handlers.onUserUpsert(mapUserFromRow(row)),
    onDelete: handlers.onUserDelete,
  });

  bindRowEvents(channel, 'manual_customers', {
    onUpsert: (row) => handlers.onManualCustomerUpsert(mapManualCustomerFromRow(row)),
    onDelete: handlers.onManualCustomerDelete,
  });

  bindRowEvents(channel, 'invoices', {
    onUpsert: (row) => handlers.onInvoiceRowUpsert(row),
    onDelete: handlers.onInvoiceDelete,
  });

  bindRowEvents(channel, 'expenses', {
    onUpsert: (row) => handlers.onExpenseUpsert(mapExpenseFromRow(row)),
    onDelete: handlers.onExpenseDelete,
  });

  bindRowEvents(channel, 'price_quotes', {
    onUpsert: (row) => handlers.onPriceQuoteUpsert(mapPriceQuoteFromRow(row)),
    onDelete: handlers.onPriceQuoteDelete,
  });

  bindRowEvents(channel, 'manual_journal_entries', {
    onUpsert: (row) => handlers.onManualJournalUpsert(mapManualJournalFromRow(row)),
    onDelete: handlers.onManualJournalDelete,
  });

  bindRowEvents(channel, 'audit_events', {
    onUpsert: (row) => handlers.onAuditUpsert(mapAuditFromRow(row)),
    onDelete: () => {
      /* rarely deleted */
    },
  });

  bindRowEvents(channel, 'attendance_records', {
    onUpsert: (row) => handlers.onAttendanceUpsert(mapAttendanceFromRow(row)),
    onDelete: handlers.onAttendanceDelete,
  });

  for (const table of ['custody_funds', 'shoot_bookings', 'equipment_bookings', 'meeting_bookings'] as const) {
    bindRowEvents(channel, table, {
      onUpsert: (row) => {
        const doc = mapDocJsonRow<Record<string, unknown>>(row);
        if (doc) handlers.onDocJsonUpsert(table, String(row.id), doc);
      },
      onDelete: (id) => handlers.onDocJsonDelete(table, id),
    });
  }

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'workspace_state' },
    (payload) => {
      if (payload.eventType === 'DELETE') {
        handlers.onConfigTablesChanged();
        return;
      }
      const row = (payload.new || payload.old) as Record<string, unknown> | null;
      const doc = row?.doc_json;
      if (doc && typeof doc === 'object') handlers.onWorkspaceDocReplace(doc as Record<string, unknown>);
    },
  );

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'accounting_policy' },
    (payload) => {
      if (payload.eventType === 'DELETE') {
        handlers.onConfigTablesChanged();
        return;
      }
      const row = payload.new as Record<string, unknown> | null;
      if (row) handlers.onAccountingPolicyReplace(mapAccountingPolicyFromRow(row));
    },
  );

  for (const table of ['closed_months', 'monthly_targets', 'custody_settings'] as const) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      handlers.onConfigTablesChanged();
    });
  }

  channel.subscribe();
  return channel;
}
