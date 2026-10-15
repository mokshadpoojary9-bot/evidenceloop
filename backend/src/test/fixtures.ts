// Test-only helpers.

/**
 * Builds a valid single-font PDF with one page per entry. A page whose text is
 * empty has no text layer at all, like a scanned page.
 */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesObj = add(''); // filled in below
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds: number[] = [];
  for (const text of pages) {
    const escaped = text.replace(/[\\()]/g, (c) => `\\${c}`);
    const lines = escaped.split('\n');
    const stream = text
      ? `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join(' ')} ET`
      : '0 0 1 rg 72 600 200 100 re f'; // a filled rectangle: graphics, no text
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
