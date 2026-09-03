from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).with_name("scanned-book.pdf")
WIDTH, HEIGHT = 1275, 1650


def font(size: int, bold: bool = False):
    name = "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"
    return ImageFont.truetype(name, size)


def page_image(title: str, paragraphs: list[str], diagram: bool = False) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(image)
    draw.text((100, 90), title, fill="#162033", font=font(50, True))
    y = 205
    for paragraph in paragraphs:
        words = paragraph.split()
        line = ""
        for word in words:
            candidate = f"{line} {word}".strip()
            if draw.textlength(candidate, font=font(27)) > WIDTH - 200:
                draw.text((100, y), line, fill="#26364d", font=font(27))
                y += 45
                line = word
            else:
                line = candidate
        draw.text((100, y), line, fill="#26364d", font=font(27))
        y += 90
    if diagram:
        box_y = 850
        colors = ["#dbeafe", "#fde68a", "#dcfce7"]
        labels = ["Observe", "Test", "Revise"]
        for index, (color, label) in enumerate(zip(colors, labels)):
            x = 115 + index * 390
            draw.rounded_rectangle((x, box_y, x + 270, box_y + 150), 24, fill=color, outline="#24354d", width=4)
            draw.text((x + 55, box_y + 52), label, fill="#172033", font=font(30, True))
            if index < 2:
                draw.line((x + 285, box_y + 75, x + 365, box_y + 75), fill="#24354d", width=8)
                draw.polygon([(x + 365, box_y + 75), (x + 335, box_y + 57), (x + 335, box_y + 93)], fill="#24354d")
        draw.text((100, 1080), "Figure 1. A small feedback loop for iterative learning.", fill="#44546a", font=font(24))
    draw.text((WIDTH - 150, HEIGHT - 90), title.split()[-1], fill="#68758a", font=font(20))
    return image


pages = [
    page_image(
        "Field Notes - 1",
        [
            "A reliable investigation begins by separating observation from explanation.",
            "Record what changed, identify the constraint, and avoid treating the first plausible story as proof.",
        ],
    ),
    page_image(
        "Field Notes - 2",
        [
            "Useful tests change one meaningful condition while preserving the rest of the situation.",
            "A failed test is evidence when its prediction was stated before the result was observed.",
        ],
        diagram=True,
    ),
    page_image(
        "Field Notes - 3",
        [
            "Revision is not erasure. Keep the earlier model, name the evidence that challenged it, and state the new boundary.",
            "The strongest explanation is the one that survives comparison with credible alternatives.",
        ],
    ),
]

pdf = canvas.Canvas(str(OUTPUT), pagesize=letter)
page_width, page_height = letter
for image in pages:
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    buffer.seek(0)
    pdf.drawInlineImage(Image.open(buffer), 0, 0, width=page_width, height=page_height)
    pdf.showPage()
pdf.save()
