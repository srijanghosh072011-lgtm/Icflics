#!/usr/bin/env python3
"""
Turn the originals in photos-src/ into the WebP derivatives the site uses.

    python3 scripts/import-photos.py

Every slot in public/assets/img/ is produced here, so the mapping between a
real photograph and where it appears is written down in one place instead of
being buried in markup.

Adding a photo: drop it in photos-src/, add an entry to SOURCES with a focal
point, then list the slots it should fill in SLOTS and re-run.

Metadata is stripped on the way out — phone exports can carry GPS, and these
are photographs of identifiable young athletes at named locations.
"""

import hashlib
import re
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "photos-src"
OUT = ROOT / "public" / "assets" / "img"

# Focal point as a fraction of the frame: where the subject actually is, so
# cropping to a different aspect keeps them rather than the background.
SOURCES = {
    # The photographer himself. Confirmed by the client — do not reassign this
    # to an athlete slot, and do not caption it as a subject.
    "owner":    {"file": "IMG_8937.jpeg", "focus": (0.33, 0.48), "look": "natural"},

    # Selective-colour set: green kit isolated, everything else drained.
    "sideline": {"file": "IMG_8934.jpeg", "focus": (0.30, 0.42), "look": "selective"},
    "dribble":  {"file": "IMG_8935.jpeg", "focus": (0.48, 0.50), "look": "selective"},
    "strike":   {"file": "IMG_8936.jpeg", "focus": (0.45, 0.48), "look": "selective"},

    # Natural-colour set.
    "run":      {"file": "IMG_8938.jpeg", "focus": (0.38, 0.45), "look": "natural"},
    "bench":    {"file": "IMG_8939.jpeg", "focus": (0.50, 0.52), "look": "natural"},

    # IMG_8940 is an amusement park. No athlete, nothing that reads as sports
    # photography, so it is deliberately unused.
}

# slot -> (source, width, height)
SLOTS = {
    # Hero. The owner leads at a larger size; the work sits beside him.
    "hero-01": ("owner",    980, 1225),   # lead frame, rendered largest
    "hero-02": ("dribble",  870, 1160),
    "hero-03": ("run",      870, 1160),
    "hero-04": ("strike",   870, 1160),

    # Service cards, cropped tighter so they do not repeat the hero.
    "service-recruiting": ("sideline", 860, 1075),
    "service-matchday":   ("strike",   860, 1075),
    "service-portrait":   ("bench",    860, 1075),   # the seated player, not the owner
    "service-brand":      ("dribble",  860, 1075),

    # Portfolio. Four athlete frames plus the landscape band. The owner's own
    # portrait is not in here: a portfolio shows the work, not the photographer.
    "work-01": ("dribble",  860, 1075),
    "work-02": ("strike",   860, 1075),
    "work-03": ("run",      860, 1075),
    "work-04": ("sideline", 860, 1075),
    "work-06": ("bench",   1400,  875),
}

ZOOM = {
    # He stands in the left third of a wide street scene. At 1.0 he is a small
    # figure in a car park; the hero needs him to read as the subject.
    "hero-01": 1.75,
    "service-recruiting": 1.35,
    "service-matchday": 1.30,
    "service-portrait": 1.75,   # tight on the seated player
    "service-brand": 1.15,
}

# Per-slot focal overrides. A tight crop needs to sit higher than the frame's
# natural centre or it takes the head off.
FOCUS = {
    "hero-01": (0.19, 0.55),
    "service-brand": (0.48, 0.38),
    "service-recruiting": (0.30, 0.38),
    "service-matchday": (0.45, 0.44),
    "service-portrait": (0.47, 0.60),   # the seated figure sits low in the frame
}


def crop_to(img, target_w, target_h, focus, zoom=1.0):
    """Crop to the target aspect around a focal point, then resize."""
    target_ratio = target_w / target_h
    w, h = img.size

    # Largest box of the target aspect that fits, scaled down by `zoom`.
    if w / h > target_ratio:
        box_h = h / zoom
        box_w = box_h * target_ratio
    else:
        box_w = w / zoom
        box_h = box_w / target_ratio

    box_w, box_h = min(box_w, w), min(box_h, h)

    # Centre the box on the focal point, then pull it back inside the frame.
    cx, cy = focus[0] * w, focus[1] * h
    left = max(0, min(cx - box_w / 2, w - box_w))
    top = max(0, min(cy - box_h / 2, h - box_h))

    cropped = img.crop((round(left), round(top),
                        round(left + box_w), round(top + box_h)))
    return cropped.resize((target_w, target_h), Image.LANCZOS)


def main():
    missing = [s["file"] for s in SOURCES.values() if not (SRC / s["file"]).exists()]
    if missing:
        print(f"Missing from photos-src/: {', '.join(missing)}")
        return 1

    loaded = {}
    for key, spec in SOURCES.items():
        img = ImageOps.exif_transpose(Image.open(SRC / spec["file"])).convert("RGB")
        loaded[key] = img
        print(f"  {spec['file']:16} {img.width}x{img.height}  -> {key}")

    print()
    total = 0
    for slot, (key, w, h) in SLOTS.items():
        focus = FOCUS.get(slot, SOURCES[key]["focus"])
        out = crop_to(loaded[key], w, h, focus, ZOOM.get(slot, 1.0))
        # No exif= argument, so nothing is carried through.
        path = OUT / f"{slot}.webp"
        out.save(path, "WEBP", quality=84, method=6)
        kb = path.stat().st_size // 1024
        total += kb
        print(f"  {slot:20} {w}x{h}  {kb}KB  ({key})")

    stamp_html()
    print(f"\n{len(SLOTS)} frames, {total}KB total.")
    return 0


def stamp_html():
    """Append a content hash to every image URL in the pages.

    Filenames are deliberately stable so a photo can be swapped without
    touching markup. The cost is that browsers keep serving the old picture —
    up to a day, per the cache headers. Stamping the URL with a hash of the
    file means a changed photo is a changed URL, and the new one appears at
    once.
    """
    digests = {}
    for path in sorted(OUT.glob("*.webp")) + sorted(OUT.glob("*.jpg")):
        digests[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()[:8]

    pattern = re.compile(r'(/assets/img/([A-Za-z0-9_-]+\.(?:webp|jpg)))(\?v=[a-f0-9]+)?')
    changed = 0

    for page in sorted((ROOT / "public").rglob("*.html")):
        source = page.read_text(encoding="utf-8")
        updated = pattern.sub(
            lambda m: m.group(1) + (f"?v={digests[m.group(2)]}" if m.group(2) in digests else ""),
            source,
        )
        if updated != source:
            page.write_text(updated, encoding="utf-8")
            changed += 1

    print(f"  version-stamped image URLs in {changed} page(s)")


if __name__ == "__main__":
    raise SystemExit(main())
