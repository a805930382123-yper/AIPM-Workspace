type PageKind = 'text' | 'scan' | 'vector' | 'blank';

/** A real PDF with raw RGB embedded image and vector commands, no fixture libraries. */
export function pdfFixture(pages: PageKind[], text = (page: number) => `Original page ${page} revenue 120`): Buffer {
  const bytes = (text: string) => Buffer.from(text, 'ascii');
  const stream = (dictionary: string, data: Buffer) =>
    Buffer.concat([bytes(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, bytes('\nendstream')]);
  const objects: Buffer[] = [
    bytes('<< /Type /Catalog /Pages 2 0 R >>'),
    bytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`),
    bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    stream(
      '/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8',
      Buffer.from([226, 47, 55, 30, 104, 210]),
    ),
  ];
  pages.forEach((kind, index) => {
    const content =
      kind === 'text'
        ? `BT /F1 14 Tf 20 150 Td (${text(index + 1).replace(/[()\\]/gu, '\\$&')}) Tj ET`
        : kind === 'scan'
          ? 'q 160 0 0 90 20 50 cm /Im0 Do Q'
          : kind === 'vector'
            ? '0.1 0.2 0.8 rg 25 25 24 105 re f 0.8 0.2 0.1 rg 75 25 24 60 re f 0.1 0.6 0.3 rg 125 25 24 135 re f'
            : '';
    objects.push(
      bytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
      ),
    );
    objects.push(stream('', bytes(content)));
  });
  const parts = [bytes('%PDF-1.4\n')];
  let cursor = parts[0].length;
  const offsets = objects.map((object, index) => {
    const entry = Buffer.concat([bytes(`${index + 1} 0 obj\n`), object, bytes('\nendobj\n')]);
    const offset = cursor;
    cursor += entry.length;
    parts.push(entry);
    return offset;
  });
  parts.push(
    bytes(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
