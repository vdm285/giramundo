// Builds public/data/places.json from Wikidata (CC0): per country, the UNESCO
// World Heritage sites with photos and coordinates, the national cuisine and
// its best-known dishes, the national anthem, and the demonym.
//
// Everything comes from the Wikidata Query Service through the cached `sparql`
// helper (data/cache/wikidata/). Countries join to facts.json through
// P297 (ISO 3166-1 alpha-2). A country with no Wikidata match, or with nothing
// filed under it, gets an empty entry: we never invent a site or a dish.
//
// Queries are split in batches of countries so no single query runs close to
// the 60 s WDQS limit, and 429 Retry-After is honored by fetchRetry.
// Re-run: npm run places
//   --landmarks-only      keep heritage, dishes, anthem and demonym from the
//                         existing places.json and rebuild only `landmarks`
//   --country=MX,US,JP    rebuild landmarks for these countries only; the
//                         others keep the landmarks already in places.json
//   --show=MX,US,JP       print the top 20 landmark labels of these countries
//                         at the end (default: the --country list, else MX US JP)

import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root, sparql as sparqlRaw, loadFacts, today, round } from './net.mjs';

const OUT = join(root, 'public/data/places.json');
const MAX_HERITAGE = 25;
const MAX_DISHES = 8;
const MAX_LANDMARKS = 40;
const MAX_LANDMARKS_SMALL = 25; // when the file would pass MAX_BYTES
const MAX_BYTES = 3 * 1024 * 1024;
const BATCH = 25;

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const LANDMARKS_ONLY = ARGS['landmarks-only'] === true;
const ONLY = typeof ARGS.country === 'string' ? new Set(ARGS.country.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) : null;
const SHOW = typeof ARGS.show === 'string' ? ARGS.show.split(',').map((s) => s.trim().toUpperCase()) : (ONLY ? [...ONLY] : ['MX', 'US', 'JP']);

// The previous output: the source of everything but landmarks in
// --landmarks-only mode, and of the landmarks of countries outside --country.
let prev = null;
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { prev = null; }
if ((LANDMARKS_ONLY || ONLY) && !prev) throw new Error(`${OUT} does not exist yet: run once without --landmarks-only / --country`);

// WDQS throttles bursts from one client (429 with Retry-After). Leave a gap
// between queries that actually hit the network; cached ones return at once.
const GAP_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sparql(query, what = 'query') {
  const started = Date.now();
  let rows;
  try {
    rows = await sparqlRaw(query);
  } catch (err) {
    console.error(`${what}: ${err.message}`);
    throw err;
  }
  const ms = Date.now() - started;
  if (ms > 50) {
    console.log(`${what}: ${rows.length} rows in ${(ms / 1000).toFixed(1)} s`);
    await sleep(GAP_MS);
  }
  return rows;
}

const WD = 'http://www.wikidata.org/entity/';
const qid = (uri) => uri.replace(WD, '');
const wd = (q) => `wd:${q}`;

// Commons file URL (Special:FilePath/<encoded name>) -> plain file name.
function commonsName(url) {
  if (!url) return null;
  const tail = url.split('/').pop();
  try { return decodeURIComponent(tail).replace(/_/g, ' '); } catch { return tail; }
}

// "Point(lon lat)" -> [lat, lon]
function parsePoint(wkt) {
  const m = /Point\(([-\d.eE+]+) ([-\d.eE+]+)\)/.exec(wkt || '');
  if (!m) return null;
  return [round(Number(m[2]), 4), round(Number(m[1]), 4)];
}

const v = (b, k) => (b[k] ? b[k].value : null);

// Bilingual label with fallback: es <- mul <- en, en <- mul <- es. Wikidata
// stores a name that is the same in every language (Marcha Real, Kimigayo)
// under the "mul" language only. null if nothing exists.
function bi(es, en, mul) {
  if (!es && !en && !mul) return null;
  return { es: es || mul || en, en: en || mul || es };
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------------------------------------------------------------------------
// 1. Countries: ISO 3166-1 alpha-2 -> Wikidata item.
//    Dissolved states are dropped; where two live items share a code
//    (Antarctica, Cyprus) the one with more sitelinks wins.

const { facts } = await loadFacts();

// ---------------------------------------------------------------------------
// 0. Local language per country, for label.local ("what locals call it").
//    facts.json lists ISO 639-3 codes; Wikidata labels use (mostly) ISO 639-1.
//    The country's first language is mapped through LANG_CODES; when it is
//    not in the table, the country's most-spoken official language from
//    culture.json (languages[0].code, Wikidata P218) is used; else null.

const LANG_CODES = {
  spa: 'es', eng: 'en', fra: 'fr', por: 'pt', deu: 'de', ita: 'it', jpn: 'ja', kor: 'ko', zho: 'zh', ara: 'ar',
  rus: 'ru', hin: 'hi', tur: 'tr', nld: 'nl', pol: 'pl', ell: 'el', heb: 'he', fas: 'fa', tha: 'th', vie: 'vi',
  ind: 'id', msa: 'ms', swa: 'sw', ukr: 'uk', ces: 'cs', hun: 'hu', ron: 'ro', swe: 'sv', nor: 'no', dan: 'da',
  fin: 'fi', cat: 'ca', sqi: 'sq', hye: 'hy', aze: 'az', ben: 'bn', bel: 'be', bul: 'bg', khm: 'km', hrv: 'hr',
  est: 'et', amh: 'am', kat: 'ka', isl: 'is', kaz: 'kk', kir: 'ky', lao: 'lo', lav: 'lv', lit: 'lt', div: 'dv',
  mon: 'mn', mya: 'my', afr: 'af', nep: 'ne', mkd: 'mk', srp: 'sr', slk: 'sk', slv: 'sl', sin: 'si', bos: 'bs',
  grn: 'gn', aym: 'ay', urd: 'ur', uzb: 'uz', tgk: 'tg', tuk: 'tk', mlt: 'mt', gle: 'ga', prs: 'fa', nno: 'nn',
  kal: 'kl', cnr: 'cnr', dzo: 'dz', som: 'so', tir: 'ti', mlg: 'mg', nya: 'ny', sna: 'sn', kin: 'rw', run: 'rn',
  tet: 'tet', fil: 'tl', tgl: 'tl', smo: 'sm', ton: 'to', fij: 'fj', bis: 'bi', hat: 'ht', pap: 'pap', lux: 'lb', ltz: 'lb',
};
let cultureLangs = {};
try {
  const culture = JSON.parse(await readFile(join(root, 'public/data/culture.json'), 'utf8'));
  for (const [iso, c] of Object.entries(culture.countries || {})) cultureLangs[iso] = (c.languages || []).map((l) => l.code).filter(Boolean);
} catch { cultureLangs = {}; }
function localLangOf(c) {
  const first = (c.languages || [])[0];
  if (first && LANG_CODES[first]) return LANG_CODES[first];
  return (cultureLangs[c.iso2] || [])[0] || null;
}

const isoRows = await sparql(`
SELECT ?c ?iso ?links WHERE {
  ?c wdt:P297 ?iso ; wikibase:sitelinks ?links .
  FILTER NOT EXISTS { ?c wdt:P576 ?dissolved }
}`);
const isoToQ = new Map();
for (const b of isoRows) {
  const iso = v(b, 'iso').toUpperCase();
  const links = Number(v(b, 'links'));
  const prev = isoToQ.get(iso);
  if (!prev || links > prev.links) isoToQ.set(iso, { q: qid(v(b, 'c')), links });
}

const countries = facts.countries.map((c) => ({ iso2: c.iso2, q: isoToQ.get(c.iso2)?.q || null }));
const matched = countries.filter((c) => c.q);
const qToIso = new Map(matched.map((c) => [c.q, c.iso2]));
const unmatched = countries.filter((c) => !c.q).map((c) => c.iso2);
console.log(`countries: ${matched.length} matched to Wikidata, ${unmatched.length} without a match${unmatched.length ? ` (${unmatched.join(', ')})` : ''}`);

const valuesOf = (batch) => batch.map((c) => wd(c.q)).join(' ');

// ---------------------------------------------------------------------------
// 2. Anthem (P85). Prefer a statement whose object is a national anthem
//    (Q23691), skip ended or deprecated statements (Mexico also lists its
//    flag salute under P85).

const anthem = new Map();
if (!LANDMARKS_ONLY) {
  const rows = await sparql(`
SELECT ?c ?anthem ?type ?rank ?les ?len ?lmul WHERE {
  ?c wdt:P297 ?iso .
  ?c p:P85 ?st . ?st ps:P85 ?anthem ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?anthem wdt:P31 ?type }
  OPTIONAL { ?anthem rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?anthem rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?anthem rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
}`);
  const score = (b) => (v(b, 'type') === `${WD}Q23691` ? 2 : 0) + (v(b, 'rank')?.endsWith('PreferredRank') ? 1 : 0);
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
    if (!label) continue;
    const cand = { qid: qid(v(b, 'anthem')), ...label, score: score(b) };
    const prev = anthem.get(iso);
    if (!prev || cand.score > prev.score) anthem.set(iso, cand);
  }
}

