// Builds sub-national boundaries (states, municipalities) for the country
// focus view. One country at a time; Mexico is the default.
//
//   node tools/build-admin.mjs                 (npm run admin)
//   node tools/build-admin.mjs --country=MX    (ISO 3166-1 alpha-2)
//   ADMIN_FRESH=1 node tools/build-admin.mjs   (re-download the source)
//
// Source: geoBoundaries (https://www.geoboundaries.org), the gbOpen release,
// through its API: https://www.geoboundaries.org/api/current/gbOpen/<ISO3>/<ADMx>/
// The API answer carries `simplifiedGeometryGeoJSON`, the file we download
// into data/cache/admin/ (gitignored). geoBoundaries republishes each
// country's official or UN/World Bank layer; the license is per layer and
// comes with the API answer (`boundaryLicense`): for Mexico, ADM1 is INEGI via
// HDX under CC BY 3.0 IGO and ADM2 is the World Bank 2012 municipalities under
// CC BY 4.0. geoBoundaries itself asks to be cited (Runfola et al. 2020,
// PLoS ONE). The UI shows "geoBoundaries, CC BY 4.0" and links the API page.
//
// The simplified files are still 4 MB (ADM1) and 17 MB (ADM2), so this script
// simplifies them again with Visvalingam-Whyatt on a shared-arc topology:
// coordinates are quantized to 3 decimals (about 100 m), every vertex is
// classified as a junction (three or more distinct neighbors across all rings)
// or an interior arc point, rings are cut into arcs at the junctions, and each
// arc is simplified once, so two neighbors keep the same border and the map
// shows no slivers. Islands shrink to triangles before they vanish; rings
// smaller than a few km^2 are dropped when the feature has another ring.
// The result is a DISPLAY layer: good for a focus view at the scale of a
// country or a state, not for area, length, or legal questions.
//
// Output (public/data/admin/, committed):
//   <iso2>-adm1.json       FeatureCollection, properties { id, name, code }
//   <iso2>-adm2.json       FeatureCollection, properties { id, name, parent }
//                          (when it fits the size target), otherwise
//   <iso2>/<adm1-id>.json  one FeatureCollection of municipalities per state
//   index.json             what exists, sizes, source, license, build date
// See docs/PIPELINES.md, "Admin boundaries".

import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { root, cacheDir, exists, fetchRetry, loadFacts, today } from './net.mjs';

const API = 'https://www.geoboundaries.org/api/current/gbOpen';
const outDir = join(root, 'public/data/admin');
const adminCache = join(cacheDir, 'admin');
const FRESH = process.env.ADMIN_FRESH === '1';

// Size targets in bytes for the committed files.
const TARGET_ADM1 = 290_000;
const TARGET_ADM2 = 1_150_000;
const TARGET_STATE = 150_000; // per-state municipality files, at least...
const BYTES_PER_UNIT = 400;    // ...this much per municipality (Oaxaca has 569)
const Q = 1000; // quantization: 3 decimals

const arg = process.argv.find((a) => a.startsWith('--country='));
const ISO2 = (arg ? arg.slice('--country='.length) : 'MX').toUpperCase();

