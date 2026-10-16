"""Paint idmap.png and borders.png from data/cache/maps/rings.json.

Called by tools/build-maps.mjs (npm run maps); needs Pillow.

    python -I tools/paint-maps.py data/cache/maps/rings.json public/textures

idmap.png    RGB (saved as a lossless palette when it fits), W x H, no
             anti-aliasing. Texel color is (id & 255, id >> 8, 0); ocean is
             black. Features are filled largest bbox first so enclaves
             (Lesotho, San Marino, Vatican) paint over their hosts; each
             feature's holes are filled black right after its outer rings.
borders.png  LA, W x H. L is 255 everywhere; A is the anti-aliased outline,
             drawn 3 px wide at 2x and downsampled with Lanczos (1.5 px),
             alpha quantized to 32 levels for size.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ringsPath = Path(sys.argv[1])
outDir = Path(sys.argv[2])

data = json.loads(ringsPath.read_text(encoding="utf-8"))
W = data["width"]
H = data["height"]
features = sorted(data["features"], key=lambda f: f["area"], reverse=True)


def closed(ring):
    pts = [(x, y) for x, y in ring]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


# ---------- id map ----------
idmap = Image.new("RGB", (W, H), (0, 0, 0))
draw = ImageDraw.Draw(idmap)
for f in features:
    fid = f["id"]
    color = (fid & 255, (fid >> 8) & 255, 0)
    for ring in f["rings"]:
        pts = [(x, y) for x, y in ring]
        # The 1 px outline in the same color keeps sub-texel countries
        # (Vatican, Monaco) on the map, like the browser's same-color stroke.
        draw.polygon(pts, fill=color, outline=color, width=1)
    for ring in f["holes"]:
        draw.polygon([(x, y) for x, y in ring], fill=(0, 0, 0))

def id_colors():
    return {c: n for n, c in idmap.getcolors(maxcolors=65536)}


# A country smaller than a texel can be covered entirely by a neighbor that
# paints after it (Sint Maarten and St-Martin share three texels). Give every
# id at least one texel, at the centroid of its largest ring, unless that
# would erase the last texel of another country.
def centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if a == 0:
        return ring[0]
    return cx / (3 * a), cy / (3 * a)


counts = id_colors()
for f in features:
    fid = f["id"]
    color = (fid & 255, (fid >> 8) & 255, 0)
    if counts.get(color, 0):
        continue
    ring = max(f["rings"], key=lambda r: abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]))))
    x, y = centroid(ring)
    px = (min(W - 1, max(0, int(x))), min(H - 1, max(0, int(y))))
    under = idmap.getpixel(px)
    if under != (0, 0, 0) and counts.get(under, 0) <= 1:
        print(f"warning: {f['name']} (id {fid}) has no texel and its centroid is the last texel of id {under[0] + (under[1] << 8)}")
        continue
    idmap.putpixel(px, color)
    counts[color] = 1
    if under != (0, 0, 0):
        counts[under] -= 1
    print(f"note: {f['name']} (id {fid}) is smaller than a texel; painted one at {px}")

colors = idmap.getcolors(maxcolors=65536)
unique = len(colors) if colors else 0
expected = {(f["id"] & 255, (f["id"] >> 8) & 255, 0) for f in features} | {(0, 0, 0)}
stray = {c for _, c in colors} - expected if colors else set()
if stray:
    raise SystemExit(f"idmap has colors that are not ids: {sorted(stray)[:5]}")
absent = expected - {c for _, c in colors}
if absent:
    raise SystemExit(f"{len(absent)} id(s) have no texel: {sorted(r + (g << 8) for r, g, _ in absent)}")

idPath = outDir / "idmap.png"
saved_as = "RGB"
if unique <= 256:
    # Palette only when it round-trips byte for byte; ids must stay exact.
    pal = idmap.convert("P", palette=Image.Palette.ADAPTIVE, colors=unique)
    if pal.convert("RGB").tobytes() == idmap.tobytes():
        pal.save(idPath, optimize=True)
        saved_as = f"P ({unique} colors)"
if saved_as == "RGB":
    idmap.save(idPath, optimize=True)
print(f"idmap.png: {W}x{H} {saved_as}, {len(features)} features, {idPath.stat().st_size // 1024} KB")

# ---------- borders ----------
S = 2
EDGE = 0.01


def on_same_edge(a, b):
    """True for segments d3 added along the antimeridian or the pole when
    it cut a ring; they are not borders and would draw a seam."""
    return (
        (a[0] <= EDGE and b[0] <= EDGE)
        or (a[0] >= W - EDGE and b[0] >= W - EDGE)
        or (a[1] >= H - EDGE and b[1] >= H - EDGE)
        or (a[1] <= EDGE and b[1] <= EDGE)
    )


big = Image.new("L", (W * S, H * S), 0)
bdraw = ImageDraw.Draw(big)
for f in features:
    for ring in f["rings"] + f["holes"]:
        pts = closed(ring)
        run = []
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if on_same_edge(a, b):
                if len(run) > 1:
                    bdraw.line([(x * S, y * S) for x, y in run], fill=255, width=3, joint="curve")
                run = []
                continue
            if not run:
                run.append(a)
            run.append(b)
        if len(run) > 1:
            bdraw.line([(x * S, y * S) for x, y in run], fill=255, width=3, joint="curve")

alpha = big.resize((W, H), Image.Resampling.LANCZOS)
# Fewer alpha levels compress much better (662 KB at 256 levels, 430 KB at
# 32) and 32 coverage steps on a 1.5 px line are not visible.
ALPHA_LEVELS = 32
step = 255 / (ALPHA_LEVELS - 1)
alpha = alpha.point(lambda v: int(round(round(v / step) * step)))
white = Image.new("L", (W, H), 255)
borders = Image.merge("LA", (white, alpha))
bPath = outDir / "borders.png"
borders.save(bPath, optimize=True)
print(f"borders.png: {W}x{H} LA, {bPath.stat().st_size // 1024} KB")