// ---------------------------------------------------------------------------
// 3. Demonym (P1549, monolingual). Spanish: the masculine singular form
//    (P5185 = Q499327) when marked, else the shortest. English: the singular
//    (P11054 = Q110786) when marked, else the shortest. Forms marked plural
//    (P11054 = Q146786) are skipped when anything else exists. Unmarked
//    Spanish pairs (argentino / argentina) break the tie away from -a.

const demonym = new Map();
if (!LANDMARKS_ONLY) {
  const rows = await sparql(`
SELECT ?c ?demo ?gender ?number WHERE {
  ?c wdt:P297 ?iso .
  ?c p:P1549 ?st . ?st ps:P1549 ?demo .
  FILTER(LANG(?demo) IN ("es", "en"))
  OPTIONAL { ?st pq:P5185 ?gender }
  OPTIONAL { ?st pq:P11054 ?number }
}`);
  const cands = new Map(); // iso -> { es: [], en: [] }
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const lang = b.demo['xml:lang'];
    const entry = cands.get(iso) || { es: [], en: [] };
    entry[lang].push({
      text: v(b, 'demo'),
      masc: v(b, 'gender') === `${WD}Q499327`,
      singular: v(b, 'number') === `${WD}Q110786`,
      plural: v(b, 'number') === `${WD}Q146786`,
    });
    cands.set(iso, entry);
  }
  const pick = (list, flag, lang) => {
    if (!list.length) return null;
    const notPlural = list.filter((d) => !d.plural);
    const base = notPlural.length ? notPlural : list;
    const marked = base.filter((d) => d[flag]);
    let pool = marked.length ? marked : base;
    if (!marked.length && lang === 'es') {
      const notFem = pool.filter((d) => !/a$/.test(d.text));
      if (notFem.length) pool = notFem;
    }
    return pool.sort((a, b) => a.text.length - b.text.length)[0].text;
  };
  for (const [iso, { es, en }] of cands) {
    const d = bi(pick(es, 'masc', 'es'), pick(en, 'singular', 'en'));
    if (d) demonym.set(iso, d);
  }
}

// ---------------------------------------------------------------------------
// 4. National cuisine (an item that is an instance of Q1968435 "national
//    cuisine" with P17 = the country). Wikidata has no "national dish"
//    property; the "national dish" class (Q1391582) is applied to only a
//    handful of items, so the dishes below are the items filed under the
//    national cuisine (P2012) that have a photo, ranked by how many
//    Wikipedias write about them. Items that are also tagged as national
//    dishes are flagged and float to the top. A dish whose country of origin
//    (P495) is recorded and is somewhere else (carbonara under US cuisine)
//    is dropped; one whose origin is the country ranks above one with no
//    origin recorded. Restaurants, chains and brands filed under a cuisine
//    are excluded by type (a full food-class check times out on WDQS).
//    Join order pinned, see below.
//
//    Two more filters apply to every country (see docs/PIPELINES.md):
//    - a dish filed under Tex-Mex cuisine (P2012 = Q29359) is dropped, even
//      when it is also filed under the country's own cuisine (chili con carne
//      sits under Mexican, US and Tex-Mex cuisine with origin Mexico);
//    - a dish with no country of origin (P495) stays only when its cuisine
//      statement names this country's cuisine item (the "national dish"
//      branch below also reaches items through P17, which is kept).
//
//    Per-country curation lives in data/overrides/dishes.json (committed):
//    { "MX": { "include": ["Q…" | { "qid": "Q…", "region": { "es", "en" } }],
//              "exclude": ["Q…"], "note": "why" } }
//    Included items are fetched from Wikidata (label, photo, Wikipedia links)
//    and go first, in the file's order; they bypass the generic filters since
//    a person vouched for them. An included item must exist and have a photo
//    (P18) or it is skipped with a warning: the file names Wikidata items, it
//    does not describe dishes. Excluded items are dropped wherever they came
//    from. The generic list fills the remaining slots up to MAX_DISHES.

