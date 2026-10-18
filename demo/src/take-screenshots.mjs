// Takes the README screenshots with headless Microsoft Edge over the DevTools protocol.
//
//   1. npm run seed:demo           (local mode: Supabase vars blank, DEV_FIXTURE_AI=true)
//   2. npm run dev                 (with VITE_SUPABASE_URL blank, so no sign-in is needed)
//   3. node demo/src/take-screenshots.mjs
//
// Writes docs/screenshots/*.png. Needs Node 22+ (global WebSocket). No extra packages.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const ROOM_204 = 'dec0de00-0000-4000-8000-000000000204';
const PORT = 9333;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');
mkdirSync(out, { recursive: true });

const edgePath = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
].find((candidate) => candidate && existsSync(candidate));
if (!edgePath) throw new Error('Microsoft Edge not found; set EDGE_PATH.');

const profile = mkdtempSync(join(tmpdir(), 'evidenceloop-shots-'));
const edge = spawn(edgePath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--hide-scrollbars',
  // Software WebGL, so the 3D scene renders without a GPU.
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function connect() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Edge is still starting.
    }
    await sleep(200);
  }
  throw new Error('Could not reach headless Edge.');
}

const socket = new WebSocket(await connect());
await new Promise((done) => socket.addEventListener('open', done, { once: true }));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((done, fail) => {
    const id = ++nextId;
    pending.set(id, (message) => (message.error ? fail(new Error(`${method}: ${message.error.message}`)) : done(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

async function open(path, settleMs) {
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 50 && (await evaluate('document.readyState')) !== 'complete'; i++) await sleep(200);
  await sleep(settleMs);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  console.log(`  docs/screenshots/${name}`);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await open('/', 6000);
  await shot('landing.png');

  await open('/dashboard', 3000);
  await shot('dashboard.png');

  // Taller, so the whole 3D verification graph is in frame under the header.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await open(`/work-orders/${ROOM_204}`, 8000);
  await shot('work-order.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const opened = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label^="View After photo"]');
    if (!button) return false;
    button.scrollIntoView({ block: 'center' });
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('No evidence thumbnail found on the work order page.');
  await sleep(2500);
  await shot('evidence-viewer.png');
} finally {
  // A graceful close lets Edge's helper processes exit and release the profile.
  const exited = new Promise((done) => edge.once('exit', done));
  await send('Browser.close').catch(() => edge.kill());
  await Promise.race([exited, sleep(5000)]);
  socket.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    console.warn(`  (could not remove the temporary Edge profile ${profile}; it is safe to delete)`);
  }
}
