// Builds the cities dataset: the most important cities of every country, for
// a second level of tap on the globe and for labels on the flat map.
//
//   node tools/build-cities.mjs            (npm run cities)
//   CITIES_FRESH=1 node tools/build-cities.mjs   (re-download the source)
//
// Source: Natural Earth 1:10m "Populated Places" (public domain), the full
// version (not "simple") because it carries localized names (NAME_ES,
// NAME_EN). The GeoJSON is taken from the nvkelso/natural-earth-vector
// repository, which mirrors the official release, and cached under
// data/cache/ne/ (gitignored, about 19 MB).
//
// Per country we keep the national capital (flagged `capital: true`) plus the
// largest places by POP_MAX, up to 8 in total (12 for the ten most populous
// countries). A place is the capital when FEATURECLA is "Admin-0 capital"
// (sovereign states) or "Admin-0 region capital" (dependencies: Nuuk, Hong
// Kong, Gibraltar), or when its name is the capital that facts.json names
// (Dodoma, Porto-Novo, Tórshavn, San Juan...). "Admin-0 capital alt" is not a
// capital: Natural Earth uses it for Kyoto, Lagos, Valparaíso, Tel Aviv.
//
// Places join to public/data/facts.json through ISO_A2; the rows Natural
// Earth marks "-99" join through ADM0_A3 → facts iso3 (with aliases for the
// codes Natural Earth spells differently: KOS, PSX, ALD, SAH), then SOV_A3.
// When ISO_A2 and ADM0_A3 disagree, ADM0_A3 wins only if it is not the
// sovereign itself: Niue's rows say ISO_A2 "NZ" but ADM0_A3 "NIU" (so Niue),
// while Martinique's say "MQ" and "FRA" (so Martinique, not France).
// Somaliland and Northern Cyprus are not in facts.json and are reported.
//
// Output: one committed file, public/data/cities.json, kept under 250 KB
// (admin1 and tz are dropped first if it does not fit). See docs/PIPELINES.md
// ("Cities").

import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheDir, exists, fetchRetry, loadFacts, root, round, today } from './net.mjs';

const OUT = join(root, 'public/data/cities.json');
const CACHE = join(cacheDir, 'ne');
const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson';
const FALLBACK_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const PER_COUNTRY = 8;
const BIG = { CN: 12, IN: 12, US: 12, BR: 12, RU: 12, MX: 12, JP: 12, ID: 12, NG: 12, PK: 12 };
const MAX_BYTES = 250 * 1024;

// Natural Earth ADM0_A3 codes that differ from ISO 3166-1 alpha-3 in facts.json.
const A3_ALIAS = { KOS: 'UNK', PSX: 'PSE', ALD: 'ALA', SAH: 'ESH' };
// Feature classes that are not places people live in today.
const SKIP_CLASSES = new Set(['Historic place', 'Meteorological Station']);
// Zone names Natural Earth still uses that IANA has renamed.
const TZ_ALIAS = {
  'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Godthab': 'America/Nuuk',
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Ujung_Pandang': 'Asia/Makassar', 'Europe/Uzhgorod': 'Europe/Kyiv', 'Europe/Zaporozhye': 'Europe/Kyiv',
};

// ------------------------------------------------------------------ download

