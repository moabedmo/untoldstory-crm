-- حالة العمل (سنوات مالية، دليل حسابات، إعدادات، رواتب، طلبات إعادة فتح) + حضور

CREATE TABLE "workspace_state" (
    "id" TEXT NOT NULL,
    "doc_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "rep_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_records_created_at_idx" ON "attendance_records" ("created_at" DESC);

INSERT INTO "workspace_state" ("id", "doc_json", "updated_at")
VALUES ('default', '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
