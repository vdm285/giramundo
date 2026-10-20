// One geographic frame for the whole app.
// Three.js SphereGeometry (default) puts longitude 0 on the -X axis and the
// north pole on +Y. These helpers match that frame. Tests in tests/geo.test.mjs
// pin the signs; do not "fix" a symptom by flipping one call site.

const RAD = Math.PI / 180;

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function wrapLon(lon) {
  return (((lon + 180) % 360) + 360) % 360 - 180;
}

/** Unit (or radius) vector for a latitude/longitude. Plain object, no Three.js. */
export function latLonToVector(lat, lon, radius = 1) {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  const cosPhi = Math.cos(phi);
  return {
    x: -radius * cosPhi * Math.cos(lambda),
    y: radius * Math.sin(phi),
    z: radius * cosPhi * Math.sin(lambda),
  };
}

export function vectorToLatLon(v) {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  return {
    lat: Math.asin(clamp(v.y / r, -1, 1)) / RAD,
    lon: Math.atan2(v.z, -v.x) / RAD,
  };
}

/**
 * UV on the Three.js sphere: u=0 at lon 0, v=1 at the north pole.
 * Earth photographs are a different layout (lon 0 at the center). The shader
 * shifts those with +0.5. Masks we draw ourselves stay in this UV space.
 */
export function latLonToUv(lat, lon) {
  return {
    u: (((lon % 360) + 360) % 360) / 360,
    v: (lat + 90) / 180,
  };
}

export function antipode(lat, lon) {
  return { lat: -lat, lon: wrapLon(lon + 180) };
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Where the sun is overhead. Approximate (about a degree), good enough to
 * light the globe. At 12:00 UTC on the March equinox this is near (0, 0).
 */
export function subsolarPoint(date) {
  const year = date.getUTCFullYear();
  const day = (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 0)) / 86400000;
  const decl = -23.44 * Math.cos(RAD * (360 / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return { lat: decl, lon: wrapLon((12 - hours) * 15) };
}

/** Nearest intersection of a ray with a sphere at the origin, or null. */
export function raySphere(origin, dir, radius) {
  const b = origin.x * dir.x + origin.y * dir.y + origin.z * dir.z;
  const c = origin.x ** 2 + origin.y ** 2 + origin.z ** 2 - radius ** 2;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return {
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
    z: origin.z + dir.z * t,
  };
}

/**
 * Move a GeoJSON feature on the sphere so that point `from` lands on point
 * `to`, by the rotation that carries one unit vector onto the other. Shape
 * and size are preserved on the globe (a translation in lat/lon would not
 * be). Used by the true-size overlay in Compare.
 */
export function rotateFeature(feature, from, to) {
  const a = latLonToVector(from.lat, from.lon);
  const b = latLonToVector(to.lat, to.lon);
  // Rodrigues' rotation about axis a x b by the angle between a and b.
  const axis = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const sin = Math.hypot(axis.x, axis.y, axis.z);
  const cos = a.x * b.x + a.y * b.y + a.z * b.z;
  if (sin < 1e-9) return feature;
  const k = { x: axis.x / sin, y: axis.y / sin, z: axis.z / sin };
  const rot = ([lon, lat]) => {
    const v = latLonToVector(lat, lon);
    const dot = k.x * v.x + k.y * v.y + k.z * v.z;
    const cross = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
    const r = {
      x: v.x * cos + cross.x * sin + k.x * dot * (1 - cos),
      y: v.y * cos + cross.y * sin + k.y * dot * (1 - cos),
      z: v.z * cos + cross.z * sin + k.z * dot * (1 - cos),
    };
    const ll = vectorToLatLon(r);
    return [ll.lon, ll.lat];
  };
  const mapRings = (rings) => rings.map((ring) => ring.map(rot));
  const g = feature.geometry;
  const geometry = g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: mapRings(g.coordinates) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map(mapRings) };
  return { type: 'Feature', properties: { ...feature.properties, ghost: true }, geometry };
}

export function shortestLonDelta(from, to) {
  return wrapLon(to - from);
}
