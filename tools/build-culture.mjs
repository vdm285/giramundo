// Builds public/data/culture.json from Wikidata (CC0): per country, the
// national anthem (with a Commons audio file when one is filed), up to 12
// notable people, and the official languages with speaker counts.
//
// Everything comes from the Wikidata Query Service through the cached `sparql`
// helper in tools/net.mjs (data/cache/wikidata/, keyed by query text, so a
// re-run after a code change that does not touch a query is free). Countries
// join to facts.json through P297 (ISO 3166-1 alpha-2), as build-places.mjs
// does. A country with nothing filed under it gets empty fields; nothing is
// invented.
//
// Tuning notes (read before "fixing" a list):
// - People are "humans whose country of citizenship (P27) is this country",
//   ranked by how many Wikipedias have an article about them (sitelinks).
//   That favors footballers, presidents and pop singers over scientists and
//   painters, and it includes naturalized citizens (Wikidata gives Trotsky
//   and Buñuel Mexican citizenship, and Cortés too). People whose recorded
//   birthplace (P19 -> P17) lies in another country sort after the rest, which
//   keeps them in the list without letting them lead it. To change the mix,
//   edit `rankPeople` below (for example weight occupations) rather than
//   editing the output.
// - The occupation shown is the one with Preferred rank when an editor set
//   one, else one the Wikidata description names, else the person's
//   occupation whose own item has the most sitelinks (so "writer" over
//   "diplomat"). SPARQL does not expose statement order, so "first P106"
//   cannot be read literally; a few people still get "actor" or "writer"
//   where a human would say "singer" or "philosopher".
// - Speaker counts are Wikidata's P1098 on the language item (preferred rank,
//   else the most recent point in time, else the largest). They are global,
//   not per country: Spanish shows ~485 million under Mexico and under Spain.
//
// Re-run: npm run culture

import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { root, sparql as sparqlRaw, loadFacts, today } from './net.mjs';

const OUT = join(root, 'public/data/culture.json');
const MAX_BYTES = 900 * 1024;
const MAX_PEOPLE = 12;
const MIN_WITH_IMAGE = 6;
const CANDIDATES = 40; // per country, before the image filter
const FAMOUS_LINKS = 30; // one global range query covers everyone above this
const DETAIL_BATCH = 200;

// WDQS throttles bursts from one client (429 with Retry-After, honored by
// fetchRetry). Leave a gap between queries that actually hit the network;
// cached ones return at once.
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
const v = (b, k) => (b[k] ? b[k].value : null);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Commons file URL (Special:FilePath/<encoded name>) -> plain file name.
function commonsName(url) {
  if (!url) return null;
  const tail = url.split('/').pop();
  try { return decodeURIComponent(tail).replace(/_/g, ' '); } catch { return tail; }
}

// Bilingual label with fallback: es <- mul <- en, en <- mul <- es. Wikidata
// stores a name that is the same in every language (Kimigayo) under "mul".
function bi(es, en, mul) {
  if (!es && !en && !mul) return null;
  return { es: es || mul || en, en: en || mul || es };
}

