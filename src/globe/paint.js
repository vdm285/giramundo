// Canvas-painted textures the shader reads: a country-id map (which country
// owns each texel), a border map (anti-aliased outlines), and 1-D palette
// textures (one color per country id, for Atlas and Data views).
//
// All equirectangular, longitude 0 at the center, same as the NASA plates.
// d3-geo's path is used so Russia and Fiji do not paint a stripe across the
// world where they cross the antimeridian.

import { geoEquirectangular, geoPath } from 'd3-geo';
import * as THREE from 'three';

export const W = 4096;
export const H = 2048;
export const projection = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);

function canvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

// Assign every feature a small integer id (1..n). 0 means ocean / no country.
export function assignIds(features) {
  features.forEach((feature, i) => { feature.properties.id = i + 1; });
  return features.length + 1;
}

export function paintIdMap(features) {
  const c = canvas();
  const ctx = c.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const path = geoPath(projection, ctx);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.3;
  for (const feature of features) {
    const id = feature.properties.id;
    const color = `rgb(${id & 255}, ${(id >> 8) & 255}, 0)`;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    path(feature);
    ctx.fill();
    // Stroke in the same color so the anti-aliased fringe does not decode
    // to a neighbor's id. Edges move by under a texel.
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, tex };
}

export function paintBorders(features) {
  const c = canvas();
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const path = geoPath(projection, ctx);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const feature of features) path(feature);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, tex };
}

// A palette is a (size x 1) RGBA texture. RGB is the country color in sRGB
// bytes; A is 255 when the country has data (Data view hatches the rest).
export function createPalette(size) {
  const data = new Uint8Array(size * 4);
  const tex = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return {
    tex,
    size,
    set(id, rgb, hasData = true) {
      const i = id * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = hasData ? 255 : 0;
    },
    clear(rgb = [60, 64, 70]) {
      for (let id = 0; id < size; id++) this.set(id, rgb, false);
    },
    commit() { tex.needsUpdate = true; },
  };
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
