# EvidenceLoop

**Prove the work. Don't just trust the photo.**

EvidenceLoop is an agentic multimodal evidence-verification system. Given a work order and its
requirements, it decides whether the available evidence — photos, video, documents — actually
*proves* each requirement was met. It does not classify an image and call it done. When proof is
missing it says so, names what is missing, and requests the minimum additional evidence. When new
evidence arrives it re-analyzes the requirements that evidence affects.

> EvidenceLoop assists verification. It does not replace qualified inspectors or certification,
> and it does not guarantee physical safety.

## AI provider — current status

Production AI is **NVIDIA Nemotron served by Nebius Token Factory**. It is the only inference
provider in this project; no other AI API or SDK is used or may be added.

**Nebius is currently disabled because no API key is available yet.** Until `NEBIUS_API_KEY` and
`NEBIUS_MODEL` are set on the backend:

- the API and dashboard report "Production AI is not configured";
- verification runs are refused (`503 AI_NOT_CONFIGURED`) — nothing is ever marked proven;
- everything else works: work orders, checklists, evidence upload, audit trail.

The Nebius adapter (`backend/src/ai/nebiusProvider.ts`) is written and unit-tested against
simulated responses (code-fenced JSON, reasoning text before the answer, 401/404/429/5xx,
timeouts), but has **not been run against the live service**. Expect to tune the prompt once a key
exists.

When Nebius is configured, the backend runs a live connection test at startup (one small text
request, one small image request). The dashboard says **"Production AI: NVIDIA Nemotron via
Nebius — connected"** with the model id only after that test passes; until then it shows
"Nemotron configured · not verified".

### What the model can inspect

| Evidence | How it is sent | Not inspected |
| --- | --- | --- |
| Photos | Inline image (≤ 5 MB) — needs a vision Nemotron model | Larger images |
| Text / transcript | Inline text, first 20,000 characters | The rest |
| PDF | Text layer extracted on the backend (`unpdf`), first 20,000 characters | Scanned PDFs without a text layer (no OCR), images inside PDFs |
| Video | Up to 8 still frames, about one every 2 s (spread wider for long clips), each labelled with its timestamp so observations carry `startSec`/`endSec` (`ffmpeg-static`) | What happens between frames; the soundtrack |
| Audio | — | Everything (no transcription) |

Anything not inspected is declared to the model as "attached but NOT inspected", with the reason,
so it cannot claim to have seen it.

### DEV ONLY fixture

To exercise the verification loop without a key, set `DEV_FIXTURE_AI=true` in `backend/.env`.
This swaps in a deterministic fixture (`backend/src/ai/devFixtureProvider.ts`) that is **not AI
inference**: it never opens a file and only checks which *kinds* of evidence are attached. Every
result it produces is stored with `simulated: true` and labelled "Simulated · dev fixture" in the
dashboard and audit trail. It reports no confidence. It is ignored when `NODE_ENV=production` and
whenever Nebius is configured.

## The demo scenario

Work order: **Replace emergency light in Room 204.** Six requirements: correct unit installed,
correct location, securely mounted, electrical connection completed, indicator functioning,
functional test completed.

With the DEV fixture enabled:

1. Create the work order from the *Emergency light replacement* template.
2. Upload a before photo, an after photo, the SOP/manual and a close-up photo.
3. **Run verification** → four requirements proven, "Indicator functioning" uncertain,
   "Functional test completed" not proven.
4. The agent opens one request covering both: *"Upload a 5–10 second video showing the emergency
   light functional test."*
5. Upload a video against that request → only the affected requirements are re-analyzed → verified.

Adding `#contradict` to an upload's note makes the fixture simulate a contradiction (DEV ONLY).

## Roles and reviewer sign-off

| Role | Can |
| --- | --- |
| **Technician** (default) | Create work orders, upload evidence, run verification, add requirements, edit/archive/delete their own work orders, submit for review |
| **Reviewer** | Read every work order, export reports, decide pending reviews. Cannot change work orders or upload evidence |

