"""Create a timing fixture without modifying or rasterizing the source PDF."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter

root = Path(__file__).resolve().parents[2]
source = PdfReader(root / "691f9193faa81670cd1a6f07d497bf8d.pdf")
target = root / "tmp/pdfs/grid-first-100.pdf"
assert len(source.pages) >= 100
writer = PdfWriter()
for page in source.pages[:100]:
    writer.add_page(page)
target.parent.mkdir(parents=True, exist_ok=True)
with target.open("xb") as stream:
    writer.write(stream)
assert len(PdfReader(target).pages) == 100
print(f"100 original PDF pages; {target.stat().st_size} bytes; {target}")
