import * as THREE from 'three';
import { clamp, latLonToVector, wrapLon } from './math.js';

// Camera sits on +Z looking at the origin, so the front of the globe is +Z,
// screen-right is +X and screen-up is +Y. quaternionForView brings (lat, lon)
// to that front point and keeps north up. tests/geo.test.mjs is the spec.

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const qLon = new THREE.Quaternion();
const qLat = new THREE.Quaternion();

export function asVector(p, out = new THREE.Vector3()) {
  return out.set(p.x, p.y, p.z);
}

export function quaternionForView(lat, lon, out = new THREE.Quaternion()) {
  // Longitude 0 sits on -X, but the camera looks at +Z, so the yaw has a
  // built-in quarter turn. Pitch then lifts the latitude onto the front.
  // Yaw runs first: out = qLat * qLon.
  qLon.setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(90 - lon));
  qLat.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(lat));
  return out.copy(qLat).multiply(qLon);
}

/**
 * Drag in pixels. Positive dx is the finger moving right; the place under
 * the finger should move right with it. Positive dy (finger down) moves
 * the place down, which raises the latitude of the view center.
 */
export function applyDrag(view, dx, dy, degPerPx) {
  view.lon = wrapLon(view.lon - dx * degPerPx);
  view.lat = clamp(view.lat + dy * degPerPx, -72, 72);
}

export function frontPoint(lat, lon) {
  const q = quaternionForView(lat, lon);
  return asVector(latLonToVector(lat, lon)).applyQuaternion(q);
}
