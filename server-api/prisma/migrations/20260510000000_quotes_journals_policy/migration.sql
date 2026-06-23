CREATE TABLE "price_quotes" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "vat_rate" DOUBLE PRECISION,
    "vat_amount" INTEGER,
    "total_amount" INTEGER,
    "cost_center" TEXT,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "invoice_id" TEXT,

    CONSTRAINT "price_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "price_quotes_created_at_idx" ON "price_quotes"("created_at");
CREATE INDEX "price_quotes_status_idx" ON "price_quotes"("status");

CREATE TABLE "manual_journal_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "lines_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manual_journal_entries_date_idx" ON "manual_journal_entries"("date");

CREATE TABLE "accounting_policy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "policy_notes" TEXT NOT NULL DEFAULT '',
    "allowed_cost_centers_json" JSONB NOT NULL DEFAULT '[]',
    "min_amount_highlight" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_policy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "accounting_policy" ("id", "policy_notes", "allowed_cost_centers_json", "min_amount_highlight", "updated_at")
VALUES ('default', '', '[]', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
