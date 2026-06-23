-- AlterTable User profile fields
ALTER TABLE "users" ADD COLUMN "avatar" TEXT,
ADD COLUMN "base_salary" INTEGER,
ADD COLUMN "skills_json" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "stats_json" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "manual_customers" (
    "id" TEXT NOT NULL,
    "customer_code" TEXT,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_by_role" TEXT NOT NULL,

    CONSTRAINT "manual_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "customer_code" TEXT,
    "lead_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "vat_rate" DOUBLE PRECISION,
    "vat_amount" INTEGER,
    "total_amount" INTEGER,
    "cost_center" TEXT,
    "status" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "record_origin" TEXT,
    "price_quote_id" TEXT,
    "paid_amount" INTEGER,
    "remaining_amount" INTEGER,
    "next_due_date" TIMESTAMP(3),
    "collections_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoices_date_idx" ON "invoices"("date");

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "vat_rate" DOUBLE PRECISION,
    "vat_amount" INTEGER,
    "total_amount" INTEGER,
    "cost_center" TEXT,
    "status" TEXT NOT NULL,
    "approval_status" TEXT NOT NULL,
    "approved_by" TEXT,
    "vendor" TEXT,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_date_idx" ON "expenses"("date");
