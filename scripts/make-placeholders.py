#!/usr/bin/env python3
"""
Generate art-directed placeholder imagery for the Icflic site.

These are deliberate duotone compositions in the brand palette, not grey
boxes, so the site is presentable before real photography lands. Each frame
carries a small corner label naming the shot it stands in for, which doubles
as the art-direction note for whoever shoots it.

To swap in a real photo: drop it into public/assets/img/ under the same
filename. No markup changes needed.

Requires: pip install Pillow fonttools brotli
Usage:    python3 scripts/make-placeholders.py
"""

import math
import random
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "public" / "assets" / "img"
FONT_DIR = ROOT / "public" / "assets" / "fonts"

INK = (19, 18, 16)
INK_2 = (29, 27, 24)
CREAM = (246, 241, 231)
CREAM_2 = (236, 228, 213)
FLARE = (255, 90, 31)
FLARE_DEEP = (168, 52, 14)
PITCH = (14, 95, 71)
PITCH_DEEP = (10, 71, 53)
BRASS = (201, 164, 76)

# Flat tones. No gradients anywhere: a matte field, a hairline mark and grain.
# A wash reads as decoration; a flat field reads as a frame waiting for a photo.
FLATS = [
    {"bg": INK,          "mark": BRASS, "label": CREAM},
    {"bg": PITCH_DEEP,   "mark": CREAM, "label": CREAM},
    {"bg": (36, 33, 29), "mark": FLARE, "label": CREAM},
    {"bg": FLARE_DEEP,   "mark": CREAM, "label": CREAM},
    {"bg": PITCH,        "mark": CREAM, "label": CREAM},
    {"bg": INK_2,        "mark": BRASS, "label": CREAM},
    {"bg": CREAM_2,      "mark": INK,   "label": INK},
    {"bg": (58, 53, 46), "mark": CREAM, "label": CREAM},
]

