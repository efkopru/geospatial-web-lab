"""Build the illustrated feature report with portrait text and landscape figures.

Usage: python scripts/build-feature-report.py
       python scripts/build-feature-report.py --source report.md --output report.pdf

Requires ReportLab. Every Markdown image must occupy its own source line; its
alt text becomes the printed caption. Images stay local and retain their aspect
ratio. Headings H1-H3 become PDF bookmarks and internal-link destinations.
"""

from __future__ import annotations

import argparse
import html
import importlib.util
import os
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, HRFlowable, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Table, TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("geolab_document_helpers", ROOT / "scripts" / "build-docs.py")
HELPERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPERS)
BODY, BOLD, MONO = HELPERS.BODY, HELPERS.BOLD, HELPERS.MONO
INK, TEAL, MUTED, LINE, PALE = HELPERS.INK, HELPERS.TEAL, HELPERS.MUTED, HELPERS.LINE, HELPERS.PALE

MARGIN = 45
TOP = 56
BOTTOM = 45
PORTRAIT = A4
LANDSCAPE = landscape(A4)
TEXT_WIDTH = PORTRAIT[0] - 2 * MARGIN
FIGURE_WIDTH = LANDSCAPE[0] - 2 * MARGIN
FIGURE_HEIGHT = LANDSCAPE[1] - TOP - BOTTOM


def make_styles():
    text = ParagraphStyle("ReportText", fontName=BODY, fontSize=10.5, leading=15,
                          textColor=INK, spaceAfter=8, allowWidows=0,
                          allowOrphans=0, splitLongWords=True)
    return {
        "text": text,
        "title": ParagraphStyle("ReportTitle", parent=text, fontName=BOLD,
                                fontSize=28, leading=33, spaceBefore=6,
                                spaceAfter=13, keepWithNext=True),
        "section": ParagraphStyle("ReportSection", parent=text, fontName=BOLD,
                                  fontSize=17, leading=22, textColor=TEAL,
                                  spaceBefore=15, spaceAfter=9, keepWithNext=True),
        "subsection": ParagraphStyle("ReportSubsection", parent=text, fontName=BOLD,
                                     fontSize=12, leading=16, spaceBefore=12,
                                     spaceAfter=6, keepWithNext=True),
        "list": ParagraphStyle("ReportList", parent=text, leftIndent=19,
                               bulletIndent=1, bulletFontName=BODY,
                               bulletFontSize=10.5, spaceAfter=6),
        "cell": ParagraphStyle("ReportCell", parent=text, fontSize=9,
                               leading=12.5, spaceAfter=0, allowWidows=1,
                               allowOrphans=1),
        "cell_head": ParagraphStyle("ReportCellHead", parent=text, fontName=BOLD,
                                    fontSize=9, leading=12.5, textColor=colors.white,
                                    spaceAfter=0, allowWidows=1, allowOrphans=1),
        "code": ParagraphStyle("ReportCode", parent=text, fontName=MONO,
                               fontSize=8.5, leading=12, spaceAfter=0,
                               allowWidows=1, allowOrphans=1),
        "quote": ParagraphStyle("ReportQuote", parent=text, leftIndent=13,
                                rightIndent=10, borderColor=TEAL, borderWidth=0.6,
                                borderPadding=10, spaceBefore=10, spaceAfter=13),
        "figure_heading": ParagraphStyle("FigureHeading", parent=text,
                                         fontName=BOLD, fontSize=13,
                                         leading=17, textColor=TEAL,
                                         spaceAfter=0),
        "caption": ParagraphStyle("FigureCaption", parent=text, fontSize=9.5,
                                  leading=13, textColor=INK, spaceAfter=0,
                                  allowWidows=1, allowOrphans=1),
    }


STYLES = make_styles()
HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
IMAGE = re.compile(r'^!\[(.*)\]\((.+?)\s*\)$')
LIST = re.compile(r"^(?:([-*])|([0-9]+)\.)\s+(.+)$")
INLINE = re.compile(r"(`[^`]+`|\*\*.+?\*\*|\[[^\]]+\]\([^)]+\)|<https?://[^>]+>)")
BLOCK_START = re.compile(r"^(#{1,3}\s|\||```|>\s|[-*]\s|\d+\.\s|!\[|<!--|---\s*$)")


def plain_heading(text):
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.replace("**", "").replace("`", "").strip()


def heading_slug(text):
    # Match the common GitHub Markdown heading-anchor convention, including
    # punctuation removal, retained underscores, and duplicate suffixes.
    text = re.sub(r"[^\w\-\s]", "", plain_heading(text).lower())
    return re.sub(r"\s", "-", text)


