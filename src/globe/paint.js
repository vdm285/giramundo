import { geoEquirectangular, geoPath } from 'd3-geo';
import * as THREE from 'three';

const W = 2048;
const H = 1024;
const projection = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);

function paintFeature(ctx, feature) {
  ctx.beginPath();
  geoPath(projection, ctx)(feature);
}

export function createPainter(features) {
  const atlas = document.createElement('canvas');
  atlas.width = W;
  atlas.height = H;
  const borders = document.createElement('canvas');
  borders.width = W;
  borders.height = H;
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const actx = atlas.getContext('2d');
  const bctx = borders.getContext('2d');
  const mctx = mask.getContext('2d');

  actx.fillStyle = '#c5d7e2';
  actx.fillRect(0, 0, W, H);
  for (const feature of features) {
    actx.fillStyle = feature.properties.fill || '#e6d7c3';
    paintFeature(actx, feature);
    actx.fill();
  }
  actx.save();
  actx.strokeStyle = 'rgba(36, 48, 58, 0.16)';
  actx.lineWidth = 1;
  actx.beginPath();
  for (let lon = -150; lon <= 150; lon += 30) {
    geoPath(projection, actx)({ type: 'LineString', coordinates: [[lon, -80], [lon, 80]] });
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    geoPath(projection, actx)({ type: 'LineString', coordinates: [[-180, lat], [180, lat]] });
  }
  actx.stroke();
  actx.restore();
  actx.strokeStyle = 'rgba(48, 36, 28, 0.72)';
  actx.lineWidth = 1.15;
  for (const feature of features) {
    paintFeature(actx, feature);
    actx.stroke();
  }

  bctx.strokeStyle = '#0000ff';
  bctx.lineWidth = 1.4;
  bctx.lineJoin = 'round';
  for (const feature of features) {
    paintFeature(bctx, feature);
    bctx.stroke();
  }

  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 8;
  const maskTex = new THREE.CanvasTexture(mask);
  maskTex.colorSpace = THREE.LinearSRGBColorSpace;
  maskTex.anisotropy = 4;

  function redraw(selected, hover) {
    mctx.clearRect(0, 0, W, H);
    if (hover && hover !== selected) {
      mctx.fillStyle = '#00ff00';
      paintFeature(mctx, hover);
      mctx.fill();
    }
    if (selected) {
      mctx.fillStyle = '#ff0000';
      paintFeature(mctx, selected);
      mctx.fill();
    }
    mctx.drawImage(borders, 0, 0);
    maskTex.needsUpdate = true;
  }

  redraw(null, null);
  return { atlasTex, maskTex, redraw };
}