async function loadSource() {
  await mkdir(CACHE, { recursive: true });
  for (const url of [SOURCE_URL, FALLBACK_URL]) {
    const path = join(CACHE, url.slice(url.lastIndexOf('/') + 1));
    if (process.env.CITIES_FRESH) await rm(path, { force: true });
    if (!(await exists(path))) {
      console.log(`downloading ${url}`);
      let res;
      try {
        res = await fetchRetry(url, { headers: { Accept: 'application/json' } });
      } catch (err) {
        console.warn(`  failed: ${err.message}`);
        continue;
      }
      const text = await res.text();
      JSON.parse(text); // a truncated download must not land in the cache
      await writeFile(path, text);
    }
    const { size } = await stat(path);
    console.log(`source: ${path} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return { data: JSON.parse(await readFile(path, 'utf8')), url, simple: url === FALLBACK_URL };
  }
  throw new Error('no Natural Earth populated places file could be downloaded');
}

// ------------------------------------------------------------------ names

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ASCII slug: "São Paulo" → "sao-paulo", "Ciudad de México" → "ciudad-de-mexico".
export function slug(s) {
  return norm(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ßẞ]/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .replace(/[ʻʼ'’`´]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Natural Earth leaves a localized name empty, or copies NAME, when it has
// none; either way the fallback is NAME.
function nameOf(p, lang) {
  const key = `NAME_${lang.toUpperCase()}`;
  return norm(p[key]) || norm(p.NAME_EN) || norm(p.NAME);
}

// ------------------------------------------------------------------ join

function a3ToIso2(code, facts) {
  const a3 = norm(code).toUpperCase();
  return facts.byIso3.get(A3_ALIAS[a3] || a3) || null;
}

function isoOf(p, facts) {
  const a2 = norm(p.ISO_A2).toUpperCase();
  const viaA2 = a2 && a2 !== '-99' && facts.iso2.has(a2) ? a2 : null;
  const adm0 = norm(p.ADM0_A3).toUpperCase();
  const viaAdm0 = a3ToIso2(adm0, facts);
  if (viaA2 && viaAdm0 && viaA2 !== viaAdm0) {
    // Both resolve and disagree: the admin-0 unit wins unless it is the sovereign itself.
    return adm0 !== norm(p.SOV_A3).toUpperCase() ? viaAdm0 : viaA2;
  }
  return viaA2 || viaAdm0 || a3ToIso2(p.SOV_A3, facts);
}

// Does this row carry the capital name facts.json gives the country? Matched on
// the ASCII slug of either language, within the country only.
function namesFactsCapital(p, country) {
  const want = new Set([country.capital?.es, country.capital?.en].filter(Boolean).map(slug));
  if (!want.size) return false;
  return [p.NAME, p.NAME_EN, p.NAME_ES, p.NAMEASCII].some((n) => n && want.has(slug(n)));
}

// Natural Earth's TIMEZONE is sometimes empty, stale or wrong (Macau is filed
// under America/Fortaleza). Renamed zones are mapped to their IANA names; a
// zone the country does not have, or no zone at all, becomes the country's
// zone when it has exactly one; a wrong zone in a multi-zone country is kept
// (it is still a real zone; the error is the source's).
function tzOf(p, country) {
  const zones = country.timezones || [];
  let tz = norm(p.TIMEZONE) || null;
  if (tz) tz = TZ_ALIAS[tz] || tz;
  if (!tz || (zones.length && !zones.includes(tz))) return zones.length === 1 ? zones[0] : tz;
  return tz;
}

function shape(f, p, country) {
  let lat = Number(p.LATITUDE);
  let lon = Number(p.LONGITUDE);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const c = f.geometry && f.geometry.coordinates;
    if (c) { lon = Number(c[0]); lat = Number(c[1]); }
  }
  const pop = Number(p.POP_MAX);
  const qid = norm(p.WIKIDATAID);
  return {
    id: '',
    name: { es: nameOf(p, 'es'), en: nameOf(p, 'en') },
    ll: [round(lat, 3), round(lon, 3)],
    pop: Number.isFinite(pop) && pop > 0 ? pop : null,
    capital: false,
    admin1: norm(p.ADM1NAME) || null,
    tz: tzOf(p, country),
    qid: /^Q\d+$/.test(qid) ? qid : null,
    // selection hints, removed in select()
    _cla: norm(p.FEATURECLA).toLowerCase(),
    _facts: namesFactsCapital(p, country),
  };
}

// Which rows are the capital, decided per country: the row named as the
// capital in facts.json if there is one (so the dossier and the pin agree:
// Sucre, Pretoria, Naypyidaw, Dodoma, Porto-Novo); otherwise every
// "Admin-0 capital" row; otherwise, for dependencies, every "Admin-0 region
// capital" row (Nuuk, Hong Kong, Gibraltar). "Admin-0 region capital" is not
// used when the country has a national capital: Natural Earth also files
// Cardiff, Banja Luka, Batumi and Novi Sad under it.
function markCapitals(rows) {
  const tiers = [
    rows.filter((r) => r._facts),
    rows.filter((r) => r._cla === 'admin-0 capital'),
    rows.filter((r) => r._cla === 'admin-0 region capital'),
  ];
  const chosen = tiers.find((t) => t.length) || [];
  for (const r of chosen) r.capital = true;
}

// ------------------------------------------------------------------ select

function select(rows, iso2) {
  const cap = BIG[iso2] || PER_COUNTRY;
  markCapitals(rows);
  for (const r of rows) { delete r._cla; delete r._facts; }
  const byPop = (a, b) => (b.pop || 0) - (a.pop || 0);
  const capitals = rows.filter((r) => r.capital).sort(byPop);
  const rest = rows.filter((r) => !r.capital).sort(byPop);
  const seen = new Set();
  const ids = new Set();
  const out = [];
  const push = (r) => {
    const key = r.name.en.toLowerCase();
    if (!r.name.en || seen.has(key)) return;
    seen.add(key);
    let id = `${iso2.toLowerCase()}-${slug(r.name.en) || slug(r.name.es) || 'city'}`;
    let n = 2;
    while (ids.has(id)) id = `${iso2.toLowerCase()}-${slug(r.name.en)}-${n++}`;
    ids.add(id);
    out.push({ ...r, id });
  };
  // More than one capital row is possible (a country whose facts.json capital
  // Natural Earth does not have, with several "Admin-0 capital" rows); all are kept.
  for (const r of capitals) push(r);
  for (const r of rest) {
    if (out.length >= cap) break;
    push(r);
  }
  return out;
}

// ------------------------------------------------------------------ size cap

function fit(out) {
  const size = () => Buffer.byteLength(JSON.stringify(out));
  const all = () => Object.values(out.countries).flat();
  const steps = [];
  if (size() > MAX_BYTES) { for (const c of all()) delete c.admin1; steps.push('dropped admin1'); }
  if (size() > MAX_BYTES) { for (const c of all()) delete c.tz; steps.push('dropped tz'); }
  let cap = Math.max(...Object.values(BIG), PER_COUNTRY);
  while (size() > MAX_BYTES && cap > 1) {
    cap -= 1;
    for (const k of Object.keys(out.countries)) out.countries[k] = out.countries[k].slice(0, cap);
    steps.push(`cap ${cap}`);
  }
  return steps;
}

// ------------------------------------------------------------------ main

const facts = await loadFacts();
const { data, url, simple } = await loadSource();
if (simple) console.warn('using the "simple" file: localized names will all be English');

const byIso2 = new Map(facts.facts.countries.map((c) => [c.iso2, c]));
const perCountry = new Map();
let unmatched = 0;
let skipped = 0;
const unmatchedSamples = new Map();
for (const f of data.features) {
  const p = f.properties || {};
  if (SKIP_CLASSES.has(norm(p.FEATURECLA))) { skipped += 1; continue; }
  const iso2 = isoOf(p, facts);
  if (!iso2) {
    unmatched += 1;
    const k = `${norm(p.ISO_A2)}/${norm(p.ADM0_A3)}/${norm(p.SOV_A3)}`;
    unmatchedSamples.set(k, (unmatchedSamples.get(k) || 0) + 1);
    continue;
  }
  if (!perCountry.has(iso2)) perCountry.set(iso2, []);
  perCountry.get(iso2).push(shape(f, p, byIso2.get(iso2)));
}

const out = {
  built: today(),
  source: 'Natural Earth 1:10m Populated Places (public domain)',
  url,
  countries: {},
};
const missing = [];
for (const c of facts.facts.countries) {
  if (!c.iso2) continue;
  const rows = perCountry.get(c.iso2) || [];
  const picked = select(rows, c.iso2);
  if (picked.length) out.countries[c.iso2] = picked;
  else missing.push(c.iso2);
}

const steps = fit(out);
await writeFile(OUT, JSON.stringify(out));
const { size } = await stat(OUT);

const total = Object.values(out.countries).flat().length;
const capitals = Object.values(out.countries).flat().filter((c) => c.capital).length;
const noCapital = Object.entries(out.countries).filter(([, v]) => !v.some((c) => c.capital)).map(([k]) => k);
console.log(`features: ${data.features.length}, skipped (historic/meteorological): ${skipped}, unmatched: ${unmatched}`);
if (unmatched) {
  console.log('  unmatched ISO_A2/ADM0_A3/SOV_A3:', [...unmatchedSamples.entries()].map(([k, n]) => `${k} x${n}`).join(', '));
}
console.log(`countries with cities: ${Object.keys(out.countries).length} of ${facts.facts.countries.length}`);
console.log(`cities: ${total}, capital rows: ${capitals}`);
console.log(`countries with none (${missing.length}): ${missing.join(' ')}`);
console.log(`countries without a capital row (${noCapital.length}): ${noCapital.join(' ')}`);
if (steps.length) console.log(`size steps: ${steps.join(', ')}`);
console.log(`wrote ${OUT} (${(size / 1024).toFixed(1)} KB)`);