// ISO 3166-2 codes and Spanish names for Mexico's 32 states. geoBoundaries'
// ADM1 names are ASCII and the source codes both "Distrito Federal" and
// "Mexico" as MX-MEX; this table, keyed by the source's ASCII name, fixes both.
// [code, short name used on maps, long constitutional name when it differs]
const MX_STATES = {
  'Aguascalientes': ['MX-AGU', 'Aguascalientes'],
  'Baja California': ['MX-BCN', 'Baja California'],
  'Baja California Sur': ['MX-BCS', 'Baja California Sur'],
  'Campeche': ['MX-CAM', 'Campeche'],
  'Chiapas': ['MX-CHP', 'Chiapas'],
  'Chihuahua': ['MX-CHH', 'Chihuahua'],
  'Coahuila de Zaragoza': ['MX-COA', 'Coahuila', 'Coahuila de Zaragoza'],
  'Colima': ['MX-COL', 'Colima'],
  'Distrito Federal': ['MX-CMX', 'Ciudad de México'],
  'Durango': ['MX-DUR', 'Durango'],
  'Guanajuato': ['MX-GUA', 'Guanajuato'],
  'Guerrero': ['MX-GRO', 'Guerrero'],
  'Hidalgo': ['MX-HID', 'Hidalgo'],
  'Jalisco': ['MX-JAL', 'Jalisco'],
  'Mexico': ['MX-MEX', 'Estado de México', 'México'],
  'Michoacan de Ocampo': ['MX-MIC', 'Michoacán', 'Michoacán de Ocampo'],
  'Morelos': ['MX-MOR', 'Morelos'],
  'Nayarit': ['MX-NAY', 'Nayarit'],
  'Nuevo Leon': ['MX-NLE', 'Nuevo León'],
  'Oaxaca': ['MX-OAX', 'Oaxaca'],
  'Puebla': ['MX-PUE', 'Puebla'],
  'Queretaro de Arteaga': ['MX-QUE', 'Querétaro'],
  'Quintana Roo': ['MX-ROO', 'Quintana Roo'],
  'San Luis Potosi': ['MX-SLP', 'San Luis Potosí'],
  'Sinaloa': ['MX-SIN', 'Sinaloa'],
  'Sonora': ['MX-SON', 'Sonora'],
  'Tabasco': ['MX-TAB', 'Tabasco'],
  'Tamaulipas': ['MX-TAM', 'Tamaulipas'],
  'Tlaxcala': ['MX-TLA', 'Tlaxcala'],
  'Veracruz de Ignacio de la Llave': ['MX-VER', 'Veracruz', 'Veracruz de Ignacio de la Llave'],
  'Yucatan': ['MX-YUC', 'Yucatán'],
  'Zacatecas': ['MX-ZAC', 'Zacatecas'],
};
const ADM1_TABLES = { MX: MX_STATES };

// ---------------------------------------------------------------- fetching

async function getText(url, file) {
  const path = join(adminCache, file);
  if (!FRESH && (await exists(path))) return readFile(path, 'utf8');
  const res = await fetchRetry(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  await writeFile(path, text);
  return text;
}

async function fetchLevel(iso3, level) {
  const meta = JSON.parse(await getText(`${API}/${iso3}/${level}/`, `meta-${iso3}-${level}.json`));
  const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!url) throw new Error(`geoBoundaries has no GeoJSON link for ${iso3} ${level}`);
  const text = await getText(url, `${iso3}-${level}_simplified.geojson`);
  const geo = JSON.parse(text);
  console.log(`${level}: ${geo.features.length} features (${(text.length / 1e6).toFixed(1)} MB) ` +
    `from ${meta.boundarySource}, ${meta.boundaryLicense}, year ${meta.boundaryYearRepresented}`);
  return { meta, geo };
}

// ---------------------------------------------------------------- names

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function adm1Props(f, iso2) {
  const src = (f.properties.shapeName || '').trim();
  const table = ADM1_TABLES[iso2];
  const row = table && table[src];
  if (table && !row) console.warn(`  ADM1 "${src}" is not in the ${iso2} table; using the source as it stands`);
  const code = row ? row[0] : (f.properties.shapeISO || '').trim() || null;
  const name = row ? row[1] : src;
  const id = `${iso2.toLowerCase()}-${code ? code.slice(code.indexOf('-') + 1).toLowerCase() : slug(src)}`;
  const props = { id, name, code };
  if (row && row[2]) props.official = row[2];
  return props;
}

// ---------------------------------------------------------------- winding

// d3-geo wants exterior rings clockwise (the inside is the smaller side);
// GeoJSON (RFC 7946) writes them counterclockwise. Flip polygons whose outer
// ring covers more than a hemisphere as d3 reads it.
function rewind(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const rings of polys) {
    if (geoArea({ type: 'Polygon', coordinates: [rings[0]] }) > 2 * Math.PI) {
      for (const r of rings) r.reverse();
    }
  }
}

// ---------------------------------------------------------------- topology

