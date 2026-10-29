import { CANNOT_VERIFY, DISCLAIMER } from '../types.js';

// What Verity knows about EvidenceLoop itself: the content of the About page, plus how the
// app is used. Kept short; it is sent with every question.

export const ABOUT_EVIDENCELOOP = `EvidenceLoop — "Prove the work. Don't just trust the photo."
EvidenceLoop checks whether photos, video and documents actually prove each requirement of a real-world work order, and asks for exactly what is missing. It is not an image classifier; the question is always "does the available evidence prove the requirement?".

The verification loop: work order → retrieve requirements → build checklist → analyze multimodal evidence → map evidence to requirements → check proof → detect uncertainty → detect contradictions → identify missing evidence → plan the minimum request → request evidence → new evidence → re-analyze → final verification → audit trail.

Principles:
- Proof, not classification: every requirement gets an explicit status — PROVEN, NOT_PROVEN, UNCERTAIN or CONTRADICTED (ANALYZING while a run is in flight). Insufficient evidence is never rounded up to a pass.
- Observation is not inference: each decision traces requirement → evidence → observation → reasoning → decision, keeping what was directly seen apart from what was concluded.
- Asks for the minimum: when proof is missing, the agent names exactly what is missing and requests the smallest additional evidence that would settle it.
- Guardrails in code: a verification policy checks every model answer; a claim that cites no real evidence is downgraded, and confidence is never invented.
When evidence is insufficient the agent says: "${CANNOT_VERIFY}"

Work order statuses: AWAITING_EVIDENCE (draft, not verified yet), ANALYZING, NEEDS_EVIDENCE (something cannot be verified yet), CONTRADICTED, VERIFIED (every mandatory requirement proven by evidence), IN_REVIEW (with a reviewer), APPROVED (a reviewer's human decision, never the same as VERIFIED), REJECTED.

How to use it:
- Technicians create work orders (from a template or an SOP/manual), upload evidence or take it with the in-app camera (Take photo / Record video), run verification, answer evidence requests, and submit contradicted or uncertain work orders for review.
- New evidence re-analyzes only the requirements it affects. Earlier conclusions are not trusted blindly.
- Reviewers (admins) work from the review queue: approve, reject or request more evidence, always with a note. Every step is in the audit trail.
- Video is inspected as still frames; audio is not transcribed; scanned PDFs without a text layer are attached but not inspected.
- AI: NVIDIA Nemotron on Nebius Token Factory (Nemotron Super VL verifies evidence; Nemotron Nano answers chat).

${DISCLAIMER}`;
