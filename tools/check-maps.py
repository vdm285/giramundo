"""Sample idmap.png at known places and compare with the feature ids.

Called by tools/build-maps.mjs after painting; needs Pillow.

    python -I tools/check-maps.py data/cache/maps/rings.json public/textures/idmap.png
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
W = data["width"]
H = data["height"]
byName = {f["name"]: f["id"] for f in data["features"]}
nameById = {f["id"]: f["name"] for f in data["features"]}

im = Image.open(sys.argv[2]).convert("RGB")
assert im.size == (W, H), im.size

# (label, lat, lon, expected feature name or None for ocean)
POINTS = [
    ("Mexico City", 19.43, -99.13, "Mexico"),
    ("Maseru (enclave)", -29.31, 27.48, "Lesotho"),
    ("Caspian Sea", 42.0, 51.0, None),
    ("Mid-Pacific", 0.0, -150.0, None),
    ("Singapore", 1.35, 103.82, "Singapore"),
    ("South Pole", -89.0, 0.0, "Antarctica"),
    ("Chukotka, east of 180", 66.0, -175.0, "Russia"),
    ("Viti Levu, Fiji", -17.8, 178.0, "Fiji"),
    ("San Marino (enclave)", 43.94, 12.45, "San Marino"),
    ("Vatican (sub-texel)", 41.9029, 12.4534, "Vatican"),
    ("Monaco", 43.7384, 7.4246, "Monaco"),
    ("Lake Victoria (not a hole in NE)", -1.5, 33.0, None),
    ("Pretoria", -25.75, 28.19, "South Africa"),
]


def sample(lat, lon):
    x = min(W - 1, int(math.floor((lon + 180) / 360 * W)))
    y = min(H - 1, int(math.floor((90 - lat) / 180 * H)))
    r, g, b = im.getpixel((x, y))
    return r + (g << 8), (x, y), b


failures = 0
for label, lat, lon, expected in POINTS:
    got, xy, b = sample(lat, lon)
    want = byName[expected] if expected else 0
    ok = got == want and b == 0
    if label.startswith("Lake Victoria"):
        # Natural Earth admin-0 does not carve out lakes other than the
        # Caspian; this point just documents that, whichever country it is.
        ok = got != 0
        want = "any land"
    status = "ok  " if ok else "FAIL"
    failures += 0 if ok else 1
    print(f"{status} {label:34s} px={xy} id={got:3d} ({nameById.get(got, 'ocean')}) expected {want} ({expected or 'ocean'})")

if failures:
    raise SystemExit(f"{failures} sample(s) failed")
print("all samples ok")