// Projected planar area, km^2, from quantized integer coordinates.
function makeArea(lat0) {
  const kx = (111.32 * Math.cos((lat0 * Math.PI) / 180)) / Q;
  const ky = 110.57 / Q;
  return (a, b, c) =>
    Math.abs(((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) * kx * ky) / 2;
}

// Visvalingam-Whyatt with pinned endpoints. Returns one weight per point: the
// effective area at which the point would be removed (Infinity for the ends).
function vwWeights(pts, area) {
  const n = pts.length;
  const w = new Array(n).fill(Infinity);
  if (n < 3) return w;
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  const cur = new Float64Array(n);
  const ver = new Int32Array(n);
  const heap = []; // [area, index, version]
  function up(k) {
    const e = heap[k];
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= e[0]) break;
      heap[k] = heap[p];
      k = p;
    }
    heap[k] = e;
  }
  const push = (i) => { heap.push([cur[i], i, ver[i]]); up(heap.length - 1); };
  function pop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let k = 0;
      const m = heap.length;
      for (;;) {
        let l = 2 * k + 1;
        if (l >= m) break;
        const r = l + 1;
        if (r < m && heap[r][0] < heap[l][0]) l = r;
        if (heap[l][0] >= last[0]) break;
        heap[k] = heap[l];
        k = l;
      }
      heap[k] = last;
    }
    return top;
  }
  for (let i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1; }
  for (let i = 1; i < n - 1; i++) { cur[i] = area(pts[i - 1], pts[i], pts[i + 1]); push(i); }
  let floor = 0;
  while (heap.length) {
    const [a, i, v] = pop();
    if (v !== ver[i] || w[i] !== Infinity) continue;
    floor = Math.max(floor, a);
    w[i] = floor;
    const p = prev[i], q = next[i];
    next[p] = q;
    prev[q] = p;
    if (p > 0) { cur[p] = area(pts[prev[p]], pts[p], pts[q]); ver[p]++; push(p); }
    if (q < n - 1) { cur[q] = area(pts[p], pts[q], pts[next[q]]); ver[q]++; push(q); }
  }
  return w;
}

