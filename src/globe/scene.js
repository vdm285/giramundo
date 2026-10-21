// The Three.js globe. Owns the renderer, the Earth and its layers, picking,
// and the per-frame loop. Interaction lives in camera.js; GLSL in shaders.js;
// the canvas-painted textures in paint.js.
//
// Frame: the place you view faces +Z, east is screen-right, north is up
// (tests/geo.test.mjs). Do not flip signs here.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { latLonToVector, raySphere, subsolarPoint, vectorToLatLon } from '../geo/math.js';
import { asVector, quaternionForView } from '../geo/orient.js';
import { createCamera } from './camera.js';
import { W, H, assignIds, createPalette, hexToRgb, paintBorders, paintIdMap } from './paint.js';
import {
  arcFrag, arcVert, atmosFrag, atmosVert, beaconFrag, beaconVert, cloudFrag, earthFrag, earthVert,
  pointFrag, pointVert, starFrag, starVert,
} from './shaders.js';

const FOV = 32;
const ACCENT = '#f2b24a';
const ACCENT2 = '#7fd1ff';

function loadTexture(url, colorSpace) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = colorSpace;
      tex.anisotropy = 8;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

function makeStars(count) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 40 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
    const mag = Math.random();
    size[i] = 0.9 + mag * mag * 3.2;
    const warm = Math.random();
    tint[i * 3] = 0.8 + warm * 0.2;
    tint[i * 3 + 1] = 0.82 + warm * 0.1;
    tint[i * 3 + 2] = 1.0 - warm * 0.25;
    phase[i] = Math.random();
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geom.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geom.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL1,
    uniforms: { time: { value: 0 }, pixelRatio: { value: 1 } },
    vertexShader: starVert,
    fragmentShader: starFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geom, mat);
}

// Great-circle polyline between two points, lifted into an arc.
function arcPoints(a, b, segments = 64, lift = 0.25) {
  const va = asVector(latLonToVector(a.lat, a.lon));
  const vb = asVector(latLonToVector(b.lat, b.lon));
  const angle = va.angleTo(vb);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = va.clone().lerp(vb, t).normalize();
    const h = 1.006 + Math.sin(Math.PI * t) * lift * Math.min(1, angle / 1.2);
    pts.push(p.multiplyScalar(h));
  }
  return pts;
}

