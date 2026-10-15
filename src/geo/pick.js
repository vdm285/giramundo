import { geoContains } from 'd3-geo';

function bboxOf(feature) {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  let crosses = false;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') return;
    if (typeof coords[0][0] === 'number') {
      let prev = null;
      for (const [lon, lat] of coords) {
        if (prev && Math.abs(lon - prev) > 180) crosses = true;
        prev = lon;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(feature.geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat, crosses };
}

export function makeIndex(features) {
  const items = features.map((feature) => ({ feature, box: bboxOf(feature) }));
  return {
    items,
    find(lon, lat) {
      // If shapes overlap, the smaller one wins so a country inside a
      // larger claim can still be tapped.
      let best = null;
      let bestArea = Infinity;
      for (const item of items) {
        const b = item.box;
        if (!b.crosses && (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat)) continue;
        if (!geoContains(item.feature, [lon, lat])) continue;
        const area = b.crosses ? 1e9 : Math.max(0.0001, (b.maxLon - b.minLon) * (b.maxLat - b.minLat));
        if (area < bestArea) {
          best = item.feature;
          bestArea = area;
        }
      }
      return best;
    },
  };
}
