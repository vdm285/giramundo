import * as THREE from 'three';
import { latLonToVector, raySphere, shortestLonDelta, subsolarPoint, vectorToLatLon } from '../geo/math.js';
import { applyDrag, asVector, quaternionForView } from '../geo/orient.js';
import { createPainter } from './paint.js';

const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const earthVert = `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const earthFrag = `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform sampler2D atlasMap;
uniform sampler2D maskMap;
uniform vec3 sunDir;
uniform float atlasMix;
uniform float hasDay;
uniform float hasNight;
uniform float hasWater;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
  // NASA plates and the d3 atlas both put longitude 0 at the center.
  // The sphere's own UV puts longitude 0 at the left edge, so both shift by half.
  vec2 photoUv = vec2(fract(vUv.x + 0.5), vUv.y);
  vec3 day = hasDay > 0.5 ? texture2D(dayMap, photoUv).rgb : vec3(0.11, 0.32, 0.48);
  vec3 night = hasNight > 0.5 ? texture2D(nightMap, photoUv).rgb : vec3(0.02, 0.03, 0.06);
  float water = hasWater > 0.5 ? texture2D(waterMap, photoUv).r : smoothstep(0.05, 0.28, day.b - max(day.r, day.g));
  vec3 atlas = texture2D(atlasMap, photoUv).rgb;
  vec3 mask = texture2D(maskMap, photoUv).rgb;
  vec3 n = normalize(vNormalW);
  vec3 sun = normalize(sunDir);
  float ndl = dot(n, sun);
  float dayAmt = smoothstep(-0.05, 0.32, ndl);
  vec3 lights = night * vec3(1.45, 1.28, 1.05);
  vec3 earth = mix(lights, day, dayAmt);
  vec3 viewDir = normalize(cameraPosition - vPosW);
  float spec = pow(max(dot(n, normalize(sun + viewDir)), 0.0), 90.0);
  earth += water * spec * vec3(0.9, 0.95, 1.0) * dayAmt * 0.28;
  float shade = mix(0.7, 1.0, smoothstep(-0.45, 0.8, ndl));
  vec3 base = mix(earth, atlas * shade, atlasMix);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  base += vec3(0.45, 0.68, 1.0) * rim * 0.18 * (1.0 - atlasMix);
  base += vec3(1.0, 0.55, 0.28) * (1.0 - smoothstep(0.0, 0.18, abs(ndl))) * 0.05 * (1.0 - atlasMix);
  base = mix(base, vec3(1.0, 0.93, 0.75), smoothstep(0.25, 0.85, mask.g) * 0.34);
  base = mix(base, vec3(0.96, 0.42, 0.22), smoothstep(0.2, 0.8, mask.r) * 0.55);
  vec3 border = mix(vec3(0.98, 0.96, 0.9), vec3(0.25, 0.16, 0.1), atlasMix);
  base = mix(base, border, smoothstep(0.15, 0.7, mask.b) * atlasMix);
  gl_FragColor = vec4(base, 1.0);
}
`;

const cloudFrag = `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float offset;
uniform float hasCloud;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  if (hasCloud < 0.5) discard;
  vec2 uv = vec2(fract(vUv.x + 0.5 + offset), vUv.y);
  float a = texture2D(cloudMap, uv).r;
  float light = smoothstep(-0.25, 0.65, dot(normalize(vNormalW), normalize(sunDir)));
  float alpha = smoothstep(0.35, 0.85, a) * (0.08 + 0.42 * light);
  gl_FragColor = vec4(vec3(1.0), alpha);
}
`;

const atmosVert = `
varying vec3 vNormalV;
void main() {
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const atmosFrag = `
varying vec3 vNormalV;
void main() {
  float fres = pow(0.62 - dot(normalize(vNormalV), vec3(0.0, 0.0, 1.0)), 3.0);
  gl_FragColor = vec4(0.35, 0.58, 1.0, 1.0) * fres * 0.85;
}
`;

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

export async function createGlobe(canvas, features, base) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x07090f, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 220);
  const view = { lat: reduced ? 22 : 8, lon: reduced ? -102 : -30, dist: reduced ? 3.2 : 5.5 };
  const globe = new THREE.Group();
  scene.add(globe);

  const starPositions = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const r = 28 + Math.random() * 50;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPositions, 3)),
    new THREE.PointsMaterial({ color: 0xfff6e4, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.85 }),
  );
  scene.add(stars);

  const painter = createPainter(features);
  const uniforms = {
    dayMap: { value: null },
    nightMap: { value: null },
    waterMap: { value: null },
    atlasMap: { value: painter.atlasTex },
    maskMap: { value: painter.maskTex },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    atlasMix: { value: 0 },
    hasDay: { value: 0 },
    hasNight: { value: 0 },
    hasWater: { value: 0 },
  };
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1, uniforms, vertexShader: earthVert, fragmentShader: earthFrag,
    }),
  );
  globe.add(earth);

  const cloudUniforms = {
    cloudMap: { value: null },
    sunDir: uniforms.sunDir,
    offset: { value: 0 },
    hasCloud: { value: 0 },
  };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 96, 48),
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

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.09, 64, 32),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL1,
      vertexShader: atmosVert,
      fragmentShader: atmosFrag,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(atmosphere);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff4d2 }),
  );
  dot.visible = false;
  globe.add(dot);

  const pinGeom = new THREE.SphereGeometry(0.012, 10, 8);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xf0c56a });
  const pins = new THREE.Group();
  globe.add(pins);

  const q = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let atlasTarget = 0;
  let sunOffsetHours = 0;
  let fly = null;
  let dragging = false;
  let vx = 0;
  let vy = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  let spin = !reduced;
  let resumeAt = 0;
  let lastNow = performance.now();
  const touches = new Map();
  let pinch = 0;
  const onClick = new Set();
  const onHover = new Set();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function degPerPx() {
    const h = canvas.clientHeight || window.innerHeight;
    const fov = camera.fov * Math.PI / 180;
    const radius = (1 / (view.dist * Math.tan(fov / 2))) * (h / 2);
    return 78 / Math.max(80, radius);
  }

  function sunVector() {
    const date = new Date(Date.now() + sunOffsetHours * 3600000);
    const spot = subsolarPoint(date);
    return asVector(latLonToVector(spot.lat, spot.lon)).applyQuaternion(q).normalize();
  }

  function setRing(lat, lon) {
    const p = latLonToVector(lat, lon, 1.02);
    dot.position.set(p.x, p.y, p.z);
    dot.visible = true;
  }

  function flyTo(lat, lon, dist = 2.45, extraTurns = 0) {
    // Keep the country you just opened on screen. Spin resumes later.
    resumeAt = performance.now() + 24000;
    const toLon = view.lon + shortestLonDelta(view.lon, lon) + extraTurns * 360;
    if (reduced) {
      view.lat = lat;
      view.lon = wrapInto(toLon);
      view.dist = dist;
      fly = null;
      return;
    }
    fly = {
      from: { lat: view.lat, lon: view.lon, dist: view.dist },
      to: { lat, lon: toLon, dist },
      t0: performance.now(),
      dur: extraTurns ? 1600 : 1150,
    };
  }

  function wrapInto(lon) {
    return (((lon + 180) % 360) + 360) % 360 - 180;
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
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
    if (p.z < 0.02) return null;
    const v = p.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.dur);
      const e = ease(t);
      view.lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
      view.lon = fly.from.lon + (fly.to.lon - fly.from.lon) * e;
      view.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e;
      if (t >= 1) {
        view.lon = wrapInto(view.lon);
        fly = null;
      }
    } else if (spin && !dragging && now > resumeAt) {
      view.lon += dt * 3.2;
    }
    if (!dragging && (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02)) {
      applyDrag(view, vx, vy, degPerPx());
      const decay = Math.exp(-3.1 * dt);
      vx *= decay;
      vy *= decay;
    }
    quaternionForView(view.lat, view.lon, q);
    globe.quaternion.copy(q);
    camera.position.set(0, 0, view.dist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    uniforms.sunDir.value.copy(sunVector());
    uniforms.atlasMix.value += (atlasTarget - uniforms.atlasMix.value) * (1 - Math.exp(-8 * dt));
    cloudUniforms.offset.value += dt * 0.0035;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    vx = 0;
    vy = 0;
    fly = null;
    resumeAt = performance.now() + 28000;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) view.dist = Math.max(1.28, Math.min(6.8, view.dist * (pinch / dist)));
      pinch = dist;
      return;
    }
    if (!dragging) {
      for (const fn of onHover) fn(event);
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    vx = dx;
    vy = dy;
    applyDrag(view, dx, dy, degPerPx());
  });
  function endPointer(event) {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = 0;
    if (!dragging) return;
    dragging = false;
    if (moved < 7) {
      for (const fn of onClick) fn(event);
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    view.dist = Math.max(1.28, Math.min(6.8, view.dist * Math.exp(event.deltaY * 0.0011)));
  }, { passive: false });

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  const [day, night, water] = await Promise.all([
    loadTexture(`${base}textures/earth-day.jpg`, THREE.SRGBColorSpace),
    loadTexture(`${base}textures/earth-night.jpg`, THREE.SRGBColorSpace),
    loadTexture(`${base}textures/earth-water.png`, THREE.LinearSRGBColorSpace),
  ]);
  if (day) { uniforms.dayMap.value = day; uniforms.hasDay.value = 1; }
  if (night) { uniforms.nightMap.value = night; uniforms.hasNight.value = 1; }
  if (water) { uniforms.waterMap.value = water; uniforms.hasWater.value = 1; }

  return {
    view,
    resize,
    flyTo,
    pickLatLon,
    project,
    setRing,
    hideRing() { dot.visible = false; },
    setHighlight(selected, hover) { painter.redraw(selected, hover); },
    setAtlas(on) { atlasTarget = on ? 1 : 0; },
    setSpin(on) { spin = on; },
    setSunOffset(hours) { sunOffsetHours = hours; },
    nudge(dx, dy) { fly = null; applyDrag(view, dx, dy, degPerPx()); },
    zoom(factor) { view.dist = Math.max(1.28, Math.min(6.8, view.dist * factor)); },
    onClick(fn) { onClick.add(fn); },
    onHover(fn) { onHover.add(fn); },
    setPins(list) {
      pins.clear();
      for (const item of list) {
        const mesh = new THREE.Mesh(pinGeom, pinMat);
        const p = latLonToVector(item.lat, item.lon, 1.012);
        mesh.position.set(p.x, p.y, p.z);
        mesh.userData.iso2 = item.iso2;
        pins.add(mesh);
      }
    },
  };
}