A work order that is **CONTRADICTED**, or **not verified with an UNCERTAIN requirement**, can be
submitted for review. It moves to **In review** and is frozen (no uploads, runs or checklist
changes). The reviewer then, always with a note:

- **approves** → *Approved by reviewer*. This is a human decision and is labelled as one; the
  unproven requirements stay unproven and the work order is never shown as *Verified*;
- **rejects** → *Rejected by reviewer*;
- **requests more evidence** → an evidence request from the reviewer, back to the technician.
  Re-analysis never retires a reviewer's request; only an upload answers it.

Every step is in the audit trail with the actor's role. Enforcement is in three places:

1. **Backend** — every route checks the role and ownership (`stores/workOrders.ts`,
   `routes/reviews.ts`); the UI only reflects the `permissions` the API returns.
2. **Row Level Security** — technicians read only their own work orders, reviewers read all;
   clients have no write path at all.
3. **Database trigger** on `public.reviews`, which also binds the backend's secret key: only a
   user with the reviewer role can decide a review, never the person who submitted it, and a
   decided review cannot be changed.

**Assigning roles (Supabase):** every user is a technician until an administrator runs, in the
SQL editor:

```sql
insert into public.user_roles (id, role) values ('<auth user uuid>', 'reviewer')
on conflict (id) do update set role = excluded.role;
```

**Local mode:** a *Demo: Technician / Reviewer* switcher in the header acts as two fixed local
users. The backend honours it only when Supabase Auth is not configured.

## Requirements from an SOP

On the new-work-order form, or on an existing work order, upload an SOP or manual (PDF with a text
layer, or plain text) and click **Generate requirements**:

1. The backend extracts the text (`POST /api/requirements/draft`; nothing is stored) and asks
   Nemotron to propose requirements: title, description, mandatory yes/no, and the evidence that
   would prove each one.
2. Every proposal must quote the SOP passage it comes from. `agent/sopDraft.ts` drops any
   proposal whose quote is not in the document, so the model cannot invent requirements.
3. You review, edit and delete proposals in the browser. Only when you confirm are they saved
   (`POST /api/work-orders/:id/requirements`), with an audit event naming the source file.

With the DEV fixture the list is simulated — step-like lines copied verbatim from the SOP, with a
keyword guess at the evidence — and is labelled as such. Scanned PDFs without a text layer are
refused (422), and with no AI configured drafting is refused (503) rather than faked.

## Evidence viewer

