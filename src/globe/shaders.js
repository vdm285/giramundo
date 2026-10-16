// GLSL for the globe. Everything works in linear light and converts to the
// output color space at the end (colorspace_fragment). sRGB textures are
// decoded by the GPU, so texture2D already returns linear values for them.
//
// Texture layout: the NASA plates, the cloud plate, the relief plate, the
// country-id map and the border map all put longitude 0 at the center. The
// sphere's own UV puts longitude 0 on the left edge, so they are sampled at
// uv.x + 0.5. See tests/geo.test.mjs for the frame this relies on.

export const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  vec3 n = normalize(position);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), n);
  east = length(east) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(east);
  vec3 north = cross(n, east);
  mat3 m = mat3(modelMatrix);
  vNormalW = normalize(m * n);
  vEastW = normalize(m * east);
  vNorthW = normalize(m * north);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const earthFrag = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform sampler2D topoMap;
uniform sampler2D cloudMap;
uniform sampler2D idMap;
uniform sampler2D borderMap;
uniform sampler2D paletteA;
uniform sampler2D paletteB;
uniform float paletteMix;
uniform float paletteSize;
uniform vec2 idSize;
uniform vec3 sunDir;
uniform float styleAtlas;
uniform float styleData;
uniform float selectedId;
uniform float hoverId;
uniform float compareId;
uniform float cloudOffset;
uniform float relief;
uniform float hasDay;
uniform float hasNight;
uniform float hasTopo;
uniform float hasWater;
uniform float hasCloud;
uniform float graticule;
uniform float borders;
uniform vec3 accent;
uniform vec3 accent2;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vEastW;
varying vec3 vNorthW;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

float decodeId(vec2 uv) {
  vec4 c = texture2D(idMap, uv);
  return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
}

vec4 paletteAt(float id) {
  vec2 p = vec2((id + 0.5) / paletteSize, 0.5);
  return mix(texture2D(paletteA, p), texture2D(paletteB, p), paletteMix);
}

// Bilinear blend of per-country values, so country edges are smooth even
// though ids must be sampled with nearest filtering.
struct Cell { vec3 color; float hasData; float land; float sel; float hov; float cmp; };

Cell sampleCountry(vec2 uv) {
  vec2 st = uv * idSize - 0.5;
  vec2 f = fract(st);
  vec2 base = (floor(st) + 0.5) / idSize;
  vec2 dx = vec2(1.0 / idSize.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / idSize.y);
  float ids[4];
  ids[0] = decodeId(base);
  ids[1] = decodeId(base + dx);
  ids[2] = decodeId(base + dy);
  ids[3] = decodeId(base + dx + dy);
  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  Cell c;
  c.color = vec3(0.0); c.hasData = 0.0; c.land = 0.0; c.sel = 0.0; c.hov = 0.0; c.cmp = 0.0;
  for (int i = 0; i < 4; i++) {
    float id = ids[i];
    float isLand = step(0.5, id);
    vec4 p = paletteAt(id);
    c.color += toLinear(p.rgb) * w[i] * isLand;
    c.hasData += p.a * w[i] * isLand;
    c.land += isLand * w[i];
    c.sel += (abs(id - selectedId) < 0.5 && selectedId > 0.5 ? 1.0 : 0.0) * w[i];
    c.hov += (abs(id - hoverId) < 0.5 && hoverId > 0.5 ? 1.0 : 0.0) * w[i];
    c.cmp += (abs(id - compareId) < 0.5 && compareId > 0.5 ? 1.0 : 0.0) * w[i];
  }
  if (c.land > 0.001) {
    c.color /= c.land;
    c.hasData /= c.land;
  }
  return c;
}

float gridLine(float coord, float spacing, float width) {
  float g = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
  float fw = fwidth(coord) * width;
  return 1.0 - smoothstep(0.0, fw, g);
}

