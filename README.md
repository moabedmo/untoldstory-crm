
  # تنفيذ الطلب

  This is a code bundle for تنفيذ الطلب. The original project is available at https://www.figma.com/design/0MRFL1cdCItFw8SPYIb3r9/%D8%AA%D9%86%D9%81%D9%8A%D8%B0-%D8%A7%D9%84%D8%B7%D9%84%D8%A8.

  **Stack:** Vite + React (frontend), Express + Prisma + PostgreSQL (backend `server-api/`). Supabase may host the Postgres URL only; the app does not use the Supabase JS client in this repo.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  Run `npm run api:dev` from the repo root (or `npm run dev` inside `server-api/`) for the REST API. Copy `server-api/.env.example` → `server-api/.env` and `.env.local.example` → `.env.local`; see root `.env.example` for a combined checklist.

## Documentation

- Arabic full operations reference: `SYSTEM_OPERATIONS_REFERENCE_AR.md`
  