// "1907-07-06T00:00:00Z" -> 1907; "-0384-01-01T00:00:00Z" -> -384.
function year(iso) {
  if (!iso) return null;
  const m = /^(-?\d+)-/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

const WIKI = (lang) => `<https://${lang}.wikipedia.org/>`;

// ---------------------------------------------------------------------------
// 1. Countries: ISO 3166-1 alpha-2 -> Wikidata item (dissolved states dropped;
//    where two live items share a code the one with more sitelinks wins).

const { facts } = await loadFacts();
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

// ---------------------------------------------------------------------------
// 2. Anthem (P85): prefer a statement whose object is a national anthem
//    (Q23691) and a Preferred rank, skip ended or deprecated statements
//    (Mexico also lists its flag salute). Audio: the anthem item's P51 files;
//    keep one, preferring instrumental or official-band recordings and a
//    format a browser plays (.ogg/.oga/.opus/.mp3/.flac/.wav before .mid).

const anthem = new Map();
{
  const rows = await sparql(`
SELECT ?c ?anthem ?rank (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
       (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen)
       (GROUP_CONCAT(DISTINCT STR(?type); separator=" ") AS ?types)
       (GROUP_CONCAT(DISTINCT STR(?audio); separator="\\n") AS ?audios) WHERE {
  ?c wdt:P297 ?iso .
  ?c p:P85 ?st . ?st ps:P85 ?anthem ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?anthem wdt:P31 ?type }
  OPTIONAL { ?anthem wdt:P51 ?audio }
  OPTIONAL { ?anthem rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?anthem rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?anthem rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?wes schema:about ?anthem ; schema:isPartOf ${WIKI('es')} }
  OPTIONAL { ?wen schema:about ?anthem ; schema:isPartOf ${WIKI('en')} }
} GROUP BY ?c ?anthem ?rank`, 'anthems');

  const PLAYABLE = /\.(ogg|oga|opus|mp3|flac|wav)$/i;
  const pickAudio = (urls) => {
    const names = urls.map(commonsName).filter(Boolean);
    if (!names.length) return null;
    const score = (n) => (/instrumental/i.test(n) ? 4 : 0) + (/navy band|marine band|military band|banda/i.test(n) ? 2 : 0)
      + (PLAYABLE.test(n) ? 1 : 0) + (/\.mid$/i.test(n) ? -8 : 0);
    return names.sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
  };
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
    if (!label) continue;
    const types = (v(b, 'types') || '').split(' ').filter(Boolean).map(qid);
    const score = (types.includes('Q23691') ? 2 : 0) + (v(b, 'rank')?.endsWith('PreferredRank') ? 1 : 0);
    const wiki = {};
    if (v(b, 'wes')) wiki.es = v(b, 'wes');
    if (v(b, 'wen')) wiki.en = v(b, 'wen');
    const cand = {
      qid: qid(v(b, 'anthem')),
      label,
      audio: pickAudio((v(b, 'audios') || '').split('\n').filter(Boolean)),
      wiki,
      score,
    };
    const prev = anthem.get(iso);
    if (!prev || cand.score > prev.score) anthem.set(iso, cand);
  }
}

// ---------------------------------------------------------------------------
// 3. Languages: official languages (P37) of the country, skipping ended and
//    deprecated statements. ISO 639-1 (P218) and native speakers (P1098) come
//    from the language item; of several P1098 values the Preferred one wins,
//    else the most recent point in time (P585), else the largest.

const languages = new Map(); // iso -> [{qid,label,code,speakers}]
{
  const rows = await sparql(`
SELECT ?c ?lang ?les ?len ?lmul ?code ?spk ?srank ?when WHERE {
  ?c wdt:P297 ?iso .
  ?c p:P37 ?st . ?st ps:P37 ?lang ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?lang rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?lang rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?lang rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?lang wdt:P218 ?code }
  OPTIONAL {
    ?lang p:P1098 ?ss . ?ss ps:P1098 ?spk ; wikibase:rank ?srank .
    FILTER(?srank != wikibase:DeprecatedRank)
    OPTIONAL { ?ss pq:P585 ?when }
  }
}`, 'languages');
  const acc = new Map(); // iso -> Map(langQ -> entry)
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
    if (!label) continue;
    const q = qid(v(b, 'lang'));
    const map = acc.get(iso) || new Map();
    const e = map.get(q) || { qid: q, label, code: v(b, 'code') || null, counts: [] };
    if (v(b, 'spk') !== null) {
      const n = Number(v(b, 'spk'));
      if (Number.isFinite(n) && n > 0) {
        e.counts.push({ n, preferred: v(b, 'srank')?.endsWith('PreferredRank') || false, when: v(b, 'when') || '' });
      }
    }
    map.set(q, e);
    acc.set(iso, map);
  }
  for (const [iso, map] of acc) {
    const list = [...map.values()].map((e) => {
      const best = e.counts.sort((a, b) => (Number(b.preferred) - Number(a.preferred)) || b.when.localeCompare(a.when) || (b.n - a.n))[0];
      return { qid: e.qid, label: e.label, code: e.code, speakers: best ? Math.round(best.n) : null };
    }).sort((a, b) => (b.speakers || 0) - (a.speakers || 0) || a.label.en.localeCompare(b.label.en));
    languages.set(iso, list);
  }
}