const TEX_MEX = 'Q29359';
const OVERRIDES = join(root, 'data/overrides/dishes.json');
let overrides = {}; // keys starting with "_" are comments
try {
  overrides = Object.fromEntries(Object.entries(JSON.parse(await readFile(OVERRIDES, 'utf8'))).filter(([k]) => !k.startsWith('_')));
} catch (err) {
  if (err.code !== 'ENOENT') throw new Error(`${OVERRIDES}: ${err.message}`);
}
const overrideOf = (iso) => {
  const o = overrides[iso] || {};
  const include = (o.include || []).map((x) => (typeof x === 'string' ? { qid: x, region: null } : { qid: x.qid, region: x.region || null }));
  return { include, exclude: new Set(o.exclude || []) };
};
const filterStats = { texmex: new Map(), origin: new Map(), noCuisine: new Map(), excluded: new Map() };
const bump = (m, iso) => m.set(iso, (m.get(iso) || 0) + 1);

const cuisine = new Map();
if (!LANDMARKS_ONLY) {
  const rows = await sparql(`
SELECT ?c ?cuisine ?links ?les ?len ?lmul ?wes ?wen WHERE {
  ?c wdt:P297 ?iso .
  ?cuisine wdt:P17 ?c ; wdt:P31 wd:Q1968435 ; wikibase:sitelinks ?links .
  OPTIONAL { ?cuisine rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?cuisine rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?cuisine rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?wes schema:about ?cuisine ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?wen schema:about ?cuisine ; schema:isPartOf <https://en.wikipedia.org/> }
}`);
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
    if (!label) continue;
    const links = Number(v(b, 'links'));
    const prev = cuisine.get(iso);
    if (prev && prev.links >= links) continue;
    const wiki = {};
    if (v(b, 'wes')) wiki.es = v(b, 'wes');
    if (v(b, 'wen')) wiki.en = v(b, 'wen');
    cuisine.set(iso, { qid: qid(v(b, 'cuisine')), label, wiki, links });
  }
}

const dishes = new Map(); // iso -> [{qid,label,image,national,links}]
if (!LANDMARKS_ONLY) {
  const byCuisine = new Map([...cuisine].map(([iso, c]) => [c.qid, iso]));
  for (const batch of chunk(matched, BATCH)) {
    const cuisineValues = batch.filter((c) => cuisine.has(c.iso2)).map((c) => wd(cuisine.get(c.iso2).qid)).join(' ');
    const rows = await sparql(`
SELECT ?dish ?c ?cuisine ?national (SAMPLE(?img) AS ?image) (SAMPLE(?links) AS ?links)
       (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
       (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen)
       (GROUP_CONCAT(DISTINCT STR(?origin); separator=" ") AS ?origins)
       (GROUP_CONCAT(DISTINCT STR(?cui); separator=" ") AS ?cuisines) WHERE {
  hint:Query hint:optimizer "None" .
  {
    VALUES ?cuisine { ${cuisineValues || 'wd:Q0'} }
    ?dish wdt:P2012 ?cuisine .
  } UNION {
    ?dish wdt:P31 wd:Q1391582 .
    ?dish wdt:P495|wdt:P17 ?c .
    VALUES ?c { ${valuesOf(batch)} }
    BIND(true AS ?national)
  }
  ?dish wdt:P18 ?img .
  ?dish wikibase:sitelinks ?links .
  FILTER NOT EXISTS {
    VALUES ?bad { wd:Q11707 wd:Q18534542 wd:Q4830453 wd:Q6881511 wd:Q783794 wd:Q431289 wd:Q5 wd:Q7889 wd:Q11032 wd:Q571 }
    ?dish wdt:P31 ?bad .
  }
  OPTIONAL { ?dish wdt:P495 ?origin }
  OPTIONAL { ?dish wdt:P2012 ?cui }
  OPTIONAL { ?dish rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?dish rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?dish rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?wes schema:about ?dish ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?wen schema:about ?dish ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?dish ?c ?cuisine ?national`, `dishes ${batch[0].iso2}-${batch.at(-1).iso2}`);
    for (const b of rows) {
      const iso = v(b, 'c') ? qToIso.get(qid(v(b, 'c'))) : byCuisine.get(qid(v(b, 'cuisine')));
      if (!iso) continue;
      const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
      if (!label) continue;
      const id = qid(v(b, 'dish'));
      if (overrideOf(iso).exclude.has(id)) { bump(filterStats.excluded, iso); continue; }
      const national = v(b, 'national') === 'true';
      const origins = (v(b, 'origins') || '').split(' ').filter(Boolean).map(qid);
      const cuisines = (v(b, 'cuisines') || '').split(' ').filter(Boolean).map(qid);
      const countryQ = matched.find((c) => c.iso2 === iso).q;
      const local = origins.includes(countryQ);
      if (cuisines.includes(TEX_MEX)) { bump(filterStats.texmex, iso); continue; }
      if (origins.length && !local) { bump(filterStats.origin, iso); continue; }
      if (!origins.length && !national && !cuisines.includes(cuisine.get(iso)?.qid)) { bump(filterStats.noCuisine, iso); continue; }
      const list = dishes.get(iso) || [];
      const prev = list.find((d) => d.qid === id);
      if (prev) { prev.national ||= national; continue; }
      const wiki = {};
      if (v(b, 'wes')) wiki.es = v(b, 'wes');
      if (v(b, 'wen')) wiki.en = v(b, 'wen');
      list.push({ qid: id, label, image: commonsName(v(b, 'image')), wiki, national, local, links: Number(v(b, 'links')) });
      dishes.set(iso, list);
    }
  }
}

// 4b. Curated dishes from data/overrides/dishes.json: one query for every
//     included item, then placed first per country in the file's order.

const curated = new Map(); // iso -> [{qid,label,image,wiki,region}]
if (!LANDMARKS_ONLY) {
  const wanted = new Map(); // qid -> fetched row
  for (const iso of Object.keys(overrides)) for (const { qid: q } of overrideOf(iso).include) wanted.set(q, null);
  if (wanted.size) {
    const rows = await sparql(`
SELECT ?dish (SAMPLE(?img) AS ?image) (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
       (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen) WHERE {
  VALUES ?dish { ${[...wanted.keys()].map(wd).join(' ')} }
  OPTIONAL { ?dish wdt:P18 ?img }
  OPTIONAL { ?dish rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?dish rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?dish rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?wes schema:about ?dish ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?wen schema:about ?dish ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?dish`, 'curated dishes');
    for (const b of rows) wanted.set(qid(v(b, 'dish')), b);
  }
  for (const iso of Object.keys(overrides)) {
    if (!matched.some((c) => c.iso2 === iso)) { console.warn(`overrides: ${iso} is not a country in facts.json, skipped`); continue; }
    const list = [];
    for (const { qid: q, region } of overrideOf(iso).include) {
      const b = wanted.get(q);
      const label = b && bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
      if (!label) { console.warn(`overrides ${iso}: ${q} is not a Wikidata item with a label, skipped`); continue; }
      const image = commonsName(v(b, 'image'));
      if (!image) { console.warn(`overrides ${iso}: ${q} (${label.es}) has no photo (P18), skipped`); continue; }
      if (list.some((d) => d.qid === q)) continue;
      const wiki = {};
      if (v(b, 'wes')) wiki.es = v(b, 'wes');
      if (v(b, 'wen')) wiki.en = v(b, 'wen');
      const d = { qid: q, label, image, wiki };
      if (region && (region.es || region.en)) d.region = { es: region.es || region.en, en: region.en || region.es };
      list.push(d);
    }
    curated.set(iso, list);
  }
}

