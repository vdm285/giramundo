// Builds public/data/culture.json from Wikidata (CC0): per country, the
// national anthem (with Commons recordings, instrumental and sung, when they
// are filed), up to 12 notable people, the official languages with speaker
// counts, and the music genres and instruments that Wikidata says were born
// there.
//
// Everything comes from the Wikidata Query Service through the cached `sparql`
// helper in tools/net.mjs (data/cache/wikidata/, keyed by query text, so a
// re-run after a code change that does not touch a query is free), plus the
// Commons API for the anthem recordings (data/cache/commons/, keyed by URL).
// Countries join to facts.json through P297 (ISO 3166-1 alpha-2), as
// build-places.mjs does. A country with nothing filed under it gets empty
// fields; nothing is invented.
//
// Flags:
//   node tools/build-culture.mjs --country=MX,JP   rebuild only these countries
//                                                  and merge them into the file
//   CULTURE_DEBUG=1                                print the anthem candidates
//
// Tuning notes (read before "fixing" a list):
// - Anthem recordings come from the anthem item's P51 files plus every audio
//   file in its Commons category (P373) and that category's audio
//   subcategory. A recording counts as sung only when its name or Commons
//   description says so (vocal, cantada, coro, choir, con letra, 歌…); a
//   file that says nothing is treated as instrumental, as before. Synthetic
//   files (MIDI, synthesizer, vocaloid, text-to-speech) are never picked.
//   Scoring is in `scoreVocal` / `scoreInstrumental` below.
// - Music genres are "instance of (a subclass of) music genre with country of
//   origin = this country", ranked by sitelinks. A genre Wikidata gives three
//   or more countries of origin (nu jazz: Brazil, UK, Mexico, US) is treated
//   as international and skipped. Instruments are subclasses of "musical
//   instrument" (or instances of "type of musical instrument") with the same
//   origin. Hand curation goes in data/overrides/music.json, never here.
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

import { writeFile, readFile, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, cacheDir, sparql as sparqlRaw, getJsonCached, loadFacts, today } from './net.mjs';

const OUT = join(root, 'public/data/culture.json');
const MUSIC_OVERRIDES = join(root, 'data/overrides/music.json');
const MAX_BYTES = 1300 * 1024;
const MAX_PEOPLE = 12;
const MIN_WITH_IMAGE = 6;
const CANDIDATES = 40; // per country, before the image filter
const FAMOUS_LINKS = 30; // one global range query covers everyone above this
const DETAIL_BATCH = 200;
const MAX_GENRES = 12;
const MAX_INSTRUMENTS = 6;
const MUSIC_DESC = 60; // chars per description, per language
const MUSIC_BYTES = 3584; // per-country budget for the music block
const COMMONS_SPACING_MS = 400;
const DEBUG = !!process.env.CULTURE_DEBUG;

// --country=MX,JP rebuilds only those countries and merges them into the
// existing file, so one country can be refreshed without a full run.
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--country='));
  if (!arg) return null;
  return new Set(arg.slice('--country='.length).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
})();

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
const countries = facts.countries
  .filter((c) => !ONLY || ONLY.has(c.iso2))
  .map((c) => ({ iso2: c.iso2, q: isoToQ.get(c.iso2)?.q || null, name: c.name }));
if (ONLY) console.log(`only: ${countries.map((c) => c.iso2).join(', ') || '(no country in facts.json matches)'}`);
const matched = countries.filter((c) => c.q);
const qToIso = new Map(matched.map((c) => [c.q, c.iso2]));
const unmatched = countries.filter((c) => !c.q).map((c) => c.iso2);
console.log(`countries: ${matched.length} matched to Wikidata, ${unmatched.length} without a match${unmatched.length ? ` (${unmatched.join(', ')})` : ''}`);

// ---------------------------------------------------------------------------
// 2. Anthem (P85): prefer a statement whose object is a national anthem
//    (Q23691) and a Preferred rank, skip ended or deprecated statements
//    (Mexico also lists its flag salute). Also read the anthem's Commons
//    category (P373), its P51 files and its Wikisource pages (es, en) for the
//    lyrics. The recordings themselves are chosen in step 2b.