class Markdown:
    def __init__(self, source_path, output_path):
        self.source_path = source_path
        self.output_path = output_path
        self.anchor_lines = {}
        self.anchors = set()
        self.figure_count = 0
        self.first_template = "portrait"

    def scan_anchors(self, lines):
        counts = {}
        in_fence = False
        for index, line in enumerate(lines):
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            heading = HEADING.match(line.strip()) if not in_fence else None
            if heading:
                base = heading_slug(heading[2])
                number = counts.get(base, 0)
                key = f"{base}-{number}" if number else base
                counts[base] = number + 1
                self.anchor_lines[index] = key
                self.anchors.add(key)

    def link(self, url):
        url = html.unescape(url.strip().strip("<>"))
        parsed = urlsplit(url)
        if parsed.scheme:
            if parsed.scheme.lower() not in {"http", "https", "mailto"}:
                raise ValueError(f"Unsupported link scheme: {url}")
            return url
        if parsed.netloc:
            return "https:" + url
        path = unquote(parsed.path).replace("\\", "/")
        target = (self.source_path.parent / path).resolve() if path else self.source_path
        if target == self.source_path and parsed.fragment:
            fragment = unquote(parsed.fragment)
            if fragment not in self.anchors:
                raise ValueError(f"Unknown internal heading: {url}")
            return "#" + fragment
        if not target.is_file():
            raise ValueError(f"Broken local link: {url}")
        relative = Path(os.path.relpath(target, self.output_path.parent)).as_posix()
        return urlunsplit(("", "", quote(relative, safe="/"), parsed.query, parsed.fragment))

    def inline(self, text):
        output = []
        for part in INLINE.split(text):
            if part.startswith("`") and part.endswith("`"):
                output.append(f'<font name="{MONO}" size="9">{html.escape(part[1:-1])}</font>')
            elif part.startswith("**") and part.endswith("**"):
                output.append("<b>" + self.inline(part[2:-2]) + "</b>")
            elif part.startswith("["):
                match = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", part)
                if match:
                    label, url = match.groups()
                    target = html.escape(self.link(url), quote=True)
                    output.append(f'<a href="{target}" color="#0B686B"><u>{self.inline(label)}</u></a>')
                else:
                    output.append(html.escape(part))
            elif part.startswith("<http") and part.endswith(">"):
                url = part[1:-1]
                target = html.escape(self.link(url), quote=True)
                output.append(f'<a href="{target}" color="#0B686B"><u>{html.escape(url)}</u></a>')
            else:
                output.append(html.escape(part))
        return "".join(output)

    def paragraph(self, text, style="text", **kwargs):
        return Paragraph(self.inline(text), STYLES[style], **kwargs)

    def table(self, lines):
        rows = HELPERS.table_rows(lines)
        columns = len(rows[0])
        if any(len(row) != columns for row in rows):
            raise ValueError("Mismatched Markdown table columns")
        heading = " ".join(rows[0]).lower()
        if columns == 2:
            ratios = [0.32, 0.68]
        elif columns == 3:
            ratios = [0.25, 0.36, 0.39] if "reporter" in heading else [0.25, 0.30, 0.45]
        elif columns == 4:
            ratios = [0.26, 0.16, 0.18, 0.40]
        else:
            ratios = [1 / columns] * columns
        cells = [[self.paragraph(cell, "cell_head" if index == 0 else "cell")
                  for cell in row] for index, row in enumerate(rows)]
        table = Table(cells, colWidths=[TEXT_WIDTH * ratio for ratio in ratios],
                      repeatRows=1, hAlign="LEFT", spaceBefore=4, spaceAfter=12)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), TEAL),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALE, colors.white]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE),
        ]))
        return table

    def code(self, lines):
        # One table row per source line permits page breaks within long blocks.
        cells = [[Paragraph(html.escape(line).replace(" ", "&#160;") or "&#160;",
                            STYLES["code"])] for line in lines]
        table = Table(cells or [[""]], colWidths=[TEXT_WIDTH], hAlign="LEFT",
                      spaceBefore=3, spaceAfter=10)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE),
            ("LEFTPADDING", (0, 0), (-1, -1), 11),
            ("RIGHTPADDING", (0, 0), (-1, -1), 11),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return table

    def parse(self, source):
        lines = source.splitlines()
        self.scan_anchors(lines)
        story = []
        mode = "portrait"
        section = "Illustrated feature report"

        def switch(wanted, new_page=False):
            nonlocal mode
            if wanted != mode:
                if not story:
                    self.first_template = wanted
                elif isinstance(story[-1], PageBreak):
                    # Reuse an explicit pending break instead of creating an
                    # empty page between it and an orientation change.
                    if len(story) > 1 and isinstance(story[-2], NextPageTemplate):
                        story[-2] = NextPageTemplate(wanted)
                    else:
                        story.insert(len(story) - 1, NextPageTemplate(wanted))
                else:
                    story.extend([NextPageTemplate(wanted), PageBreak()])
                mode = wanted
            elif new_page and story and not isinstance(story[-1], PageBreak):
                story.append(PageBreak())

        index = 0
        while index < len(lines):
            line = lines[index].strip()
            if not line:
                index += 1
                continue
            if line == "<!-- pagebreak -->":
                switch("portrait", new_page=True)
                index += 1
                continue
            if line.startswith("<!--"):
                # Comments are authoring instructions, not printed content.
                while "-->" not in lines[index]:
                    index += 1
                    if index >= len(lines):
                        raise ValueError("Unclosed Markdown comment")
                index += 1
                continue
            image = IMAGE.match(line)
            if image:
                caption, image_url = image.groups()
                image_url = image_url.strip().strip("<>")
                if urlsplit(image_url).scheme:
                    raise ValueError("Figure images must be local files")
                path = (self.source_path.parent / unquote(image_url)).resolve()
                if not path.is_file():
                    raise ValueError(f"Missing figure: {image_url}")
                switch("landscape", new_page=True)
                self.figure_count += 1
                if not re.match(r"^Figure\s+\d", caption, flags=re.IGNORECASE):
                    caption = f"Figure {self.figure_count:02d}. {caption}"
                story.append(Figure(path, section, caption, self))
                index += 1
                continue

            switch("portrait")
            if line.startswith("```"):
                block = []
                index += 1
                while index < len(lines) and not lines[index].strip().startswith("```"):
                    block.append(lines[index])
                    index += 1
                if index >= len(lines):
                    raise ValueError("Unclosed code fence")
                story.append(self.code(block))
                index += 1
                continue
            if line.startswith("|"):
                block = []
                while index < len(lines) and lines[index].strip().startswith("|"):
                    block.append(lines[index])
                    index += 1
                story.append(self.table(block))
                continue
            heading = HEADING.match(line)
            if heading:
                level, title = len(heading[1]), heading[2]
                style = {1: "title", 2: "section", 3: "subsection"}[level]
                paragraph = self.paragraph(title, style)
                paragraph.heading_key = self.anchor_lines[index]
                paragraph.heading_level = level - 1
                story.append(paragraph)
                if level == 2:
                    section = plain_heading(title)
                if level == 1:
                    story.append(HRFlowable(width=TEXT_WIDTH, thickness=1.6,
                                            color=TEAL, spaceBefore=2, spaceAfter=12))
                index += 1
                continue
            item = LIST.match(line)
            if item:
                label = (item[2] + ".") if item[2] else "\u2022"
                text = item[3]
                index += 1
                while index < len(lines) and lines[index].startswith("  ") and lines[index].strip() and not BLOCK_START.match(lines[index].strip()):
                    text += " " + lines[index].strip()
                    index += 1
                story.append(self.paragraph(text, "list", bulletText=label))
                continue
            if line.startswith("> "):
                story.append(self.paragraph(line[2:], "quote"))
                index += 1
                continue
            if line == "---":
                story.append(HRFlowable(width=TEXT_WIDTH, thickness=0.6,
                                        color=LINE, spaceBefore=8, spaceAfter=12))
                index += 1
                continue
            block = [line]
            index += 1
            while index < len(lines) and lines[index].strip() and not BLOCK_START.match(lines[index].strip()):
                block.append(lines[index].strip())
                index += 1
            paragraph = self.paragraph(" ".join(block))
            if block[-1].endswith(":"):
                paragraph.keepWithNext = True
            story.append(paragraph)
        # A trailing author page break must not produce a blank final page.
        while story and isinstance(story[-1], (PageBreak, NextPageTemplate)):
            story.pop()
        return story


