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

# Duotone recipes: (ground, light, mark). `light` is always markedly brighter
# than `ground` — a dark glow on a dark ground just reads as mud.
SCHEMES = [
    {"ground": INK,        "light": FLARE, "mark": BRASS,      "label": CREAM},
    {"ground": PITCH_DEEP, "light": BRASS, "mark": CREAM,      "label": CREAM},
    {"ground": INK,        "light": BRASS, "mark": FLARE,      "label": CREAM},
    {"ground": FLARE_DEEP, "light": FLARE, "mark": INK,        "label": CREAM},
    {"ground": PITCH,      "light": FLARE, "mark": CREAM,      "label": CREAM},
    {"ground": INK_2,      "light": CREAM, "mark": FLARE,      "label": CREAM},
    {"ground": CREAM_2,    "light": CREAM, "mark": FLARE_DEEP, "label": INK},
    {"ground": PITCH_DEEP, "light": FLARE, "mark": BRASS,      "label": CREAM},
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
# Field construction
# ---------------------------------------------------------------------------

def duotone_field(size, scheme, rng):
    """Broad directional wash from a deepened ground into the light colour.

    Built at 96px and upscaled — the bicubic interpolation is what makes the
    gradient smooth without banding.
    """
    w, h = size
    ground, light = scheme["ground"], scheme["light"]
    peak = lerp(ground, light, rng.uniform(0.5, 0.8))
    deep = lerp(ground, (0, 0, 0), 0.4) if luma(ground) > 40 else ground

    small = Image.new("RGB", (96, 96))
    px = small.load()
    rad = math.radians(rng.uniform(0, 360))
    dx, dy = math.cos(rad), math.sin(rad)
    bias = rng.uniform(0.9, 1.7)
    for y in range(96):
        for x in range(96):
            t = ((x / 95) * dx + (y / 95) * dy + 1) / 2
            t = max(0.0, min(1.0, t)) ** bias
            px[x, y] = lerp(deep, peak, t)
    return small.resize((w, h), Image.BICUBIC)


def add_keylight(img, scheme, rng):
    """A hot spot in the scheme's light colour. This is what makes it pop."""
    w, h = img.size
    cx = w * rng.uniform(0.12, 0.88)
    cy = h * rng.uniform(0.08, 0.55)
    radius = max(w, h) * rng.uniform(0.5, 0.9)
    strength = rng.uniform(0.6, 0.95)

    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    steps = 56
    for i in range(steps):
        t = (i + 1) / steps
        r = radius * (1 - t)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=int(255 * (t ** 2.2)))
    mask = mask.filter(ImageFilter.GaussianBlur(radius * 0.13))
    mask = mask.point(lambda v: int(v * strength))

    tint = Image.new("RGB", (w, h), scheme["light"])
    return Image.composite(tint, img, mask)


def add_vignette(img, amount=0.42):
    """Pull the corners down so the eye lands in the middle, like a real lens."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    steps = 40
    for i in range(steps):
        t = i / steps
        ix, iy = w * 0.3 * t, h * 0.3 * t
        d.ellipse([ix - w * 0.2, iy - h * 0.2, w - ix + w * 0.2, h - iy + h * 0.2],
                  fill=int(255 * (1 - t)))
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.07))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(dark, img, mask.point(lambda v: int((255 - v) * amount)))


# ---------------------------------------------------------------------------
# Motifs — drawn onto an RGBA overlay so they can sit at real opacity
# ---------------------------------------------------------------------------

def motif_pitch_lines(d, w, h, colour, rng):
    """Receding touchlines in perspective."""
    n = rng.randint(5, 8)
    for i in range(n):
        t = (i + 1) / (n + 1)
        y = h * (0.24 + 0.78 * (t ** 1.9))
        spread = w * 0.5 * (0.2 + t * 1.7)
        d.line([(w / 2 - spread, y), (w / 2 + spread, y)],
               fill=colour + (int(90 + 110 * t),), width=max(2, int(1 + t * 5)))


def motif_centre_circle(d, w, h, colour, rng):
    cx, cy = w * rng.uniform(0.35, 0.65), h * rng.uniform(0.4, 0.62)
    for i, factor in enumerate((1.0, 0.62, 0.28)):
        r = min(w, h) * 0.46 * factor
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  outline=colour + (150 - i * 30,), width=max(2, int(min(w, h) * 0.006)))


def motif_net(d, w, h, colour, rng):
    """Goal-net lattice."""
    step = max(26, int(min(w, h) / 11))
    for i in range(-h, w + h, step):
        d.line([(i, 0), (i + h, h)], fill=colour + (70,), width=2)
        d.line([(i, h), (i + h, 0)], fill=colour + (70,), width=2)


def motif_halftone(d, w, h, colour, rng):
    """Dot gradient — a print-press nod that photographs well behind type."""
    step = max(20, int(min(w, h) / 20))
    for gy in range(0, h + step, step):
        for gx in range(0, w + step, step):
            t = gy / max(1, h)
            r = step * 0.46 * (t ** 1.3)
            if r < 0.8:
                continue
            d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=colour + (120,))


def motif_arc_sweep(d, w, h, colour, rng):
    """Motion arcs — a ball's flight path, abstracted."""
    for i in range(4):
        pad = min(w, h) * (0.06 + i * 0.14)
        box = [-w * 0.35 + pad, h * 0.2 + pad, w * 1.35 - pad, h * 1.95 - pad]
        d.arc(box, start=198, end=342, fill=colour + (160 - i * 32,),
              width=max(2, int(min(w, h) * 0.005)))


