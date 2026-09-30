"""Build matching PDF editions of the three project Markdown documents.

Run from any directory: python scripts/build-docs.py
Requires ReportLab. Optional QA uses pypdf and pdfplumber separately.
The deliberately small parser supports the constructs used in these documents.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import quote, urlparse

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, HRFlowable, PageBreak, PageTemplate,
    Paragraph, Table, TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
DOCS = {
    "README.md": ("Project overview", "Architecture, setup, and verification"),
    "HOW_TO_USE.md": ("How to use", "Setup, workflows, and recovery"),
    "PROJECT_SUMMARY.md": ("Project summary", "Portfolio preparation edition"),
}
INK = colors.HexColor("#172D3B")
TEAL = colors.HexColor("#0B686B")
MUTED = colors.HexColor("#536574")
LINE = colors.HexColor("#D8E3E7")
PALE = colors.HexColor("#F0F5F6")
PAGE_W, PAGE_H = A4
MARGIN = 45
WIDTH = PAGE_W - MARGIN * 2


def register_fonts():
    candidates = [
        (Path("C:/Windows/Fonts"), ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"), "consola.ttf"),
        (Path("/usr/share/fonts/truetype/dejavu"), ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"), "DejaVuSansMono.ttf"),
    ]
    for folder, files, mono in candidates:
        if all((folder / f).exists() for f in (*files, mono)):
            for name, filename in zip(("Body", "BodyBold", "BodyItalic", "BodyBoldItalic"), files):
                pdfmetrics.registerFont(TTFont(name, str(folder / filename)))
            pdfmetrics.registerFont(TTFont("Mono", str(folder / mono)))
            pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyBold", italic="BodyItalic", boldItalic="BodyBoldItalic")
            return "Body", "BodyBold", "Mono"
    return "Helvetica", "Helvetica-Bold", "Courier"


BODY, BOLD, MONO = register_fonts()
styles = getSampleStyleSheet()
styles.add(ParagraphStyle("Text", fontName=BODY, fontSize=9.5, leading=14.3,
                          textColor=INK, spaceAfter=7, splitLongWords=True,
                          allowWidows=0, allowOrphans=0))
styles.add(ParagraphStyle("DocTitle", parent=styles["Text"], fontName=BOLD,
                          fontSize=27, leading=32, spaceBefore=7, spaceAfter=8,
                          textColor=INK, keepWithNext=True))
styles.add(ParagraphStyle("Section", parent=styles["Text"], fontName=BOLD,
                          fontSize=14.5, leading=19, textColor=TEAL,
                          spaceBefore=14, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle("Subsection", parent=styles["Text"], fontName=BOLD,
                          fontSize=11, leading=15, spaceBefore=9, spaceAfter=5,
                          keepWithNext=True))
styles.add(ParagraphStyle("Deck", parent=styles["Text"], fontSize=10.5,
                          leading=15, textColor=MUTED, spaceAfter=12))
styles.add(ParagraphStyle("Cell", parent=styles["Text"], fontSize=8.7,
                          leading=12.3, spaceAfter=0, allowWidows=1, allowOrphans=1))
styles.add(ParagraphStyle("CellHead", parent=styles["Cell"], fontName=BOLD,
                          textColor=colors.white))
styles.add(ParagraphStyle("CodeBlock", parent=styles["Text"], fontName=MONO,
                          fontSize=8, leading=11.3, spaceAfter=0,
                          allowWidows=1, allowOrphans=1))
styles.add(ParagraphStyle("ListText", parent=styles["Text"], leftIndent=17,
                          firstLineIndent=0, bulletIndent=0, spaceAfter=5,
                          bulletFontName=BODY, bulletFontSize=9.3))
styles.add(ParagraphStyle("QuoteText", parent=styles["Text"], leftIndent=12,
                          rightIndent=10, borderColor=TEAL, borderWidth=0.7,
                          borderPadding=11, spaceBefore=16, spaceAfter=19))


def pdf_link(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme or url.startswith("#"):
        return url
    target = (ROOT / parsed.path).resolve()
    if not target.is_file():
        raise ValueError(f"Broken local Markdown link: {url}")
    if parsed.path in DOCS:
        return Path(parsed.path).with_suffix(".pdf").name
    # PDF lives two folders beneath root; retain references to source evidence.
    return "../../" + quote(parsed.path.replace("\\", "/"), safe="/")


INLINE = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))")


def inline(text: str) -> str:
    out = []
    for part in INLINE.split(text):
        if part.startswith("`") and part.endswith("`"):
            out.append(f'<font name="{MONO}" size="8.5">{html.escape(part[1:-1])}</font>')
        elif part.startswith("**") and part.endswith("**"):
            out.append("<b>" + html.escape(part[2:-2]) + "</b>")
        elif part.startswith("[") and re.fullmatch(r"\[[^\]]+\]\([^)]+\)", part):
            match = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", part)
            label, url = match.groups()
            out.append(f'<a href="{html.escape(pdf_link(url), quote=True)}" color="#0B686B"><u>{html.escape(label)}</u></a>')
        else:
            out.append(html.escape(part))
    return "".join(out)


def paragraph(text: str, style: str = "Text", **kwargs):
    return Paragraph(inline(text), styles[style], **kwargs)


def table_rows(lines):
    rows = [[c.strip() for c in line.strip().strip("|").split("|")] for line in lines]
    if len(rows) < 2 or not all(re.fullmatch(r":?-+:?", c.strip()) for c in rows[1]):
        raise ValueError("Malformed Markdown table")
    return [rows[0], *rows[2:]]


def make_table(lines):
    rows = table_rows(lines)
    ncols = len(rows[0])
    if any(len(row) != ncols for row in rows):
        raise ValueError("Mismatched Markdown table cells")
    if ncols == 2:
        widths = [WIDTH * 0.30, WIDTH * 0.70]
    elif ncols == 3:
        if "ports" in " ".join(rows[0]).lower():
            widths = [WIDTH * 0.29, WIDTH * 0.18, WIDTH * 0.53]
        elif "Browser address" in rows[0]:
            widths = [WIDTH * 0.40, WIDTH * 0.40, WIDTH * 0.20]
        else:
            widths = [WIDTH * 0.34, WIDTH * 0.18, WIDTH * 0.48]
    else:
        widths = [WIDTH / ncols] * ncols
    cells = [[paragraph(c, "CellHead" if i == 0 else "Cell") for c in row] for i, row in enumerate(rows)]
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT", spaceBefore=3, spaceAfter=11)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALE, colors.white]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, TEAL),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
    ]))
    return table


def code_block(lines):
    # A paragraph per line preserves whitespace and allows long commands to wrap.
    cells = []
    for line in lines:
        escaped = html.escape(line).replace(" ", "&#160;") or "&#160;"
        cells.append(Paragraph(escaped, styles["CodeBlock"]))
    box = Table([[cells]], colWidths=[WIDTH], hAlign="LEFT", spaceBefore=2, spaceAfter=11)
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return box


def parse(source: str, subtitle: str, source_name: str):
    lines = source.splitlines()
    story = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            if i == len(lines):
                raise ValueError("Unclosed code fence")
            story.append(code_block(block))
            i += 1
            continue
        if line.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            story.append(make_table(block))
            continue
        heading = re.match(r"^(#{1,3}) (.+)$", line)
        if heading:
            level, title = len(heading[1]), heading[2]
            if source_name == "PROJECT_SUMMARY.md" and title in {"Architecture and skills demonstrated", "Recorded verification"}:
                story.append(PageBreak())
            story.append(paragraph(title, {1: "DocTitle", 2: "Section", 3: "Subsection"}[level]))
            if level == 1:
                story.append(paragraph(subtitle + " | 29 September 2026", "Deck"))
                story.append(HRFlowable(width=WIDTH, thickness=1.4, color=TEAL, spaceAfter=12))
            i += 1
            continue
        bullet = re.match(r"^(?:([-*])|([0-9]+)\.) (.+)$", line)
        if bullet:
            label = (bullet[2] + ".") if bullet[2] else "\u2022"
            story.append(paragraph(bullet[3], "ListText", bulletText=label))
            i += 1
            continue
        if line.startswith("> "):
            story.append(paragraph(line[2:], "QuoteText"))
            i += 1
            continue
        block = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|> |[-*] |\d+\. )", lines[i].strip()):
            block.append(lines[i].strip())
            i += 1
        item = paragraph(" ".join(block))
        if block[-1].endswith(":"):
            item.keepWithNext = True
        story.append(item)
    return story


class Document(BaseDocTemplate):
    def __init__(self, path, label, source_name):
        super().__init__(str(path), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=53, bottomMargin=48, title=f"Geospatial Web Lab | {label}",
                         author="Geospatial Web Lab", subject=label,
                         pageCompression=1)
        self.label = label
        self.source_name = source_name
        self.heading_count = 0
        frame = Frame(MARGIN, 48, WIDTH, PAGE_H - 101,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="main", frames=frame, onPage=self.decorate))

    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(TEAL)
        canvas.setFont(BOLD, 8)
        canvas.drawString(MARGIN, PAGE_H - 30, "GEOSPATIAL WEB LAB")
        canvas.setFillColor(MUTED)
        canvas.setFont(BODY, 8)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 30, self.label)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, 35, PAGE_W - MARGIN, 35)
        canvas.setFont(BODY, 7.5)
        canvas.drawString(MARGIN, 23, f"Source: {self.source_name} | Documentation edition 2026-09-29")
        canvas.drawRightString(PAGE_W - MARGIN, 23, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in {"DocTitle", "Section", "Subsection"}:
            key = f"heading-{self.heading_count}"
            self.heading_count += 1
            self.canv.bookmarkPage(key)
            level = {"DocTitle": 0, "Section": 1, "Subsection": 2}[flowable.style.name]
            self.canv.addOutlineEntry(flowable.getPlainText(), key, level=level, closed=False)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, (label, subtitle) in DOCS.items():
        source = (ROOT / filename).read_text(encoding="utf-8-sig")
        output = OUTPUT / Path(filename).with_suffix(".pdf")
        Document(output, label, filename).build(parse(source, subtitle, filename))
        print(f"Created {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