Click any evidence file, or any evidence cited in a requirement's observations, to open it in the
viewer: images (fit / actual size), video and audio players, PDFs inline, and text files. Beside
it are the file's metadata and full SHA-256, **what the AI can actually inspect** for that file
type (and what it cannot — e.g. a video's soundtrack, a scanned PDF), and every observation that
cites the file. Clicking a video observation's timestamp jumps the player to that moment.

## Managing work orders

- **List** — search (title, location, description), filter by status or archived, sort by
  newest, oldest or recently updated.
- **Edit** — title, location and description. Every change is written to the audit trail with
  its old and new value.
- **Archive** — makes the work order read-only (no uploads, edits or verification runs) and
  hides it from the default list. Unarchive to resume.
- **Delete** — permanent, after a confirmation dialog: removes the work order, its evidence files,
  decisions and audit trail. Archive instead to keep the record.
- **Export PDF** — `GET /api/work-orders/:id/report.pdf`: requirements, evidence (with SHA-256),
  observations, decisions, evidence requests and the full audit trail, with the disclaimer that
  EvidenceLoop does not replace qualified inspectors. DEV fixture results are labelled simulated.

## Architecture

```
            ┌──────────────────────────┐        ┌───────────────────────────────────────────┐
 Browser ──▶│ frontend (Vite + React)  │──HTTP─▶│ backend (Express)                          │
            │ Tailwind · React Router  │        │                                           │
            │ Framer Motion · R3F      │        │  routes ──▶ agent/engine  (the loop)       │
            └───────────┬──────────────┘        │               │                           │
                        │ publishable key       │               ├─▶ ai/provider  (interface) │
                        │ (sign-in, Realtime,   │               │     ├─ NebiusNemotron  ◀── production
                        │  RLS-limited reads)   │               │     └─ DevFixture      ◀── DEV ONLY
                        ▼                       │               ├─▶ agent/policy  (guardrails)│
                 ┌─────────────┐  secret key    │               ├─▶ agent/planner (min. request)
                 │  Supabase   │◀───────────────│               └─▶ agent/audit               │
                 │ Postgres ·  │                │  stores: Db + FileStore                    │
                 │ Auth ·      │                │    Supabase  |  local disk (dev fallback)  │
                 │ Storage ·   │                └───────────────────────────────────────────┘
                 │ Realtime    │
                 └─────────────┘
```

### The verification loop (`backend/src/agent/engine.ts`)

Work order → retrieve requirements → build checklist → analyze evidence → map evidence to
requirements → check proof → detect uncertainty and contradictions → identify missing evidence →
plan the minimum request → new evidence → re-analyze → final verification, with every step
appended to the audit trail.

The AI provider supplies perception and judgment only. Everything else is deterministic code:

- **Policy (`agent/policy.ts`)** — applied to every provider answer. It can only make a decision
  more cautious. `PROVEN` without a direct observation of evidence that is actually attached is
  downgraded; `CONTRADICTED` without cited evidence is downgraded; observations citing unknown
  files are dropped; confidence is passed through or dropped, never computed; unproven
  requirements always state "I cannot verify this requirement from the available evidence."
  A missing or malformed answer becomes `NOT_PROVEN`.
- **Planner (`agent/planner.ts`)** — merges missing-evidence needs by kind so one upload can
  settle several requirements. Only unproven *mandatory* requirements generate requests.
- **Re-analysis** — new evidence re-evaluates every requirement that is not proven, plus any
  requirement that kind of evidence is relevant to (so new evidence can overturn `PROVEN`).
  Earlier conclusions are not fed back to the provider.
- **Overall status** — `VERIFIED` only when every mandatory requirement is `PROVEN`; any
  contradiction blocks it.

Each decision is stored as an append-only assessment:
**Requirement → Evidence → Observation (direct | inferred) → Reasoning → Decision.**

### Project structure

```
backend/src/
  index.ts              Composition root: picks Supabase or local stores, and the AI provider
  app.ts                Express app
  types.ts              Domain model — shared with the frontend via the @domain alias
  templates.ts          Requirement library (the demo scenario)
  config/env.ts         Environment validation; decides the AI mode
  ai/                   provider.ts (interface) · nebiusProvider.ts · devFixtureProvider.ts
  agent/                engine.ts · policy.ts · planner.ts · audit.ts
  stores/               db.ts (interface) · supabaseDb.ts · localDb.ts · fileStore.ts · workOrders.ts
  middleware/           auth.ts (Supabase JWT) · errors.ts
  routes/               health.ts (health, system, templates) · workOrders.ts
  lib/                  supabase.ts · nebius.ts (HTTP client)
frontend/src/
  App.tsx               Routes
  api.ts · auth.tsx · hooks.ts · lib/supabase.ts
  components/           Landing, WorkOrderList, WorkOrderForm, WorkOrderDetail, RequirementCard,
                        EvidencePanel, EvidenceRequests, AuditTrail, LoopScene (3D), …
supabase/schema.sql     Tables, RLS policies, Realtime publication, private storage bucket
render.yaml             Render blueprint (backend)
frontend/vercel.json    SPA rewrite (frontend)
```

## Local setup

Requires **Node.js 20.12+**.

```bash
npm install
cp backend/.env.example backend/.env      # then set DEV_FIXTURE_AI=true to try the loop
npm run dev                               # API on :4000, dashboard on :5173
```

Open http://localhost:5173.

With no Supabase credentials the backend runs in **local mode**: data and uploads are kept in
`backend/.data/` (git-ignored) and there is no sign-in. Local mode is refused when
`NODE_ENV=production`.

| Command | What it does |
| --- | --- |
| `npm run dev` | API and dashboard with hot reload |
| `npm test` | Backend tests (policy, planner, media, Nebius client, full demo loop and review flow over HTTP) and frontend tests (components, filters, AI status labels) |
| `npm run lint` | ESLint over both workspaces |
| `npm run typecheck` | Type-check both workspaces |
| `npm run check` | Lint, typecheck, test and build — run before every commit |
| `npm run build` | Build both workspaces |
| `npm run check:supabase` | Checks the Supabase key, tables and storage bucket |
| `npm run check:nebius` | Live Nebius test: prints configured yes/no, model id, text OK/FAIL, image (vision) OK/FAIL and latency. Never prints the key |

### Connecting Supabase

1. Create a project and run `supabase/schema.sql` in the SQL editor.
2. Backend (`backend/.env`): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
3. Frontend (`frontend/.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

With Supabase configured the API requires a signed-in user, files go to a private Storage bucket
(served through short-lived signed URLs), and the dashboard updates live through Realtime.

### Enabling Nebius (when the key is available)

Set `NEBIUS_API_KEY` and `NEBIUS_MODEL` (the exact Nemotron model id from the Nebius console) in
`backend/.env`, or in Render's environment settings, then run `npm run check:nebius`.

EvidenceLoop inspects photos and video frames, so the model must be **vision-capable**. If the
check reports text OK but image FAIL, pick a vision Nemotron model (Nemotron Nano VL / Omni) in the
Token Factory console and set `NEBIUS_MODEL` to its id.

`ffmpeg-static` downloads an ffmpeg binary in its install script; the root `package.json` approves
that script under `allowScripts`. If video frames fail with `EFTYPE`, the download was
interrupted — delete `node_modules/ffmpeg-static/ffmpeg.exe` (or `ffmpeg`) and run
`node node_modules/ffmpeg-static/install.js`.

## Environment variables

| Where | Variable | Secret? |
| --- | --- | --- |
| Backend | `SUPABASE_URL` | no |
| Backend | `SUPABASE_SECRET_KEY` | **yes** |
| Backend | `NEBIUS_API_KEY` | **yes** |
| Backend | `NEBIUS_BASE_URL`, `NEBIUS_MODEL` | no |
| Backend | `PORT`, `CORS_ORIGIN`, `MAX_UPLOAD_MB`, `SUPABASE_STORAGE_BUCKET`, `DEV_FIXTURE_AI` | no |
| Frontend | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | no (public) |

## Security

- `SUPABASE_SECRET_KEY` and `NEBIUS_API_KEY` are read only by the backend. The browser never
  calls Nebius, and only ever holds the Supabase publishable key.
- Anything prefixed `VITE_` is compiled into the public bundle; only the three variables above
  belong there.
- `.env` files are git-ignored; only value-free `.env.example` files are committed.
- Row Level Security is enabled on every table. Signed-in users can read only their own work
  orders' rows; there are no client-side write policies, so evidence, decisions and the audit
  trail can only be written by the backend.
- The API reports configuration as modes and booleans, never values, and does not log keys.
- Uploads are size-limited, type-checked against the declared evidence kind, and hashed
  (SHA-256) at upload for the audit trail.

## Deployment

**Backend → Render.** Create a Blueprint from `render.yaml` and fill in the secret values in the
dashboard. Set `CORS_ORIGIN` to the Vercel URL.

**Frontend → Vercel.** Import the repo, set the Root Directory to `frontend` (framework preset:
Vite), and set the three `VITE_*` variables.

## Not built yet

- Live Nebius/Nemotron verification (blocked on the API key) and prompt tuning against real output
- Audio transcription (audio and video soundtracks are "attached but not inspected") and OCR for
  scanned PDFs. Only NVIDIA Nemotron via Nebius may be used, so both wait for a Nemotron model
  that accepts audio or page images to be confirmed on Token Factory
