// The flat map: an equirectangular world drawn with Canvas 2D. Same picking,
// same selection, same dossier as the globe. Offered when WebGL is missing or
// slow, and available as a view in its own right.
//
// Equirectangular was chosen because the NASA plates and the country index
// already live in that layout, so this view costs no extra assets.

import { geoBounds, geoCentroid, geoContains, geoEquirectangular, geoPath } from 'd3-geo';
import { subsolarPoint, wrapLon } from '../geo/math.js';

const ACCENT = '#f2b24a';
const DAY_URL = 'textures/earth-day.jpg';

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

// Globe distance (Earth radii) <-> pixels per degree, so the two surfaces
// share one notion of "how close".
function distToPpd(dist, h) {
  const fov = 32 * Math.PI / 180;
  const radiusPx = (1 / (dist * Math.tan(fov / 2))) * (h / 2);
  return (radiusPx * Math.PI) / 180;
}
function ppdToDist(ppd, h) {
  const fov = 32 * Math.PI / 180;
  const radiusPx = (ppd * 180) / Math.PI;
  return (h / 2) / (radiusPx * Math.tan(fov / 2));
}

export function createFlatMap(canvas, world, { base, wire = false }) {
  const ctx = canvas.getContext('2d');
  const view = { lat: 15, lon: -40, dist: 4.2 };
  const taps = new Set();
  const moves = new Set();
  let style = 'earth';
  let selected = null;
  let hover = null;
  let ghost = null;
  let admin = null;
  let adminHover = null;
  let adminSelected = null;
  let markers = [];
  let beacon = null;
  let colorFor = null;
  let dirty = true;
  let running = true;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let fly = null;
  let zoomTarget = null;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 1;
  let h = 1;
  let frames = 0;
  let fpsStart = performance.now();
  const fpsHist = [];

  const day = new Image();
  day.crossOrigin = 'anonymous';
  day.onload = () => { dirty = true; };
  if (!wire) day.src = `${base}${DAY_URL}`;

  // Night mask: a coarse per-pixel sun test, redrawn every minute.
  const night = document.createElement('canvas');
  night.width = 360;
  night.height = 180;
  let nightAt = 0;
  function paintNight() {
    const spot = subsolarPoint(new Date());
    const nctx = night.getContext('2d');
    const img = nctx.createImageData(360, 180);
    const sl = spot.lat * Math.PI / 180;
    const sn = spot.lon * Math.PI / 180;
    for (let y = 0; y < 180; y++) {
      const lat = (89.5 - y) * Math.PI / 180;
      for (let x = 0; x < 360; x++) {
        const lon = (x - 179.5) * Math.PI / 180;
        const cos = Math.sin(lat) * Math.sin(sl) + Math.cos(lat) * Math.cos(sl) * Math.cos(lon - sn);
        const dark = 1 - Math.min(1, Math.max(0, (cos + 0.1) / 0.3));
        const i = (y * 360 + x) * 4;
        img.data[i] = 4; img.data[i + 1] = 6; img.data[i + 2] = 14; img.data[i + 3] = Math.round(dark * 175);
      }
    }
    nctx.putImageData(img, 0, 0);
    nightAt = Date.now();
  }
  paintNight();

  const projection = geoEquirectangular();
  const path = geoPath(projection, ctx);

  function ppd() { return distToPpd(view.dist, h); }
  function minDist() { return ppdToDist(Math.max(w / 360, h / 180) , h); }
  // The zoom floor: 0.35 keeps the 8k plate from turning to mush at the
  // world level; with state or municipal boundaries loaded the lines are
  // the picture, so a state (even Ciudad de México) may fill the screen.
  function clampDist(d) { return Math.max(admin ? 0.03 : 0.35, Math.min(minDist(), d)); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.dist = clampDist(view.dist);
    cache = null;
    dirty = true;
  }

  function setup() {
    const k = ppd();
    projection.scale(k * 180 / Math.PI).translate([w / 2 - view.lon * k, h / 2 + view.lat * k]);
  }

  function clampView() {
    const k = ppd();
    const halfH = h / 2 / k;
    view.lat = Math.max(-90 + halfH, Math.min(90 - halfH, view.lat));
    if (90 - halfH < 0) view.lat = 0;
    view.lon = wrapLon(view.lon);
  }

  function pickLatLon(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    setup();
    const p = projection.invert([clientX - rect.left, clientY - rect.top]);
    if (!p || Math.abs(p[1]) > 90) return null;
    return { lat: p[1], lon: wrapLon(p[0]) };
  }

  function project(lat, lon) {
    setup();
    const rect = canvas.getBoundingClientRect();
    const k = ppd();
    // Pick the world copy nearest the viewport center.
    let l = lon;
    const dl = wrapLon(lon - view.lon);
    l = view.lon + dl;
    const [x, y] = projection([l, lat]);
    void k;
    return { x: rect.left + x, y: rect.top + y, depth: 1 };
  }

  // The static layer (base image or fills, graticule, borders, night mask) is
  // expensive: 250 vector outlines. It is rendered once into an offscreen
  // canvas with a margin around the viewport and reused while panning; it is
  // re-rendered only when zoom, style, data colors or the margin run out.
  let cache = null;
  let colorVersion = 0;

  function worldCopies(x0, worldW, width) {
    const copies = [];
    for (let off = -1; off <= 1; off++) {
      const x = x0 + off * worldW;
      if (x + worldW < -50 || x > width + 50) continue;
      copies.push(off);
    }
    return copies;
  }

  function renderStatic(k, x0, y0) {
    const margin = Math.round(Math.max(w, h) * 0.6);
    const cw = w + 2 * margin;
    const ch = h + 2 * margin;
    if (!cache || cache.canvas.width !== Math.round(cw * dpr) || cache.canvas.height !== Math.round(ch * dpr)) {
      const canvas2 = document.createElement('canvas');
      canvas2.width = Math.round(cw * dpr);
      canvas2.height = Math.round(ch * dpr);
      cache = { canvas: canvas2 };
    }
    const c = cache.canvas.getContext('2d');
    const cpath = geoPath(projection, c);
    c.setTransform(dpr, 0, 0, dpr, margin * dpr, margin * dpr);
    c.fillStyle = '#05070c';
    c.fillRect(-margin, -margin, cw, ch);
    const worldW = 360 * k;
    const mapH = 180 * k;
    if (style === 'earth' && Date.now() - nightAt > 60000) paintNight();
    for (const off of worldCopies(x0, worldW, w + 2 * margin)) {
      c.save();
      c.translate(off * worldW, 0);
      if (wire) {
        // Wireframe: white paper, black outlines, nothing else.
        c.fillStyle = '#fff';
        c.fillRect(x0, y0, worldW, mapH);
        c.strokeStyle = '#000';
        c.lineWidth = 0.8;
        c.beginPath();
        for (const f of world.features) cpath(f);
        c.stroke();
        c.restore();
        continue;
      }
      if (style === 'earth') {
        if (day.complete && day.naturalWidth) c.drawImage(day, x0, y0, worldW, mapH);
        else { c.fillStyle = '#10243b'; c.fillRect(x0, y0, worldW, mapH); }
        c.imageSmoothingEnabled = true;
        c.drawImage(night, x0, y0, worldW, mapH);
      } else {
        c.fillStyle = style === 'data' ? '#0d1522' : '#c7d9e3';
        c.fillRect(x0, y0, worldW, mapH);
        if (style === 'atlas') {
          c.strokeStyle = 'rgba(36,48,58,0.18)';
          c.lineWidth = 1;
          c.beginPath();
          for (let lon = -180; lon <= 180; lon += 15) cpath({ type: 'LineString', coordinates: [[lon, -90], [lon, 90]] });
          for (let lat = -75; lat <= 75; lat += 15) cpath({ type: 'LineString', coordinates: [[-180, lat], [180, lat]] });
          c.stroke();
        }
        for (const f of world.features) {
          let fill = f.properties.fill || '#e6d7c3';
          if (style === 'data') fill = (colorFor && colorFor(f)) || '#2a2e35';
          c.fillStyle = fill;
          c.beginPath();
          cpath(f);
          c.fill();
        }
      }
      c.strokeStyle = style === 'atlas' ? 'rgba(48,36,28,0.7)' : style === 'data' ? 'rgba(160,175,195,0.35)' : 'rgba(255,255,255,0.22)';
      c.lineWidth = style === 'atlas' ? 1 : 0.8;
      c.lineJoin = 'round';
      c.beginPath();
      for (const f of world.features) cpath(f);
      c.stroke();
      c.restore();
    }
    Object.assign(cache, { k, x0, y0, style, margin, cw, ch, colorVersion, nightAt, dayReady: Boolean(day.complete && day.naturalWidth) });
  }

  function draw() {
    setup();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = ppd();
    const worldW = 360 * k;
    const [x0, y0] = projection([-180, 90]);
    const dayReady = Boolean(day.complete && day.naturalWidth);
    const fresh = cache && cache.k === k && cache.style === style && cache.colorVersion === colorVersion
      && cache.dayReady === dayReady && (style !== 'earth' || Date.now() - cache.nightAt < 60000)
      && Math.abs(x0 - cache.x0) <= cache.margin && Math.abs(y0 - cache.y0) <= cache.margin;
    if (!fresh) renderStatic(k, x0, y0);
    ctx.drawImage(cache.canvas, 0, 0, cache.canvas.width, cache.canvas.height,
      (x0 - cache.x0) - cache.margin, (y0 - cache.y0) - cache.margin, cache.cw, cache.ch);
    const copies = worldCopies(x0, worldW, w);
    for (const off of copies) {
      const x = x0 + off * worldW;
      ctx.save();
      ctx.translate(off * worldW, 0);
      // Admin layer (states, then municipalities) in focus mode: light fills,
      // ink strokes, the hovered or chosen unit lifted, names at centroids.
      if (admin?.features?.length) {
        const k2 = ppd();
        for (const f of admin.features) {
          const hot = f.properties.id === adminHover || f.properties.id === adminSelected;
          ctx.fillStyle = hot ? 'rgba(242,178,74,0.55)' : 'rgba(255,255,255,0.22)';
          ctx.beginPath(); path(f); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(48,36,28,0.75)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (const f of admin.features) path(f);
        ctx.stroke();
        if (k2 > 9) {
          ctx.font = `600 ${Math.min(14, 8 + k2 / 4)}px Outfit, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const f of admin.features) {
            const c = f.properties.centroid || geoCentroid(f);
            f.properties.centroid = c;
            const [cx, cy] = projection(c);
            const label = f.properties.name || '';
            if (!label) continue;
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(247,242,232,0.85)';
            ctx.strokeText(label, cx, cy);
            ctx.fillStyle = '#1b1813';
            ctx.fillText(label, cx, cy);
          }
        }
      }
      // True-size overlay: the selected shape rotated onto the compared country.
      if (ghost) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#7fd1ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); path(ghost); ctx.stroke();
        ctx.fillStyle = 'rgba(127,209,255,0.18)';
        ctx.beginPath(); path(ghost); ctx.fill();
        ctx.restore();
      }
      // Hover and selection.
      if (hover && hover !== selected) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath(); path(hover); ctx.fill();
      }
      if (selected) {
        ctx.fillStyle = style === 'atlas' ? 'rgba(242,178,74,0.45)' : 'rgba(242,178,74,0.28)';
        ctx.beginPath(); path(selected); ctx.fill();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 10;
        ctx.beginPath(); path(selected); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Markers.
      const scale = Math.max(0.6, Math.min(1.5, 2.6 / view.dist));
      for (const m of markers) {
        const [mx, my] = projection([m.lon, m.lat]);
        const r = (m.size || 8) * 0.5 * scale * (m.highlight ? 1.5 : 1);
        ctx.beginPath(); ctx.arc(mx, my, r + 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fillStyle = m.color || ACCENT; ctx.fill();
      }
      // Beacon rings.
      if (beacon) {
        const [bx, by] = projection([beacon.lon, beacon.lat]);
        const tsec = performance.now() / 1000;
        for (let i = 0; i < 2; i++) {
          const tt = (tsec * 0.55 + i * 0.5) % 1;
          ctx.beginPath(); ctx.arc(bx, by, 4 + tt * 26 * scale, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(242,178,74,${(1 - tt) * 0.9})`; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff6e0'; ctx.fill();
      }
      ctx.restore();
      void x;
    }
  }

  let lastNow = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    let moving = false;
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.dur);
      const e = easeInOut(t);
      view.lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
      view.lon = fly.from.lon + (fly.to.lon - fly.from.lon) * e;
      view.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e;
      if (t >= 1) fly = null;
      moving = true;
    } else if (zoomTarget != null && Math.abs(zoomTarget.dist - view.dist) > 0.0005) {
      // Zoom toward the cursor: keep the geographic point under it fixed.
      const before = pickLatLon(zoomTarget.x, zoomTarget.y);
      view.dist += (zoomTarget.dist - view.dist) * (1 - Math.exp(-12 * dt));
      const after = pickLatLon(zoomTarget.x, zoomTarget.y);
      if (before && after) { view.lon += before.lon - after.lon; view.lat += before.lat - after.lat; }
      moving = true;
    }
    clampView();
    if (moving || dirty || beacon) { draw(); dirty = false; }
    frames += 1;
    if (now - fpsStart > 1000) { fpsHist.push(frames * 1000 / (now - fpsStart)); if (fpsHist.length > 10) fpsHist.shift(); frames = 0; fpsStart = now; }
    requestAnimationFrame(frame);
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; fly = null; zoomTarget = null;
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) { for (const fn of moves) fn(e); return; }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    const k = ppd();
    view.lon -= dx / k;
    view.lat += dy / k;
    dirty = true;
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (moved < 6) for (const fn of taps) fn(e);
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0022);
    const current = zoomTarget?.dist ?? view.dist;
    zoomTarget = { x: e.clientX, y: e.clientY, dist: clampDist(current * factor) };
    void rect;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  const control = {
    nudge(dx, dy) { const k = ppd(); view.lon -= dx / k; view.lat += dy / k; dirty = true; },
    zoomBy(f) { zoomTarget = { x: w / 2, y: h / 2, dist: clampDist((zoomTarget?.dist ?? view.dist) * f) }; },
  };

  return {
    view,
    control,
    resize,
    pickLatLon,
    project,
    markerAt(clientX, clientY, radius = 16) {
      let best = null; let bestD = radius;
      for (const m of markers) {
        const p = project(m.lat, m.lon);
        const d = Math.hypot(p.x - clientX, p.y - clientY);
        if (d < bestD) { best = m; bestD = d; }
      }
      return best;
    },
    flyTo(lat, lon, dist = view.dist, { duration } = {}) {
      const toLon = view.lon + wrapLon(lon - view.lon);
      fly = { from: { lat: view.lat, lon: view.lon, dist: view.dist }, to: { lat, lon: toLon, dist: clampDist(dist) }, t0: performance.now(), dur: duration || 900 };
      zoomTarget = null;
    },
    onTap(fn) { taps.add(fn); return () => taps.delete(fn); },
    onMove(fn) { moves.add(fn); return () => moves.delete(fn); },
    setStyle(s) { style = s; dirty = true; },
    setSelected(f) { selected = f; dirty = true; },
    setHover(f) { if (hover !== f) { hover = f; dirty = true; } },
    setCompare() {},
    setGhost(f) { ghost = f || null; dirty = true; },
    // Focus mode: fit a feature's bounds into the viewport, leaving `coveredRight`
    // px for the dossier, so the country (or state) fills what the reader sees.
    fitBounds(feature, { coveredRight = 0, pad = 0.12, duration = 900 } = {}) {
      const [[lon0, lat0], [lon1, lat1]] = geoBounds(feature);
      const dLon = Math.max(0.5, lon1 >= lon0 ? lon1 - lon0 : (lon1 + 360) - lon0);
      const dLat = Math.max(0.5, lat1 - lat0);
      const visibleW = Math.max(200, w - coveredRight);
      const k = Math.min(visibleW / (dLon * (1 + pad * 2)), h / (dLat * (1 + pad * 2)));
      const dist = clampDist(ppdToDist(k, h));
      const cLon = wrapLon(lon0 + dLon / 2);
      const cLat = (lat0 + lat1) / 2;
      // Shift the center so the shape sits in the uncovered part of the screen.
      const shiftLon = (coveredRight / 2) / k;
      const toLon = view.lon + wrapLon(cLon + shiftLon - view.lon);
      fly = { from: { lat: view.lat, lon: view.lon, dist: view.dist }, to: { lat: cLat, lon: toLon, dist }, t0: performance.now(), dur: duration };
      zoomTarget = null;
    },
    setAdmin(collection) { admin = collection || null; adminHover = null; adminSelected = null; dirty = true; },
    setAdminHover(id) { if (adminHover !== id) { adminHover = id; dirty = true; } },
    setAdminSelected(id) { adminSelected = id; dirty = true; },
    adminAt(clientX, clientY) {
      if (!admin?.features?.length) return null;
      const ll = pickLatLon(clientX, clientY);
      if (!ll) return null;
      for (const f of admin.features) if (geoContains(f, [ll.lon, ll.lat])) return f;
      return null;
    },
    setDataColors(fn) { colorFor = fn; colorVersion += 1; dirty = true; },
    setMarkers(list) { markers = list; dirty = true; },
    setBeacon(lat, lon) { beacon = lat == null ? null : { lat, lon }; dirty = true; },
    addArc() { return null; },
    clearArcs() {},
    setClouds() {},
    setSunOffset() {},
    setSpin() {},
    getFps: () => fpsHist.at(-1) || 60,
    getFpsHistory: () => [...fpsHist],
    dispose() {
      running = false;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
    },
  };
}
