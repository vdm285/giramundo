// The corner globe: a small orthographic Earth drawn with d3-geo on a canvas.
// Drag it to spin the world; release, and the country under its center
// becomes the new country. No click in between. It is the way out of a
// country when the stage is showing that country up close.

import { geoCentroid, geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo';

export function createMiniGlobe(canvas, world, { onPick, onHover } = {}) {
  const ctx = canvas.getContext('2d');
  const projection = geoOrthographic().clipAngle(90);
  const path = geoPath(projection, ctx);
  const graticule = geoGraticule10();
  let size = 150;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let rotation = [60, -15, 0];
  let selected = null;
  let dragging = false;
  let moved = 0;
  let last = null;
  let spinning = true;
  let dirty = true;
  let running = true;
  let lastNow = performance.now();

  function resize() {
    size = canvas.clientWidth || 150;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    projection.scale(size / 2 - 2).translate([size / 2, size / 2]);
    dirty = true;
  }

  function centerCountry() {
    const center = projection.invert([size / 2, size / 2]);
    if (!center) return null;
    const feature = world.index.find(center[0], center[1]);
    return feature ? (world.byIso.get(feature.properties.iso2) || world.byPlace.get(feature.properties.placeId) || null) : null;
  }

  function draw() {
    projection.rotate(rotation);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    // Ocean disc.
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(size * 0.38, size * 0.36, size * 0.05, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#5a9ccf');
    g.addColorStop(0.55, '#1f5a8a');
    g.addColorStop(1, '#0b1d31');
    ctx.fillStyle = g;
    ctx.fill();
    // Land.
    ctx.beginPath();
    for (const f of world.features) path(f);
    ctx.fillStyle = '#7f9a6a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    path(graticule);
    ctx.stroke();
    if (selected) {
      ctx.beginPath();
      path(selected);
      ctx.fillStyle = 'rgba(242,178,74,0.9)';
      ctx.fill();
    }
    // Center ring: the pick point.
    const hit = centerCountry();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 7, 0, Math.PI * 2);
    ctx.strokeStyle = hit ? '#f2b24a' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    canvas.title = hit ? (hit.name?.es || hit.name?.en || '') : '';
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (spinning && !dragging) { rotation[0] += dt * 6; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(frame);
  }

  function onDown(e) {
    dragging = true;
    moved = 0;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    last = [e.clientX, e.clientY];
    const k = 180 / size;
    rotation = [rotation[0] + dx * k, Math.max(-80, Math.min(80, rotation[1] - dy * k)), 0];
    dirty = true;
    if (onHover) onHover(centerCountry());
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    const hit = centerCountry();
    if (hit && onPick) onPick(hit, moved < 6 ? 'tap' : 'release');
  }
  function onWheel(e) {
    e.preventDefault();
    rotation = [rotation[0] + e.deltaY * 0.15, rotation[1], 0];
    dirty = true;
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  resize();
  requestAnimationFrame(frame);

  return {
    setSelected(feature) {
      selected = feature || null;
      if (feature) {
        // Center the globe on the selected country so the rest is one drag away.
        const c = geoCentroid(feature);
        if (c && Number.isFinite(c[0])) rotation = [-c[0], -c[1], 0];
      }
      dirty = true;
    },
    setSpin(on) { spinning = on; },
    resize,
    dispose() {
      running = false;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
