import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import {
  antipode, haversineKm, latLonToUv, latLonToVector, raySphere, subsolarPoint, vectorToLatLon, wrapLon,
} from '../src/geo/math.js';
import { applyDrag, frontPoint, quaternionForView } from '../src/geo/orient.js';
import { makeIndex } from '../src/geo/pick.js';

const world = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-110m.json', import.meta.url)));
const countries = feature(world, world.objects.countries);
const index = makeIndex(countries.features);

function close(a, b, eps, label) {
  assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);
}

test('lat/lon round-trips through the sphere frame', () => {
  for (const [lat, lon] of [[0, 0], [19.43, -99.13], [35.7, 139.7], [-33.9, 151.2], [64, -21], [-75, 40]]) {
    const back = vectorToLatLon(latLonToVector(lat, lon));
    close(back.lat, lat, 1e-6, 'lat');
    close(back.lon, lon, 1e-6, 'lon');
  }
  const guinea = latLonToVector(0, 0);
  close(guinea.x, -1, 1e-9, 'lon0 x');
  close(guinea.y, 0, 1e-9, 'lon0 y');
  close(guinea.z, 0, 1e-9, 'lon0 z');
  const north = latLonToVector(90, 0);
  close(north.y, 1, 1e-9, 'north y');
});

test('sphere UVs agree with Three.js SphereGeometry', () => {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (const [lat, lon] of [[19.43, -99.13], [0, 0], [48.8, 2.3], [-35, 149]]) {
    const target = latLonToVector(lat, lon);
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - target.x;
      const dy = pos.getY(i) - target.y;
      const dz = pos.getZ(i) - target.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    const expected = latLonToUv(lat, lon);
    close(uv.getX(bi), expected.u, 0.02, `u ${lat},${lon}`);
    close(uv.getY(bi), expected.v, 0.03, `v ${lat},${lon}`);
  }
});

test('the viewed place faces the camera, north is up, east is right', () => {
  for (const [lat, lon] of [[0, 0], [23, -102], [35.6, 139.7], [-33.9, 18.4], [51.5, -0.1]]) {
    const p = frontPoint(lat, lon);
    close(p.x, 0, 0.02, `front x ${lat}`);
    close(p.y, 0, 0.02, `front y ${lat}`);
    close(p.z, 1, 0.02, `front z ${lat}`);
  }
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const project = (lat, lon, viewLat, viewLon) => {
    const q = quaternionForView(viewLat, viewLon);
    const g = latLonToVector(lat, lon);
    return new THREE.Vector3(g.x, g.y, g.z).applyQuaternion(q).project(camera);
  };
  const origin = project(0, 0, 0, 0);
  const east = project(0, 12, 0, 0);
  const north = project(12, 0, 0, 0);
  assert.ok(east.x > origin.x + 0.02, `east should be screen-right (${east.x} vs ${origin.x})`);
  assert.ok(north.y > origin.y + 0.02, `north should be screen-up (${north.y} vs ${origin.y})`);
});

test('dragging right moves the place under the finger to the right', () => {
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const screen = (lat, lon, view) => {
    const q = quaternionForView(view.lat, view.lon);
    const g = latLonToVector(lat, lon);
    const p = new THREE.Vector3(g.x, g.y, g.z).applyQuaternion(q).project(camera);
    return p;
  };
  const view = { lat: 0, lon: 0, dist: 3.2 };
  const before = screen(0, 0, view);
  applyDrag(view, 30, 0, 0.35);
  const after = screen(0, 0, view);
  assert.ok(after.x > before.x + 0.01, `finger-right should carry the center point right (${before.x} -> ${after.x})`);
  const view2 = { lat: 10, lon: 20, dist: 3.2 };
  const beforeY = screen(10, 20, view2);
  applyDrag(view2, 0, 30, 0.35);
  const afterY = screen(10, 20, view2);
  assert.ok(afterY.y < beforeY.y - 0.01, `finger-down should carry the center point down (${beforeY.y} -> ${afterY.y})`);
});

test('sun is over the equator at the March equinox noon UTC', () => {
  const eq = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12, 0, 0)));
  assert.ok(Math.abs(eq.lat) < 2, eq.lat);
  assert.ok(Math.abs(eq.lon) < 2, eq.lon);
  const june = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0, 0)));
  assert.ok(june.lat > 20 && june.lat < 25, june.lat);
  const evening = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 18, 0, 0)));
  close(evening.lon, -90, 1, '18:00 UTC longitude');
});

test('a centered ray hits the front of the globe', () => {
  const hit = raySphere({ x: 0, y: 0, z: 3.2 }, { x: 0, y: 0, z: -1 }, 1);
  close(hit.x, 0, 1e-9, 'hit x');
  close(hit.z, 1, 1e-9, 'hit z');
  assert.equal(raySphere({ x: 0, y: 0, z: 3 }, { x: 0, y: 1, z: 0 }, 1), null);
});

test('the finer map can pick Singapore and still knows Mexico City', () => {
  const finer = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url)));
  const fineIndex = makeIndex(feature(finer, finer.objects.countries).features);
  assert.equal(fineIndex.find(-99.1332, 19.4326).properties.name, 'Mexico');
  assert.equal(fineIndex.find(103.8198, 1.3521).properties.name, 'Singapore');
  assert.equal(fineIndex.find(14.5147, 35.8989).properties.name, 'Malta');
});

test('Mexico City is in Mexico and the Gulf of Mexico is not', () => {
  const mx = index.find(-99.1332, 19.4326);
  assert.equal(mx.properties.name, 'Mexico');
  assert.equal(index.find(-90, 25), null);
  const tokyo = index.find(139.69, 35.68);
  assert.equal(tokyo.properties.name, 'Japan');
});

test('antipode and distance', () => {
  const a = antipode(19.4, -99.1);
  const b = antipode(a.lat, a.lon);
  close(b.lat, 19.4, 1e-9, 'back lat');
  close(b.lon, -99.1, 1e-6, 'back lon');
  const km = haversineKm({ lat: 19.43, lon: -99.13 }, { lat: 40.4, lon: -3.7 });
  assert.ok(km > 8500 && km < 11000, km);
  assert.equal(wrapLon(190), -170);
  assert.equal(wrapLon(-190), 170);
});
