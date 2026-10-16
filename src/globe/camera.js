// The view: where the camera looks (lat, lon) and how far it is (dist, in
// Earth radii). Handles drag with inertia, wheel and pinch zoom, keyboard
// nudges, flights, and the idle spin. The sphere math is in ../geo and is
// covered by tests/geo.test.mjs; this file only decides when to call it.

import { shortestLonDelta } from '../geo/math.js';
import { applyDrag } from '../geo/orient.js';

export const MIN_DIST = 1.22;
export const MAX_DIST = 6.8;

function clampDist(d) {
  return Math.max(MIN_DIST, Math.min(MAX_DIST, d));
}

export function wrapLon(lon) {
  return (((lon + 180) % 360) + 360) % 360 - 180;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function createCamera(canvas, { fov = 32, reduced = false } = {}) {
  const view = { lat: reduced ? 22 : 10, lon: reduced ? -102 : -40, dist: reduced ? 3.2 : 5.6 };
  const taps = new Set();
  const moves = new Set();
  let spin = !reduced;
  let spinRate = 2.6; // degrees per second
  let holdUntil = 0;
  let fly = null;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let vx = 0;
  let vy = 0;
  let lastDragAt = 0;
  const touches = new Map();
  let pinch = 0;
  let zoomTarget = view.dist;

  function degPerPx() {
    const h = canvas.clientHeight || window.innerHeight;
    const radius = (1 / (view.dist * Math.tan((fov * Math.PI / 180) / 2))) * (h / 2);
    return 78 / Math.max(80, radius);
  }

  function flyTo(lat, lon, dist = view.dist, { turns = 0, duration } = {}) {
    holdUntil = performance.now() + 20000;
    const toLon = view.lon + shortestLonDelta(view.lon, lon) + turns * 360;
    const target = clampDist(dist);
    zoomTarget = target;
    if (reduced) {
      view.lat = lat;
      view.lon = wrapLon(toLon);
      view.dist = target;
      fly = null;
      return;
    }
    const angle = Math.hypot(lat - view.lat, toLon - view.lon);
    // Long hops rise first so the ground does not smear past the camera.
    const hump = angle > 35 ? Math.max(view.dist, target, Math.min(4.6, 2.2 + angle / 60)) : 0;
    fly = {
      from: { lat: view.lat, lon: view.lon, dist: view.dist },
      to: { lat, lon: toLon, dist: target },
      hump,
      t0: performance.now(),
      dur: duration || (turns ? 1700 : Math.min(1500, 700 + angle * 7)),
    };
  }

  function update(now, dt) {
    let moving = false;
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.dur);
      const e = easeInOut(t);
      view.lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
      view.lon = fly.from.lon + (fly.to.lon - fly.from.lon) * e;
      let dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e;
      if (fly.hump) dist += (fly.hump - Math.max(fly.from.dist, fly.to.dist)) * Math.sin(Math.PI * t) * 0.9;
      view.dist = dist;
      moving = true;
      if (t >= 1) {
        view.lon = wrapLon(view.lon);
        fly = null;
      }
    } else {
      if (!dragging && (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02)) {
        applyDrag(view, vx, vy, degPerPx());
        const decay = Math.exp(-3.4 * dt);
        vx *= decay;
        vy *= decay;
        moving = true;
      }
      if (Math.abs(zoomTarget - view.dist) > 0.0005) {
        view.dist += (zoomTarget - view.dist) * (1 - Math.exp(-10 * dt));
        moving = true;
      }
      if (spin && !dragging && now > holdUntil) {
        // Slow down when close so the ground does not race by.
        view.lon += dt * spinRate * Math.min(1, (view.dist - 1) / 2.2);
        moving = true;
      }
    }
    if (dragging) moving = true;
    return moving;
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size > 1) { dragging = false; return; }
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    vx = 0;
    vy = 0;
    fly = null;
    zoomTarget = view.dist;
    holdUntil = performance.now() + 26000;
    canvas.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) { view.dist = clampDist(view.dist * (pinch / d)); zoomTarget = view.dist; }
      pinch = d;
      return;
    }
    if (!dragging) {
      for (const fn of moves) fn(event);
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    const now = performance.now();
    // Velocity in px per frame, smoothed, so a slow release does not fling.
    const dtMs = Math.max(8, now - lastDragAt);
    lastDragAt = now;
    const k = Math.min(1, dtMs / 32);
    vx = vx * (1 - k) + dx * k;
    vy = vy * (1 - k) + dy * k;
    applyDrag(view, dx, dy, degPerPx());
  }

  function onPointerUp(event) {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = 0;
    if (!dragging) return;
    dragging = false;
    if (performance.now() - lastDragAt > 90) { vx = 0; vy = 0; }
    if (moved < 7) for (const fn of taps) fn(event);
  }

  function onWheel(event) {
    event.preventDefault();
    fly = null;
    holdUntil = performance.now() + 20000;
    const factor = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0022);
    zoomTarget = clampDist(zoomTarget * factor);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    view,
    degPerPx,
    flyTo,
    update,
    isDragging: () => dragging,
    isFlying: () => Boolean(fly),
    hold(ms = 20000) { holdUntil = performance.now() + ms; },
    stop() { fly = null; vx = 0; vy = 0; zoomTarget = view.dist; },
    nudge(dx, dy) { fly = null; holdUntil = performance.now() + 20000; applyDrag(view, dx, dy, degPerPx()); },
    zoomBy(factor) { fly = null; holdUntil = performance.now() + 20000; zoomTarget = clampDist(zoomTarget * factor); },
    setSpin(on) { spin = on && !reduced; },
    setSpinRate(deg) { spinRate = deg; },
    onTap(fn) { taps.add(fn); return () => taps.delete(fn); },
    onMove(fn) { moves.add(fn); return () => moves.delete(fn); },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