def motif_diagonal_band(d, w, h, colour, rng):
    """A single wide diagonal sash — the boldest, most graphic option."""
    t = rng.uniform(0.28, 0.5)
    bw = min(w, h) * rng.uniform(0.22, 0.36)
    x0 = w * t
    d.polygon([(x0, 0), (x0 + bw, 0), (x0 + bw - w * 0.45, h), (x0 - w * 0.45, h)],
              fill=colour + (48,))


MOTIFS = [motif_pitch_lines, motif_centre_circle, motif_net,
          motif_halftone, motif_arc_sweep, motif_diagonal_band]


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------

def make_image(w, h, seed, label_top="placeholder", label_bottom="", numeral=None,
               scheme_index=None, vignette=0.42):
    rng = random.Random(seed)
    scheme = SCHEMES[scheme_index if scheme_index is not None else seed % len(SCHEMES)]

    img = duotone_field((w, h), scheme, rng)
    img = add_keylight(img, scheme, rng)

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    MOTIFS[(seed // 5) % len(MOTIFS)](od, w, h, scheme["mark"], rng)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    # Oversized ghosted numeral — a jersey number, abstracted.
    if numeral:
        f = load_font("bodonimoda-latin.woff2", int(h * 0.66), weight=700, opsz=96)
        if isinstance(f, ImageFont.FreeTypeFont):
            layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            bb = ld.textbbox((0, 0), numeral, font=f)
            ld.text(((w - (bb[2] - bb[0])) / 2 - bb[0], (h - (bb[3] - bb[1])) / 2 - bb[1]),
                    numeral, font=f, fill=scheme["mark"] + (58,))
            img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    img = add_vignette(img, vignette)

    # Film grain. Flat gradients read as CGI; real photography has texture.
    noise = Image.effect_noise((w, h), 26).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.05)

    # Corner spec label.
    if label_top or label_bottom:
        d = ImageDraw.Draw(img, "RGBA")
        pad = max(18, int(w * 0.038))
        fs = max(12, int(w * 0.019))
        f_small = load_font("inter-latin.woff2", fs, weight=600)
        f_mid = load_font("inter-latin.woff2", int(fs * 1.1), weight=500)
        lc = scheme["label"]
        if label_top:
            d.line([(pad, pad + fs * 0.4), (pad + fs * 2.4, pad + fs * 0.4)],
                   fill=lc + (170,), width=2)
            tracked_text(d, (pad, pad + fs * 1.1), label_top.upper(), f_small,
                         lc + (190,), tracking=fs * 0.12)
        if label_bottom:
            d.text((pad, h - pad - fs * 1.6), label_bottom, font=f_mid, fill=lc + (140,))

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
            numeral=NUMERALS[i % len(NUMERALS)] if i % 3 == 0 else None,
        )
        out = IMG_DIR / f"{name}.webp"
        img.save(out, "WEBP", quality=80, method=6)
        kb = out.stat().st_size // 1024
        total += kb
        print(f"  {name}.webp  {w}x{h}  {kb}KB")

    # Open Graph card. JPEG — some social scrapers still choke on WebP.
    og = make_image(1200, 630, seed=4, label_top="", label_bottom="",
                    scheme_index=0, vignette=0.55)
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
