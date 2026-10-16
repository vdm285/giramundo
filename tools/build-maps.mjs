// Precomputes the two country textures the globe used to paint on a canvas
// at startup (src/globe/paint.js: paintIdMap and paintBorders):
//
//   public/textures/idmap.png    RGB(id & 255, id >> 8, 0) per texel, black ocean
//   public/textures/borders.png  LA, white with anti-aliased alpha outlines
//
// Node projects the Natural Earth shapes with d3-geo (the same path the
// browser uses, so Russia, Fiji and Antarctica are cut at the antimeridian
// the same way) and writes pixel-space rings to data/cache/maps/rings.json.
// Python/Pillow then fills them (tools/paint-maps.py) and samples known
// points back (tools/check-maps.py).
//
// Re-run: npm run maps        (after countries-50m.json changes)

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoEquirectangular, geoPath } from 'd3-geo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 4096;
const H = 2048;

// Same projection as src/globe/paint.js: longitude 0 at the center, north up.
const projection = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);

// A canvas-like context that records the subpaths d3 emits.
function recorder() {
  const rings = [];
  let current = null;
  return {
    rings,
    moveTo(x, y) { current = [[x, y]]; rings.push(current); },
    lineTo(x, y) { current.push([x, y]); },
    closePath() { current = null; },
    arc() {},
    beginPath() {},
  };
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function round(ring) {
  return ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

const topo = JSON.parse(await readFile(join(root, 'public/data/countries-50m.json'), 'utf8'));
const fc = feature(topo, topo.objects.countries);
if (fc.features.length > 65535) throw new Error('too many features for a 16-bit id');

// Which sign an outer ring has in pixel space. d3 keeps the orientation of
// the source rings (exterior clockwise on the sphere), so we read it off a
// single-ring feature instead of hard-coding it.
const probe = fc.features.find((f) => f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1);
const probeCtx = recorder();
geoPath(projection, probeCtx)(probe);
const outerSign = Math.sign(signedArea(probeCtx.rings.reduce((a, b) => (Math.abs(signedArea(a)) > Math.abs(signedArea(b)) ? a : b))));

const out = [];
let holeCount = 0;
let pieceCount = 0;
let points = 0;
fc.features.forEach((f, i) => {
  const id = i + 1;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  const holes = [];
  for (const polygon of polygons) {
    // One polygon at a time, so the sign of each emitted piece tells outer
    // from hole and a clipped outer piece cannot be mistaken for one.
    const ctx = recorder();
    geoPath(projection, ctx)({ type: 'Polygon', coordinates: polygon });
    for (const ring of ctx.rings) {
      if (ring.length < 3) continue;
      const area = signedArea(ring);
      if (area === 0) continue;
      points += ring.length;
      pieceCount += 1;
      if (Math.sign(area) === outerSign) rings.push(round(ring));
      else { holes.push(round(ring)); holeCount += 1; }
    }
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  out.push({
    id,
    name: f.properties.name,
    numeric: f.id ?? null,
    area: rings.length ? (maxX - minX) * (maxY - minY) : 0,
    rings,
    holes,
  });
});

const sourceHoles = fc.features.reduce((n, f) => {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return n + polygons.reduce((m, p) => m + p.length - 1, 0);
}, 0);
// d3 rejoins rings the source cut at the antimeridian (Antarctica's coast is
// stored as two rings and comes back as one), so fewer holes is expected;
// more would mean the sign convention is wrong.
if (holeCount > sourceHoles) {
  throw new Error(`hole classification drifted: ${holeCount} emitted vs ${sourceHoles} in the source`);
}
if (holeCount !== sourceHoles) console.log(`note: ${sourceHoles} source holes, ${holeCount} after d3 rejoined antimeridian cuts`);
const empty = out.filter((f) => !f.rings.length).map((f) => f.name);
if (empty.length) throw new Error(`features without an outer ring: ${empty.join(', ')}`);

const cacheDir = join(root, 'data/cache/maps');
await mkdir(cacheDir, { recursive: true });
const ringsPath = join(cacheDir, 'rings.json');
await writeFile(ringsPath, JSON.stringify({ width: W, height: H, features: out }));
console.log(`rings.json: ${out.length} features, ${pieceCount} ring pieces (${holeCount} holes), ${points} points`);

const texDir = join(root, 'public/textures');
await mkdir(texDir, { recursive: true });

function py(script, ...args) {
  const r = spawnSync('python', ['-I', join(root, 'tools', script), ...args], { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${script} exited with ${r.status}`);
}

py('paint-maps.py', ringsPath, texDir);

for (const name of ['idmap.png', 'borders.png']) {
  const s = await stat(join(texDir, name)).catch(() => null);
  if (!s || s.size === 0) throw new Error(`${name} was not written`);
  console.log(`${name}: ${(s.size / 1024).toFixed(0)} KB`);
}

py('check-maps.py', ringsPath, join(texDir, 'idmap.png'));