export async function createGlobe(canvas, world, { base, reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x05070c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  // Start at 1.5 at most; adaptResolution moves it from there.
  renderer.setPixelRatio(Math.min(pixelRatio, 1.5));
  let dirtyFrames = 4;
  let frameIndex = 0;
  let lastSig = '';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 260);
  const control = createCamera(canvas, { fov: FOV, reduced });
  const { view } = control;
  const globe = new THREE.Group();
  scene.add(globe);

  const stars = makeStars(2600);
  stars.material.uniforms.pixelRatio.value = pixelRatio;
  scene.add(stars);

  // Country ids and palettes.
  const features = world.features;
  const paletteSize = assignIds(features);
  // The country-id and border maps are precomputed PNGs (npm run maps), so
  // startup does not paint two 4096x2048 canvases. Painting in the browser
  // remains the fallback if either image fails to load.
  const idMap = { tex: null };
  const borderMap = { tex: null };
  const atlasPalette = createPalette(paletteSize);
  const dataPalette = createPalette(paletteSize);
  atlasPalette.clear([220, 210, 190]);
  for (const feature of features) {
    atlasPalette.set(feature.properties.id, hexToRgb(feature.properties.fill || '#e6d7c3'), true);
  }
  atlasPalette.commit();
  dataPalette.clear();
  dataPalette.commit();

  const sunDir = new THREE.Vector3(1, 0, 0);
  const uniforms = {
    dayMap: { value: null },
    nightMap: { value: null },
    waterMap: { value: null },
    topoMap: { value: null },
    cloudMap: { value: null },
    idMap: { value: idMap.tex },
    borderMap: { value: borderMap.tex },
    paletteA: { value: atlasPalette.tex },
    paletteB: { value: dataPalette.tex },
    paletteMix: { value: 0 },
    paletteSize: { value: paletteSize },
    idSize: { value: new THREE.Vector2(W, H) },
    sunDir: { value: sunDir },
    styleAtlas: { value: 0 },
    styleData: { value: 0 },
    selectedId: { value: 0 },
    hoverId: { value: 0 },
    compareId: { value: 0 },
    cloudOffset: { value: 0 },
    relief: { value: 1.6 },
    hasDay: { value: 0 },
    hasNight: { value: 0 },
    hasTopo: { value: 0 },
    hasWater: { value: 0 },
    hasCloud: { value: 0 },
    graticule: { value: 1 },
    borders: { value: 1 },
    accent: { value: new THREE.Color(ACCENT) },
    accent2: { value: new THREE.Color(ACCENT2) },
  };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    new THREE.ShaderMaterial({ glslVersion: THREE.GLSL1, uniforms, vertexShader: earthVert, fragmentShader: earthFrag }),
  );
  globe.add(earth);

  const cloudUniforms = {
    cloudMap: { value: null },
    sunDir: { value: sunDir },
    cloudOffset: uniforms.cloudOffset,
    opacity: { value: 0.0 },
  };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.008, 128, 64),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      uniforms: cloudUniforms,
      vertexShader: earthVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
    }),
  );
  clouds.visible = false;
  globe.add(clouds);

  const atmosUniforms = { sunDir: { value: sunDir }, outer: { value: 1.11 }, strength: { value: 1.0 } };
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.11, 96, 48),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      uniforms: atmosUniforms,
      vertexShader: atmosVert,
      fragmentShader: atmosFrag,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(atmosphere);

  // Selected-country outline: fat lines, lifted a hair above the surface.
  const outlineMat = new LineMaterial({
    color: new THREE.Color(ACCENT), linewidth: 2.2, worldUnits: false, transparent: true, opacity: 0.95,
    depthTest: true, depthWrite: false,
  });
  const outlineGlowMat = new LineMaterial({
    color: new THREE.Color(ACCENT), linewidth: 7, worldUnits: false, transparent: true, opacity: 0.15,
    depthTest: true, depthWrite: false,
  });
  let outline = null;
  let outlineGlow = null;
  const outlineGroup = new THREE.Group();
  globe.add(outlineGroup);

  // Markers (pins): one Points object, rebuilt on demand.
  const markerMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL1,
    uniforms: { pixelRatio: { value: pixelRatio }, scale: { value: 1 }, opacity: { value: 1 } },
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthWrite: false,
  });
  let markers = new THREE.Points(new THREE.BufferGeometry(), markerMat);
  let markerList = [];
  globe.add(markers);

  // Beacon: pulsing rings at the selected place.
  const beaconUniforms = { color: { value: new THREE.Color(ACCENT) }, time: { value: 0 }, opacity: { value: 0 } };
  const beacon = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.09),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      uniforms: beaconUniforms,
      vertexShader: beaconVert,
      fragmentShader: beaconFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beacon.visible = false;
  globe.add(beacon);

  // Arcs for tours and comparisons.
  const arcs = new THREE.Group();
  globe.add(arcs);

  const q = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const targets = { atlas: 0, data: 0, clouds: 0 };
  let sunOffsetHours = 0;
  let lastNow = performance.now();
  let running = true;
  let frames = 0;
  let fpsWindowStart = performance.now();
  let fps = 60;
  const sampleStats = [];

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    outlineMat.resolution.set(w * pixelRatio, h * pixelRatio);
    outlineGlowMat.resolution.set(w * pixelRatio, h * pixelRatio);
    ghostMat.resolution.set(w * pixelRatio, h * pixelRatio);
  }

  function sunVector() {
    const date = new Date(Date.now() + sunOffsetHours * 3600000);
    const spot = subsolarPoint(date);
    return asVector(latLonToVector(spot.lat, spot.lon)).applyQuaternion(q).normalize();
  }

  function pickLatLon(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const { origin, direction } = raycaster.ray;
    const hit = raySphere(origin, direction, 1);
    if (!hit) return null;
    const local = asVector(hit).applyQuaternion(q.clone().invert());
    return vectorToLatLon(local);
  }

  function project(lat, lon) {
    const p = asVector(latLonToVector(lat, lon)).applyQuaternion(q);
    if (p.z < 0.05) return null;
    const v = p.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      depth: p.z,
    };
  }

  // A second outline in the compare color: the selected country's shape
  // rotated onto the compared one (true-size overlay).
  const ghostMat = new LineMaterial({
    color: new THREE.Color(ACCENT2), linewidth: 2, worldUnits: false, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false, dashed: true, dashSize: 0.02, gapSize: 0.012,
  });
  let ghost = null;
  function segmentsOf(feature) {
    const segs = [];
    const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = latLonToVector(ring[i][1], ring[i][0], 1.0036);
          const b = latLonToVector(ring[i + 1][1], ring[i + 1][0], 1.0036);
          segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    return segs;
  }
  function setGhost(feature) {
    if (ghost) { outlineGroup.remove(ghost); ghost.geometry.dispose(); ghost = null; }
    if (!feature) { dirtyFrames = 4; return; }
    const geom = new LineSegmentsGeometry();
    geom.setPositions(segmentsOf(feature));
    ghost = new LineSegments2(geom, ghostMat);
    ghost.computeLineDistances();
    outlineGroup.add(ghost);
    dirtyFrames = 4;
  }

  function setOutline(feature) {
    if (outline) { outlineGroup.remove(outline, outlineGlow); outline.geometry.dispose(); outline = null; outlineGlow = null; }
    if (!feature) return;
    const segs = [];
    const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = latLonToVector(ring[i][1], ring[i][0], 1.0035);
          const b = latLonToVector(ring[i + 1][1], ring[i + 1][0], 1.0035);
          segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const geom = new LineSegmentsGeometry();
    geom.setPositions(segs);
    outline = new LineSegments2(geom, outlineMat);
    outlineGlow = new LineSegments2(geom, outlineGlowMat);
    outline.computeLineDistances();
    outlineGroup.add(outlineGlow, outline);
  }

  function setMarkers(list) {
    markerList = list;
    globe.remove(markers);
    markers.geometry.dispose();
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const hi = new Float32Array(n);
    list.forEach((m, i) => {
      const p = latLonToVector(m.lat, m.lon, 1.004);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const c = new THREE.Color(m.color || ACCENT);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = m.size || 9;
      hi[i] = m.highlight ? 1 : 0;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geom.setAttribute('highlight', new THREE.BufferAttribute(hi, 1));
    markers = new THREE.Points(geom, markerMat);
    markers.frustumCulled = false;
    globe.add(markers);
    dirtyFrames = 4;
  }

  function markerAt(clientX, clientY, radiusPx = 16) {
    let best = null;
    let bestD = radiusPx;
    for (const m of markerList) {
      const p = project(m.lat, m.lon);
      if (!p) continue;
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  let beaconAt = 0;
  function setBeacon(lat, lon) {
    if (lat == null) { beacon.visible = false; beaconUniforms.opacity.value = 0; return; }
    beaconAt = performance.now();
    dirtyFrames = 4;
    const p = asVector(latLonToVector(lat, lon, 1.006));
    beacon.position.copy(p);
    beacon.lookAt(p.clone().multiplyScalar(2));
    beacon.visible = true;
    beaconUniforms.opacity.value = 1;
  }

  function clearArcs() {
    for (const child of [...arcs.children]) { arcs.remove(child); child.geometry.dispose(); child.material.dispose(); }
  }

  function addArc(a, b, { color = ACCENT, animate = true } = {}) {
    const pts = arcPoints(a, b);
    const curve = new THREE.CatmullRomCurve3(pts);
    const geom = new THREE.TubeGeometry(curve, 96, 0.0028, 6, false);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      uniforms: {
        color: { value: new THREE.Color(color) },
        progress: { value: animate ? 0 : 1 },
        time: { value: 0 },
        opacity: { value: 0.9 },
      },
      vertexShader: arcVert,
      fragmentShader: arcFrag,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.t0 = performance.now();
    arcs.add(mesh);
    return mesh;
  }

  function approach(current, target, dt, speed = 6) {
    return current + (target - current) * (1 - Math.exp(-speed * dt));
  }

  let paused = false;
  function frame(now) {
    if (!running) return;
    if (paused) { lastNow = now; requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    const moving = control.update(now, dt);
    // Any texture or flag change repaints for a few frames.
    const sig = `${uniforms.hasDay.value}${uniforms.hasNight.value}${uniforms.hasWater.value}${uniforms.hasTopo.value}${uniforms.hasCloud.value}${uniforms.dayMap.value?.id}${uniforms.selectedId.value}${uniforms.hoverId.value}${uniforms.compareId.value}${markerList.length}`;
    if (sig !== lastSig) { lastSig = sig; dirtyFrames = 4; }
    quaternionForView(view.lat, view.lon, q);
    globe.quaternion.copy(q);
    camera.position.set(0, 0, view.dist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    sunDir.copy(sunVector());

    uniforms.styleAtlas.value = approach(uniforms.styleAtlas.value, targets.atlas, dt, 7);
    uniforms.styleData.value = approach(uniforms.styleData.value, targets.data, dt, 7);
    uniforms.paletteMix.value = uniforms.styleData.value;
    const cloudTarget = targets.clouds * (1 - targets.atlas) * (1 - targets.data);
    cloudUniforms.opacity.value = approach(cloudUniforms.opacity.value, cloudTarget, dt, 4);
    clouds.visible = cloudUniforms.opacity.value > 0.01 && Boolean(cloudUniforms.cloudMap.value);
    uniforms.cloudOffset.value += dt * 0.0022;
    atmosUniforms.strength.value = 0.8 - 0.6 * Math.max(uniforms.styleAtlas.value, uniforms.styleData.value);

    const t = now / 1000;
    stars.material.uniforms.time.value = t;
    beaconUniforms.time.value = t;
    beacon.scale.setScalar(Math.max(0.5, Math.min(1.6, view.dist / 2.4)));
    // Outline widths stay readable but a little slimmer when far.
    const far = Math.min(1, Math.max(0, (view.dist - 1.3) / 4));
    outlineMat.linewidth = 1.9 - far * 0.6;
    outlineGlowMat.linewidth = 5.5 - far * 2;
    // The beacon announces the landing, then fades so the map stays clean.
    const sinceBeacon = now - beaconAt;
    beaconUniforms.opacity.value = beacon.visible ? Math.max(0, Math.min(1, 1 - (sinceBeacon - 2600) / 1400)) : 0;
    markerMat.uniforms.scale.value = Math.max(0.6, Math.min(1.5, 2.6 / view.dist));
    for (const arc of arcs.children) {
      const u = arc.material.uniforms;
      u.time.value = t;
      if (u.progress.value < 1) u.progress.value = Math.min(1, (now - arc.userData.t0) / 1400);
    }

    // Render on demand: when nothing moves, draw a third of the frames. The
    // clouds and stars still drift, just at 20 fps, which the eye forgives.
    const settling = Math.abs(uniforms.styleAtlas.value - targets.atlas) > 0.002
      || Math.abs(uniforms.styleData.value - targets.data) > 0.002
      || Math.abs(cloudUniforms.opacity.value - cloudTarget) > 0.002
      || (beacon.visible && beaconUniforms.opacity.value > 0)
      || arcs.children.some((a) => a.material.uniforms.progress.value < 1);
    const busy = moving || settling || dirtyFrames > 0;
    if (dirtyFrames > 0) dirtyFrames -= 1;
    frameIndex += 1;
    if (busy || frameIndex % 3 === 0) renderer.render(scene, camera);

    frames += 1;
    if (now - fpsWindowStart > 1000) {
      fps = frames * 1000 / (now - fpsWindowStart);
      sampleStats.push(fps);
      if (sampleStats.length > 10) sampleStats.shift();
      frames = 0;
      fpsWindowStart = now;
      adaptResolution(busy);
    }
    requestAnimationFrame(frame);
  }

  // Adaptive resolution: step the pixel ratio down when the frame rate
  // sags while the scene is moving, and back up when it is comfortable.
  // Invisible on a sphere with clouds; it halves or thirds the pixel work.
  let scale = Math.min(pixelRatio, 1.5);
  let scaleCap = Math.min(pixelRatio, 1.5);
  let goodStreak = 0;
  function adaptResolution(wasBusy) {
    if (document.visibilityState !== 'visible' || !wasBusy) return;
    if (fps < 48 && scale > 0.7) {
      scale = Math.max(0.7, scale * 0.85);
      goodStreak = 0;
      applyScale();
    } else if (fps > 57 && scale < scaleCap) {
      goodStreak += 1;
      if (goodStreak >= 3) {
        scale = Math.min(scaleCap, scale * 1.1);
        goodStreak = 0;
        applyScale();
      }
    }
  }
  function applyScale() {
    renderer.setPixelRatio(scale);
    stars.material.uniforms.pixelRatio.value = scale;
    markerMat.uniforms.pixelRatio.value = scale;
    resize();
    dirtyFrames = 4;
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  // Textures stream in after the first frame so the globe appears at once.
  const T = `${base}textures/`;
  let day4k = null;
  let day8k = null;
  let want8k = false;
  let loading8k = false;
  // A 90 KB plate first so the Earth has color within the first second,
  // then the 4k plate replaces it.
  loadTexture(`${T}earth-day-1k.jpg`, THREE.SRGBColorSpace).then((tex) => {
    if (!tex || day4k || day8k) return;
    uniforms.dayMap.value = tex;
    uniforms.hasDay.value = 1;
  });
  loadTexture(`${T}earth-day.jpg`, THREE.SRGBColorSpace).then((tex) => {
    if (!tex) return;
    day4k = tex;
    if (!day8k) { uniforms.dayMap.value = tex; uniforms.hasDay.value = 1; }
  });
  // The 8k plate (Solar System Scope, CC BY 4.0) only when close and in full quality.
  function maybeLoad8k() {
    if (!want8k || day8k || loading8k || view.dist > 2.2) return;
    loading8k = true;
    loadTexture(`${T}earth-day-8k.jpg`, THREE.SRGBColorSpace).then((tex) => {
      loading8k = false;
      if (!tex) return;
      day8k = tex;
      if (want8k) { uniforms.dayMap.value = tex; uniforms.hasDay.value = 1; }
    });
  }
  function applyQuality(level) {
    // 'full' | 'simple'
    const full = level !== 'simple';
    want8k = full;
    if (full) loadRich();
    targets.clouds = full && cloudUniforms.cloudMap.value ? 1 : 0;
    uniforms.relief.value = full ? 1.6 : 0.6;
    stars.visible = true;
    scaleCap = full ? Math.min(pixelRatio, 1.5) : Math.min(pixelRatio, 1);
    scale = Math.min(scale, scaleCap);
    applyScale();
    if (!full && day4k) { uniforms.dayMap.value = day4k; }
    if (full && day8k) { uniforms.dayMap.value = day8k; }
    maybeLoad8k();
  }
  loadTexture(`${T}earth-night.jpg`, THREE.SRGBColorSpace).then((tex) => { if (tex) { uniforms.nightMap.value = tex; uniforms.hasNight.value = 1; } });
  loadTexture(`${T}earth-water.png`, THREE.NoColorSpace).then((tex) => { if (tex) { uniforms.waterMap.value = tex; uniforms.hasWater.value = 1; } });
  // Country ids (nearest, no mips) and borders (linear, mips).
  new THREE.TextureLoader().load(`${T}idmap.png`, (tex) => {
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 1;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    idMap.tex = tex;
    uniforms.idMap.value = tex;
    dirtyFrames = 4;
  }, undefined, () => {
    const painted = paintIdMap(features);
    idMap.tex = painted.tex;
    uniforms.idMap.value = painted.tex;
  });
  new THREE.TextureLoader().load(`${T}borders.png`, (tex) => {
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    borderMap.tex = tex;
    uniforms.borderMap.value = tex;
    dirtyFrames = 4;
  }, undefined, () => {
    const painted = paintBorders(features);
    borderMap.tex = painted.tex;
    uniforms.borderMap.value = painted.tex;
  });

  // Relief and clouds only in Full quality: Simple never downloads them.
  let richLoading = false;
  function loadRich() {
    if (richLoading) return;
    richLoading = true;
    loadTexture(`${T}earth-topology.png`, THREE.NoColorSpace).then((tex) => { if (tex) { uniforms.topoMap.value = tex; uniforms.hasTopo.value = 1; } });
    loadTexture(`${T}earth-clouds.jpg`, THREE.NoColorSpace).then((tex) => {
      if (tex) { uniforms.cloudMap.value = tex; cloudUniforms.cloudMap.value = tex; uniforms.hasCloud.value = 1; targets.clouds = want8k ? 1 : 0; }
    });
  }
  setInterval(maybeLoad8k, 700);

  return {
    view,
    control,
    resize,
    pickLatLon,
    project,
    markerAt,
    flyTo: control.flyTo,
    // Under the full-screen deck nothing of the globe shows; stop drawing.
    setPaused(p) { paused = Boolean(p); if (!paused) dirtyFrames = 4; },
    onTap: control.onTap,
    onMove: control.onMove,
    setStyle(style) {
      targets.atlas = style === 'atlas' ? 1 : 0;
      targets.data = style === 'data' ? 1 : 0;
    },
    setSelected(feature) {
      uniforms.selectedId.value = feature ? feature.properties.id : 0;
      setOutline(feature);
    },
    setHover(feature) { uniforms.hoverId.value = feature ? feature.properties.id : 0; },
    setCompare(feature) { uniforms.compareId.value = feature ? feature.properties.id : 0; },
    setGhost,
    setDataColors(colorFor) {
      // colorFor(feature) -> '#rrggbb' or null when there is no data.
      dataPalette.clear();
      for (const feature of features) {
        const hex = colorFor(feature);
        if (hex) dataPalette.set(feature.properties.id, hexToRgb(hex), true);
      }
      dataPalette.commit();
      dirtyFrames = 4;
    },
    setMarkers,
    setBeacon,
    addArc,
    clearArcs,
    setClouds(on) { targets.clouds = on ? 1 : 0; },
    setQuality: applyQuality,
    setSunOffset(hours) { sunOffsetHours = hours; },
    setSpin: control.setSpin,
    getFps: () => fps,
    getFpsHistory: () => [...sampleStats],
    getInfo() {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      return { fps: Math.round(fps), gpu: String(gpu), width: size.x, height: size.y, pixelRatio: renderer.getPixelRatio(), webgl2: renderer.capabilities.isWebGL2 };
    },
    dispose() {
      running = false;
      control.dispose();
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
