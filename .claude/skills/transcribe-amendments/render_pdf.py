#!/usr/bin/env python3
"""Render a Council compromise PDF to PNG page images for VISUAL transcription.

Why this exists: the compromise PDFs carry tracked changes (strikethrough =
deletions, bold / bold-underlined = additions). Plain-text extraction throws
that formatting away and interleaves struck and added words (e.g. "9672 hours",
"datasubmitting"), so the consolidated reading the transcription guide requires
cannot be produced from text alone. Render the pages, then READ the PNGs.

Usage:
  # all pages at default dpi -> /tmp/p01.png, /tmp/p02.png, ...
  python3 render_pdf.py sources/council/ST-XXXX-2026_*.pdf --all

  # selected pages (1-based), ranges allowed
  python3 render_pdf.py <pdf> --pages 1,17-19,28

  # high-dpi zoom crop of an ambiguous clause:
  #   "<page>:<y0frac>:<y1frac>[:<dpi>]"  (vertical fractions of the page)
  python3 render_pdf.py <pdf> --crop 18:0.30:0.52:320 --crop 19:0.30:0.62

Outputs full pages as p<NN>.png and crops as p<NN>_<y0>-<y1>.png in --outdir
(default /tmp). The harmless stderr line
  "MuPDF error: ... No common ancestor in structure tree"
can be ignored; rendering still succeeds.
"""
import argparse, os, sys

try:
    import fitz  # PyMuPDF
except ModuleNotFoundError:
    sys.exit(
        "PyMuPDF missing. No pip on this VPS - unpack a manylinux wheel to "
        "/tmp/pylib and run with PYTHONPATH=/tmp/pylib (see SKILL.md, "
        "'Provisioning PyMuPDF')."
    )


def parse_pages(spec, n):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [p for p in out if 1 <= p <= n]


def main():
    ap = argparse.ArgumentParser(description="Render PDF pages to PNG for visual transcription.")
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based pages/ranges, e.g. 1,17-19,28")
    ap.add_argument("--all", action="store_true", help="render every page")
    ap.add_argument("--dpi", type=int, default=175)
    ap.add_argument("--outdir", default="/tmp")
    ap.add_argument("--crop", action="append", default=[],
                    help='"page:y0frac:y1frac[:dpi]" high-dpi vertical crop (repeatable)')
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit(f"No such PDF: {args.pdf}")
    os.makedirs(args.outdir, exist_ok=True)
    doc = fitz.open(args.pdf)
    n = doc.page_count
    print(f"{os.path.basename(args.pdf)}: {n} pages")

    if args.all or (not args.pages and not args.crop):
        pages = list(range(1, n + 1))
    else:
        pages = parse_pages(args.pages, n) if args.pages else []

    for p in pages:
        out = os.path.join(args.outdir, f"p{p:02d}.png")
        doc[p - 1].get_pixmap(dpi=args.dpi).save(out)
        print("page ->", out)

    for spec in args.crop:
        bits = spec.split(":")
        page = int(bits[0]); y0 = float(bits[1]); y1 = float(bits[2])
        dpi = int(bits[3]) if len(bits) > 3 else 300
        pg = doc[page - 1]; r = pg.rect
        clip = fitz.Rect(r.x0, r.y0 + r.height * y0, r.x1, r.y0 + r.height * y1)
        out = os.path.join(args.outdir, f"p{page:02d}_{y0}-{y1}.png")
        pg.get_pixmap(dpi=dpi, clip=clip).save(out)
        print("crop ->", out)


if __name__ == "__main__":
    main()
