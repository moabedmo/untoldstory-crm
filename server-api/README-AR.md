# API السيرفر — خطوات أولية على VPS هوستنجر

## ١) على الـ VPS نفسه

1. تثبيت **Node.js 18+**  
   - مثلاً `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -` ثم `sudo apt install -y nodejs` (أوبونتو)
2. تثبيت **PostgreSQL** وإنشاء قاعدة باسم الشركة، ومستخدم له صلاحيات عليها.
3. افتح جدار الحماية على المنفذ اللي هتشغّل عليه الـ API (مثل **4000**) إن لزم، أو ضع **nginx** أمامه للـ reverse proxy وشهادة TLS.

## ٢) رفع الكود

- ارفع مجلد **`server-api/`** كامل للسيرفر (أو اعمل clone للمشروع).
- على السيرفر: `cd server-api && npm ci` (أو `npm install`).
- انسخ `.env.example` إلى `.env` وضع `DATABASE_URL` الصحيح و`CORS_ORIGINS` (عنوان موقع الواجهة على الإنترنت + localhost للتطوير).

## ٣) تهيئة القاعدة

**شرح مبسّط خطوة بخطوة (لغير المبرمجين):** اقرأ من جذر المشروع الملف **`دليل-ربط-قاعدة-البيانات.md`**.

> **ليس من صفحة API Keys في Supabase:** الربط هنا بـ **رابط قاعدة بيانات Postgres** من **Settings → Database → Connection string**، وليس مفاتيح `anon` / `service_role`.

في مجلد `server-api` يجب أن يحتوي ملف **`.env`** على **`DATABASE_URL`** و**`DIRECT_URL`** (من Supabase: رابط الـ pooling + رابط **Direct connection** — التفاصيل في الدليل).

```bash
cd server-api
npm install
npm run db:generate
npm run db:migrate
```

- أوامر `db:generate` و `db:migrate` تتحقق تلقائياً من الملف (`npm run check:env`).  
- على Windows إذا ظهر **`EPERM`** أثناء التوليد: أغلق أي سيرفر Node شغال (مثلاً التطوير) ثم أعد المحاولة.
- إذا ظهر **`P3005`** مع Supabase: من مجلد `api` بالترتيب `npm run db:push` ثم `npm run db:baseline` ثم `npm run db:migrate` (تفصيل في **دليل-ربط-قاعدة-البيانات.md**).

## ٤) التشغيل

- للتجربة: `npm run dev`
- للإنتاج استخدم **systemd** أو **pm2**: `npm run start`

## ٥) الفحص

- من المتصفّح أو الطرفية: `curl http://127.0.0.1:4000/health`  
  يجب أن يرجع `ok: true` و`db: connected`.

---

## الليدز والوضع الإنتاجي (واجهة)

- بعد `db:migrate` تظهر الجداول على PostgreSQL.
- مسارات REST (تحتاج **`Authorization: Bearer <jwt>`** ما عدا تسجيل الدخول):
  - **`/api/leads`** — GET/POST، PATCH `/:id`
  - **`/api/users`** — GET/POST، PATCH/DELETE `/:id`
  - **`/api/manual-customers`** — CRUD
  - **`/api/invoices`**, **`/api/expenses`** — GET/POST، PATCH `/:id`
  - **`/api/price-quotes`** — GET/POST، PATCH `/:id` (اعتماد/رفض)
  - **`/api/manual-journals`** — GET/POST، **`DELETE /api/manual-journals/:id`** (محاسب / مالك)
  - **`GET/PATCH /api/accounting-policy`** — سياسة محاسبية واحدة
  - **`/api/closed-months`** — GET، `POST /close`، `POST /reopen` (مالك)
  - **`/api/monthly-targets`** — GET، PATCH `/:repId` (مالك / مدير مبيعات)
  - **`GET/PATCH /api/custody-settings`** — تكويد عهدة الإنتاج (محاسب للتعديل)
  - **`/api/audit-events`** — GET، POST
  - **`/api/custody-funds`** — GET، POST، PUT `/:id`
  - **`/api/shoot-bookings`**, **`/api/equipment-bookings`**, **`/api/meeting-bookings`** — GET، POST، PATCH `/:id`
  - **`GET/PATCH /api/workspace-state`** — مستند JSON واحد للواجهة (دمج جزئي): شجرة الحسابات، السنوات المقفلة، الأرصدة الافتتاحية، إعدادات الطباعة والتكاملات، سير العمل، SLA، جودة بيانات الليدز، المعدات، اعتمادات الرواتب وطلباتها، طلبات إعادة فتح الفترة، وأيضاً: `journalCodebook`، `expenseCodebook`، `customerCodePrefix`، `expenseSavedViews`، `payrollAutoSendDay`، `expenseEscalations` (محاسب/مالك)، `entityComments`، `uiVisualMode` (مالك)، `personalTodosByUserId` (كل مستخدم قائمته تحت `userId`) — مع قيود حسب الدور على المفاتيح العليا.
  - **`GET/POST /api/attendance-records`** — سجل الحضور والانصراف (محاسب / مالك)، حتى 4000 صف أحدث أولاً.
- في مشروع الواجهة، فعّل **`VITE_DATA_SOURCE=server`** في `.env.local`. قالب: **`.env.local.example`**.

**الخطة والمتبقي:** **`خطة-ربط-الباكند.md`** في جذر المشروع.
