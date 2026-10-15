import { runLiveCheck } from '../ai/liveCheck.js';
import { env, isNebiusConfigured } from '../config/env.js';

// Verifies the live Nebius Token Factory + NVIDIA Nemotron connection: `npm run check:nebius`.
// Sends one small text request and one small image request. Never prints the key.

console.log(`NEBIUS_API_KEY    ${env.NEBIUS_API_KEY ? 'set' : 'MISSING'}`);
console.log(`NEBIUS_BASE_URL   ${env.NEBIUS_BASE_URL}`);
console.log(`NEBIUS_MODEL      ${env.NEBIUS_MODEL ?? 'MISSING'}`);
console.log(`configured        ${isNebiusConfigured ? 'yes' : 'no'}`);

if (!isNebiusConfigured) {
  console.log(
    '\nFAIL  Nebius is not configured. Set NEBIUS_API_KEY and NEBIUS_MODEL in backend/.env and run again.',
  );
  process.exit(1);
}

const result = await runLiveCheck({
  apiKey: env.NEBIUS_API_KEY!,
  baseUrl: env.NEBIUS_BASE_URL,
  model: env.NEBIUS_MODEL!,
});

const line = (label: string, probe: { ok: boolean; latencyMs: number; detail: string | null } | null) =>
  console.log(
    probe
      ? `${probe.ok ? 'OK  ' : 'FAIL'}  ${label.padEnd(15)} ${probe.latencyMs} ms${probe.detail ? ` — ${probe.detail}` : ''}`
      : `SKIP  ${label.padEnd(15)} (text request failed first)`,
  );

console.log('');
line('text', result.text);
line('image (vision)', result.image);

if (result.text.ok && result.image && !result.image.ok) {
  console.log(
    `\nThe model "${env.NEBIUS_MODEL}" answered text but not the image request, so it is not vision-capable` +
      ' (or rejected the image). EvidenceLoop needs to inspect photos and video frames: pick a vision Nemotron' +
      ' model (Nemotron Nano VL / Omni) in the Nebius Token Factory console and set NEBIUS_MODEL to its exact id.',
  );
}

const passed = result.text.ok && result.image?.ok === true;
console.log(passed ? '\nNebius check passed.' : '\nNebius check FAILED.');
process.exit(passed ? 0 : 1);