const anthem = new Map();
{
  const WS = (lang) => `<https://${lang}.wikisource.org/>`;
  const rows = await sparql(`
SELECT ?c ?anthem ?rank (SAMPLE(?les) AS ?les) (SAMPLE(?len) AS ?len) (SAMPLE(?lmul) AS ?lmul)
       (SAMPLE(?wes) AS ?wes) (SAMPLE(?wen) AS ?wen) (SAMPLE(?ses) AS ?ses) (SAMPLE(?sen) AS ?sen)
       (SAMPLE(?cat) AS ?cat)
       (GROUP_CONCAT(DISTINCT STR(?type); separator=" ") AS ?types)
       (GROUP_CONCAT(DISTINCT STR(?audio); separator="\\n") AS ?audios) WHERE {
  ?c wdt:P297 ?iso .
  ?c p:P85 ?st . ?st ps:P85 ?anthem ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?anthem wdt:P31 ?type }
  OPTIONAL { ?anthem wdt:P51 ?audio }
  OPTIONAL { ?anthem wdt:P373 ?cat }
  OPTIONAL { ?anthem rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?anthem rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?anthem rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?wes schema:about ?anthem ; schema:isPartOf ${WIKI('es')} }
  OPTIONAL { ?wen schema:about ?anthem ; schema:isPartOf ${WIKI('en')} }
  OPTIONAL { ?ses schema:about ?anthem ; schema:isPartOf ${WS('es')} }
  OPTIONAL { ?sen schema:about ?anthem ; schema:isPartOf ${WS('en')} }
} GROUP BY ?c ?anthem ?rank`, 'anthems');

  // How many countries list each anthem: when a country lists two with the
  // same rank (Antigua: "Fair Antigua" and "God Save the King"; Norfolk
  // Island: "Advance Australia Fair" and "God Save the King"), the one fewer
  // countries share is its own.
  const uses = new Map();
  for (const b of rows) uses.set(qid(v(b, 'anthem')), (uses.get(qid(v(b, 'anthem'))) || 0) + 1);
  for (const b of rows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    const label = bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
    if (!label) continue;
    const types = (v(b, 'types') || '').split(' ').filter(Boolean).map(qid);
    // Then: an anthem with a Wikipedia article, then one with audio files,
    // then the older item (Malawi has one item per language version).
    const score = (types.includes('Q23691') ? 2 : 0) + (v(b, 'rank')?.endsWith('PreferredRank') ? 1 : 0) - uses.get(qid(v(b, 'anthem'))) / 1000
      + ((v(b, 'wes') || v(b, 'wen')) ? 0.0005 : 0) + (v(b, 'audios') ? 0.0002 : 0) - Number(qid(v(b, 'anthem')).slice(1)) / 1e15;
    const wiki = {};
    if (v(b, 'wes')) wiki.es = v(b, 'wes');
    if (v(b, 'wen')) wiki.en = v(b, 'wen');
    const wikisource = {};
    if (v(b, 'ses')) wikisource.es = v(b, 'ses');
    if (v(b, 'sen')) wikisource.en = v(b, 'sen');
    const cand = {
      qid: qid(v(b, 'anthem')),
      label,
      labelMul: v(b, 'lmul'),
      files: (v(b, 'audios') || '').split('\n').filter(Boolean).map(commonsName).filter(Boolean),
      category: v(b, 'cat'),
      wiki,
      wikisource,
      lyricsUrl: wikisource.es || wikisource.en || wiki.es || wiki.en || null,
      score,
    };
    const prev = anthem.get(iso);
    if (!prev || cand.score > prev.score) anthem.set(iso, cand);
  }
}

// ---------------------------------------------------------------------------
// 2b. Recordings. Commons files the anthem's category (P373) and, usually, an
//     "Audio files of national anthems of <Country>" subcategory; the anthem
//     item's own P51 files are added to the pool. One category listing per
//     category (cmlimit 500, files and subcategories in one call), then
//     imageinfo with extmetadata in batches of 50: mime, duration, license,
//     artist, credit and the file description. The pool is scored twice: once
//     for the best sung recording (audioVocal), once for the best
//     instrumental (audio). Requests are spaced COMMONS_SPACING_MS apart and
//     cached under data/cache/commons/ like build-money.mjs.

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
let lastCommonsStart = 0;
let commonsGate = Promise.resolve();
let commonsNet = 0;
async function commons(params) {
  const url = `${COMMONS_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const path = join(cacheDir, 'commons', `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);
  let cached = true;
  try { await access(path); } catch { cached = false; }
  if (!cached) {
    commonsGate = commonsGate.then(async () => {
      const wait = lastCommonsStart + COMMONS_SPACING_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCommonsStart = Date.now();
    });
    await commonsGate;
    commonsNet += 1;
  }
  try {
    return await getJsonCached(url, 'commons');
  } catch (err) {
    console.error(`commons: ${err.message}`);
    return null;
  }
}

