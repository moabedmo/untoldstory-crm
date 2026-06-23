import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './prisma.js';
import { authRouter } from './routes/auth.routes.js';
import { leadsRouter } from './routes/leads.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { manualCustomersRouter } from './routes/manualCustomers.routes.js';
import { invoicesRouter } from './routes/invoices.routes.js';
import { expensesRouter } from './routes/expenses.routes.js';
import { priceQuotesRouter } from './routes/priceQuotes.routes.js';
import { manualJournalsRouter } from './routes/manualJournals.routes.js';
import { accountingPolicyRouter } from './routes/accountingPolicy.routes.js';
import { closedMonthsRouter } from './routes/closedMonths.routes.js';
import { monthlyTargetsRouter } from './routes/monthlyTargets.routes.js';
import { custodySettingsRouter } from './routes/custodySettings.routes.js';
import { auditEventsRouter } from './routes/auditEvents.routes.js';
import { custodyFundsRouter } from './routes/custodyFunds.routes.js';
import { shootBookingsRouter } from './routes/shootBookings.routes.js';
import { equipmentBookingsRouter } from './routes/equipmentBookings.routes.js';
import { meetingBookingsRouter } from './routes/meetingBookings.routes.js';
import { workspaceStateRouter } from './routes/workspaceState.routes.js';
import { attendanceRecordsRouter } from './routes/attendanceRecords.routes.js';
import { integrationsOAuthRouter } from './routes/integrationsOAuth.routes.js';

const SETUP_HTML = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>أول مستخدم</title></head>
<body style="font-family:system-ui,sans-serif;padding:1.5rem;max-width:22rem;margin:0 auto;background:#0f172a;color:#e2e8f0">
<h1 style="font-size:1.1rem;margin-bottom:1rem">إنشاء أول حساب</h1>
<p style="font-size:0.85rem;color:#94a3b8;margin-bottom:1rem">تظهر هذه الصفحة مرة واحدة فقط عندما لا يوجد أي مستخدم في قاعدة البيانات.</p>
<form method="POST" action="/auth/bootstrap-first" style="display:flex;flex-direction:column;gap:0.75rem">
<label>البريد<br/><input name="email" type="email" required style="width:100%;padding:0.5rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff"/></label>
<label>كلمة المرور (8 أحرف على الأقل)<br/><input name="password" type="password" minlength="8" required style="width:100%;padding:0.5rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff"/></label>
<label>الاسم<br/><input name="name" required style="width:100%;padding:0.5rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff"/></label>
<label>الدور<br/><select name="role" style="width:100%;padding:0.5rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff">
<option value="مالك">مالك</option>
<option value="مدير مبيعات">مدير مبيعات</option>
<option value="مندوب">مندوب</option>
<option value="محاسب">محاسب</option>
<option value="مدير إنتاج">مدير إنتاج</option>
</select></label>
<button type="submit" style="margin-top:0.5rem;padding:0.65rem 1rem;border:none;border-radius:10px;background:#6366f1;color:#fff;font-weight:700;cursor:pointer">إنشاء الحساب</button>
</form>
</body></html>`;

const app = express();
const PORT = Number(process.env.PORT) || 4000;

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

/** أصول مسموحة افتراضياً للتطوير؛ للإنتاج اضبط CORS_ORIGINS في .env */
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

/** صفحة إنشاء أول مستخدم (تعمل فقط لو جدول المستخدمين فاضي) */
app.get('/setup', async (_req, res) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res
        .type('html')
        .send(
          `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>الإعداد</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem;margin:0 auto"><p>يوجد مستخدمون بالفعل في النظام.</p><p><a href="http://localhost:5173">افتح تسجيل الدخول في الواجهة</a></p></body></html>`
        );
    }
    return res.type('html').send(SETUP_HTML);
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
});

app.use('/auth', authRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/users', usersRouter);
app.use('/api/manual-customers', manualCustomersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/price-quotes', priceQuotesRouter);
app.use('/api/manual-journals', manualJournalsRouter);
app.use('/api/accounting-policy', accountingPolicyRouter);
app.use('/api/closed-months', closedMonthsRouter);
app.use('/api/monthly-targets', monthlyTargetsRouter);
app.use('/api/custody-settings', custodySettingsRouter);
app.use('/api/audit-events', auditEventsRouter);
app.use('/api/custody-funds', custodyFundsRouter);
app.use('/api/shoot-bookings', shootBookingsRouter);
app.use('/api/equipment-bookings', equipmentBookingsRouter);
app.use('/api/meeting-bookings', meetingBookingsRouter);
app.use('/api/workspace-state', workspaceStateRouter);
app.use('/api/integrations', integrationsOAuthRouter);
app.use('/api/attendance-records', attendanceRecordsRouter);

app.get('/', (_req, res) => {
  res.type('html').send(
    '<p>API شغال. <a href="/setup">إنشاء أول مستخدم</a> — <a href="/health">فحص قاعدة البيانات</a></p>'
  );
});

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: 'connected', at: new Date().toISOString() });
  } catch (e) {
    return res.status(503).json({
      ok: false,
      db: 'error',
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
});


app.use((req, res) => {
  res.status(404).json({ error: 'المسار غير موجود' });
});

app.use((err, _req, res, _next) => {
  console.error('[api] unhandled', err);
  if (res.headersSent) return;
  const msg = err instanceof Error ? err.message : 'خطأ في الخادم';
  const isJsonParse = err instanceof SyntaxError && /json/i.test(String(err.message));
  res.status(isJsonParse ? 400 : 500).json({
    error: isJsonParse ? 'جسم الطلب JSON غير صالح' : msg,
  });
});

app.listen(PORT, () => {
  console.log(
    `[api] http://0.0.0.0:${PORT}  (setup أول مستخدم: /setup, health: /health)`
  );
});
