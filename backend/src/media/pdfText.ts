import { extractText, getDocumentProxy } from 'unpdf';

export const MAX_TEXT_CHARS = 20_000;

export type PdfTextResult =
  | { ok: true; text: string; pages: number; truncated: boolean }
  /** Unreadable PDF, or a scan with no text layer. The file stays "attached but not inspected". */
  | { ok: false; reason: string; pages: number | null };

/**
 * Extracts the text layer of a PDF, capped at `maxChars`. There is no OCR: a
 * scanned PDF has no text layer, so it is reported as not extractable rather than
 * guessed at.
 */
export async function extractPdfText(data: Buffer, maxChars = MAX_TEXT_CHARS): Promise<PdfTextResult> {
  let pages: number | null = null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const result = await extractText(pdf, { mergePages: true });
    pages = result.totalPages;
    const text = result.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length === 0) {
      return { ok: false, reason: 'no text layer (likely a scanned document; OCR is not available)', pages };
    }
    return { ok: true, text: text.slice(0, maxChars), pages, truncated: text.length > maxChars };
  } catch (error) {
    return { ok: false, reason: `could not be read as a PDF (${(error as Error)?.message ?? 'unknown error'})`, pages };
  }
}
