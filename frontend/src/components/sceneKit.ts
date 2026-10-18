// Shared by the 3D scenes (landing hero and work-order graph): theme colours and the
// canvas-drawn textures. Only imported from the lazily loaded 3D chunk.
import { CanvasTexture } from 'three';
import type { EvidenceIcon } from '../lib/verificationGraph';

export const TAU = Math.PI * 2;
export const NV_GREEN = '#76b900';
export const AMBER = '#f5a524';
export const BACKGROUND = '#05070c';
/** A resumed tab must not make anything jump; slow devices still keep up. */
export const MAX_DELTA = 0.1;

/** A white radial falloff, tinted by the material colour. */
export function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

/** Line icons for evidence, drawn once on a canvas: a photo, a video, a document, audio. */
export function iconTexture(kind: EvidenceIcon) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  if (c) {
    c.strokeStyle = '#f1f5f9';
    c.fillStyle = '#f1f5f9';
    c.lineWidth = 7;
    c.lineJoin = c.lineCap = 'round';
    c.beginPath();
    if (kind === 'photo') {
      c.roundRect(14, 26, 100, 76, 12);
      c.stroke();
      c.beginPath();
      c.moveTo(24, 92);
      c.lineTo(52, 60);
      c.lineTo(72, 80);
      c.lineTo(86, 66);
      c.lineTo(104, 92);
      c.stroke();
      c.beginPath();
      c.arc(88, 46, 8, 0, TAU);
      c.fill();
    } else if (kind === 'video') {
      c.roundRect(14, 26, 100, 76, 12);
      c.stroke();
      c.beginPath();
      c.moveTo(54, 46);
      c.lineTo(82, 64);
      c.lineTo(54, 82);
      c.closePath();
      c.fill();
    } else if (kind === 'audio') {
      // A waveform.
      [24, 44, 64, 84, 104].forEach((x, k) => {
        const half = [14, 30, 44, 26, 12][k]!;
        c.moveTo(x, 64 - half);
        c.lineTo(x, 64 + half);
      });
      c.stroke();
    } else {
      c.moveTo(34, 14);
      c.lineTo(78, 14);
      c.lineTo(98, 34);
      c.lineTo(98, 114);
      c.lineTo(34, 114);
      c.closePath();
      c.stroke();
      for (const y of [52, 70, 88]) {
        c.beginPath();
        c.moveTo(48, y);
        c.lineTo(84, y);
        c.stroke();
      }
    }
  }
  return new CanvasTexture(canvas);
}
