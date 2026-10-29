import type { ReadinessReport, SystemStatus } from '../types.js';

// Smoke-tests a deployment: `npm run smoke -- <backend-url> <frontend-url>`.
// Uses only public endpoints, so it needs no keys and can never print one.

const [backendArg, frontendArg] = process.argv.slice(2);
if (!backendArg || !frontendArg) {
  console.error('Usage: npm run smoke -- <backend-url> <frontend-url>');
  console.error('  e.g. npm run smoke -- https://evidenceloop-api.onrender.com https://evidenceloop.vercel.app');
  process.exit(2);
}
const backend = backendArg.replace(/\/+$/, '');
const frontend = frontendArg.replace(/\/+$/, '');
const origin = new URL(frontend).origin;

/** Render's free tier sleeps when idle and takes up to about a minute to wake. */
const WAKE_DEADLINE_MS = 120_000;

interface Row {
  check: string;
  ok: boolean;
  detail: string;
}
const rows: Row[] = [];
const record = (check: string, ok: boolean, detail: string) => rows.push({ check, ok, detail });

async function get(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
}

async function wakeBackend(): Promise<boolean> {
  const started = Date.now();
  let lastError = '';
  process.stdout.write('Waking up the backend (Render free tier can take ~1 minute)');
  while (Date.now() - started < WAKE_DEADLINE_MS) {
    try {
      const res = await get(`${backend}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        process.stdout.write('\n');
        record('backend /api/health', body.status === 'ok', `HTTP ${res.status}, ${Math.round((Date.now() - started) / 1000)}s`);
        return body.status === 'ok';
      }
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  process.stdout.write('\n');
  record('backend /api/health', false, `not reachable within ${WAKE_DEADLINE_MS / 1000}s (${lastError})`);
  return false;
}

/** The keep-alive target an external pinger calls so the free Render instance does not sleep. */
async function checkPing() {
  try {
    const res = await get(`${backend}/health/ping`);
    record('keep-alive /health/ping', res.ok && (await res.text()) === 'ok', `HTTP ${res.status}`);
  } catch (error) {
    record('keep-alive /health/ping', false, (error as Error).message);
  }
}

async function checkSystem() {
  try {
    const res = await get(`${backend}/api/system`);
    const system = (await res.json()) as SystemStatus;
    record('Nemotron configured', system.ai.mode === 'nebius', `ai mode: ${system.ai.mode}${system.ai.model ? ` (${system.ai.model})` : ''}`);
    record(
      'Nemotron live test',
      system.ai.live.state === 'connected',
      `${system.ai.live.state}${system.ai.live.detail ? ` — ${system.ai.live.detail}` : ''}`,
    );
    record('Supabase persistence + auth', system.persistence === 'supabase' && system.auth === 'supabase', `persistence: ${system.persistence}, auth: ${system.auth}`);
  } catch (error) {
    record('/api/system', false, (error as Error).message);
  }
}

async function checkReadiness() {
  try {
    const res = await get(`${backend}/api/health/ready`);
    if (res.status === 404) {
      record('/api/health/ready', false, 'endpoint missing: the deployed backend is older than this script');
      return;
    }
    const { checks } = (await res.json()) as ReadinessReport;
    record('Supabase database reachable', checks.database.ok, checks.database.detail);
    record('storage bucket exists', checks.storage.ok, checks.storage.detail);
    record('video frames (ffmpeg)', checks.video.ok, checks.video.detail);
    record('PDF text (unpdf)', checks.pdf.ok, checks.pdf.detail);
  } catch (error) {
    record('/api/health/ready', false, (error as Error).message);
  }
}

async function checkCors() {
  try {
    // The preflight a signed-in browser sends before an authenticated JSON POST.
    const res = await get(`${backend}/api/work-orders`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    record(
      'CORS allows the frontend origin',
      allowed === origin || allowed === '*',
      allowed ? `allow-origin: ${allowed}` : `no allow-origin header for ${origin}: add it to CORS_ORIGIN on Render`,
    );
  } catch (error) {
    record('CORS allows the frontend origin', false, (error as Error).message);
  }
}

async function checkFrontend() {
  try {
    const res = await get(`${frontend}/`);
    const html = await res.text();
    record('frontend loads', res.ok && html.includes('<div id="root"'), `HTTP ${res.status}`);

    // A deep link must return the SPA, not a 404 (frontend/vercel.json rewrites).
    const deep = await get(`${frontend}/work-orders/smoke-test`);
    const deepHtml = await deep.text();
    record('SPA deep link (vercel.json)', deep.ok && deepHtml.includes('<div id="root"'), `HTTP ${deep.status} for /work-orders/smoke-test`);

    // The bundle must be built with VITE_API_BASE_URL pointing at this backend.
    const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    if (!script) {
      record('frontend points at backend', false, 'no script tag found in index.html');
      return;
    }
    const bundle = await (await get(new URL(script, `${frontend}/`).href)).text();
    record(
      'frontend points at backend',
      bundle.includes(backend),
      bundle.includes(backend) ? 'VITE_API_BASE_URL matches' : 'backend URL not in the bundle: set VITE_API_BASE_URL (no trailing slash) and redeploy',
    );
  } catch (error) {
    record('frontend', false, (error as Error).message);
  }
}

if (await wakeBackend()) {
  await Promise.all([checkPing(), checkSystem(), checkReadiness(), checkCors()]);
}
await checkFrontend();

const width = Math.max(...rows.map((row) => row.check.length));
console.log(`\nEvidenceLoop smoke test\n  backend:  ${backend}\n  frontend: ${frontend}\n`);
for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.check.padEnd(width)}  ${row.detail}`);
const failed = rows.filter((row) => !row.ok).length;
console.log(`\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`);
process.exitCode = failed === 0 ? 0 : 1;