void main() {
  vec2 uv = vec2(fract(vUv.x + 0.5), vUv.y);
  vec3 n = normalize(vNormalW);
  vec3 east = normalize(vEastW);
  vec3 north = normalize(vNorthW);
  vec3 sun = normalize(sunDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float NdV = clamp(dot(n, V), 0.0, 1.0);
  float sunFacing = dot(n, sun);
  float latRad = (vUv.y - 0.5) * 3.14159265;

  // Relief from the height plate. A texel in u is shorter near the poles.
  vec2 grad = vec2(0.0);
  if (hasTopo > 0.5) {
    vec2 tx = vec2(1.0 / 2048.0, 1.0 / 1024.0);
    float hL = texture2D(topoMap, uv - vec2(tx.x, 0.0)).r;
    float hR = texture2D(topoMap, uv + vec2(tx.x, 0.0)).r;
    float hD = texture2D(topoMap, uv - vec2(0.0, tx.y)).r;
    float hU = texture2D(topoMap, uv + vec2(0.0, tx.y)).r;
    grad = vec2((hR - hL) / max(cos(latRad), 0.15), hU - hD);
  }
  vec3 nb = normalize(n - relief * (grad.x * east + grad.y * north));

  float water = hasWater > 0.5 ? texture2D(waterMap, uv).r : 0.0;
  float clouds = hasCloud > 0.5 ? texture2D(cloudMap, vec2(fract(uv.x + cloudOffset), uv.y)).r : 0.0;
  clouds = smoothstep(0.18, 0.95, clouds);

  Cell cell = sampleCountry(uv);
  float border = texture2D(borderMap, uv).a;

  // ---------- Earth ----------
  vec3 day = hasDay > 0.5 ? texture2D(dayMap, uv).rgb : mix(vec3(0.02, 0.07, 0.16), vec3(0.18, 0.22, 0.12), cell.land);
  float luma = dot(day, vec3(0.2126, 0.7152, 0.0722));
  day = mix(vec3(luma), day, 1.18);
  day = mix(day, day * vec3(0.78, 0.92, 1.12), water * 0.55);
  vec3 nightC = hasNight > 0.5 ? texture2D(nightMap, uv).rgb : vec3(0.0);

  float terminator = smoothstep(-0.16, 0.22, sunFacing);
  float lambert = clamp(dot(nb, sun) * 1.05 + 0.06, 0.0, 1.0);
  float light = lambert * terminator;
  vec3 earth = day * (light * 1.25 + 0.012);
  if (hasCloud > 0.5) {
    vec2 shift = vec2(dot(sun, east), dot(sun, north)) * 0.0035;
    float shadow = smoothstep(0.2, 0.95, texture2D(cloudMap, vec2(fract(uv.x + cloudOffset - shift.x), uv.y - shift.y)).r);
    earth *= 1.0 - shadow * 0.42 * terminator;
  }
  vec3 H = normalize(sun + V);
  float NdH = max(dot(n, H), 0.0);
  float spec = pow(NdH, 160.0) * 1.6 + pow(NdH, 22.0) * 0.08;
  float fresnelW = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  earth += water * (spec * vec3(1.0, 0.9, 0.75) + fresnelW * vec3(0.10, 0.18, 0.32)) * terminator * (1.0 - clouds * 0.8);
  float nightAmt = 1.0 - smoothstep(-0.22, 0.06, sunFacing);
  vec3 lights = pow(nightC, vec3(1.35)) * vec3(1.65, 1.12, 0.62) * 2.4;
  earth += lights * nightAmt * (1.0 - clouds * 0.65);
  earth += day * vec3(0.18, 0.24, 0.42) * 0.035 * nightAmt;
  float dusk = exp(-pow(sunFacing * 4.5, 2.0));
  earth += vec3(0.9, 0.38, 0.12) * dusk * 0.045 * (1.0 - water * 0.4);

  // ---------- Atlas (paper) ----------
  float hill = clamp(1.0 + 7.0 * (-grad.x + grad.y), 0.72, 1.28);
  vec3 paperOcean = toLinear(vec3(0.78, 0.86, 0.89));
  paperOcean = mix(paperOcean, toLinear(vec3(0.69, 0.80, 0.86)), smoothstep(0.0, 0.6, abs(latRad) / 1.57));
  vec3 atlasLand = cell.color * mix(1.0, hill, 0.85);
  vec3 atlas = mix(paperOcean, atlasLand, cell.land);
  atlas *= mix(0.80, 1.0, smoothstep(-0.45, 0.6, sunFacing));

  // ---------- Data (choropleth) ----------
  vec3 dataOcean = toLinear(vec3(0.05, 0.085, 0.13));
  dataOcean += toLinear(vec3(0.05, 0.09, 0.14)) * pow(1.0 - NdV, 2.0) * 0.6;
  float hatch = step(0.5, fract((uv.x * 2.0 + uv.y) * 420.0));
  vec3 noData = mix(toLinear(vec3(0.20, 0.22, 0.25)), toLinear(vec3(0.26, 0.28, 0.31)), hatch);
  vec3 dataLand = mix(noData, cell.color, cell.hasData) * mix(1.0, hill, 0.45);
  vec3 dataCol = mix(dataOcean, dataLand, cell.land);
  dataCol *= mix(0.62, 1.0, smoothstep(-0.35, 0.45, sunFacing));
  dataCol += lights * nightAmt * 0.25 * (1.0 - cell.land * cell.hasData * 0.6);

  vec3 color = mix(earth, atlas, styleAtlas);
  color = mix(color, dataCol, styleData);

  // Graticule, crisp at every zoom.
  float latDeg = latRad * 57.29578;
  float lonDeg = (uv.x - 0.5) * 360.0;
  float grid = max(gridLine(latDeg, 15.0, 1.0), gridLine(lonDeg, 15.0, 1.0));
  float eq = gridLine(latDeg + 90.0, 180.0, 1.6);
  float gridAmt = graticule * (styleAtlas * 0.16 + styleData * 0.10);
  vec3 gridCol = mix(toLinear(vec3(0.22, 0.30, 0.36)), vec3(0.5, 0.6, 0.7), styleData);
  color = mix(color, gridCol, grid * gridAmt * (1.0 - cell.land * 0.55));
  color = mix(color, toLinear(vec3(0.75, 0.42, 0.25)), eq * graticule * styleAtlas * 0.35);

  // Borders: ink on paper, faint light on the photo and the data views.
  vec3 inkAtlas = toLinear(vec3(0.30, 0.22, 0.16));
  vec3 inkDark = vec3(0.55, 0.62, 0.72);
  float borderAmt = borders * border * (styleAtlas * 0.85 + styleData * 0.35 + (1.0 - styleAtlas - styleData) * 0.10);
  color = mix(color, mix(inkDark * 0.4, inkAtlas, styleAtlas), borderAmt);

  // Selection tint, comparison tint, hover lift. The crisp outline is a
  // separate line mesh drawn on top of the sphere.
  vec3 acc = toLinear(accent);
  vec3 acc2 = toLinear(accent2);
  float tint = mix(0.22, 0.40, styleAtlas) * (1.0 - styleData * 0.7);
  color = mix(color, acc, cell.sel * tint);
  color = mix(color, acc2, cell.cmp * tint * 0.9);
  color += vec3(0.07, 0.065, 0.05) * cell.hov * (1.0 - cell.sel) * (1.0 + styleAtlas);

  // Atmosphere in-scatter over the disc: blue on the day side, warm at dusk.
  float fres = pow(1.0 - NdV, 2.6);
  vec3 atm = mix(vec3(0.26, 0.52, 1.0), vec3(1.0, 0.48, 0.2), dusk * 0.75);
  float atmAmt = smoothstep(-0.35, 0.5, sunFacing) * (1.0 - styleAtlas * 0.7) * (1.0 - styleData * 0.75);
  color += atm * fres * 0.62 * atmAmt;
  color = mix(color, color + vec3(0.06, 0.08, 0.1) * fres, styleAtlas);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <colorspace_fragment>
}
`;

export const cloudFrag = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudOffset;
uniform float opacity;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
void main() {
  vec2 uv = vec2(fract(vUv.x + 0.5 + cloudOffset), vUv.y);
  float c = texture2D(cloudMap, uv).r;
  float a = smoothstep(0.16, 0.92, c);
  vec3 n = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float s = dot(n, normalize(sunDir));
  float lit = smoothstep(-0.18, 0.35, s);
  float dusk = exp(-pow(s * 4.0, 2.0));
  vec3 col = mix(vec3(0.035, 0.045, 0.07), vec3(1.0), lit);
  col = mix(col, vec3(1.0, 0.62, 0.38), dusk * 0.55);
  float limb = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  float alpha = a * opacity * (0.55 + 0.45 * lit) * (1.0 - limb * 0.5);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

export const atmosVert = /* glsl */ `
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// A shell drawn from the inside. For each pixel we find where the view ray
// passes closest to the planet and light that height by the sun.
export const atmosFrag = /* glsl */ `
uniform vec3 sunDir;
uniform float outer;
uniform float strength;
varying vec3 vPosW;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPosW - ro);
  float t = -dot(ro, rd);
  vec3 p = ro + rd * t;
  float d = length(p);
  float h = clamp((d - 1.0) / (outer - 1.0), 0.0, 1.0);
  float dens = exp(-h * 5.2) * (1.0 - h);
  vec3 sun = normalize(sunDir);
  float s = dot(normalize(p), sun);
  float dayAmt = smoothstep(-0.28, 0.35, s);
  float dusk = exp(-pow(s * 3.4, 2.0));
  vec3 col = mix(vec3(0.02, 0.035, 0.09), vec3(0.33, 0.6, 1.0), dayAmt);
  col = mix(col, vec3(1.0, 0.5, 0.22), dusk * 0.55);
  float mie = pow(max(dot(rd, sun), 0.0), 10.0);
  col += vec3(1.0, 0.78, 0.55) * mie * 1.1 * smoothstep(-0.5, 0.1, s);
  float amt = dens * strength * (0.22 + 0.78 * max(dayAmt, dusk * 0.8)) + dens * mie * 0.8;
  gl_FragColor = vec4(col * amt, 1.0);
  #include <colorspace_fragment>
}
`;

export const starVert = /* glsl */ `
attribute float size;
attribute vec3 tint;
attribute float phase;
uniform float time;
uniform float pixelRatio;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vTint = tint;
  vAlpha = 0.82 + 0.18 * sin(time * (0.6 + phase * 1.7) + phase * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

export const starFrag = /* glsl */ `
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = pow(smoothstep(0.5, 0.0, length(c)), 1.6);
  gl_FragColor = vec4(vTint * a * vAlpha, 1.0);
  #include <colorspace_fragment>
}
`;

export const pointVert = /* glsl */ `
attribute vec3 color;
attribute float size;
attribute float highlight;
uniform float pixelRatio;
uniform float scale;
varying vec3 vColor;
varying float vFacing;
varying float vHighlight;
void main() {
  vColor = color;
  vHighlight = highlight;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 nW = normalize(wp.xyz);
  vFacing = dot(nW, normalize(cameraPosition - wp.xyz));
  gl_PointSize = size * pixelRatio * scale * (1.0 + highlight * 0.6);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const pointFrag = /* glsl */ `
uniform float opacity;
varying vec3 vColor;
varying float vFacing;
varying float vHighlight;
void main() {
  if (vFacing < 0.08) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.52, 0.64, r);
  float ring = smoothstep(0.62, 0.7, r) * (1.0 - smoothstep(0.86, 1.0, r));
  vec3 col = mix(vec3(0.07, 0.06, 0.05), vColor, core);
  float a = max(core, ring * 0.95) * opacity * smoothstep(0.08, 0.3, vFacing);
  col = mix(col, vec3(1.0), vHighlight * 0.35 * core);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export const arcVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const arcFrag = /* glsl */ `
uniform vec3 color;
uniform float progress;
uniform float time;
uniform float opacity;
varying vec2 vUv;
void main() {
  float x = vUv.x;
  if (x > progress) discard;
  float head = smoothstep(progress - 0.16, progress, x) * step(progress, 0.999);
  float pulse = smoothstep(0.06, 0.0, abs(fract(x - time * 0.35) - 0.5) - 0.44);
  float ends = smoothstep(0.0, 0.03, x) * smoothstep(1.0, 0.97, x);
  vec3 col = color * (0.75 + 0.6 * pulse) + vec3(1.0) * head * 0.6;
  float a = opacity * (0.55 + 0.45 * pulse + head * 0.4) * mix(0.6, 1.0, ends);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export const beaconVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const beaconFrag = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float t = fract(time * 0.55 + float(i) * 0.5);
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(r - t * 0.95));
    a += ring * (1.0 - t) * 0.9;
  }
  float dot = 1.0 - smoothstep(0.1, 0.14, r);
  float halo = (1.0 - smoothstep(0.0, 0.35, r)) * 0.35;
  vec3 col = mix(color, vec3(1.0), dot * 0.75);
  float alpha = clamp(a + dot + halo, 0.0, 1.0) * opacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