_TTF_CACHE = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_font(name, size, weight=None, opsz=None):
    """Load one of the site's self-hosted WOFF2 faces.

    Pillow cannot read WOFF2, so each face is decompressed to a plain TTF once
    and cached in the system temp directory.
    """
    src = FONT_DIR / name
    if not src.exists():
        return ImageFont.load_default()

    if name not in _TTF_CACHE:
        try:
            from fontTools.ttLib.woff2 import decompress
        except ImportError:
            print("  ! fonttools missing — run: pip install fonttools brotli")
            _TTF_CACHE[name] = None
        else:
            out = Path(tempfile.gettempdir()) / f"icflic-{src.stem}.ttf"
            if not out.exists():
                decompress(str(src), str(out))
            _TTF_CACHE[name] = out

    ttf = _TTF_CACHE.get(name)
    if ttf is None:
        return ImageFont.load_default()

    font = ImageFont.truetype(str(ttf), size)
    if weight is not None or opsz is not None:
        try:
            font.set_variation_by_axes([weight or 400, opsz or 11])
        except (OSError, AttributeError):
            pass
    return font


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def tracked_text(draw, xy, text, font, fill, tracking=0):
    """Draw text with letter-spacing; Pillow has no native support for it."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


def tracked_width(draw, text, font, tracking=0):
    return (sum(draw.textlength(c, font=font) for c in text)
            + tracking * max(0, len(text) - 1))


# ---------------------------------------------------------------------------
# Hairline marks. Drawn on an RGBA overlay at low opacity so they register as
# a detail rather than a pattern.
# ---------------------------------------------------------------------------

def mark_none(d, w, h, colour, rng):
    return


def mark_rule(d, w, h, colour, rng):
    """A single thin rule across the lower third."""
    y = h * rng.uniform(0.6, 0.74)
    inset = w * 0.14
    d.line([(inset, y), (w - inset, y)], fill=colour + (46,), width=2)


def mark_circle(d, w, h, colour, rng):
    """One thin circle, generously inset."""
    r = min(w, h) * 0.28
    cx, cy = w / 2, h * rng.uniform(0.42, 0.54)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=colour + (40,), width=2)


def mark_frame(d, w, h, colour, rng):
    """A hairline inset frame, like a contact-sheet crop mark."""
    inset = min(w, h) * 0.09
    d.rectangle([inset, inset, w - inset, h - inset], outline=colour + (34,), width=2)


def mark_corner(d, w, h, colour, rng):
    """Two corner brackets."""
    inset = min(w, h) * 0.1
    arm = min(w, h) * 0.12
    for (x, y, dx, dy) in ((inset, inset, 1, 1), (w - inset, h - inset, -1, -1)):
        d.line([(x, y), (x + arm * dx, y)], fill=colour + (52,), width=2)
        d.line([(x, y), (x, y + arm * dy)], fill=colour + (52,), width=2)


def mark_crosshair(d, w, h, colour, rng):
    """A centred registration cross."""
    cx, cy = w / 2, h / 2
    arm = min(w, h) * 0.06
    d.line([(cx - arm, cy), (cx + arm, cy)], fill=colour + (44,), width=2)
    d.line([(cx, cy - arm), (cx, cy + arm)], fill=colour + (44,), width=2)


MARKS = [mark_none, mark_rule, mark_circle, mark_frame, mark_corner, mark_crosshair]


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------

def make_image(w, h, seed, label_top="placeholder", label_bottom="", numeral=None,
               scheme_index=None):
    """A flat field, one hairline mark, grain, and a corner spec label.

    Deliberately not a gradient. These stand in for photographs, and a wash
    draws attention to itself in a way a real frame in this position would not.
    """
    rng = random.Random(seed)
    tone = FLATS[scheme_index if scheme_index is not None else seed % len(FLATS)]

    img = Image.new("RGB", (w, h), tone["bg"])

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    MARKS[(seed // 3) % len(MARKS)](od, w, h, tone["mark"], rng)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    # Grain. Without it a flat fill reads as an empty div rather than a frame.
    noise = Image.effect_noise((w, h), 20).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.035)

    if label_top or label_bottom:
        d = ImageDraw.Draw(img, "RGBA")
        pad = max(18, int(w * 0.038))
        fs = max(12, int(w * 0.019))
        f_small = load_font("inter-latin.woff2", fs, weight=600)
        f_mid = load_font("inter-latin.woff2", int(fs * 1.1), weight=500)
        lc = tone["label"]
        if label_top:
            d.line([(pad, pad + fs * 0.4), (pad + fs * 2.4, pad + fs * 0.4)],
                   fill=lc + (150,), width=2)
            tracked_text(d, (pad, pad + fs * 1.1), label_top.upper(), f_small,
                         lc + (170,), tracking=fs * 0.12)
        if label_bottom:
            d.text((pad, h - pad - fs * 1.6), label_bottom, font=f_mid, fill=lc + (125,))

    return img


def draw_og(img, title, subtitle):
    """Compose the Open Graph card: wordmark, rule, tagline."""
    w, h = img.size
    d = ImageDraw.Draw(img, "RGBA")

    f_title = load_font("bodonimoda-latin.woff2", 128, weight=600, opsz=96)
    f_sub = load_font("inter-latin.woff2", 21, weight=600)
    if not isinstance(f_title, ImageFont.FreeTypeFont):
        return

    t_track = 16
    tw = tracked_width(d, title, f_title, t_track)
    bb = d.textbbox((0, 0), title, font=f_title)
    ty = h / 2 - (bb[3] + bb[1]) / 2 - 28
    tracked_text(d, ((w - tw) / 2, ty), title, f_title, CREAM, t_track)

    rule_y = ty + bb[3] + 44
    d.line([(w / 2 - 118, rule_y), (w / 2 + 118, rule_y)], fill=BRASS + (200,), width=2)

    s_track = 6
    sw = tracked_width(d, subtitle, f_sub, s_track)
    tracked_text(d, ((w - sw) / 2, rule_y + 26), subtitle, f_sub, BRASS, s_track)


# ---------------------------------------------------------------------------
# Slots: filename -> (width, height, art-direction note)
# ---------------------------------------------------------------------------

SLOTS = [
    # Hero collage — five vertical frames
    ("hero-01", 900, 1200, "Portrait · athlete, held gaze"),
    ("hero-02", 900, 1380, "Action · sprint, low angle"),
    ("hero-03", 900, 1530, "Detail · boots, grass, chalk"),
    ("hero-04", 900, 1380, "Action · aerial duel"),
    ("hero-05", 900, 1200, "Portrait · kit, studio light"),

    # Services
    ("service-recruiting", 1200, 900, "Recruiting · clean background frame"),
    ("service-matchday", 1200, 900, "Match day · peak action, long lens"),
    ("service-portrait", 1200, 900, "Editorial portrait · controlled light"),
    ("service-brand", 1200, 900, "Brand content · vertical social crops"),

    # Story / about
    ("story-01", 1100, 1375, "Behind the scenes · working the sideline"),
    ("story-02", 1400, 1050, "Contact sheet · selects laid out"),
    ("portrait-owner", 1000, 1250, "Owner portrait · replace with real headshot"),

    # Portfolio grid
    ("work-01", 1200, 1500, "Signing day · pen, table, teammates"),
    ("work-02", 1200, 1500, "Portrait · shadow across the face"),
    ("work-03", 1600, 1067, "Wide · stadium at golden hour"),
    ("work-04", 1200, 1500, "Action · slide tackle, turf spray"),
    ("work-05", 1200, 1500, "Detail · taped wrists, chalked hands"),
    ("work-06", 1600, 1067, "Wide · walking out of the tunnel"),
    ("work-07", 1200, 1500, "Portrait · profile against dark"),
    ("work-08", 1200, 1500, "Action · header, ball frozen"),
    ("work-09", 1200, 1500, "Celebration · arms out, crowd blur"),
    ("work-10", 1600, 1067, "Wide · empty pitch, floodlights"),
    ("work-11", 1200, 1500, "Detail · gloves, grip, sweat"),
    ("work-12", 1200, 1500, "Portrait · bench, exhale, post-match"),
]

NUMERALS = ["7", "10", "9", "4", "11", "1", "8", "23", "6", "3", "5", "2"]


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    total = 0

    for i, (name, w, h, note) in enumerate(SLOTS):
        img = make_image(
            w, h, seed=i * 13 + 5,
            label_bottom=note,
        )
        out = IMG_DIR / f"{name}.webp"
        img.save(out, "WEBP", quality=80, method=6)
        kb = out.stat().st_size // 1024
        total += kb
        print(f"  {name}.webp  {w}x{h}  {kb}KB")

    # Open Graph card. JPEG — some social scrapers still choke on WebP.
    og = make_image(1200, 630, seed=0, label_top="", label_bottom="", scheme_index=0)
    draw_og(og, "ICFLIC", "SPORTS PHOTOGRAPHY FOR ATHLETES")
    og_path = IMG_DIR / "og-default.jpg"
    og.save(og_path, "JPEG", quality=86, optimize=True, progressive=True)
    print(f"  og-default.jpg  1200x630  {og_path.stat().st_size // 1024}KB")

    # Favicons / touch icon — brass monogram on ink, replaced when a logo lands.
    for px, fname in ((180, "apple-touch-icon.png"), (512, "icon-512.png"),
                      (192, "icon-192.png")):
        ico = Image.new("RGB", (px, px), INK)
        d = ImageDraw.Draw(ico)
        f = load_font("bodonimoda-latin.woff2", int(px * 0.44), weight=700, opsz=96)
        if isinstance(f, ImageFont.FreeTypeFont):
            bb = d.textbbox((0, 0), "IC", font=f)
            d.text(((px - (bb[2] - bb[0])) / 2 - bb[0],
                    (px - (bb[3] - bb[1])) / 2 - bb[1]), "IC", font=f, fill=BRASS)
        inset = max(2, px // 22)
        d.rectangle([inset, inset, px - inset - 1, px - inset - 1],
                    outline=BRASS, width=max(1, px // 90))
        ico.save(ROOT / "public" / fname, "PNG", optimize=True)
        print(f"  public/{fname}  {px}x{px}")

    print(f"\n{len(SLOTS)} frames, {total}KB total.")
    print("Replace any file in public/assets/img/ with a real photo of the same")
    print("name to swap it in — no markup changes needed.")


if __name__ == "__main__":
    main()
