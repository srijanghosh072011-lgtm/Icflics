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

from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "photos-src"
OUT = ROOT / "public" / "assets" / "img"

# Focal point as a fraction of the frame: where the subject actually is, so
# cropping to a different aspect keeps them rather than the background.
SOURCES = {
    "sideline":  {"file": "IMG_8934.jpeg", "focus": (0.30, 0.45)},  # #23 watching from the line
    "dribble":   {"file": "IMG_8935.jpeg", "focus": (0.48, 0.52)},  # #27 running at the defence
    "strike":    {"file": "IMG_8936.jpeg", "focus": (0.45, 0.50)},  # #20 striking, ball in frame
    "cityscape": {"file": "IMG_8937.jpeg", "focus": (0.32, 0.55)},  # night portrait, off the field
}

# slot name -> (source key, width, height)
# Everything is portrait because every source is portrait. Forcing these into
# landscape frames would cut the subjects in half.
SLOTS = {
    # Hero collage — three frames, not five. Three real photographs beat five
    # frames where two are stand-ins.
    "hero-01": ("sideline",  870, 1160),
    "hero-02": ("dribble",   870, 1160),
    "hero-03": ("strike",    870, 1160),

    # Service cards. Tighter crops so they read as different frames from the
    # hero rather than the same photo twice.
    "service-recruiting": ("sideline",  860, 1075),
    "service-matchday":   ("strike",    860, 1075),
    "service-portrait":   ("cityscape", 860, 1075),
    "service-brand":      ("dribble",   860, 1075),

    # Portfolio.
    "work-01": ("dribble",   860, 1075),
    "work-02": ("strike",    860, 1075),
    "work-03": ("sideline",  860, 1075),
    "work-04": ("cityscape", 860, 1075),

    # Editorial splits.
    "story-01": ("dribble",   860, 1075),
    "story-02": ("cityscape", 860, 1075),
}

# Tighter crops for the service cards, so they are not identical to the hero.
ZOOM = {
    "service-recruiting": 1.35,
    "service-matchday": 1.30,
    "service-portrait": 1.25,
    "service-brand": 1.40,
    "work-01": 1.0, "work-02": 1.0, "work-03": 1.0, "work-04": 1.0,
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
        out = crop_to(loaded[key], w, h, SOURCES[key]["focus"], ZOOM.get(slot, 1.0))
        # No exif= argument, so nothing is carried through.
        path = OUT / f"{slot}.webp"
        out.save(path, "WEBP", quality=84, method=6)
        kb = path.stat().st_size // 1024
        total += kb
        print(f"  {slot:20} {w}x{h}  {kb}KB  ({key})")

    print(f"\n{len(SLOTS)} frames, {total}KB total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