// ---------------------------------------------------------------------------
// 5. UNESCO World Heritage sites. A site is an item with a UNESCO id (P757,
//    no "-", so component parts of serial sites are excluded) and a live
//    heritage designation statement (P1435 = Q9259) that has not ended.
//    The country is the site's P17, so transboundary sites appear under
//    every country they lie in. Year is the designation's start time.
//    A site under several countries is marked shared (count) and sorts after
//    the local ones, since it has a single coordinate.
//    The join order is pinned (optimizer "None"): left to itself Blazegraph
//    sometimes starts from the wrong side and the query hits the 60 s limit.

const heritage = new Map(); // iso -> [site]
if (!LANDMARKS_ONLY) {
  for (const batch of chunk(matched, BATCH)) {
    const rows = await sparql(`
SELECT ?site ?c (SAMPLE(?whs) AS ?whsId) (MIN(?yr) AS ?year) (SAMPLE(?links) AS ?links)
       (SAMPLE(?coord) AS ?coord) (SAMPLE(?img) AS ?image)
       (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
       (SAMPLE(?des) AS ?des) (SAMPLE(?den) AS ?den)
       (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen) WHERE {
  hint:Query hint:optimizer "None" .
  ?site wdt:P757 ?whs .
  FILTER(!CONTAINS(?whs, "-"))
  ?site p:P1435 ?st . ?st ps:P1435 wd:Q9259 ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  ?site wdt:P17 ?c .
  VALUES ?c { ${valuesOf(batch)} }
  ?site wikibase:sitelinks ?links .
  OPTIONAL { ?st pq:P580 ?start . BIND(YEAR(?start) AS ?yr) }
  OPTIONAL { ?site wdt:P625 ?coord }
  OPTIONAL { ?site wdt:P18 ?img }
  OPTIONAL { ?site rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?site rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?site rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?site schema:description ?des FILTER(LANG(?des) = "es") }
  OPTIONAL { ?site schema:description ?den FILTER(LANG(?den) = "en") }
  OPTIONAL { ?wes schema:about ?site ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?wen schema:about ?site ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?site ?c`, `heritage ${batch[0].iso2}-${batch.at(-1).iso2}`);
    for (const b of rows) {
      const iso = qToIso.get(qid(v(b, 'c')));
      if (!iso) continue;
      const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
      if (!label) continue;
      const list = heritage.get(iso) || [];
      const id = qid(v(b, 'site'));
      if (list.some((s) => s.qid === id)) continue;
      const wiki = {};
      if (v(b, 'wes')) wiki.es = v(b, 'wes');
      if (v(b, 'wen')) wiki.en = v(b, 'wen');
      const year = v(b, 'year') ? Number(v(b, 'year')) : null;
      list.push({
        qid: id,
        whs: v(b, 'whsId'),
        label,
        desc: bi(v(b, 'des'), v(b, 'den')),
        ll: parsePoint(v(b, 'coord')),
        image: commonsName(v(b, 'image')),
        year: Number.isFinite(year) ? year : null,
        wiki,
        links: Number(v(b, 'links')),
      });
      heritage.set(iso, list);
    }
  }
}

// ---------------------------------------------------------------------------
// 5b. Landmarks: the places people actually visit, World Heritage or not
//     (Chapultepec, Times Square, Shibuya, a national park, a cathedral).
//     Two SPARQL requests per country (candidates, then their details, see
//     below): items whose country (P17) is this one,
//     with coordinates (P625) and a photo (P18), whose class (P31) is in the
//     subclass tree of "tourist attraction" (Q570116) or of one of the
//     LANDMARK_ROOTS below (park, museum, square, beach, archaeological site,
//     church, palace...). The class trees are resolved once, server side, in
//     a subquery (about 6,000 classes; the three widest trees, monument,
//     memorial and fortification, are taken one level deep so statues and
//     bunkers do not flood the list). Bridges and skyscrapers count only with
//     25 or more sitelinks. Unlike the heritage and dish queries this one is
//     left to the optimizer: measured on the United States, the pinned order
//     P17 -> sitelinks -> class took 54 to 113 s, the optimizer's plan 25 s.
//     Ranked by sitelinks, the 120 best candidates are fetched and filtered
//     here: anything already in `heritage`, anything whose class says it is a
//     settlement, an administrative unit, a country, an island or a river
//     (unless it is also an archaeological site: Mitla is a town and a ruin),
//     anything whose label is the name of a country, a state or a city, and
//     anything excluded in data/overrides/landmarks.json. Nature (mountains,
//     lakes, volcanoes) is capped at a quarter of the slots: every Wikipedia
//     writes about the Great Lakes, few people go to look at them.
//     `kind` is a short tag from the class tree, in this priority: site,
//     monument, palace, church, temple, museum, square, market, beach, tower,
//     bridge, park, nature, other.
//     Overrides (data/overrides/landmarks.json, committed):
//     { "MX": { "include": ["Q523194"], "exclude": ["Q13700"], "note": "why" } }
//     Included items are fetched by id (they still need coordinates and a
//     photo), ranked with the rest and never dropped by the cap; they carry
//     curated: true. Excluded ids are dropped wherever they came from.