// ---------------------------------------------------------------------------
// 4. People, step one: candidates per country (humans with P27 = country,
//    skipping deprecated and ended citizenships so Ishiguro is not Japanese
//    and Soviet citizens are not Russian; the CANDIDATES most-linked). Sorting a big country's citizens by
//    sitelinks is the heavy part (the United States alone takes ~35 s), so a
//    single range query over "everyone with at least FAMOUS_LINKS sitelinks"
//    (hint:rangeSafe lets Blazegraph walk the sitelinks index) covers the big
//    countries in a few seconds; only countries that get fewer than CANDIDATES
//    people from it run their own ORDER BY query, and those are the small
//    countries where it is quick. A country whose query fails keeps an empty
//    list and the run goes on.

const candidates = new Map(); // iso -> [{qid, links}]
const failed = [];
{
  const rows = await sparql(`
SELECT ?p ?c ?links WHERE {
  hint:Query hint:optimizer "None" .
  ?p wikibase:sitelinks ?links . hint:Prior hint:rangeSafe true .
  FILTER(?links >= ${FAMOUS_LINKS})
  ?p wdt:P31 wd:Q5 .
  ?p p:P27 ?st . ?st ps:P27 ?c ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
}`, `famous humans (>= ${FAMOUS_LINKS} sitelinks)`);
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const list = candidates.get(iso) || [];
    list.push({ qid: qid(v(b, 'p')), links: Number(v(b, 'links')) });
    candidates.set(iso, list);
  }
  for (const list of candidates.values()) list.sort((a, b) => b.links - a.links).splice(CANDIDATES);

  const rest = matched.filter((c) => (candidates.get(c.iso2) || []).length < CANDIDATES);
  console.log(`people: ${matched.length - rest.length} countries filled from the range query; ${rest.length} need their own query`);
  for (const c of rest) {
    try {
      const own = await sparql(`
SELECT ?p ?links WHERE {
  ?p p:P27 ?st . ?st ps:P27 ${wd(c.q)} ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  ?p wdt:P31 wd:Q5 ; wikibase:sitelinks ?links .
} ORDER BY DESC(?links) LIMIT ${CANDIDATES}`, `people ${c.iso2}`);
      candidates.set(c.iso2, own.map((b) => ({ qid: qid(v(b, 'p')), links: Number(v(b, 'links')) })));
    } catch (err) {
      failed.push(c.iso2);
      candidates.set(c.iso2, []);
    }
  }
}

