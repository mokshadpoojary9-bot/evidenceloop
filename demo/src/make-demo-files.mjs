// Regenerates every file in demo/ from scratch:
//   node demo/src/make-demo-files.mjs
//
// Images: scenes.html (hand-written SVG) rendered by headless Microsoft Edge, then
// converted to JPEG by ffmpeg. Video: eight rendered frames joined by ffmpeg.
// SOPs: pdfkit, so every PDF has a real text layer. Nothing is downloaded.

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import PDFDocument from 'pdfkit';

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, '..');
const scenes = pathToFileURL(join(here, 'scenes.html')).href;
const work = mkdtempSync(join(tmpdir(), 'evidenceloop-demo-'));

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
if (!edge) throw new Error('Microsoft Edge not found; set EDGE_PATH.');

function render(scene, png) {
  execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${join(work, 'profile')}`,
    '--window-size=1280,960',
    `--screenshot=${png}`,
    `${scenes}#${scene}`,
  ], { stdio: 'ignore' });
}

const ffmpeg = (args) => execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', ...args]);

function photo(scene, out) {
  const png = join(work, `${scene}.png`);
  render(scene, png);
  ffmpeg(['-i', png, '-q:v', '3', out]);
  console.log(`  ${out}`);
}

function testVideo(out) {
  for (let t = 0; t < 8; t++) render(`room204-test-${t}`, join(work, `frame-${t}.png`));
  ffmpeg([
    '-framerate', '1', '-i', join(work, 'frame-%d.png'),
    '-vf', 'scale=960:720,fps=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
  console.log(`  ${out}`);
}

function sop(out, { code, title, scope, model, steps, notes }) {
  return new Promise((done, fail) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${code} ${title}`, Author: 'EvidenceLoop demo (fictional)' } });
    const stream = createWriteStream(out);
    stream.on('finish', done).on('error', fail);
    doc.pipe(stream);
    doc.fontSize(9).fillColor('#666').text('FICTIONAL SAMPLE SOP — created for the EvidenceLoop demo. Not a real procedure.');
    doc.moveDown(1.2).fontSize(18).fillColor('#000').text(`${code}: ${title}`);
    doc.moveDown(0.4).fontSize(11).text(scope);
    doc.moveDown(0.6).fontSize(11).text(`Specified unit: ${model}`, { underline: true });
    doc.moveDown(0.8).fontSize(13).text('Procedure');
    doc.moveDown(0.3).fontSize(11);
    steps.forEach((step, index) => doc.text(`${index + 1}. ${step}`, { paragraphGap: 4 }));
    doc.moveDown(0.8).fontSize(13).text('Evidence to record');
    doc.moveDown(0.3).fontSize(11);
    notes.forEach((note) => doc.text(`- ${note}`, { paragraphGap: 3 }));
    doc.moveDown(1.2).fontSize(9).fillColor('#666').text(
      'This procedure supports verification. It does not replace qualified inspection or certification.',
    );
    doc.end();
  });
}

const dir = (name) => {
  const path = join(demoDir, name);
  mkdirSync(path, { recursive: true });
  return path;
};

try {
  const room = dir('room-204');
  const corridor = dir('corridor-b');
  const lab = dir('lab-3');
  console.log('Rendering images and video…');
  for (const [scene, folder] of [['room204', room], ['corridorb', corridor], ['lab3', lab]]) {
    for (const shot of ['before', 'after', 'closeup']) photo(`${scene}-${shot}`, join(folder, `${shot}.jpg`));
  }
  testVideo(join(room, 'functional-test.mp4'));

  console.log('Writing SOP PDFs…');
  await sop(join(room, 'sop-emergency-light.pdf'), {
    code: 'SOP EL-07',
    title: 'Emergency light replacement',
    scope: 'Applies to wall-mounted maintained emergency luminaires above exit doors, including Room 204.',
    model: 'Lumora EL-2040 (3 h maintained, LED). No other model may be installed.',
    steps: [
      'Isolate the lighting circuit and remove the failed unit.',
      'Install the Lumora EL-2040 at the position of the unit it replaces, above the door.',
      'Fix the unit flush to the wall with all four fixings.',
      'Connect the supply through a 20 mm conduit gland; terminate and close the terminal cover.',
      'Restore the supply and confirm the green CHARGE indicator is lit.',
      'Press TEST: the unit must illuminate on battery. Record a 5-10 second video of the test.',
    ],
    notes: [
      'Before photo of the old unit with the room sign visible.',
      'After photo from the same position, model label and indicator visible.',
      'Close-up of the fixings and supply entry.',
      'Functional test video (5-10 s).',
    ],
  });
  await sop(join(corridor, 'sop-extinguisher-bracket.pdf'), {
    code: 'SOP FX-03',
    title: 'Fire extinguisher bracket installation',
    scope: 'Applies to wall brackets for 6 kg portable extinguishers at marked corridor positions, including Corridor B.',
    model: 'Brackwell BX-6 wall bracket.',
    steps: [
      'Install a Brackwell BX-6 bracket at the marked position in Corridor B.',
      'Fix the bracket to the wall with all four fixings.',
      'Mount the bracket so the extinguisher handle is between 1.0 m and 1.2 m above the floor.',
      'Seat the extinguisher in both cradles.',
      'Fit the FIRE EXTINGUISHER sign directly above the bracket.',
    ],
    notes: [
      'Before photo of the marked position with the corridor sign visible.',
      'After photo showing extinguisher, bracket and sign.',
      'Close-up of the fixings with a tape measure showing the handle height.',
    ],
  });
  await sop(join(lab, 'sop-ceiling-fan.pdf'), {
    code: 'SOP CF-12',
    title: 'Ceiling fan replacement',
    scope: 'Applies to ceiling fans in teaching laboratories, including Lab 3.',
    model: 'Aerivo CF-52 (52 in, 230 V). Smaller models such as the CF-48 are not approved for laboratories.',
    steps: [
      'Isolate the circuit and remove the existing fan.',
      'Install the Aerivo CF-52 on the existing ceiling box in Lab 3.',
      'Fix the canopy bracket to the ceiling box with both fixings.',
      'Connect line, neutral and earth at the terminal block and close the canopy.',
      'Restore the supply and run the fan at every speed setting; record a short video.',
    ],
    notes: [
      'Before photo of the existing fan with the LAB 3 sign visible.',
      'After photo with the model label on the motor housing visible.',
      'Close-up of canopy fixings, wiring and label.',
      'Video of the fan running at each speed.',
    ],
  });
  console.log('Done.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