const LANDMARK_ROOTS = {
  site: ['Q839954', 'Q12516', 'Q109607', 'Q1081138', 'Q893745', 'Q57821'], // archaeological site, pyramid, ruins, historic site, national monument, fortification (shallow)
  monument: ['Q4989906', 'Q5003624', 'Q179700', 'Q1779653', 'Q143912', 'Q170980'], // monument (shallow), memorial (shallow), statue, colossal statue, triumphal arch, obelisk
  palace: ['Q16560', 'Q23413', 'Q751876'], // palace, castle, château
  church: ['Q16970', 'Q44613'], // church building (cathedrals, basilicas, chapels), monastery
  temple: ['Q44539', 'Q845945', 'Q32815', 'Q34627'], // temple (Buddhist, Hindu...), Shinto shrine, mosque, synagogue
  museum: ['Q33506'],
  square: ['Q174782'],
  market: ['Q330284', 'Q132510'], // marketplace, market
  beach: ['Q40080'],
  tower: ['Q1440300', 'Q39715', 'Q12518', 'Q11303'], // observation tower, lighthouse, tower (Tokyo Tower is a lattice tower), skyscraper (25+ sitelinks)
  bridge: ['Q12280'], // 25+ sitelinks
  park: ['Q22698', 'Q46169', 'Q167346', 'Q1107656', 'Q194195', 'Q43501', 'Q2281788'], // park (urban park...), national park, botanical garden, garden, amusement park (theme park), zoo, public aquarium
  nature: ['Q8502', 'Q8072', 'Q34038', 'Q35509', 'Q150784', 'Q23397', 'Q177380', 'Q83471', 'Q179049', 'Q23790', 'Q334743', 'Q187223', 'Q631305', 'Q25391'], // mountain, volcano, waterfall, cave, canyon, lake, hot spring, geyser, nature reserve, natural monument, cenote, lagoon, rock formation, dune
  other: ['Q570116', 'Q2319498', 'Q153562', 'Q2190251'], // tourist attraction, architectural landmark, opera house, arts centre
};
const KIND_PRIORITY = Object.keys(LANDMARK_ROOTS);
const SHALLOW_ROOTS = new Set(['Q4989906', 'Q5003624', 'Q57821']);
const BIG_ONLY = ['Q12280', 'Q11303'];
const BIG_MIN_LINKS = 25;
const MIN_LINKS = 3;
const CANDIDATES = 120;
const NATURE_SHARE = 1 / 4;
// A settlement that is also, directly, an archaeological site, ruins or a
// pyramid stays (Mitla, Kohunlich). Being under "historic site" or "ancient
// city" is not enough: Kamakura, Hakodate and Kumamoto are cities.
const SITE_DIRECT = ['Q839954', 'Q109607', 'Q12516'];
// Classes that make an item a place to live or govern, not a place to visit:
// human settlement (direct), and the trees of administrative territorial
// entity, city, town, village, country, island, archipelago, river.
const NOT_A_PLACE_TREES = ['Q56061', 'Q515', 'Q3957', 'Q532', 'Q6256', 'Q23442', 'Q33837', 'Q4022'];
const NOT_A_PLACE_DIRECT = ['Q486972'];

const allRoots = Object.values(LANDMARK_ROOTS).flat();
const deepRoots = allRoots.filter((r) => !SHALLOW_ROOTS.has(r));
const shallowRoots = allRoots.filter((r) => SHALLOW_ROOTS.has(r));
const classTreeSparql = `
      {
        VALUES ?root { ${deepRoots.map(wd).join(' ')} }
        ?k wdt:P279* ?root .
      } UNION {
        VALUES ?root { ${shallowRoots.map(wd).join(' ')} }
        ?k wdt:P279? ?root .
      }`;

const LM_OVERRIDES = join(root, 'data/overrides/landmarks.json');
let lmOverrides = {};
try {
  lmOverrides = Object.fromEntries(Object.entries(JSON.parse(await readFile(LM_OVERRIDES, 'utf8'))).filter(([k]) => !k.startsWith('_')));
} catch (err) {
  if (err.code !== 'ENOENT') throw new Error(`${LM_OVERRIDES}: ${err.message}`);
}
const lmOverrideOf = (iso) => ({ include: lmOverrides[iso]?.include || [], exclude: new Set(lmOverrides[iso]?.exclude || []) });

// Names that are not landmarks: every country (es/en), every city in
// cities.json (es/en) and every first-level unit in public/data/admin.
const fold = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const placeNames = new Set();
for (const c of facts.countries) for (const n of [c.name?.es, c.name?.en, c.official?.es, c.official?.en]) if (n) placeNames.add(fold(n));
try {
  const cities = JSON.parse(await readFile(join(root, 'public/data/cities.json'), 'utf8'));
  for (const list of Object.values(cities.countries || {})) for (const c of list) for (const n of [c.name?.es, c.name?.en]) if (n) placeNames.add(fold(n));
} catch { /* cities.json is optional here */ }
try {
  const adminDir = join(root, 'public/data/admin');
  for (const f of await readdir(adminDir)) {
    if (!/-adm1\.json$/.test(f)) continue;
    const geo = JSON.parse(await readFile(join(adminDir, f), 'utf8'));
    for (const ft of geo.features || []) if (ft.properties?.name) placeNames.add(fold(ft.properties.name));
  }
} catch { /* no admin data */ }

// kind of an item from its P31 classes (any depth, through the class tree map)
const classRoots = new Map(); // class qid -> Set(root qid)
const kindOfRoot = (r) => KIND_PRIORITY.find((name) => LANDMARK_ROOTS[name].includes(r));
const rootsOf = (classes) => {
  const roots = new Set();
  for (const c of classes) for (const r of classRoots.get(c) || []) roots.add(r);
  return roots;
};
const kindOf = (roots) => {
  const kinds = new Set([...roots].map(kindOfRoot));
  return KIND_PRIORITY.find((k) => kinds.has(k)) || 'other';
};

const landmarkFields = `
  (SAMPLE(?coord) AS ?coord) (SAMPLE(?img) AS ?image)
  (GROUP_CONCAT(DISTINCT STR(?cls); separator=" ") AS ?classes)
  (GROUP_CONCAT(DISTINCT STR(?bad); separator=" ") AS ?bads)
  (SAMPLE(?gone) AS ?gone) (SAMPLE(?collection) AS ?collection)
  (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
  (SAMPLE(?des) AS ?des) (SAMPLE(?den) AS ?den)
  (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen)`;
// (BIND(EXISTS {...}) comes back unbound from Blazegraph; an OPTIONAL join
// with GROUP_CONCAT does the same job.)
const landmarkOptionals = `
  ?item wdt:P31 ?cls .
  OPTIONAL { VALUES ?bad { ${NOT_A_PLACE_TREES.map(wd).join(' ')} } ?item wdt:P31 ?b1 . ?b1 wdt:P279* ?bad . }
  OPTIONAL { ?item wdt:P576 ?gone }
  OPTIONAL { ?item wdt:P195 ?collection }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?item rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?item rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?item schema:description ?des FILTER(LANG(?des) = "es") }
  OPTIONAL { ?item schema:description ?den FILTER(LANG(?den) = "en") }
  OPTIONAL { ?wes schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?wen schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }`;