const AUDIO_EXT = /\.(ogg|oga|opus|mp3|flac|wav)$/i;
const AUDIO_SUBCAT = /audio|sound|recording|grabaci|música|music|aufnahme|enregistrement|performed|performance|interpret|versions?\b|vocal|instrumental/i;
const stripHtml = (s) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null);
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Files (members and audio subcategories' members) of one category.
async function categoryAudio(cat) {
  const data = await commons({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmtype: 'file|subcat', cmlimit: '500' });
  const members = data?.query?.categorymembers || [];
  const files = members.filter((m) => m.ns === 6).map((m) => m.title.replace(/^File:/, '')).filter((n) => AUDIO_EXT.test(n));
  // Audio usually sits one or two categories down ("National anthems of
  // Mexico" > "Audio files of national anthems of Mexico"; "God Save the King"
  // > "God Save the King performed" > "Audio files of God Save the King"):
  // follow up to two matching subcategories per level, two levels deep.
  const subcats = members.filter((m) => m.ns === 14).map((m) => m.title.replace(/^Category:/, '')).filter((n) => AUDIO_SUBCAT.test(n));
  for (const sub of subcats.slice(0, 2)) {
    const d = await commons({ action: 'query', list: 'categorymembers', cmtitle: `Category:${sub}`, cmtype: 'file|subcat', cmlimit: '500' });
    const subMembers = d?.query?.categorymembers || [];
    for (const m of subMembers) {
      const n = m.title.replace(/^File:/, '');
      if (m.ns === 6 && AUDIO_EXT.test(n)) files.push(n);
    }
    const deeper = subMembers.filter((m) => m.ns === 14).map((m) => m.title.replace(/^Category:/, '')).filter((n) => AUDIO_SUBCAT.test(n));
    for (const deep of deeper.slice(0, 2)) {
      const dd = await commons({ action: 'query', list: 'categorymembers', cmtitle: `Category:${deep}`, cmtype: 'file', cmlimit: '500' });
      for (const m of dd?.query?.categorymembers || []) {
        const n = m.title.replace(/^File:/, '');
        if (AUDIO_EXT.test(n)) files.push(n);
      }
      subcats.push(deep);
    }
  }
  return { files: [...new Set(files)], subcats };
}

async function fileInfo(names) {
  const out = new Map();
  for (const batch of chunk(names, 50)) {
    const data = await commons({
      action: 'query', titles: batch.map((n) => `File:${n}`).join('|'), prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|Credit|ImageDescription|ObjectName',
    });
    for (const p of data?.query?.pages || []) {
      const i = p.imageinfo?.[0];
      if (!i) continue;
      const e = i.extmetadata || {};
      const g = (k) => (e[k] ? stripHtml(String(e[k].value)) : null);
      out.set(p.title.replace(/^File:/, ''), {
        name: p.title.replace(/^File:/, ''),
        mime: i.mime || null,
        seconds: Number.isFinite(i.duration) ? Math.round(i.duration) : null,
        license: g('LicenseShortName'),
        artist: clip(g('Artist'), 80),
        credit: clip(g('Credit'), 80),
        description: clip(g('ImageDescription'), 300),
      });
    }
  }
  return out;
}

// Words that say a recording is sung, in the languages Commons describers use.
const VOCAL = /\b(vocal|vocals|vocale|vokal|sung|singing|choir|chorus|choral|coro|coral|cantad[ao]s?|cantan|cantando|cantat[ao]|chant[ée]e?|gesungen|gesang|chor|voz|voces|voice|voices|lyrics|letra|a cappella|soprano|tenor|bar[ií]tono|baritone|zang|gezongen|s[aå]ng|sung by|with words|con letra|avec paroles|mit text|canto|cantada|cantores|sings?)\b|歌唱|合唱|演唱|独唱|獨唱|齐唱|齊唱|声乐|聲樂|有歌词|有歌詞|보컬|노래|вокал|хор|поёт|спев/i;
// Says in so many words that nobody sings on it.
const NO_VOCAL = /no (official )?lyrics|without (lyrics|vocals|words|singing)|no ?vocals?\b|sin letra|sin voz|sin canto|senza parole|sans paroles|ohne gesang|instrumental only|only instrumental|melody only|tanpa nyanyian/i;
const INSTRUMENTAL = /instrumental|instrumentaal|orchestr|orquest|\bband\b|banda|brass|piano|organ|órgano|guitar|guitarra|violin|karaoke|without (lyrics|vocals|words)|sin letra|sin voz|演奏|version instrumentale/i;
// Never a genuine recording: skip for both picks.
const SYNTHETIC = /\bmidi\b|synth|vocaloid|text.to.speech|\btts\b|computer|electronic voice|8.bit|chiptune|music box|caja de m[uú]sica|bo[iî]te [àa] musique|spieluhr|humming|whistl|silbad|silbido|ringtone|remix|parod|garageband|spoken word|speaker:/i;
// A real recording, but of something else: a jazz or rock arrangement, a cover.
const STYLE = /\bjazz|\brock\b|metal|techno|house|disco|reggae|\brap\b|hip.hop|cover|arrangement|arreglo|arrangiert|medley|mashup|fake|フェイク|ジャズ|\btake \d|\btoma \d|\bdemo\b|rehears|ensayo|\btest\b|prueba|home recording|amateur/i;
// Another anthem that shares the category: a predecessor state or regime.
const HISTORICAL = /soviet|sovetsk|ussr|urss|former|historical|hist[óo]ric[ao]|antiguo|khanate|empire|imperio|imperial|\breich\b|reichstag|nazi|horst.wessel|weimar|colonial|yugoslav|czechoslovak|rhodesia|confederat|habsburg|prussia|preu[sß]|austria.hungary|royal anthem|himno real|before 19|until 19|\(1[89]\d\d[–-]19\d\d\)/i;
// A state, province or city anthem, or another country's: only a problem
// when the file name does not name this anthem.
const SUBNATIONAL = /\b(state anthem|himno (del )?estado|estado de|oblast|provinc|regional anthem|autonomous|aut[óo]nom|municipal|city|ciudad|county|departamento|territory|territorio)\b/i;
const OFFICIAL = /official|oficial|secretar|ministr|minister|government|gobierno|gouvernement|navy|marine|military|militar|army|ej[ée]rcito|defens|presiden|national (orchestra|band|choir|symphony)|coro nacional|orquesta|symphon|sinf[óo]n|philharmon|filarm|\bstate\b|\bestado\b|radio|broadcast|garde r[ée]publicaine|republican guard|guardia republicana|guards? band|\bop[ée]ra\b/i;
const CROWD = /\bfans?\b|crowd|stadium|estadio|hinchas|afici[óo]n|p[úu]blico|match|partido|\blive\b|en vivo|rally|protest|parade|school|escuela|\bkids\b|niños|children/i;
// "en Náhuatl", "in Abkhazian": a version in a language other than the one
// the anthem is sung in. The second pattern is case-sensitive on purpose
// ("in Somali", not "in september").
const OTHER_LANGUAGE = /translat|traducc|traduction|übersetz|\b(en|in)\s+(lengua|idioma|language)|version in|versión en|\b(in|en|em|auf) (nahuatl|maya|quechua|aymara|guaran[ií]|welsh|irish|gaelic|basque|catalan|galician|m[āa]ori|hawaiian|inuktitut|s[áa]mi|romansh|esperanto|latin)\b/i;
const otherLanguage = (t) => OTHER_LANGUAGE.test(t) || /\bin [A-Z]\w+(ian|ish|ese)\b/.test(t);
const ANTHEM_WORD = /anthem|himno|hymn|hymne|hino|inno|hymnus|nationalhymne|volkslied|国歌|國歌|국가|гимн|anthem|marcha real|kimigayo/i;
const OLD_YEAR = /\b1[89]\d\d\b|\b19[0-8]\d\b/;

// Does the file name (or, failing that, its description) name this anthem?
// Tokens of the anthem's labels and of the country's name (4+ letters,
// generic words dropped), matched by stem like `mentioned` above: "mexico"
// matches "Mexican". A file that names it nowhere scores 0 and is treated
// as another song that shares the category (a flag march, a state anthem).
const GENERIC = new Set(['national', 'nacional', 'anthem', 'himno', 'hymn', 'hymne', 'hino', 'inno', 'song', 'canción', 'cancion', 'march', 'marcha', 'state', 'estado', 'republic', 'república', 'republica', 'kingdom', 'reino', 'united', 'unidos', 'unido', 'islands', 'islas', 'federal', 'democratic', 'people', 'pueblo', 'land', 'country', 'país', 'pais', 'official', 'oficial', 'hymn']);
function tokenHits(text, labels) {
  const t = fold(text);
  let n = 0;
  const seen = new Set();
  for (const label of labels) {
    for (const w of fold(label).split(/[^a-z0-9À-ɏЀ-ӿ぀-ヿ一-鿿]+/)) {
      if (w.length < 4 || GENERIC.has(w) || seen.has(w)) continue;
      seen.add(w);
      if (t.includes(w.slice(0, Math.max(4, w.length - 2)))) n += 1;
    }
  }
  return n;
}
function anthemish(f, labels) {
  const inName = tokenHits(f.name, labels);
  const inDesc = inName ? 0 : tokenHits(f.description || '', labels);
  if (!inName && !inDesc) return { score: 0, named: false };
  return { score: (ANTHEM_WORD.test(`${f.name} ${f.description || ''}`) ? 2 : 0) + Math.min(inName, 3) + (inDesc ? 1 : 0), named: inName > 0 };
}
function durationScore(s, vocal) {
  if (s === null) return 0;
  if (s < 20) return -10;
  if (s < 45) return -3;
  if (s < 60) return -1;
  if (s < 90) return 2;
  if (s <= 300) return 3;
  if (s <= 420) return 1;
  if (s <= 600) return -2;
  if (s <= 720) return -4;
  return vocal ? -10 : -6;
}
// Shared penalties: an anthem of a predecessor state, a state or city
// anthem (when the file does not name this one), a jazz arrangement, a
// crowd, a version in another language, an old recording (mild), FLAC/WAV
// (Safari does not play them).
function penalties(f, text, named) {
  return (HISTORICAL.test(text) ? -6 : 0) + (!named && SUBNATIONAL.test(text) ? -6 : 0) + (STYLE.test(text) ? -4 : 0)
    + (CROWD.test(text) ? -2 : 0) + (otherLanguage(text) ? -3 : 0) + (OLD_YEAR.test(f.name) ? -1 : 0) + (/\.(flac|wav)$/i.test(f.name) ? -2 : 0);
}
function scoreVocal(f, labels, p51) {
  const text = `${f.name} ${f.description || ''}`;
  if (!VOCAL.test(text) || NO_VOCAL.test(text) || SYNTHETIC.test(text)) return null;
  const meta = `${f.artist || ''} ${f.credit || ''}`;
  let { score: a, named } = anthemish(f, labels);
  if (p51) { a = Math.max(a, 3); named = true; }
  return (a || -6) + durationScore(f.seconds, true) + (OFFICIAL.test(meta) ? 3 : OFFICIAL.test(text) ? 1 : 0) + penalties(f, text, named) + (p51 ? 1 : 0);
}
function scoreInstrumental(f, labels, p51) {
  const text = `${f.name} ${f.description || ''}`;
  if (VOCAL.test(text) && !NO_VOCAL.test(text) && !/instrumental/i.test(text)) return null;
  if (/\bmidi\b|vocaloid|text.to.speech|\btts\b/i.test(text) || /\.mid$/i.test(f.name)) return null;
  const meta = `${f.artist || ''} ${f.credit || ''}`;
  let { score: a, named } = anthemish(f, labels);
  if (p51) { a = Math.max(a, 3); named = true; }
  return (a || -6) + (p51 ? 4 : 0) + (/instrumental/i.test(f.name) ? 4 : 0) + (INSTRUMENTAL.test(text) ? 2 : 0)
    + durationScore(f.seconds, false) + (OFFICIAL.test(meta) ? 2 : OFFICIAL.test(text) ? 1 : 0)
    + (SYNTHETIC.test(text) ? -4 : 0) + penalties(f, text, named);
}
// The performer or author when the file page names one; the "source" field
// only when it is text, not a bare URL (the file page link carries the rest).
const creditOf = (f) => (f ? (f.artist || (f.credit && !/^https?:\/\//i.test(f.credit) ? f.credit : null)) : null);
const best = (list) => list.sort((x, y) => y.score - x.score || Math.abs((x.f.seconds || 150) - 150) - Math.abs((y.f.seconds || 150) - 150) || x.f.name.length - y.f.name.length)[0] || null;

{
  let withCategory = 0;
  for (const c of countries) {
    const a = anthem.get(c.iso2);
    if (!a) continue;
    const labels = [a.label.es, a.label.en, a.labelMul, c.name?.es, c.name?.en].filter(Boolean);
    let pool = [...a.files];
    if (a.category) {
      withCategory += 1;
      const { files } = await categoryAudio(a.category);
      pool.push(...files);
    }
    pool = [...new Set(pool)];
    const infos = await fileInfo(pool.filter((n) => AUDIO_EXT.test(n)));
    const p51 = new Set(a.files);
    const files = pool.map((n) => infos.get(n) || { name: n, mime: null, seconds: null, license: null, artist: null, credit: null, description: null })
      .filter((f) => !f.mime || /^(audio\/|application\/ogg)/.test(f.mime))
      .filter((f) => AUDIO_EXT.test(f.name) || p51.has(f.name));
    // Both picks need a positive score; a file that says "instrumental and
    // vocal" can fill both slots.
    const vocal = best(files.map((f) => ({ f, score: scoreVocal(f, labels, p51.has(f.name)) })).filter((x) => x.score !== null && x.score > 0));
    const instrumental = best(files.map((f) => ({ f, score: scoreInstrumental(f, labels, p51.has(f.name)) })).filter((x) => x.score !== null && x.score > 0));
    a.audio = instrumental?.f.name || null;
    a.audioLicense = instrumental?.f.license || null;
    a.audioCredit = creditOf(instrumental?.f);
    a.audioSeconds = instrumental?.f.seconds ?? null;
    a.audioVocal = vocal ? vocal.f.name : null;
    a.audioVocalLicense = a.audioVocal ? vocal.f.license : null;
    a.audioVocalCredit = a.audioVocal ? creditOf(vocal.f) : null;
    a.audioVocalSeconds = a.audioVocal ? vocal.f.seconds : null;
    if (DEBUG) {
      console.log(`\n${c.iso2} ${a.label.es} | category: ${a.category || '-'} | P51: ${a.files.join(', ') || '-'}`);
      for (const f of files) console.log(`  V=${String(scoreVocal(f, labels, p51.has(f.name))).padStart(4)} I=${String(scoreInstrumental(f, labels, p51.has(f.name))).padStart(4)} ${f.seconds ?? '?'}s ${f.license || '?'} | ${f.name} | ${f.artist || ''} | ${(f.description || '').slice(0, 80)}`);
      console.log(`  -> audio: ${a.audio} | vocal: ${a.audioVocal}`);
    }
  }
  console.log(`anthem recordings: ${withCategory} anthems with a Commons category, ${commonsNet} Commons requests on the network`);
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
// 3b. Music. Genres: one global query over "instance of (a subclass of) music
//     genre (Q188451) with a country of origin (P495) that has an ISO code",
//     with the number of origin countries per genre; three or more means
//     international (nu jazz) and the genre is skipped. Instruments: the
//     subclass tree of "musical instrument" (Q34379, about 5,700 items) plus
//     instances of "type of musical instrument" (Q110295396) is fetched once,
//     then joined to P495 in VALUES batches; the one-query form of that join
//     times out. Details (labels, descriptions, image, Wikipedia es/en) for
//     the kept items come in VALUES batches like the people. Optional
//     curation: data/overrides/music.json { ISO2: { include: [qid], exclude:
//     [qid] } }; included items are fetched and placed first, excluded ones
//     dropped wherever they came from. Only Wikidata items, never names.

const music = new Map(); // iso -> { genres: [{qid, links}], instruments: [{qid, links}] }
let musicOverrides = {};
try { musicOverrides = JSON.parse(await readFile(MUSIC_OVERRIDES, 'utf8')); } catch { /* optional */ }
{
  const genreRows = await sparql(`
SELECT ?g ?c ?links (COUNT(DISTINCT ?o) AS ?norigins) WHERE {
  ?g wdt:P31/wdt:P279* wd:Q188451 .
  ?g wdt:P495 ?c . ?c wdt:P297 ?iso .
  ?g wdt:P495 ?o .
  ?g wikibase:sitelinks ?links .
} GROUP BY ?g ?c ?links`, 'music genres');
  let international = 0;
  for (const b of genreRows) {
    const iso = qToIso.get(qid(v(b, 'c')));
    if (!iso) continue;
    if (Number(v(b, 'norigins')) >= 3) { international += 1; continue; }
    const e = music.get(iso) || { genres: [], instruments: [] };
    e.genres.push({ qid: qid(v(b, 'g')), links: Number(v(b, 'links')) || 0 });
    music.set(iso, e);
  }

  const treeRows = await sparql(`
SELECT DISTINCT ?i WHERE { { ?i wdt:P279+ wd:Q34379 } UNION { ?i wdt:P31 wd:Q110295396 } }`, 'instrument classes');
  const tree = treeRows.map((b) => qid(v(b, 'i')));
  const batches = chunk(tree, 500);
  for (const [i, batch] of batches.entries()) {
    let rows;
    try {
      rows = await sparql(`
SELECT ?i ?c ?links (COUNT(DISTINCT ?o) AS ?norigins) WHERE {
  VALUES ?i { ${batch.map(wd).join(' ')} }
  ?i wdt:P495 ?c . ?c wdt:P297 ?iso .
  ?i wdt:P495 ?o .
  ?i wikibase:sitelinks ?links .
} GROUP BY ?i ?c ?links`, `instruments ${i + 1}/${batches.length}`);
    } catch (err) {
      console.error(`instruments ${i + 1}: skipped (${err.message})`);
      continue;
    }
    for (const b of rows) {
      const iso = qToIso.get(qid(v(b, 'c')));
      if (!iso) continue;
      if (Number(v(b, 'norigins')) >= 3) { international += 1; continue; }
      const e = music.get(iso) || { genres: [], instruments: [] };
      if (!e.instruments.some((x) => x.qid === qid(v(b, 'i')))) e.instruments.push({ qid: qid(v(b, 'i')), links: Number(v(b, 'links')) || 0 });
      music.set(iso, e);
    }
  }

  // Rank, apply overrides, cap.
  for (const c of countries) {
    const e = music.get(c.iso2) || { genres: [], instruments: [] };
    const ov = musicOverrides[c.iso2] || {};
    const exclude = new Set(ov.exclude || []);
    const include = (ov.include || []).filter((q) => /^Q\d+$/.test(q));
    const dedupe = (list) => {
      const seen = new Set();
      return list.filter((x) => !exclude.has(x.qid) && !seen.has(x.qid) && seen.add(x.qid));
    };
    e.genres = dedupe([...include.map((q) => ({ qid: q, links: 0, curated: true })), ...e.genres.sort((a, b) => b.links - a.links)]).slice(0, MAX_GENRES);
    e.instruments = dedupe(e.instruments.sort((a, b) => b.links - a.links)).slice(0, MAX_INSTRUMENTS);
    music.set(c.iso2, e);
  }
  const genreTotal = [...music.values()].reduce((n, e) => n + e.genres.length, 0);
  const instrTotal = [...music.values()].reduce((n, e) => n + e.instruments.length, 0);
  console.log(`music: ${genreRows.length} genre rows, ${tree.length} instrument classes, ${international} items with 3+ origin countries skipped; kept ${genreTotal} genres and ${instrTotal} instruments`);
}

// Details for every kept music item: labels, descriptions, image, Wikipedia.
const musicDetails = new Map(); // qid -> { label, desc, image, wiki, links }
{
  const all = [...new Set([...music.values()].flatMap((e) => [...e.genres, ...e.instruments]).map((x) => x.qid))];
  const batches = chunk(all, DETAIL_BATCH);
  for (const [i, batch] of batches.entries()) {
    let rows;
    try {
      rows = await sparql(`
SELECT ?p ?les ?len ?lmul ?des ?den ?img ?wes ?wen ?links WHERE {
  VALUES ?p { ${batch.map(wd).join(' ')} }
  OPTIONAL { ?p rdfs:label ?les FILTER(LANG(?les) = "es") }
  OPTIONAL { ?p rdfs:label ?len FILTER(LANG(?len) = "en") }
  OPTIONAL { ?p rdfs:label ?lmul FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?p schema:description ?des FILTER(LANG(?des) = "es") }
  OPTIONAL { ?p schema:description ?den FILTER(LANG(?den) = "en") }
  OPTIONAL { ?p wdt:P18 ?img }
  OPTIONAL { ?p wikibase:sitelinks ?links }
  OPTIONAL { ?wes schema:about ?p ; schema:isPartOf ${WIKI('es')} }
  OPTIONAL { ?wen schema:about ?p ; schema:isPartOf ${WIKI('en')} }
}`, `music details ${i + 1}/${batches.length}`);
    } catch (err) {
      console.error(`music details ${i + 1}: skipped (${err.message})`);
      continue;
    }
    for (const b of rows) {
      const q = qid(v(b, 'p'));
      const d = musicDetails.get(q) || { label: null, desc: null, image: null, wiki: {}, links: 0 };
      d.label ||= bi(v(b, 'les'), v(b, 'len'), v(b, 'lmul'));
      d.desc ||= bi(v(b, 'des'), v(b, 'den'));
      d.image ||= commonsName(v(b, 'img'));
      if (v(b, 'wes')) d.wiki.es = v(b, 'wes');
      if (v(b, 'wen')) d.wiki.en = v(b, 'wen');
      d.links = Number(v(b, 'links')) || d.links;
      musicDetails.set(q, d);
    }
  }
}

function musicEntry(x) {
  const d = musicDetails.get(x.qid);
  if (!d?.label) {
    if (x.curated) console.warn(`music override ${x.qid}: not a Wikidata item with a label, skipped`);
    return null;
  }
  const e = { qid: x.qid, label: d.label, desc: d.desc ? { es: clip(d.desc.es, MUSIC_DESC), en: clip(d.desc.en, MUSIC_DESC) } : null, wiki: d.wiki, sitelinks: d.links };
  if (d.image) e.image = d.image;
  if (x.curated) e.curated = true;
  return e;
}
// Per-country music block within MUSIC_BYTES: the tail (after the first six
// genres and three instruments) loses its descriptions, then its images, then
// instruments and genres are capped, until it fits. Labels and Wikipedia
// links stay.
function musicFor(iso) {
  const e = music.get(iso);
  if (!e) return null;
  const genres = e.genres.map(musicEntry).filter(Boolean);
  const instruments = e.instruments.map(musicEntry).filter(Boolean);
  if (!genres.length && !instruments.length) return null;
  const block = { genres };
  if (instruments.length) block.instruments = instruments;
  const size = () => Buffer.byteLength(JSON.stringify(block));
  const tail = (g = 6, i = 3) => [...block.genres.slice(g), ...(block.instruments || []).slice(i)];
  const steps = [
    () => { for (const x of tail()) delete x.desc; },
    () => { for (const x of tail()) delete x.image; },
    () => { for (const x of [...block.genres, ...(block.instruments || [])]) delete x.image; },
    () => { for (const x of tail(4, 2)) delete x.desc; },
    () => { for (const x of [...block.genres, ...(block.instruments || [])]) if (x.desc) x.desc = { es: clip(x.desc.es, 40), en: clip(x.desc.en, 40) }; },
    () => { if (block.instruments) block.instruments.splice(4); },
    () => { block.genres.splice(10); },
    () => { block.genres.splice(8); },
    () => { if (block.instruments) block.instruments.splice(3); },
  ];
  for (const step of steps) {
    if (size() <= MUSIC_BYTES) break;
    step();
  }
  if (block.instruments && !block.instruments.length) delete block.instruments;
  return block;
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
  notes: 'anthem = P85 (national anthem preferred over flag salutes); audio = the best instrumental recording and audioVocal = the best sung recording among the anthem item\'s P51 files and the audio files of its Commons category (P373), chosen by file name and description (a file that does not say it is sung counts as instrumental; MIDI and synthetic files are skipped), each with the license and credit from the Commons file page; lyricsUrl = Wikisource (es, then en) else Wikipedia; people = humans with P27 = the country, the most-linked across Wikipedias, people born elsewhere sort after the rest, with a photo when at least 6 have one, capped at 12; languages = P37, speakers = P1098 of the language item (global, not per country), code = P218; music.genres = music genres (P31/P279* Q188451) with country of origin (P495) = the country, genres with 3+ origin countries skipped, by sitelinks, capped at 12; music.instruments = subclasses of musical instrument (Q34379) with P495 = the country, capped at 6; curated: true marks items from data/overrides/music.json.',
  countries: {},
};

// --country: start from the committed file and replace only the countries built.
if (ONLY) {
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    out.countries = prev.countries || {};
    console.log(`merging into ${OUT} (${Object.keys(out.countries).length} countries kept)`);
  } catch { console.warn(`${OUT} not found; writing only ${[...ONLY].join(', ')}`); }
}

const stats = { anthem: 0, anthemAudio: 0, anthemVocal: 0, anthemLyrics: 0, anthemWikisource: 0, anthemWiki: 0, people: 0, people6: 0, people12: 0, withImage: 0, peopleTotal: 0, languages: 0, langTotal: 0, speakers: 0, music: 0, genres: 0, instruments: 0, instrCountries: 0, musicBytes: 0 };
for (const c of countries) {
  const a = anthem.get(c.iso2);
  const people = c.q ? rankPeople(c.iso2, c.q) : [];
  const langs = languages.get(c.iso2) || [];
  const m = musicFor(c.iso2);
  out.countries[c.iso2] = {
    anthem: a ? {
      qid: a.qid,
      label: a.label,
      audio: a.audio,
      audioLicense: a.audioLicense,
      audioCredit: a.audioCredit,
      audioSeconds: a.audioSeconds,
      audioVocal: a.audioVocal,
      audioVocalLicense: a.audioVocalLicense,
      audioVocalCredit: a.audioVocalCredit,
      audioVocalSeconds: a.audioVocalSeconds,
      wiki: a.wiki,
      wikisource: a.wikisource,
      lyricsUrl: a.lyricsUrl,
    } : null,
    people,
    languages: langs,
    music: m,
  };
  if (a) stats.anthem += 1;
  if (a?.audio) stats.anthemAudio += 1;
  if (a?.audioVocal) stats.anthemVocal += 1;
  if (a?.lyricsUrl) stats.anthemLyrics += 1;
  if (a && (a.wikisource.es || a.wikisource.en)) stats.anthemWikisource += 1;
  if (a && (a.wiki.es || a.wiki.en)) stats.anthemWiki += 1;
  if (m) {
    stats.music += 1;
    stats.genres += m.genres.length;
    stats.instruments += (m.instruments || []).length;
    if (m.instruments) stats.instrCountries += 1;
    stats.musicBytes += Buffer.byteLength(JSON.stringify(m));
  }
  if (people.length) stats.people += 1;
  if (people.length >= 6) stats.people6 += 1;
  if (people.length >= 12) stats.people12 += 1;
  stats.peopleTotal += people.length;
  stats.withImage += people.filter((p) => p.image).length;
  if (langs.length) stats.languages += 1;
  stats.langTotal += langs.length;
  stats.speakers += langs.filter((l) => l.speakers).length;
}

// Size guard: shorten descriptions first, then trim music, then lower the people cap.
const shrink = [
  ['desc cut to 100 chars', () => each((p) => { if (p.desc) for (const k of ['es', 'en']) if (p.desc[k].length > 100) p.desc[k] = `${p.desc[k].slice(0, 99).trimEnd()}…`; })],
  ['music: no instruments, 8 genres', () => { for (const e of Object.values(out.countries)) if (e.music) { delete e.music.instruments; e.music.genres.splice(8); } }],
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
console.log(`anthem: ${stats.anthem} countries, ${stats.anthemAudio} with audio, ${stats.anthemVocal} with a sung recording, ${stats.anthemWiki} with a Wikipedia article, ${stats.anthemWikisource} with lyrics on Wikisource, ${stats.anthemLyrics} with a lyrics link`);
console.log(`music: ${stats.music} countries, ${stats.genres} genres, ${stats.instruments} instruments in ${stats.instrCountries} countries, ${stats.music ? (stats.musicBytes / stats.music / 1024).toFixed(1) : 0} KB per country on average`);
console.log(`people: ${stats.people} countries, ${stats.people6} with >= 6, ${stats.people12} with 12; ${stats.peopleTotal} people, ${stats.withImage} with image${failed.length ? `; failed: ${failed.join(' ')}` : ''}`);
console.log(`languages: ${stats.languages} countries, ${stats.langTotal} entries, ${stats.speakers} with a speaker count`);
