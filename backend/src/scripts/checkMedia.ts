import { checkMedia } from '../media/selfCheck.js';

// Verifies video frame sampling (ffmpeg) and PDF text extraction on this machine:
// `npm run check:media`. Render runs it during the build, so a deploy without a
// working ffmpeg fails loudly instead of silently skipping video evidence.

const { video, pdf } = await checkMedia();
for (const [label, check] of [['video (ffmpeg)', video], ['pdf (unpdf)', pdf]] as const) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${label} — ${check.detail}`);
}
process.exitCode = video.ok && pdf.ok ? 0 : 1;