function landmarkRow(b) {
  const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
  const ll = parsePoint(v(b, 'coord'));
  const image = commonsName(v(b, 'image'));
  if (!label || !ll || !image) return null;
  const classes = (v(b, 'classes') || '').split(' ').filter(Boolean).map(qid);
  const roots = rootsOf(classes);
  const sitelinks = Number(v(b, 'links'));
  // A bridge or a skyscraper that is nothing else needs 25 sitelinks.
  const bigOnly = roots.size > 0 && [...roots].every((r) => BIG_ONLY.includes(r));
  const wiki = {};
  if (v(b, 'wes')) wiki.es = v(b, 'wes');
  if (v(b, 'wen')) wiki.en = v(b, 'wen');
  return {
    qid: qid(v(b, 'item')),
    label,
    desc: bi(v(b, 'des'), v(b, 'den')),
    ll,
    image,
    wiki,
    kind: kindOf(roots),
    sitelinks,
    notAPlace: classes.some((c) => NOT_A_PLACE_DIRECT.includes(c)) || (v(b, 'bads') || '').trim().length > 0,
    isSite: classes.some((c) => SITE_DIRECT.includes(c)),
    tooSmall: bigOnly && sitelinks < BIG_MIN_LINKS,
    // Demolished or dissolved (P576: the Lighthouse of Alexandria, the
    // Tuileries), or held in a collection (P195: the Venus de Milo is a
    // statue, but a museum piece is not a place).
    gone: !!v(b, 'gone') || !!v(b, 'collection'),
  };
}

const landmarks = new Map(); // iso -> [item]
const lmStats = { queried: 0, failed: [], candidates: 0, droppedHeritage: 0, droppedNotAPlace: 0, droppedGone: 0, droppedName: 0, droppedExcluded: 0, natureCapped: 0, curated: 0, curatedMissing: [] };
{
  // Class tree -> kind, once (about 6,000 rows).
  const rows = await sparql(`SELECT DISTINCT ?k ?root WHERE {${classTreeSparql}
}`, 'landmark classes');
  for (const b of rows) {
    const k = qid(v(b, 'k'));
    if (!classRoots.has(k)) classRoots.set(k, new Set());
    classRoots.get(k).add(qid(v(b, 'root')));
  }
  console.log(`landmark classes: ${classRoots.size} classes under ${allRoots.length} roots`);

  const heritageIds = new Map(); // iso -> Set(qid)
  for (const c of matched) {
    const list = LANDMARKS_ONLY ? (prev?.countries?.[c.iso2]?.heritage || []) : (heritage.get(c.iso2) || []);
    heritageIds.set(c.iso2, new Set(list.map((s) => s.qid)));
  }

  // Curated includes, one query for every id.
  const included = new Map(); // qid -> row
  {
    const ids = new Set();
    for (const [iso, o] of Object.entries(lmOverrides)) {
      if (!matched.some((c) => c.iso2 === iso)) { console.warn(`landmark overrides: ${iso} is not a country in facts.json, skipped`); continue; }
      if (ONLY && !ONLY.has(iso)) continue;
      for (const q of o.include || []) ids.add(q);
    }
    if (ids.size) {
      const rows = await sparql(`
SELECT ?item (SAMPLE(?links) AS ?links) ${landmarkFields} WHERE {
  VALUES ?item { ${[...ids].map(wd).join(' ')} }
  ?item wikibase:sitelinks ?links .${landmarkOptionals}
} GROUP BY ?item`, 'curated landmarks');
      for (const b of rows) {
        const row = landmarkRow(b);
        if (row) included.set(row.qid, row);
        else lmStats.curatedMissing.push(`${qid(v(b, 'item'))} (no label, coordinates or photo)`);
      }
      for (const q of ids) if (!included.has(q) && !lmStats.curatedMissing.some((m) => m.startsWith(q))) lmStats.curatedMissing.push(`${q} (not found)`);
    }
  }

  const todo = matched.filter((c) => !ONLY || ONLY.has(c.iso2));
  for (const c of todo) {
    const iso = c.iso2;
    const own = new Set(c.q ? [c.q] : []);
    let rows;
    try {
      // Two requests: the candidates (left to the optimizer, see above) and
      // their details (pinned: start from the VALUES list, then the
      // OPTIONALs). In one request the optimizer also reshuffles the outer
      // OPTIONALs and the whole thing times out.
      const cands = await sparql(`
SELECT DISTINCT ?item ?links WHERE {
  ?item wdt:P17 ${wd(c.q)} .
  ?item wdt:P31 ?k .
  { SELECT DISTINCT ?k WHERE {${classTreeSparql}
  } }
  ?item wikibase:sitelinks ?links .
  FILTER(?links >= ${MIN_LINKS})
  ?item wdt:P625 ?c0 .
  ?item wdt:P18 ?i0 .
} ORDER BY DESC(?links) LIMIT ${CANDIDATES}`, `landmarks ${iso}`);
      rows = cands.length ? await sparql(`
SELECT ?item (SAMPLE(?links) AS ?links) ${landmarkFields} WHERE {
  hint:Query hint:optimizer "None" .
  VALUES ?item { ${cands.map((b) => wd(qid(v(b, 'item')))).join(' ')} }
  ?item wikibase:sitelinks ?links .${landmarkOptionals}
} GROUP BY ?item`, `landmark details ${iso}`) : [];
    } catch (err) {
      lmStats.failed.push(iso);
      console.warn(`landmarks ${iso}: ${err.message}; keeping the previous list`);
      const old = prev?.countries?.[iso]?.landmarks;
      if (old) landmarks.set(iso, old.map((l) => ({ ...l, keep: true })));
      continue;
    }
    lmStats.queried += 1;
    const { include, exclude } = lmOverrideOf(iso);
    const seen = new Set();
    const pool = [];
    const consider = (row, curated) => {
      if (!row || seen.has(row.qid) || own.has(row.qid)) return;
      seen.add(row.qid);
      if (exclude.has(row.qid)) { lmStats.droppedExcluded += 1; return; }
      if (heritageIds.get(iso)?.has(row.qid)) { lmStats.droppedHeritage += 1; return; }
      if (!curated) {
        if (row.tooSmall) return;
        if (row.gone) { lmStats.droppedGone += 1; return; }
        if (row.notAPlace && !row.isSite) { lmStats.droppedNotAPlace += 1; return; }
        if (placeNames.has(fold(row.label.es)) || placeNames.has(fold(row.label.en))) { lmStats.droppedName += 1; return; }
      }
      const { notAPlace, isSite, tooSmall, gone, ...item } = row;
      pool.push(curated ? { ...item, curated: true } : item);
    };
    for (const q of include) consider(included.get(q), true);
    for (const b of rows) { lmStats.candidates += 1; consider(landmarkRow(b), false); }
    pool.sort((a, b) => b.sitelinks - a.sitelinks);
    if (pool.length) landmarks.set(iso, pool);
  }
  // Countries outside --country keep what the file already has.
  if (ONLY && prev) {
    for (const c of matched) {
      if (ONLY.has(c.iso2) || landmarks.has(c.iso2)) continue;
      const old = prev.countries?.[c.iso2]?.landmarks;
      if (old?.length) landmarks.set(c.iso2, old.map((l) => ({ ...l, keep: true })));
    }
  }
}

