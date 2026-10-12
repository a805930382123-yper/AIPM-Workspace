# B03 construction fixtures: real-format samples used by tests and HTTP self-check.
# Usage: python make-fixtures.py <output-dir>
# DOCX is written with python-docx; the text PDF is produced from that DOCX with the
# bundled LibreOffice kit (see docs/reports/B03-build.md). This script writes every
# other sample with raw bytes so no extension is faked for DOCX/PDF.
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from PIL import Image, ImageDraw

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
written = []


def write(name: str, data: bytes) -> None:
    path = out / name
    path.write_bytes(data)
    written.append((name, len(data)))


# --- Markdown: mixed CRLF/LF, leading and trailing whitespace kept verbatim -------
md = (
    "  \r\n"
    "# 渠道动销分析\r\n"
    "\r\n"
    "> B03 自检样本：本行与前后空白必须原样保留。\r\n"
    "\r\n"
    "第一段：门店动销率与分销覆盖的关系。\n"
    "第二行使用单独 LF 换行。\r\n"
    "---\r\n"
    "第三段：独立分隔线之后的内容仍是正文。\r\n"
    "\r\n"
    "- 要点一：周转天数\r\n"
    "- 要点二：SKU 宽度\r\n"
    "\r\n"
    "尾随空白保留：   \r\n"
    "  \n"
)
write("zh-report.md", md.encode("utf-8"))

# --- TXT: Chinese, leading blank lines, trailing blank line, mixed newlines -------
txt = (
    "  \n"
    "\n"
    "会议纪要（TXT 样本）\n"
    "主持人：王经理\n"
    "\r\n"
    "结论：\n"
    "1. 补货周期从 7 天缩短到 5 天\n"
    "2. 库存周转提升 12%\r\n"
    "\n"
    "末尾留白保留。  \n"
    "\n"
)
write("zh-notes.txt", txt.encode("utf-8"))

# --- TXT with UTF-8 BOM: BOM must be dropped, whitespace kept ---------------------
bom = "\ufeff带 BOM 的 TXT 样本\r\n第二行\n  \n"
write("bom-notes.txt", bom.encode("utf-8"))

# --- GBK encoded text: must fail loudly instead of decoding to mojibake -----------
write("gbk-notes.txt", "GBK 编码的中文内容：动销与库存。\r\n第二行。\n".encode("gbk"))

# --- Empty and whitespace-only text ----------------------------------------------
write("empty.txt", b"")
write("blank.txt", "   \r\n \t\n  \n".encode("utf-8"))

# --- Unsupported extension (real PNG, really not text) ---------------------------
image = Image.new("RGB", (320, 200), (245, 245, 245))
draw = ImageDraw.Draw(image)
draw.rectangle((20, 20, 300, 180), outline=(80, 80, 80), width=3)
draw.text((40, 90), "FMCG sample image", fill=(20, 20, 20))
image.save(out / "logo.png")
written.append(("logo.png", (out / "logo.png").stat().st_size))

# --- DOCX: real Word package written by python-docx ------------------------------
docx_paragraphs = [
    "经销商库存周转动销分析报告",
    "报告编号：FMCG-B03-001",
    "一、背景",
    "华东区经销商平均库存周转天数为 38 天，动销率 62%。",
    "二、结论",
    "建议将安全库存下调 10%，并每周复核补货节奏。",
]
document = Document()
document.add_heading("经销商库存周转动销分析报告", level=1)
for text in docx_paragraphs[1:]:
    document.add_paragraph(text)
# Explicit eastAsia font so Chinese glyphs are addressed, not left to font fallback.
for paragraph in document.paragraphs:
    for run in paragraph.runs:
        run.font.name = "Microsoft YaHei"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
docx_path = out / "zh-report.docx"
document.save(docx_path)
written.append(("zh-report.docx", docx_path.stat().st_size))

# --- Damaged DOCX: real package truncated before the zip central directory --------
docx_bytes = docx_path.read_bytes()
write("broken.docx", docx_bytes[:800])
assert docx_bytes[:2] == b"PK"

# --- Fake extension: Chinese plain text renamed to .docx -------------------------
fake_text = "这段内容是纯文本，不是 Word 文档。\r\n第二行。\n"
write("fake-docx.docx", fake_text.encode("utf-8"))

# --- Damaged PDF: PDF header then garbage, no xref/trailer -----------------------
write("broken.pdf", b"%PDF-1.7\n" + bytes(range(256)) * 2)

# --- Fake extension: plain text renamed to .pdf ---------------------------------
write("fake-pdf.pdf", fake_text.encode("utf-8"))

# --- Scanned-style PDF: one image page, no text layer ---------------------------
page = Image.new("RGB", (1240, 1754), (255, 255, 255))
page_draw = ImageDraw.Draw(page)
page_draw.rectangle((80, 80, 1160, 1674), outline=(120, 120, 120), width=4)
page_draw.text((120, 200), "SCANNED PAGE - IMAGE ONLY, NO TEXT LAYER", fill=(30, 30, 30))
page_draw.text((120, 240), "FMCG B03 fixture 2026", fill=(30, 30, 30))
page.save(out / "scan-image.pdf")
written.append(("scan-image.pdf", (out / "scan-image.pdf").stat().st_size))

for name, size in sorted(written):
    print(f"{name}\t{size}")
