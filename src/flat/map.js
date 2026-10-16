// The flat map: an equirectangular world drawn with Canvas 2D. Same picking,
// same selection, same dossier as the globe. Offered when WebGL is missing or
// slow, and available as a view in its own right.
//
// Equirectangular was chosen because the NASA plates and the country index
// already live in that layout, so this view costs no extra assets.

import { geoEquirectangular, geoPath } from 'd3-geo';
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

export function createFlatMap(canvas, world, { base }) {
  const ctx = canvas.getContext('2d');
  const view = { lat: 15, lon: -40, dist: 4.2 };
  const taps = new Set();
  const moves = new Set();
  let style = 'earth';
  let selected = null;
  let hover = null;
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
  day.src = `${base}${DAY_URL}`;

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
  function clampDist(d) { return Math.max(0.35, Math.min(minDist(), d)); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.dist = clampDist(view.dist);
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

  function draw() {
    setup();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    const k = ppd();
    const worldW = 360 * k;
    const [x0, y0] = projection([-180, 90]);
    const mapH = 180 * k;
    // Copies of the world so panning wraps.
    const copies = [];
    for (let off = -1; off <= 1; off++) {
      const x = x0 + off * worldW;
      if (x + worldW < -50 || x > w + 50) continue;
      copies.push(off);
    }
    for (const off of copies) {
      const x = x0 + off * worldW;
      ctx.save();
      ctx.translate(off * worldW, 0);
      if (style === 'earth') {
        if (day.complete && day.naturalWidth) ctx.drawImage(day, x0, y0, worldW, mapH);
        else { ctx.fillStyle = '#10243b'; ctx.fillRect(x0, y0, worldW, mapH); }
        if (Date.now() - nightAt > 60000) paintNight();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(night, x0, y0, worldW, mapH);
      } else {
        ctx.fillStyle = style === 'data' ? '#0d1522' : '#c7d9e3';
        ctx.fillRect(x0, y0, worldW, mapH);
        if (style === 'atlas') {
          ctx.strokeStyle = 'rgba(36,48,58,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let lon = -180; lon <= 180; lon += 15) path({ type: 'LineString', coordinates: [[lon, -90], [lon, 90]] });
          for (let lat = -75; lat <= 75; lat += 15) path({ type: 'LineString', coordinates: [[-180, lat], [180, lat]] });
          ctx.stroke();
        }
        for (const f of world.features) {
          let fill = f.properties.fill || '#e6d7c3';
          if (style === 'data') fill = (colorFor && colorFor(f)) || '#2a2e35';
          ctx.fillStyle = fill;
          ctx.beginPath();
          path(f);
          ctx.fill();
        }
      }
      // Borders.
      ctx.strokeStyle = style === 'atlas' ? 'rgba(48,36,28,0.7)' : style === 'data' ? 'rgba(160,175,195,0.35)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = style === 'atlas' ? 1 : 0.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const f of world.features) path(f);
      ctx.stroke();
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
    setDataColors(fn) { colorFor = fn; dirty = true; },
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