// Cap per country: curated first, then by sitelinks, nature at most a quarter.
function capLandmarks(list, max) {
  if (list.length && list[0].keep) return list.slice(0, max).map(({ keep, ...l }) => l);
  const natureMax = Math.ceil(max * NATURE_SHARE);
  const out = [];
  let nature = 0;
  const sorted = [...list].sort((a, b) => Number(!!b.curated) - Number(!!a.curated) || b.sitelinks - a.sitelinks);
  for (const l of sorted) {
    if (out.length >= max) break;
    if (l.kind === 'nature' && !l.curated) {
      if (nature >= natureMax) { lmStats.natureCapped += 1; continue; }
      nature += 1;
    }
    out.push(l);
  }
  return out.sort((a, b) => b.sitelinks - a.sitelinks);
}

// ---------------------------------------------------------------------------
// 6. Assemble. Local sites with a photo and coordinates first, then the ones
//    more Wikipedias write about. Dishes: national ones first, then by sitelinks.

const siteCountries = new Map();
for (const list of heritage.values()) for (const s of list) siteCountries.set(s.qid, (siteCountries.get(s.qid) || 0) + 1);

const out = {
  built: today(),
  source: 'Wikidata (CC0), Wikimedia Commons',
  attribution: {
    data: 'Wikidata, CC0 1.0. https://www.wikidata.org/',
    images: 'Each image is a Wikimedia Commons file with its own license; show the author and license from the file page. Thumbnail: https://commons.wikimedia.org/wiki/Special:FilePath/<image>?width=640',
    text: 'desc and wiki links point to Wikipedia (CC BY-SA 4.0).',
  },
  notes: 'heritage = UNESCO World Heritage sites (P1435=Q9259 with a P757 id) whose P17 is the country, capped at 25, shared=n when the site spans n countries; dishes = items filed under the national cuisine (P2012) with a photo and no foreign country of origin, not filed under Tex-Mex (Q29359), ranked by sitelinks, national=true when tagged Q1391582; curated=true (and region) on dishes a person picked in data/overrides/dishes.json, which go first; anthem = P85; demonym = P1549.'
    + ` landmarks = items in the country (P17) with coordinates and a photo whose class (P31) is under tourist attraction (Q570116) or under a list of place classes (park, museum, square, beach, archaeological site, church, temple, palace, tower, bridge, market, nature...), not in heritage, not a settlement or an administrative unit, not named like a country, state or city, ranked by sitelinks, capped at ${MAX_LANDMARKS} with nature at most a quarter; kind = the class tag; curated=true on items a person added in data/overrides/landmarks.json.`,
  countries: {},
};

const stats = { withHeritage: 0, sites: 0, sitesWithImage: 0, sitesWithLl: 0, withDishes: 0, dishes: 0, withCuisine: 0, withAnthem: 0, withDemonym: 0, capped: [], curated: [] };

function assembleCountry(c) {
  if (LANDMARKS_ONLY) {
    const { landmarks: _old, ...rest } = prev.countries?.[c.iso2] || { qid: c.q, demonym: null, anthem: null, cuisine: null, dishes: [], heritage: [] };
    return rest;
  }
  const sites = (heritage.get(c.iso2) || [])
    .map((s) => ({ ...s, shared: siteCountries.get(s.qid) }))
    .sort((a, b) => (Number(a.shared > 1) - Number(b.shared > 1))
      || (Number(!!b.image && !!b.ll) - Number(!!a.image && !!a.ll))
      || (b.links - a.links));
  if (sites.length > MAX_HERITAGE) stats.capped.push(`${c.iso2}:${sites.length}`);
  const kept = sites.slice(0, MAX_HERITAGE).map(({ links, shared, ...s }) => (shared > 1 ? { ...s, shared } : s));
  const picked = curated.get(c.iso2) || [];
  const pickedIds = new Set(picked.map((d) => d.qid));
  const ds = picked.map((d) => ({ ...d, curated: true })).concat((dishes.get(c.iso2) || [])
    .filter((d) => !pickedIds.has(d.qid))
    .sort((a, b) => (Number(b.national) - Number(a.national)) || (Number(b.local) - Number(a.local)) || (b.links - a.links))
    .slice(0, Math.max(0, MAX_DISHES - picked.length))
    .map(({ links, national, local, ...d }) => (national ? { ...d, national: true } : d)));
  if (picked.length) stats.curated.push(`${c.iso2}:${picked.length}`);
  const cu = cuisine.get(c.iso2);
  return {
    qid: c.q,
    demonym: demonym.get(c.iso2) || null,
    anthem: anthem.get(c.iso2) ? (({ score, ...a }) => a)(anthem.get(c.iso2)) : null,
    cuisine: cu ? { qid: cu.qid, label: cu.label, wiki: cu.wiki } : null,
    dishes: ds,
    heritage: kept,
  };
}

for (const c of countries) {
  const entry = assembleCountry(c);
  entry.landmarks = capLandmarks(landmarks.get(c.iso2) || [], MAX_LANDMARKS);
  out.countries[c.iso2] = entry;
  const kept = entry.heritage;
  const ds = entry.dishes;
  if (kept.length) stats.withHeritage += 1;
  stats.sites += kept.length;
  stats.sitesWithImage += kept.filter((s) => s.image).length;
  stats.sitesWithLl += kept.filter((s) => s.ll).length;
  if (ds.length) stats.withDishes += 1;
  stats.dishes += ds.length;
  if (entry.cuisine) stats.withCuisine += 1;
  if (entry.anthem) stats.withAnthem += 1;
  if (entry.demonym) stats.withDemonym += 1;
}

// ---------------------------------------------------------------------------
// 7. Local labels: what locals call the dish (and the cuisine and the sites),
//    i.e. the Wikidata label in the country's first language (see step 0).
//    es/en countries reuse the label already fetched; the rest are queried
//    per language in batches, with the "mul" label as a fallback (a name that
//    is the same in every language). null when Wikidata has no label.

