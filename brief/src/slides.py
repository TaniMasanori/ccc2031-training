"""Render the LLM's slide outline into a clean landscape PDF deck.

Pure-Python (fpdf2) so it runs in CI with no heavy dependencies. A title slide
is prepended, giving a 7-slide deck total. Designed to be readable on a phone.

Japanese (CJK) text needs a Unicode TrueType font. Set the FONT_PATH env var to
a .ttf (e.g. IPA Gothic at /usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf,
installed via `apt-get install fonts-ipafont-gothic`). Without it, we fall back
to a latin-1 core font and non-latin characters are replaced with '?'.
"""
from __future__ import annotations

import os
from pathlib import Path

from fpdf import FPDF

# 16:9-ish landscape in millimetres.
PAGE_W, PAGE_H = 254, 142
INK = (28, 30, 38)
ACCENT = (40, 90, 170)
MUTED = (110, 115, 125)

_FONT_PATH = os.environ.get("FONT_PATH", "")
_HAS_UNICODE = bool(_FONT_PATH) and Path(_FONT_PATH).exists()
_FAMILY = "Deck" if _HAS_UNICODE else "Helvetica"
_BULLET = "\u2022" if _HAS_UNICODE else "-"


class _Deck(FPDF):
    def header(self):
        pass

    def footer(self):
        self.set_y(-12)
        self.set_font(_FAMILY, size=8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"{self.page_no()}", align="R")


def _safe(pdf: _Deck, text: str) -> str:
    """If using a latin-1 core font, sanitise; otherwise pass through."""
    if _HAS_UNICODE:
        return text or ""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _set(pdf: _Deck, size: int, bold: bool = False) -> None:
    # Unicode TTFs registered here are regular weight; emulate bold via size.
    style = "B" if (bold and not _HAS_UNICODE) else ""
    pdf.set_font(_FAMILY, style, size)


def _title_slide(pdf: _Deck, title: str, subtitle: str) -> None:
    pdf.add_page()
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, PAGE_W, PAGE_H, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(20, 48)
    _set(pdf, 30, bold=True)
    pdf.multi_cell(PAGE_W - 40, 14, _safe(pdf, title))
    pdf.set_xy(20, 86)
    _set(pdf, 14)
    pdf.multi_cell(PAGE_W - 40, 9, _safe(pdf, subtitle))


def _content_slide(pdf: _Deck, title: str, bullets: list[str]) -> None:
    pdf.add_page()
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, PAGE_W, 26, style="F")
    pdf.set_xy(16, 7)
    pdf.set_text_color(255, 255, 255)
    _set(pdf, 18, bold=True)
    pdf.multi_cell(PAGE_W - 32, 10, _safe(pdf, title))
    pdf.set_xy(20, 40)
    pdf.set_text_color(*INK)
    _set(pdf, 13)
    for b in bullets:
        x_start = pdf.get_x()
        pdf.set_text_color(*ACCENT)
        pdf.cell(7, 8, _BULLET)
        pdf.set_text_color(*INK)
        pdf.multi_cell(PAGE_W - 47, 8, _safe(pdf, b))
        pdf.ln(2)
        pdf.set_x(x_start)


def render_deck(slide_outline: list[dict], date_str: str, out_path: Path,
                deck_title: str = "Daily Research Brief") -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pdf = _Deck(orientation="L", unit="mm", format=(PAGE_H, PAGE_W))
    pdf.set_auto_page_break(auto=True, margin=16)
    if _HAS_UNICODE:
        pdf.add_font(_FAMILY, "", _FONT_PATH, uni=True)

    _title_slide(pdf, deck_title, date_str)
    for slide in slide_outline:
        _content_slide(pdf, slide.get("title", ""), list(slide.get("bullets", [])))

    pdf.output(str(out_path))
    return out_path
