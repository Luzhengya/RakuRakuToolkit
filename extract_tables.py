"""
Extract tables from a PDF using pdfplumber.

Usage: python3 extract_tables.py <input_pdf>

Outputs JSON on stdout matching the ExtractTablesResponse shape expected by
the front-end. Coordinates are in PDF user space with bottom-left origin
(pdfplumber uses top-left internally — we flip y here).

Each cell carries the chars-based font metadata for the front-end to use
when redrawing (size + family + bold detection).
"""

import sys
import json
import traceback

try:
    import pdfplumber
except ImportError:
    print(
        json.dumps({"error": "pdfplumber not installed. pip install pdfplumber"}),
        file=sys.stderr,
    )
    sys.exit(1)


def detect_bold(font_name):
    if not font_name:
        return False
    lower = font_name.lower()
    return any(
        kw in lower
        for kw in ("bold", "heavy", "semibold", "demibold", "black")
    )


def chars_in_bbox(chars, x0, top, x1, bottom):
    """Return chars whose centre lies inside the bbox (top-down coords)."""
    result = []
    for c in chars:
        cx = (float(c.get("x0", 0)) + float(c.get("x1", 0))) / 2
        cy = (float(c.get("top", 0)) + float(c.get("bottom", 0))) / 2
        if x0 <= cx < x1 and top <= cy < bottom:
            result.append(c)
    return result


def extract(pdf_path):
    out = {"pageSizes": [], "tables": []}

    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_w = float(page.width)
            page_h = float(page.height)
            out["pageSizes"].append({"width": page_w, "height": page_h})

            # Cache chars once per page — pdfplumber's .chars walks the content
            # stream on every access, expensive for big pages.
            try:
                chars = page.chars or []
            except Exception:
                chars = []

            # pdfplumber bbox is (x0, top, x1, bottom) with TOP-DOWN origin.
            # Front-end expects bottom-up [x1, y1, x2, y2]:
            #   y1 = page_h - bottom  (lower edge in flipped space)
            #   y2 = page_h - top     (upper edge in flipped space)
            def to_bottom_up(bbox):
                x0, top, x1, bottom = bbox
                return [
                    float(x0),
                    float(page_h - bottom),
                    float(x1),
                    float(page_h - top),
                ]

            try:
                tables = page.find_tables()
            except Exception:
                tables = []

            for tbl in tables:
                try:
                    tbl_bbox = tbl.bbox
                except Exception:
                    continue

                table_data = {
                    "pageIdx": page_idx,
                    "bounds": to_bottom_up(tbl_bbox),
                    "rows": [],
                }

                # pdfplumber's Table exposes .rows; each row has .cells which
                # is a list of (x0, top, x1, bottom) tuples or None for empty.
                try:
                    rows_iter = tbl.rows
                except Exception:
                    rows_iter = []

                for row in rows_iter:
                    try:
                        cell_bboxes = row.cells
                    except Exception:
                        cell_bboxes = []

                    row_cells = []
                    for cell_bbox in cell_bboxes:
                        if cell_bbox is None:
                            continue
                        cx0, ctop, cx1, cbtm = cell_bbox

                        in_cell = chars_in_bbox(chars, cx0, ctop, cx1, cbtm)
                        text = "".join(str(c.get("text", "")) for c in in_cell).strip()

                        sizes = [
                            float(c["size"])
                            for c in in_cell
                            if c.get("size") is not None
                        ]
                        names = [
                            c["fontname"]
                            for c in in_cell
                            if c.get("fontname")
                        ]

                        fontSize = (sum(sizes) / len(sizes)) if sizes else None
                        fontName = names[0] if names else None
                        bold = (
                            any(detect_bold(n) for n in names) if names else None
                        )

                        row_cells.append({
                            "bounds": to_bottom_up(cell_bbox),
                            "text": text,
                            "fontSize": fontSize,
                            "fontName": fontName,
                            "bold": bold,
                        })

                    if not row_cells:
                        continue

                    xs1 = [c["bounds"][0] for c in row_cells]
                    ys1 = [c["bounds"][1] for c in row_cells]
                    xs2 = [c["bounds"][2] for c in row_cells]
                    ys2 = [c["bounds"][3] for c in row_cells]
                    row_data = {
                        "bounds": [min(xs1), min(ys1), max(xs2), max(ys2)],
                        "cells": row_cells,
                    }
                    table_data["rows"].append(row_data)

                if table_data["rows"]:
                    out["tables"].append(table_data)

    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            json.dumps({"error": "Usage: extract_tables.py <pdf_path>"}),
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        result = extract(sys.argv[1])
        # ensure_ascii=False so CJK text survives the round-trip
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(
            json.dumps({"error": str(e), "trace": traceback.format_exc()}),
            file=sys.stderr,
        )
        sys.exit(1)
