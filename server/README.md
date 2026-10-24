# LineRoster API

Node + Express + MongoDB backend for LineRoster, with a Groq-powered assistant.
It imports the same `src/domain` engine as the web app, so a month generated
on the server is identical to one generated in the browser.

## Run locally

**Quickest — no database setup:**

```bash
cd server
npm install
npx tsx scripts/dev-mem.ts     # in-memory MongoDB, http://localhost:4400
```

Add `GROQ_API_KEY=gsk_...` to `server/.env` (or the shell) and the chat talks.

**With MongoDB Atlas:**

```bash
cp .env.example .env      # fill in MONGODB_URI, JWT_SECRET, GROQ_API_KEY, ADMIN_*
npm run dev               # http://localhost:4400
```

Port 4400 taken? `PORT=4401 npm run dev` and set `VITE_API_URL=http://localhost:4401`
in `.env.development`.

```bash
npx tsx scripts/smoke.ts  # 19 end-to-end checks against in-memory Mongo
npm run typecheck
```

## Environment

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | long random string; signs sessions |
| `GROQ_API_KEY` | enables `/ai/*`; without it the assistant returns a clear error |
| `GROQ_MODEL` | default `openai/gpt-oss-120b` |
| `AI_PUBLIC` | default `true`: the chat needs no sign-in. Set `false` to require an account |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first supervisor, created when the users collection is empty |
| `CORS_ORIGINS` | comma-separated web origins (the Vercel URL, localhost) |
| `PORT` | default 4400 |

## Routes

All routes except `POST /auth/login` and `GET /health` need `Authorization: Bearer <token>`.
Viewers can read; only supervisors can change anything.

| Route | What |
|---|---|
| `POST /auth/login` · `GET /auth/me` | sign in, current user |
| `POST /auth/users` · `GET /auth/users` | supervisor: invite / list users |
| `GET,PUT,DELETE /lines /codes /employees /leave` | reference data, keyed by the app's own ids |
| `GET,PUT /settings` | app settings |
| `GET /rosters/:line/:y/:m` | roster + headcounts + issues (generated if not stored) |
| `POST …/cell` | one hand edit `{employeeId, dayIndex, code}` |
| `POST …/generate` | rebuild from rules `{respectOverrides}` |
| `GET,POST …/rotate` | preview / apply fair rotation into next month |
| `GET,POST /sync` | pull / push the whole dataset in backup-JSON shape |
| `POST /ai/ask` | assistant: `{lineId, year, month, question, history?, context?}` → `{answer, actions, preview}` |
| `POST /ai/apply` | apply proposed actions to the stored month |
| `GET /audit` | who changed what, newest first |

## How the assistant works

The model (Groq, Llama 3.3 70B) receives the month as compact text — one
line per person — plus the codes, minimums and current issues, and must reply
in JSON: an `answer` and optional `actions` (`employeeId`, `day`, `code`).
The server then drops any action naming an unknown person, code or day,
applies the rest to a copy through the engine, and reports the error count
before and after. The web app shows that preview and applies on the
supervisor's confirmation via the normal edit path (undoable, validated).

## Deploy

Any Node host. Build step: none (runs via `tsx`). Start command: `npm start`.
Set the env vars above; set `CORS_ORIGINS` to the Vercel URL. Then build the
web app with `VITE_API_URL=https://<your-api-host>`.
