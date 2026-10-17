import type { AiMode, Evidence } from '../types';

export interface Inspection {
  /** What the AI receives from this file. */
  summary: string;
  /** What it does not see. Null when nothing is withheld. */
  notInspected: string | null;
  tone: 'ok' | 'partial' | 'none';
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Mirrors what backend/src/ai/nebiusProvider.ts sends to the model, so the viewer
 * never suggests the AI saw more than it did.
 */
export function describeInspection(item: Pick<Evidence, 'mimeType' | 'sizeBytes'>, mode: AiMode | null): Inspection {
  if (mode === 'dev-fixture') {
    return {
      summary: 'DEV fixture: no AI opens this file. Only the fact that a file of this kind is attached is used.',
      notInspected: 'The entire content.',
      tone: 'none',
    };
  }
  const { mimeType, sizeBytes } = item;
  if (mimeType.startsWith('image/')) {
    return sizeBytes <= MAX_IMAGE_BYTES
      ? { summary: 'The full image is sent to the model.', notInspected: null, tone: 'ok' }
      : { summary: 'Not sent: images over 5 MB are not inspected.', notInspected: 'The entire image.', tone: 'none' };
  }
  if (mimeType === 'application/pdf') {
    return {
      summary: 'The PDF’s text layer (first 20,000 characters) is sent to the model.',
      notInspected: 'Images and drawings in the PDF, text beyond 20,000 characters, and scanned pages without a text layer.',
      tone: 'partial',
    };
  }
  if (mimeType.startsWith('text/')) {
    return {
      summary: 'The text (first 20,000 characters) is sent to the model.',
      notInspected: sizeBytes > 20_000 ? 'Text beyond the first 20,000 characters.' : null,
      tone: sizeBytes > 20_000 ? 'partial' : 'ok',
    };
  }
  if (mimeType.startsWith('video/')) {
    return {
      summary: 'Up to 8 still frames (about one every 2 seconds, spread across long clips) are sent, each with its timestamp.',
      notInspected: 'What happens between frames, and the soundtrack.',
      tone: 'partial',
    };
  }
  if (mimeType.startsWith('audio/')) {
    return { summary: 'Not inspected: audio transcription is not available.', notInspected: 'The entire recording.', tone: 'none' };
  }
  return { summary: 'Not inspected: unsupported file type.', notInspected: 'The entire file.', tone: 'none' };
}