class Figure(Flowable):
    """An entire landscape page containing one uncropped screenshot."""

    def __init__(self, path, section, caption, markdown):
        super().__init__()
        self.path = path
        self.picture = ImageReader(str(path))
        self.pixel_width, self.pixel_height = self.picture.getSize()
        self.heading = markdown.paragraph(section, "figure_heading")
        self.caption = markdown.paragraph(caption, "caption")
        self.figure_key = f"figure-{markdown.figure_count:02d}"
        self.hAlign = "LEFT"

    def wrap(self, available_width, available_height):
        self.width = available_width
        self.height = FIGURE_HEIGHT
        _, self.heading_height = self.heading.wrap(self.width, self.height)
        _, self.caption_height = self.caption.wrap(self.width, self.height)
        image_height = self.height - self.heading_height - self.caption_height - 24
        if image_height < 100:
            raise ValueError(f"Figure caption is too long: {self.path.name}")
        scale = min(self.width / self.pixel_width, image_height / self.pixel_height)
        self.image_width = self.pixel_width * scale
        self.image_height = self.pixel_height * scale
        return self.width, self.height

    def draw(self):
        top = self.height
        self.heading.drawOn(self.canv, 0, top - self.heading_height)
        top -= self.heading_height + 10
        left = (self.width - self.image_width) / 2
        bottom = top - self.image_height
        self.canv.drawImage(self.picture, left, bottom, width=self.image_width,
                            height=self.image_height, preserveAspectRatio=True,
                            mask="auto")
        self.canv.saveState()
        self.canv.setStrokeColor(LINE)
        self.canv.setLineWidth(0.6)
        self.canv.rect(left, bottom, self.image_width, self.image_height, fill=0, stroke=1)
        self.canv.restoreState()
        self.caption.drawOn(self.canv, 0, bottom - 12 - self.caption_height)