// Builds the shared-arc topology of a FeatureCollection and the VW weights
// of every arc. Returns a function `at(tolerance)` that produces a new
// FeatureCollection with simplified geometry (tolerance in km^2).
function topology(fc, lat0) {
  const area = makeArea(lat0);
  const key = (p) => p[0] * 4_000_000 + p[1]; // ints: lon in [-180e3, 180e3], lat in [-90e3, 90e3]
  // 1. quantize rings, drop consecutive duplicates and the closing point
  const feats = fc.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const qpolys = polys.map((rings) => rings.map((ring) => {
      const out = [];
      for (const [x, y] of ring) {
        const p = [Math.round(x * Q), Math.round(y * Q)];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
      return out;
    }).filter((r) => r.length >= 3)).filter((rings) => rings.length);
    return { properties: f.properties, polys: qpolys };
  });
  // 2. neighbor sets: a point with three or more distinct neighbors is a junction
  const neighbors = new Map();
  for (const f of feats) for (const rings of f.polys) for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const k = key(ring[i]);
      let s = neighbors.get(k);
      if (!s) { s = new Set(); neighbors.set(k, s); }
      s.add(key(ring[(i + n - 1) % n]));
      s.add(key(ring[(i + 1) % n]));
    }
  }
  const isJunction = (p) => neighbors.get(key(p)).size > 2;
  let junctions = 0;
  for (const s of neighbors.values()) if (s.size > 2) junctions++;
  // 3. cut rings into arcs; simplify each distinct arc once
  const arcs = new Map();
  function arcFor(pts) {
    const fwd = pts.map(key).join(',');
    const back = pts.slice().reverse().map(key).join(',');
    let rev = false, k = fwd;
    if (back < fwd) { rev = true; k = back; }
    let arc = arcs.get(k);
    if (!arc) {
      const apts = rev ? pts.slice().reverse() : pts;
      arc = { pts: apts, w: vwWeights(apts, area) };
      arcs.set(k, arc);
    }
    return { arc, rev };
  }
  const topo = feats.map((f) => ({
    properties: f.properties,
    polys: f.polys.map((rings) => rings.map((ring) => {
      const n = ring.length;
      const js = [];
      for (let i = 0; i < n; i++) if (isJunction(ring[i])) js.push(i);
      if (js.length === 0) {
        // a lone ring (an island, a hole): one closed arc pinned at its first point
        return { closed: true, arcs: [arcFor([...ring, ring[0]])] };
      }
      const out = [];
      for (let j = 0; j < js.length; j++) {
        const s = js[j], e = js[(j + 1) % js.length];
        const seg = [ring[s]];
        for (let i = (s + 1) % n; ; i = (i + 1) % n) { seg.push(ring[i]); if (i === e) break; }
        out.push(arcFor(seg));
      }
      return { closed: false, arcs: out };
    })),
  }));
  console.log(`  topology: ${neighbors.size} points, ${arcs.size} arcs, ${junctions} junctions`);

  function ringAt(r, tol) {
    const pts = [];
    for (const { arc, rev } of r.arcs) {
      let kept = [];
      for (let i = 0; i < arc.pts.length; i++) if (arc.w[i] >= tol) kept.push(i);
      if (r.closed && kept.length < 4) {
        // keep the three strongest points so an island stays a triangle
        kept = arc.w.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 4).map((x) => x[1]).sort((a, b) => a - b);
      }
      const seq = kept.map((i) => arc.pts[i]);
      if (rev) seq.reverse();
      for (let i = pts.length ? 1 : 0; i < seq.length; i++) pts.push(seq[i]); // the shared endpoint once
    }
    pts.pop(); // the ring closes on its first point; re-added on output
    return pts;
  }
  const kx = (111.32 * Math.cos((lat0 * Math.PI) / 180)) / Q;
  const ky = 110.57 / Q;
  const ringArea = (pts) => {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return (Math.abs(s) / 2) * kx * ky;
  };
  const toLL = (p) => [p[0] / Q, p[1] / Q];

  return function at(tol, pred = null) {
    // rings smaller than this are dropped (unless they are the feature's biggest):
    // slivers at the tolerance, and degenerate (collinear) rings, which d3-geo
    // would read as the whole sphere. 0.001 km^2 is below any real triangle at Q.
    const minRing = Math.max(tol * 3, 0.001);
    const features = (pred ? topo.filter((f) => pred(f.properties)) : topo).map((f) => {
      let polys = f.polys.map((rings) => rings.map((r) => ringAt(r, tol)).map((pts) => (pts.length >= 3 ? pts : null)));
      // drop tiny rings, but keep the biggest outer ring no matter what
      const outers = polys.map((rings) => rings[0]).filter(Boolean);
      const biggest = outers.reduce((b, r) => (!b || ringArea(r) > ringArea(b) ? r : b), null);
      polys = polys
        .map((rings) => rings.map((pts) => (pts && (pts === biggest || ringArea(pts) >= minRing) ? pts : null)))
        .filter((rings) => rings[0])
        .map((rings) => rings.filter(Boolean));
      const coords = polys.map((rings) => rings.map((pts) => { const ll = pts.map(toLL); ll.push(ll[0]); return ll; }));
      const geometry = coords.length === 1
        ? { type: 'Polygon', coordinates: coords[0] }
        : { type: 'MultiPolygon', coordinates: coords };
      return { type: 'Feature', properties: f.properties, geometry };
    });
    return { type: 'FeatureCollection', features };
  };
}

function countVertices(fc) {
  let n = 0;
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) for (const r of rings) n += r.length - 1;
  }
  return n;
}

