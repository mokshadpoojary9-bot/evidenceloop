# EvidenceLoop — project instructions

**"Prove the work. Don't just trust the photo."**
Built for the Nebius × NVIDIA Global AI Hackathon.
Repository: https://github.com/mokshadpoojary9-bot/evidenceloop.git (branch `main`).

EvidenceLoop is an agentic multimodal evidence-verification application. It determines whether
photos, videos, documents and other evidence actually *prove* that real-world work requirements
were completed. It is not an image classifier. The core question is always:
"Does the available evidence actually prove the requirement?"

## Workflow rules (mandatory)

1. **Inspect first.** Before modifying anything, look at the repository, `git status`, recent
   commits, the architecture, the code and the tests.
2. **Preserve working implementation.** Do not rebuild from scratch, start a new app, or
   duplicate features that already exist. Implement only what is missing.
3. **Commit and push completed milestones automatically** to `origin/main`, without asking for
   approval each time. A milestone is a meaningful, finished, passing unit of work.
4. **Before every commit:** inspect the diff, check for secrets, and run `npm run check`
   (lint → typecheck → tests → build). Never commit `.env` files, credentials or secrets.
5. **Never** force-push, delete branches, change the remote, overwrite existing work, or discard
   user changes. On a conflict or unexpected remote state: stop and explain.
6. **After each milestone, report:** commit hash, commit message, branch, push status, test results.
7. **Do not deploy** to Render or Vercel until the application is ready and tested locally.

## AI provider rules

- Production AI is **NVIDIA Nemotron via Nebius Token Factory**, and nothing else. Never add
  OpenAI, Anthropic, Gemini, Groq, OpenRouter, Hugging Face inference or any other provider.
- Nebius access is **pending**. Do not block development on it, do not invent credentials, and do
  not ask for the key.
- The Nemotron integration must stay explicitly marked **not configured / not verified** — in the
  code, the UI and the docs — until a genuine connection and a live inference test have succeeded.
- The DEV ONLY fixture (`backend/src/ai/devFixtureProvider.ts`) is not AI inference. Everything it
  produces must stay flagged `simulated` and labelled as such. It must never run in production.

## Platform rules

- **Supabase** for database, authentication and evidence storage. Do not introduce Firebase.
- Stack: Vite, React, TypeScript, Tailwind, React Router, Framer Motion, Three.js / React Three
  Fiber (frontend); Node.js, Express, TypeScript (backend). Avoid unnecessary rewrites.
- Deployment targets (later): frontend → Vercel, backend → Render.

## Secrets

- Backend only: `SUPABASE_SECRET_KEY`, `NEBIUS_API_KEY` (plus `SUPABASE_URL`, `NEBIUS_BASE_URL`,
  `NEBIUS_MODEL`).
- Browser may only have: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`.
- Never put secrets in source, logs, GitHub or documentation. When checking configuration, report
  whether a value is set — never the value.

## Verification principles (the product's contract)

1. Never invent evidence or claim to see something that is not present.
2. Separate direct observation from inference.
3. Every requirement gets an explicit status: `PROVEN`, `NOT_PROVEN`, `UNCERTAIN`,
   `CONTRADICTED` (or `ANALYZING` while a run is in flight).
4. `PROVEN` requires sufficient evidence; insufficient evidence is `NOT_PROVEN`. Never guess to
   make a task pass. Never fabricate confidence. Never hide uncertainty.
5. Detect contradictions. Identify exactly what evidence is missing and request the minimum,
   specific, actionable additional evidence.
6. New evidence triggers re-evaluation; previous AI conclusions are not trusted blindly.
7. Keep the chain: Requirement → Evidence → Observation → Reasoning → Decision.
8. `VERIFIED` requires every mandatory requirement to be sufficiently supported.
9. When evidence is insufficient, say exactly:
   "I cannot verify this requirement from the available evidence."
10. Never claim physical safety is guaranteed. EvidenceLoop assists verification and does not
    replace qualified inspectors or certification.

These are enforced in code by `backend/src/agent/policy.ts` and covered by tests. Changes that
weaken them need a very good reason.

## Demo scenario

Work order "Replace emergency light in Room 204" with six requirements: correct unit installed,
correct location, securely mounted, electrical connection completed, indicator functioning,
functional test completed. Missing proof leads to the request "Upload a 5–10 second video showing
the emergency light functional test."; uploading it re-analyzes the affected requirements.

## Orientation

- `npm run dev` — API on :4000, dashboard on :5173. `npm run check` — everything.
- Domain model: `backend/src/types.ts` (the frontend imports it via the `@domain` alias).
- The loop: `backend/src/agent/engine.ts`; guardrails: `agent/policy.ts`; request planning:
  `agent/planner.ts`; provider seam: `backend/src/ai/provider.ts`.
- Persistence: `backend/src/stores/` (Supabase, or a local unauthenticated fallback in
  `backend/.data/` that is refused in production). Schema and RLS: `supabase/schema.sql`.
- See `README.md` for architecture, setup and current status.
