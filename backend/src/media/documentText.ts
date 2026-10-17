import { extractPdfText, MAX_TEXT_CHARS } from './pdfText.js';

export type DocumentTextResult =
  | { ok: true; text: string; pages: number | null; truncated: boolean }
  | { ok: false; reason: string };

/** Text of an SOP/manual: a PDF's text layer, or a plain-text file. Capped at MAX_TEXT_CHARS. */
export async function extractDocumentText(data: Buffer, mimeType: string): Promise<DocumentTextResult> {
  if (mimeType === 'application/pdf') {
    const pdf = await extractPdfText(data);
    return pdf.ok
      ? { ok: true, text: pdf.text, pages: pdf.pages, truncated: pdf.truncated }
      : { ok: false, reason: `This PDF has ${pdf.reason}.` };
  }
  if (mimeType.startsWith('text/')) {
    const text = data.toString('utf8').trim();
    if (!text) return { ok: false, reason: 'The file is empty.' };
    return { ok: true, text: text.slice(0, MAX_TEXT_CHARS), pages: null, truncated: text.length > MAX_TEXT_CHARS };
  }
  return { ok: false, reason: `Unsupported file type ${mimeType}: upload a PDF or a plain-text file.` };
}