const localStats = { dishes: 0, dishesDiffer: 0, cuisines: 0, sites: 0, landmarks: 0, langs: new Set(), queries: 0 };
{
  const WD_LANGS = { no: ['nb', 'no'] }; // Wikidata codes that differ from the table
  const want = new Map(); // lang -> Map(qid -> [objects whose label gets .local])
  for (const c of facts.countries) {
    const entry = out.countries[c.iso2];
    if (!entry) continue;
    const lang = localLangOf(c);
    entry.localLang = lang;
    // In --landmarks-only mode dishes, cuisine and heritage keep the local
    // labels the file already has; only the landmarks are (re)labelled.
    const targets = LANDMARKS_ONLY
      ? [...entry.landmarks]
      : [...entry.dishes, ...entry.heritage, ...entry.landmarks, ...(entry.cuisine ? [entry.cuisine] : [])];
    for (const t of targets) t.label = { ...t.label, local: null };
    if (!LANDMARKS_ONLY) for (const d of entry.dishes) d.localLang = lang;
    if (!lang) continue;
    if (lang === 'es' || lang === 'en') {
      for (const t of targets) t.label.local = t.label[lang];
      continue;
    }
    const m = want.get(lang) || new Map();
    for (const t of targets) {
      if (!m.has(t.qid)) m.set(t.qid, []);
      m.get(t.qid).push(t);
    }
    want.set(lang, m);
  }
  for (const [lang, m] of want) {
    const codes = WD_LANGS[lang] || [lang];
    for (const batch of chunk([...m.keys()], 200)) {
      let rows;
      try {
        rows = await sparql(`
SELECT ?item ?l WHERE {
  VALUES ?item { ${batch.map(wd).join(' ')} }
  ?item rdfs:label ?l .
  FILTER(LANG(?l) IN (${[...codes, 'mul'].map((x) => `"${x}"`).join(', ')}))
}`, `labels ${lang}`);
      } catch {
        continue; // this language keeps local: null; the run goes on
      }
      localStats.queries += 1;
      const got = new Map(); // qid -> { text, mul }
      for (const b of rows) {
        const q = qid(v(b, 'item'));
        const mul = b.l['xml:lang'] === 'mul';
        const prev = got.get(q);
        if (!prev || (prev.mul && !mul)) got.set(q, { text: v(b, 'l'), mul });
      }
      for (const [q, { text }] of got) for (const t of m.get(q)) t.label.local = text;
    }
  }
  for (const entry of Object.values(out.countries)) {
    if (entry.localLang) localStats.langs.add(entry.localLang);
    for (const d of entry.dishes) {
      if (!d.label.local) continue;
      localStats.dishes += 1;
      if (d.label.local !== d.label.es && d.label.local !== d.label.en) localStats.dishesDiffer += 1;
    }
    if (entry.cuisine?.label.local) localStats.cuisines += 1;
    localStats.sites += entry.heritage.filter((s) => s.label.local).length;
  }
}
out.notes += ' label.local = the label in the country\'s first language (localLang, from facts.json languages[0]), mul as fallback, null when Wikidata has none.';

// Size guard: landmarks are the part that can grow; past MAX_BYTES the cap
// drops to MAX_LANDMARKS_SMALL per country (curated items stay).
let json = JSON.stringify(out);
let landmarkCap = MAX_LANDMARKS;
if (Buffer.byteLength(json) > MAX_BYTES) {
  landmarkCap = MAX_LANDMARKS_SMALL;
  for (const entry of Object.values(out.countries)) entry.landmarks = capLandmarks(entry.landmarks, landmarkCap);
  out.notes = out.notes.replace(`capped at ${MAX_LANDMARKS} with`, `capped at ${landmarkCap} with`);
  json = JSON.stringify(out);
  console.log(`places.json would pass ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB: landmarks capped at ${landmarkCap} per country`);
}
for (const entry of Object.values(out.countries)) localStats.landmarks += entry.landmarks.filter((s) => s.label.local).length;
await writeFile(OUT, json);
const { size } = await stat(OUT);
console.log(`wrote ${OUT} (${(size / 1024).toFixed(0)} KB)`);
{
  const entries = Object.entries(out.countries);
  const withLm = entries.filter(([, e]) => e.landmarks.length);
  const total = entries.reduce((n, [, e]) => n + e.landmarks.length, 0);
  const curatedN = entries.reduce((n, [, e]) => n + e.landmarks.filter((l) => l.curated).length, 0);
  const kinds = new Map();
  for (const [, e] of entries) for (const l of e.landmarks) kinds.set(l.kind, (kinds.get(l.kind) || 0) + 1);
  const full = withLm.filter(([, e]) => e.landmarks.length >= landmarkCap).length;
  console.log(`landmarks: ${lmStats.queried} countries queried${lmStats.failed.length ? ` (${lmStats.failed.length} failed: ${lmStats.failed.join(' ')})` : ''}, ${lmStats.candidates} candidates; ${withLm.length} countries with landmarks, ${total} landmarks (${full} at the cap of ${landmarkCap}), ${curatedN} curated${lmStats.curatedMissing.length ? `; curated but skipped: ${lmStats.curatedMissing.join(', ')}` : ''}`);
  console.log(`landmark filters: already heritage ${lmStats.droppedHeritage}, settlement/admin/island/river ${lmStats.droppedNotAPlace}, demolished or in a collection ${lmStats.droppedGone}, named like a place ${lmStats.droppedName}, excluded by override ${lmStats.droppedExcluded}, nature over the cap ${lmStats.natureCapped}`);
  console.log(`landmark kinds: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  for (const iso of SHOW) {
    const list = out.countries[iso]?.landmarks || [];
    console.log(`\n${iso}: top ${Math.min(20, list.length)} of ${list.length} landmarks`);
    for (const l of list.slice(0, 20)) console.log(`  ${String(l.sitelinks).padStart(4)}  ${l.kind.padEnd(9)} ${l.label.en}${l.label.es !== l.label.en ? ` / ${l.label.es}` : ''}${l.curated ? '  (curated)' : ''}`);
  }
  console.log('');
}
console.log(`heritage: ${stats.withHeritage} countries, ${stats.sites} sites, ${stats.sitesWithImage} with image, ${stats.sitesWithLl} with coordinates; capped at ${MAX_HERITAGE}: ${stats.capped.join(' ') || 'none'}`);
console.log(`cuisine: ${stats.withCuisine} countries; dishes: ${stats.withDishes} countries, ${stats.dishes} dishes; curated: ${stats.curated.join(' ') || 'none'}`);
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k}:${n}`).join(' ');
console.log(`dish filters: Tex-Mex ${sum(filterStats.texmex)} (${top(filterStats.texmex) || 'none'}); foreign origin ${sum(filterStats.origin)} (${top(filterStats.origin) || 'none'}); no origin and not this cuisine ${sum(filterStats.noCuisine)} (${top(filterStats.noCuisine) || 'none'}); excluded by override ${sum(filterStats.excluded)} (${top(filterStats.excluded) || 'none'})`);
console.log(`anthem: ${stats.withAnthem} countries; demonym: ${stats.withDemonym} countries`);
console.log(`local labels: ${localStats.langs.size} languages, ${localStats.queries} label queries; dishes ${localStats.dishes} (${localStats.dishesDiffer} differ from es/en), cuisines ${localStats.cuisines}, sites ${localStats.sites}, landmarks ${localStats.landmarks}`);
