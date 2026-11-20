/** A textual PDF with real page boundaries and a Unicode font map. */
export function textPdf(texts:string[]):Buffer {
  const utf=(s:string)=>[...s].map(x=>x.charCodeAt(0).toString(16).padStart(4,'0')).join('').toUpperCase();
  const codes=[...new Set(texts.join(''))].map(utf);
  const cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'+codes.length+' beginbfchar\n'+codes.map(x=>'<'+x+'> <'+x+'>').join('\n')+'\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const stream=(x:string)=>'<< /Length '+Buffer.byteLength(x)+' >>\nstream\n'+x+'\nendstream';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+texts.map((_,i)=>(6+i*2)+' 0 R').join(' ')+'] /Count '+texts.length+' >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>',stream(cmap)];
  for(const [i,t] of texts.entries()){
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(7+i*2)+' 0 R >>');
    const lines=t.match(/.{1,70}/gu)??[];
    objects.push(stream('BT /F1 10 Tf 14 TL 20 700 Td '+lines.map(line=>'<'+utf(line)+'> Tj').join(' T* ')+' ET'));
  }
  let data='%PDF-1.5\n';
  const offsets=[];
  for(const [i,obj] of objects.entries()){
    offsets.push(Buffer.byteLength(data));
    data+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';
  }
  const xref=Buffer.byteLength(data);
  return Buffer.from(data+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
}
