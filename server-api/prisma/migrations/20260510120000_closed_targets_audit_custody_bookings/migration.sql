-- أشهر الإغلاق، الأهداف الشهرية، إعدادات خريطة عهدة، التدقيق، العهد، الحجوزات

CREATE TABLE "closed_months" (
    "month_key" TEXT NOT NULL,
    CONSTRAINT "closed_months_pkey" PRIMARY KEY ("month_key")
);

CREATE TABLE "monthly_targets" (
    "rep_id" TEXT NOT NULL,
    "leads_target" INTEGER NOT NULL DEFAULT 0,
    "revenue_target" INTEGER NOT NULL DEFAULT 0,
    "calls_target" INTEGER NOT NULL DEFAULT 0,
    "daily_calls_target" INTEGER NOT NULL DEFAULT 0,
    "weekly_calls_target" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "monthly_targets_pkey" PRIMARY KEY ("rep_id")
);

CREATE TABLE "custody_settings" (
    "id" TEXT NOT NULL,
    "custody_account_map_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custody_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_created_at_idx" ON "audit_events" ("created_at" DESC);

CREATE TABLE "custody_funds" (
    "id" TEXT NOT NULL,
    "doc_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custody_funds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shoot_bookings" (
    "id" TEXT NOT NULL,
    "doc_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shoot_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "equipment_bookings" (
    "id" TEXT NOT NULL,
    "doc_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "equipment_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_bookings" (
    "id" TEXT NOT NULL,
    "doc_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_bookings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "custody_settings" ("id", "custody_account_map_json", "updated_at")
VALUES ('default', '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