// Does the description name this occupation? Every word of the label with
// four letters or more must appear, by stem (first len-2 chars, at least 4),
// in the description of the same language: "pintor" matches "pintora",
// "film director" matches "Japanese film director and screenwriter". A few
// occupations are usually described with another word ("president" for a
// politician, "filmmaker" for a film director); those are listed here.
const IMPLIED = new Map([
  ['Q82955', /president|prime minister|chancellor|senator|governor|statesm|minister|politic|primer ministro|canciller|senador|gobernador|ministr/], // politician
  ['Q116', /(emperor|empress|king|queen|monarch|sultan|emir|emperador|emperatriz|rey|reina|monarca|sultán)/], // monarch
  ['Q33999', /(actress|actriz)/], // actor
  ['Q36180', /(author|novelist|essayist|autor|autora|novelista|ensayista)/], // writer
  ['Q2526255', /filmmaker|film director|cineasta|director de cine/], // film director
  ['Q177220', /(singer|cantante)/], // singer
  ['Q937857', /footballer|soccer|futbolista/], // association football player
  ['Q4964182', /philosopher|filósof/], // philosopher
  ['Q1028181', /painter|pintor/], // painter
  ['Q39631', /physician|médic/], // physician
  ['Q47064', /military|militar/], // military personnel
  ['Q189290', /military|militar/], // military officer
]);
function mentioned(q, label, desc) {
  if (!label || !desc) return false;
  const all = `${desc.es || ''} ${desc.en || ''}`.toLowerCase();
  if (IMPLIED.get(q)?.test(all)) return true;
  for (const lang of ['es', 'en']) {
    const text = (desc[lang] || '').toLowerCase();
    const words = (label[lang] || '').toLowerCase().split(/[\s-]+/).filter((w) => w.length >= 4);
    if (words.length && words.every((w) => text.includes(w.slice(0, Math.max(4, w.length - 2))))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. People, step two: details for every candidate, batched by VALUES.
//    Two flat queries per batch (labels, descriptions, image, dates, birth
//    countries via P19 -> P17; then occupations with their rank and
//    sitelinks). Blazegraph throws a StackOverflowError when these OPTIONALs
//    are combined with GROUP BY / GROUP_CONCAT, so rows are merged in JS: the
//    earliest date, the first image, every birth country.

const details = new Map(); // qid -> {...}
{
  const all = [...new Set([...candidates.values()].flat().map((p) => p.qid))];
  const batches = chunk(all, DETAIL_BATCH);
  for (const [i, batch] of batches.entries()) {
    const values = batch.map(wd).join(' ');
    let rows;
    let jobRows;
    try {
      rows = await sparql(`
SELECT ?p ?les ?len ?lmul ?des ?den ?img ?born ?died ?bc WHERE {
  VALUES ?p { ${values} }
  OPTIONAL { ?p rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?p rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?p rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?p schema:description ?des FILTER(LANG(?des) = "es") }
  OPTIONAL { ?p schema:description ?den FILTER(LANG(?den) = "en") }
  OPTIONAL { ?p wdt:P18 ?img }
  OPTIONAL { ?p wdt:P569 ?born }
  OPTIONAL { ?p wdt:P570 ?died }
  OPTIONAL { ?p wdt:P19 ?birthplace . ?birthplace wdt:P17 ?bc }
}`, `details ${i + 1}/${batches.length}`);
      jobRows = await sparql(`
SELECT ?p ?job ?jrank ?jlinks ?jes ?jen ?jmul WHERE {
  VALUES ?p { ${values} }
  ?p p:P106 ?js . ?js ps:P106 ?job ; wikibase:rank ?jrank .
  FILTER(?jrank != wikibase:DeprecatedRank)
  OPTIONAL { ?job wikibase:sitelinks ?jlinks }
  OPTIONAL { ?job rdfs:label ?jes FILTER(LANG(?jes) = "es") }
  OPTIONAL { ?job rdfs:label ?jen FILTER(LANG(?jen) = "en") }
  OPTIONAL { ?job rdfs:label ?jmul FILTER(LANG(?jmul) = "mul") }
}`, `occupations ${i + 1}/${batches.length}`);
    } catch (err) {
      console.error(`details ${i + 1}: skipped (${err.message})`);
      continue;
    }
    const minYear = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));
    for (const b of rows) {
      const q = qid(v(b, 'p'));
      const d = details.get(q) || { label: null, desc: null, image: null, born: null, died: null, births: new Set(), jobs: new Map() };
      d.label ||= bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
      d.desc ||= bi(v(b, 'des'), v(b, 'den'));
      d.image ||= commonsName(v(b, 'img'));
      d.born = minYear(d.born, year(v(b, 'born')));
      d.died = minYear(d.died, year(v(b, 'died')));
      if (v(b, 'bc')) d.births.add(qid(v(b, 'bc')));
      details.set(q, d);
    }
    for (const b of jobRows) {
      const d = details.get(qid(v(b, 'p')));
      if (!d) continue;
      const label = bi(v(b, 'jes'), v(b, 'jen'), v(b, 'jmul'));
      if (!label) continue;
      d.jobs.set(qid(v(b, 'job')), {
        label,
        preferred: (v(b, 'jrank') || '').endsWith('PreferredRank'),
        links: Number(v(b, 'jlinks')) || 0,
      });
    }
  }
  // One occupation per person: Preferred rank first, then one the Wikidata
  // description itself names ("film director" for Kurosawa, whose best-known
  // occupation item would otherwise be "writer"), then the best-known one.
  for (const d of details.values()) {
    d.births = [...d.births];
    const score = ([q, j]) => (j.preferred ? 2000 : 0) + (mentioned(q, j.label, d.desc) ? 1000 : 0) + j.links;
    d.job = [...d.jobs.entries()].sort((a, b) => score(b) - score(a))[0]?.[1].label || null;
    delete d.jobs;
  }
}

// Rank a country's candidates: born here (or birthplace unknown) first, then
// by sitelinks. Keep only people with a photo when that leaves at least
// MIN_WITH_IMAGE; otherwise let the ones without a photo fill the list.
function rankPeople(iso, countryQ) {
  const list = (candidates.get(iso) || [])
    .map((p) => ({ ...p, ...details.get(p.qid) }))
    .filter((p) => p.label);
  const native = (p) => !p.births || !p.births.length || p.births.includes(countryQ);
  list.sort((a, b) => (Number(native(b)) - Number(native(a))) || (b.links - a.links));
  const withImage = list.filter((p) => p.image);
  const pick = withImage.length >= MIN_WITH_IMAGE ? withImage : [...withImage, ...list.filter((p) => !p.image)];
  return pick.slice(0, MAX_PEOPLE).map((p) => ({
    qid: p.qid,
    label: p.label,
    desc: p.desc,
    image: p.image,
    born: p.born,
    died: p.died,
    job: p.job,
  }));
}

// ---------------------------------------------------------------------------
// 6. Assemble and write, shrinking until the file fits MAX_BYTES.

const out = {
  built: today(),
  source: 'Wikidata (CC0), Wikimedia Commons',
  attribution: {
    data: 'Wikidata, CC0 1.0. https://www.wikidata.org/ Link each item: https://www.wikidata.org/wiki/<qid>',
    images: 'Each image and audio file is a Wikimedia Commons file with its own license; show the author and license from the file page. Thumbnail: https://commons.wikimedia.org/wiki/Special:FilePath/<image>?width=640 ; audio: https://commons.wikimedia.org/wiki/Special:FilePath/<audio>',
    text: 'desc is the Wikidata description; wiki links point to Wikipedia (CC BY-SA 4.0).',
  },
  notes: 'anthem = P85 (national anthem preferred over flag salutes), audio = one P51 file of the anthem item; people = humans with P27 = the country, the most-linked across Wikipedias, people born elsewhere sort after the rest, with a photo when at least 6 have one, capped at 12; languages = P37, speakers = P1098 of the language item (global, not per country), code = P218.',
  countries: {},
};

const stats = { anthem: 0, anthemAudio: 0, anthemWiki: 0, people: 0, people6: 0, people12: 0, withImage: 0, peopleTotal: 0, languages: 0, langTotal: 0, speakers: 0 };
for (const c of countries) {
  const a = anthem.get(c.iso2);
  const people = c.q ? rankPeople(c.iso2, c.q) : [];
  const langs = languages.get(c.iso2) || [];
  out.countries[c.iso2] = {
    anthem: a ? { qid: a.qid, label: a.label, audio: a.audio, wiki: a.wiki } : null,
    people,
    languages: langs,
  };
  if (a) stats.anthem += 1;
  if (a?.audio) stats.anthemAudio += 1;
  if (a && (a.wiki.es || a.wiki.en)) stats.anthemWiki += 1;
  if (people.length) stats.people += 1;
  if (people.length >= 6) stats.people6 += 1;
  if (people.length >= 12) stats.people12 += 1;
  stats.peopleTotal += people.length;
  stats.withImage += people.filter((p) => p.image).length;
  if (langs.length) stats.languages += 1;
  stats.langTotal += langs.length;
  stats.speakers += langs.filter((l) => l.speakers).length;
}

// Size guard: shorten descriptions first, then lower the people cap.
const shrink = [
  ['desc cut to 100 chars', () => each((p) => { if (p.desc) for (const k of ['es', 'en']) if (p.desc[k].length > 100) p.desc[k] = `${p.desc[k].slice(0, 99).trimEnd()}…`; })],
  ['people cap 10', () => cap(10)],
  ['people cap 8', () => cap(8)],
];
function each(fn) { for (const e of Object.values(out.countries)) for (const p of e.people) fn(p); }
function cap(n) { for (const e of Object.values(out.countries)) e.people.splice(n); }
let json = JSON.stringify(out);
for (const [what, fn] of shrink) {
  if (Buffer.byteLength(json) <= MAX_BYTES) break;
  fn();
  json = JSON.stringify(out);
  console.log(`over ${MAX_BYTES / 1024} KB: ${what} -> ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
}

await writeFile(OUT, json);
const { size } = await stat(OUT);
console.log(`wrote ${OUT} (${(size / 1024).toFixed(0)} KB)`);
console.log(`anthem: ${stats.anthem} countries, ${stats.anthemAudio} with audio, ${stats.anthemWiki} with a Wikipedia article`);
console.log(`people: ${stats.people} countries, ${stats.people6} with >= 6, ${stats.people12} with 12; ${stats.peopleTotal} people, ${stats.withImage} with image${failed.length ? `; failed: ${failed.join(' ')}` : ''}`);
console.log(`languages: ${stats.languages} countries, ${stats.langTotal} entries, ${stats.speakers} with a speaker count`);
