from pathlib import Path
from pypdf import PdfReader, PdfWriter
from docx import Document
import sys

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
source = Path(__file__).resolve().parents[1] / 'fixtures' / 'b03' / 'zh-report.pdf'
reader = PdfReader(source)
w = PdfWriter()
for p in reader.pages: w.add_page(p)
w.encrypt('independent-acceptance-password')
with (out / 'encrypted.pdf').open('wb') as f: w.write(f)
w = PdfWriter()
for p in reader.pages: w.add_page(p)
w.add_blank_page(width=595, height=842)
with (out / 'mixed.pdf').open('wb') as f: w.write(f)
d = Document(); d.add_paragraph('独立验收中文文档'); d.add_paragraph('库存周转 45 天。')
d.save(out / 'independent.docx')
Document().save(out / 'empty.docx')
print(out)
