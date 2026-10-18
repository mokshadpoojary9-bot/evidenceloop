# EvidenceLoop: 2-minute live demo

The exact click path for judges. Two steps (marked ⚡) use **real NVIDIA Nemotron via Nebius Token Factory**.
Everything the seed creates is simulated by the DEV fixture and is labelled
**"Simulated · dev fixture"** in the UI, so no Nemotron result is faked.

## Before you go on stage (5 minutes, once)

1. `backend/.env` has the Nebius key, model and Supabase values (as now). `DEV_FIXTURE_AI` makes no
   difference here: when Nebius is configured, Nebius always wins.
2. You need two accounts in the app: a **technician** (your normal sign-up) and a **reviewer**
   (sign up a second email, then make it a reviewer with the SQL one-liner in `CLAUDE.md`).
3. Seed the demo data for the technician:
   ```bash
   npm run seed:demo -- --owner technician@example.com
   ```
   You get three work orders, all marked *Simulated · dev fixture*:
   | Work order | State |
   | --- | --- |
   | Replace emergency light in Room 204 | 4 of 6 proven, 1 open request for the functional-test video. **The live demo.** |
   | Install fire extinguisher bracket, Corridor B | VERIFIED, with a complete loop in its audit trail (request → answer → re-analysis) |
   | Replace ceiling fan, Lab 3 | CONTRADICTED: the after photo shows an Aerivo CF-48, but the SOP requires the CF-52 |
4. `npm run dev`, then sign in as the technician at http://localhost:5173. Check that the sidebar
   says **Nemotron connected**. If it says *not verified*, the live test failed: run
   `npm run check:nebius` before going on stage.
5. Keep `demo/room-204/functional-test.mp4` ready in a file picker.
6. To start over after a rehearsal: `npm run seed:demo -- --reset`, then seed again.

> Local mode (no Supabase) works the same way: `npm run seed:demo` without `--owner`, and use the
> **Demo: Technician / Reviewer** switcher instead of two accounts. Stop the API before seeding in
> local mode.

## The click path (about 2 minutes)

| Time | Click | Say |
| --- | --- | --- |
| 0:00 | Open **http://localhost:5173**. The landing page shows the 3D evidence loop. | "A photo says something happened. EvidenceLoop checks whether the evidence actually *proves* each requirement." |
| 0:10 | **Open dashboard** | "One VERIFIED, one CONTRADICTED and one waiting for evidence. These three were seeded by our dev fixture and are labelled *simulated*." |
| 0:20 | Click **Replace emergency light in Room 204** | "Six requirements from the SOP. Four are proven, the indicator is uncertain and the functional test is not proven." |
| 0:30 | Scroll over the **3D verification graph**, then open requirement **6. Functional test completed** in the checklist | "Requirement → evidence → observation → reasoning → decision. Here: *I cannot verify this requirement from the available evidence.*" |
| 0:40 | **Re-run verification** ⚡ *Real Nemotron.* | "Now NVIDIA Nemotron looks at the photos and reads the SOP for real. The *simulated* label is replaced by the model name." |
| 0:55 | The run completes. Point at the open **evidence request**. | "It doesn't guess. It asks for the minimum proof: *Upload a 5–10 second video showing the emergency light functional test.*" |
| 1:05 | **Upload video** on that request → choose `demo/room-204/functional-test.mp4` ⚡ *Real Nemotron again.* | "New evidence triggers re-analysis of only the requirements it affects. Nemotron sees the frames: TEST pressed, the unit lights up on battery." |
| 1:25 | Status changes to **Verified**. Open requirement 6 and the video in the **evidence viewer**. | "Every decision cites its evidence, and video observations carry timestamps." |
| 1:35 | Open **Replace ceiling fan, Lab 3** → **Submit for review**. Sign in as the reviewer (local mode: switch to *Demo: Reviewer*) → **Reject** with a note, or **Approve**. | "AI never overrides a contradiction. A human decides. An approval is recorded as *Approved by reviewer (not AI-verified)*, never as VERIFIED." |
| 1:50 | Back on Room 204: **Export report** | "A PDF with the full chain and audit trail, ready for the inspector." |

### Why the reviewer step uses Lab 3

A **VERIFIED** work order needs no sign-off, and EvidenceLoop does not allow one: review is only for
contradicted or uncertain work. That is part of the product's contract, so the reviewer step is shown
on the contradicted Lab 3 order.

## Which steps use real Nemotron, and what they cost

- **0:40 Re-run verification** and **1:05 the video upload** each run Nemotron through Nebius Token
  Factory. It receives the images, the SOP text and, for the video, up to 8 still frames (about one
  every 2 s). Together
  they cost **a few cents**.
- Everything else (seeding, dashboard, graph, viewer, review, PDF export) makes no AI call.
- Rehearsals cost the same each time. Reset and re-seed between runs.

## If something goes wrong on stage

- **Nemotron doesn't reach VERIFIED.** That is the product working: it judged the evidence
  insufficient and says why. The sample images are drawn illustrations, not photographs, and a real
  model may judge them differently than the fixture did. Read out its reasoning and the new request.
  Corridor B shows what a completed loop looks like.
- **Nemotron not connected.** Seeded data still demonstrates the full UI, labelled *simulated*.
  Say so plainly.
- EvidenceLoop assists verification. It does not replace qualified inspectors or certification,
  and it does not guarantee physical safety.