class Report(BaseDocTemplate):
    def __init__(self, path, source_name, first_template="portrait"):
        super().__init__(str(path), pagesize=PORTRAIT, leftMargin=MARGIN,
                         rightMargin=MARGIN, topMargin=TOP, bottomMargin=BOTTOM,
                         title="Geospatial Web Lab | Illustrated feature report",
                         author="Geospatial Web Lab",
                         subject="Five applications, feature explanations, screenshots, and verification boundaries",
                         pageCompression=1)
        self.source_name = source_name
        self.last_outline_level = -1
        templates = [("portrait", PORTRAIT), ("landscape", LANDSCAPE)]
        templates.sort(key=lambda item: item[0] != first_template)
        for name, size in templates:
            width, height = size
            frame = Frame(MARGIN, BOTTOM, width - 2 * MARGIN, height - TOP - BOTTOM,
                          leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
                          id=name + "-frame")
            self.addPageTemplates(PageTemplate(id=name, frames=[frame], pagesize=size,
                                               onPage=self.decorate))

    def decorate(self, canvas, doc):
        width, height = self.pageTemplate.pagesize
        canvas.saveState()
        canvas.setFillColor(TEAL)
        canvas.setFont(BOLD, 8)
        canvas.drawString(MARGIN, height - 30, "GEOSPATIAL WEB LAB")
        canvas.setFillColor(MUTED)
        canvas.setFont(BODY, 8)
        canvas.drawRightString(width - MARGIN, height - 30, "Illustrated feature report")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, 35, width - MARGIN, 35)
        canvas.setFont(BODY, 7.5)
        canvas.drawString(MARGIN, 23, f"{self.source_name} | Synthetic application data")
        canvas.drawRightString(width - MARGIN, 23, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Figure):
            self.canv.bookmarkPage(flowable.figure_key)
            title = flowable.caption.getPlainText()
            self.canv.addOutlineEntry(title, flowable.figure_key, level=2, closed=False)
            self.last_outline_level = 2
        if isinstance(flowable, Paragraph) and hasattr(flowable, "heading_key"):
            self.canv.bookmarkPage(flowable.heading_key)
            level = min(flowable.heading_level, self.last_outline_level + 1)
            self.canv.addOutlineEntry(flowable.getPlainText(), flowable.heading_key,
                                     level=level, closed=False)
            self.last_outline_level = level


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "FEATURE_REPORT.md")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "pdf" / "FEATURE_REPORT.pdf")
    arguments = parser.parse_args()
    source = arguments.source.resolve()
    output = arguments.output.resolve()
    if not source.is_file():
        parser.error(f"Source does not exist: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    markdown = Markdown(source, output)
    story = markdown.parse(source.read_text(encoding="utf-8-sig"))
    if not story:
        parser.error("Source contains no printable content")
    report = Report(output, source.name, markdown.first_template)
    report.build(story)
    print(f"Created {output} ({report.page} pages, {markdown.figure_count} figures, {output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
