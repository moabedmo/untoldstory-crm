-- دعم تكامل مرجعي: فهارس + مفاتيح أجنبية (بدون تعديل أعمدة أخرى)

CREATE INDEX "attendance_records_rep_id_idx" ON "attendance_records"("rep_id");

CREATE INDEX "invoices_lead_id_idx" ON "invoices"("lead_id");

CREATE INDEX "invoices_price_quote_id_idx" ON "invoices"("price_quote_id");

CREATE INDEX "manual_customers_created_by_id_idx" ON "manual_customers"("created_by_id");

CREATE INDEX "price_quotes_lead_id_idx" ON "price_quotes"("lead_id");

CREATE INDEX "price_quotes_invoice_id_idx" ON "price_quotes"("invoice_id");

ALTER TABLE "manual_customers" ADD CONSTRAINT "manual_customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_price_quote_id_fkey" FOREIGN KEY ("price_quote_id") REFERENCES "price_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "monthly_targets" ADD CONSTRAINT "monthly_targets_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