// Finds the smallest tolerance (km^2) whose serialization fits the byte target.
function fit(at, target, label) {
  const size = (fc) => Buffer.byteLength(JSON.stringify(fc));
  const fc0 = at(0);
  const s0 = size(fc0);
  if (s0 <= target) {
    console.log(`  ${label}: ${(s0 / 1e3).toFixed(0)} KB, ${countVertices(fc0)} vertices, no simplification needed`);
    return { fc: fc0, tol: 0, bytes: s0 };
  }
  let lo = 0, hi = 0.5, best = null;
  while (size(at(hi)) > target) hi *= 2;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const fc = at(mid);
    const b = size(fc);
    if (b <= target) { hi = mid; best = { fc, tol: mid, bytes: b }; } else lo = mid;
  }
  if (!best) { const fc = at(hi); best = { fc, tol: hi, bytes: size(fc) }; }
  console.log(`  ${label}: tolerance ${best.tol.toFixed(3)} km², ${(best.bytes / 1e3).toFixed(0)} KB, ` +
    `${countVertices(best.fc)} of ${countVertices(fc0)} vertices (${(s0 / 1e3).toFixed(0)} KB unsimplified)`);
  return best;
}

// ---------------------------------------------------------------- main

async function main() {
  const { facts } = await loadFacts();
  const country = facts.countries.find((c) => c.iso2 === ISO2);
  if (!country) throw new Error(`${ISO2} is not in facts.json`);
  const iso3 = country.iso3;
  const iso2l = ISO2.toLowerCase();
  await mkdir(adminCache, { recursive: true });
  await mkdir(outDir, { recursive: true });
  console.log(`Admin boundaries for ${ISO2} (${iso3})`);

  const adm1 = await fetchLevel(iso3, 'ADM1');
  const adm2 = await fetchLevel(iso3, 'ADM2').catch((err) => { console.warn(`  no ADM2: ${err.message}`); return null; });

  // ADM1: winding, names, codes
  for (const f of adm1.geo.features) { rewind(f.geometry); f.properties = adm1Props(f, ISO2); }
  const ids = new Set();
  for (const f of adm1.geo.features) {
    if (ids.has(f.properties.id)) throw new Error(`duplicate ADM1 id ${f.properties.id}`);
    ids.add(f.properties.id);
  }
  const lat0 = geoCentroid(adm1.geo)[1];
  // bounding boxes so geoContains (O(vertices)) only runs on candidates
  const bbox = new Map(adm1.geo.features.map((s) => [s, geoBounds(s.geometry)]));
  const inBox = (s, [x, y]) => { const [[x0, y0], [x1, y1]] = bbox.get(s); return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
  const stateAt = (p) => adm1.geo.features.find((s) => inBox(s, p) && geoContains(s.geometry, p));

  // ADM2: parent by point-in-polygon of the centroid against ADM1, then ids
  if (adm2) {
    const unassigned = [];
    const perState = new Map();
    for (const f of adm2.geo.features) {
      rewind(f.geometry);
      const c = geoCentroid(f.geometry);
      let parent = stateAt(c);
      if (!parent) {
        // the centroid is outside its own shape (a crescent, an archipelago): let the vertices vote
        const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
        const votes = new Map();
        const step = Math.max(1, Math.floor(ring.length / 40));
        for (let i = 0; i < ring.length; i += step) {
          const s = stateAt(ring[i]);
          if (s) votes.set(s, (votes.get(s) || 0) + 1);
        }
        parent = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      }
      const name = (f.properties.shapeName || '').trim();
      if (!parent) {
        unassigned.push(name);
        f.properties = { id: `${iso2l}-${slug(name)}`, name, parent: null };
        continue;
      }
      const pid = parent.properties.id;
      let id = `${pid}-${slug(name)}`;
      for (let k = 2; ids.has(id); k++) id = `${pid}-${slug(name)}-${k}`;
      ids.add(id);
      f.properties = { id, name, parent: pid };
      perState.set(pid, (perState.get(pid) || 0) + 1);
    }
    if (unassigned.length) console.warn(`  ${unassigned.length} ADM2 without a parent: ${unassigned.slice(0, 10).join(', ')}`);
    console.log(`  ADM2 per state: ${[...perState.entries()].map(([k, v]) => `${k.slice(3)} ${v}`).join(', ')}`);
  }

  // ADM1 output
  console.log('Simplifying ADM1');
  const r1 = fit(topology(adm1.geo, lat0), TARGET_ADM1, 'adm1');
  const adm1Path = join(outDir, `${iso2l}-adm1.json`);
  await writeFile(adm1Path, JSON.stringify(r1.fc));

  const levelMeta = (m, tol, bytes, count) => ({
    count,
    bytes,
    toleranceKm2: Number(tol.toFixed(3)),
    year: m.boundaryYearRepresented,
    source: m.boundarySource,
    license: m.boundaryLicense,
    sourceUrl: m.boundarySourceURL,
    api: `${API}/${m.boundaryISO}/${m.boundaryType}/`,
    gbBuild: m.buildDate,
  });
  const entry = { iso3, levels: {} };
  entry.levels.adm1 = { file: `${iso2l}-adm1.json`, ...levelMeta(adm1.meta, r1.tol, r1.bytes, r1.fc.features.length) };

  // ADM2 output: one file when it keeps enough detail, otherwise per state
  const single = join(outDir, `${iso2l}-adm2.json`);
  const splitDir = join(outDir, iso2l);
  if (await exists(splitDir)) await rm(splitDir, { recursive: true });
  if (await exists(single)) await rm(single);
  if (adm2) {
    console.log('Simplifying ADM2');
    const t2 = topology(adm2.geo, lat0);
    const r2 = fit(t2, TARGET_ADM2, 'adm2 (single file)');
    const keep = countVertices(r2.fc) / countVertices(t2(0));
    if (keep >= 0.4) {
      await writeFile(single, JSON.stringify(r2.fc));
      entry.levels.adm2 = { file: `${iso2l}-adm2.json`, ...levelMeta(adm2.meta, r2.tol, r2.bytes, r2.fc.features.length) };
    } else {
      console.log(`  a single file would keep ${(keep * 100).toFixed(0)}% of the vertices; splitting per state`);
      await mkdir(splitDir, { recursive: true });
      const files = {};
      let total = 0, count = 0, tolMax = 0;
      for (const s of adm1.geo.features) {
        const pid = s.properties.id;
        // filter the national topology so shared borders agree between states
        const at = (tol) => t2(tol, (p) => p.parent === pid);
        const n = at(0).features.length;
        if (!n) continue;
        const r = fit(at, Math.max(TARGET_STATE, n * BYTES_PER_UNIT), pid);
        const file = `${iso2l}/${pid}.json`;
        await writeFile(join(outDir, file), JSON.stringify(r.fc));
        files[pid] = { file, count: r.fc.features.length, bytes: r.bytes, toleranceKm2: Number(r.tol.toFixed(3)) };
        total += r.bytes; count += r.fc.features.length; tolMax = Math.max(tolMax, r.tol);
      }
      entry.levels.adm2 = { split: 'adm1', dir: `${iso2l}/`, ...levelMeta(adm2.meta, tolMax, total, count), files };
      const orphans = adm2.geo.features.filter((f) => !f.properties.parent).length;
      if (orphans) entry.levels.adm2.unassigned = orphans;
    }
  }

  // index.json, merged with the countries already there
  const index = {
    built: today(),
    source: 'geoBoundaries (gbOpen), https://www.geoboundaries.org',
    credit: 'geoBoundaries, CC BY 4.0',
    citation: 'Runfola D, et al. (2020) geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866.',
    note: 'Simplified for display (Visvalingam-Whyatt on shared arcs, coordinates at 3 decimals). Not for area, length or legal questions. Each level carries the license of its own source layer.',
    countries: {},
  };
  const indexPath = join(outDir, 'index.json');
  if (await exists(indexPath)) {
    try {
      const prev = JSON.parse(await readFile(indexPath, 'utf8'));
      for (const [k, v] of Object.entries(prev.countries || {})) if (k !== ISO2) index.countries[k] = v;
    } catch { /* rebuilt from scratch */ }
  }
  index.countries[ISO2] = entry;
  await writeFile(indexPath, JSON.stringify(index, null, 2));

  const kb = async (p) => `${((await stat(p)).size / 1e3).toFixed(0)} KB`;
  console.log(`\nWrote ${adm1Path} (${await kb(adm1Path)})`);
  console.log(`Wrote ${indexPath}`);
  console.log(`ADM1 ${r1.fc.features.length}: ${r1.fc.features.map((f) => f.properties.name).sort().join(', ')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
