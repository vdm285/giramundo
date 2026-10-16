// Collects live radio stations for the "listen to local radio" feature of every
// country dossier.
//
//   node tools/build-radio.mjs            (npm run radio)
//   RADIO_FRESH=1 node tools/build-radio.mjs   (ignore the disk cache)
//
// Source: Radio-Browser (https://www.radio-browser.info), a community-run,
// keyless, CORS-open directory of internet radio streams. For each country in
// public/data/facts.json it asks one mirror for the most-voted stations with
// that ISO 3166-1 alpha-2 code and keeps up to 8 that a browser on an HTTPS
// page can actually play:
//
//   - lastcheckok === 1   (the directory's own checker reached the stream)
//   - ssl_error === 0     (the certificate is fine)
//   - url_resolved starts with https://   (GitHub Pages is HTTPS; an http://
//     stream is mixed content and the browser refuses it)
//   - codec the <audio> element decodes natively: MP3, AAC, AAC+, OGG/Opus.
//     HLS (.m3u8, or hls === 1) is kept only when a country has nothing else,
//     and is marked `hls: true` so the player can decide what to do with it.
//
// Ranked by votes, then clickcount; de-duplicated by name and by URL. Output
// is one committed file, public/data/radio.json, kept under 400 KB.
//
// Attribution: station names and streams belong to their broadcasters; the
// directory data is community-contributed. The site only plays the public
// stream URL and never re-hosts, records or re-streams audio. See
// docs/PIPELINES.md ("Radio").
//
// Politeness: the server is chosen by resolving all.api.radio-browser.info
// and picking one of the listed mirrors (as the API docs ask), every request
// carries the shared User-Agent, at most 3 are in flight, starts are spaced
// 300 ms apart, retries go through fetchRetry and raw responses are cached
// under data/cache/radio/. One failing country never stops the run.

import { writeFile, stat, rm } from 'node:fs/promises';
import { promises as dns } from 'node:dns';
import { join } from 'node:path';
import { cacheDir, getJsonCached, loadFacts, pool, root, round, today } from './net.mjs';

const OUT = join(root, 'public/data/radio.json');
const CACHE_SUB = 'radio';
const PER_COUNTRY = 8;         // stations kept per country
const FETCH_LIMIT = 100;       // stations asked for per country (many top ones are http://)
const MAX_TAGS = 4;
const MAX_BYTES = 400 * 1024;  // hard cap for the output file
const CONCURRENCY = 3;
const SPACING_MS = 300;
const FALLBACK_SERVER = 'de1.api.radio-browser.info';

// Codecs the <audio> element plays without a library, as Radio-Browser spells them.
const NATIVE_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OGG/OPUS', 'OPUS', 'VORBIS']);

// ------------------------------------------------------------------ server

// The API docs: resolve all.api.radio-browser.info, reverse-resolve the IPs to
// get the mirror names, pick one at random. Fall back to a known mirror.
async function pickServer() {
  try {
    const ips = await dns.resolve4('all.api.radio-browser.info');
    const names = new Set();
    for (const ip of ips) {
      try {
        for (const n of await dns.reverse(ip)) if (n.endsWith('.api.radio-browser.info')) names.add(n);
      } catch { /* an IP without a PTR record is skipped */ }
    }
    const list = [...names];
    if (list.length) return list[Math.floor(Math.random() * list.length)];
  } catch { /* fall through */ }
  return FALLBACK_SERVER;
}

// ------------------------------------------------------------------ fetch

let nextSlot = 0;
async function fetchStations(server, iso2) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + SPACING_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  const url = `https://${server}/json/stations/bycountrycodeexact/${iso2}?order=votes&reverse=true&hidebroken=true&limit=${FETCH_LIMIT}`;
  const data = await getJsonCached(url, CACHE_SUB);
  if (!Array.isArray(data)) throw new Error(`unexpected response for ${iso2}`);
  return data;
}

// ------------------------------------------------------------------ select

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nameKey = (s) => norm(s).toLowerCase();

function isHls(s) {
  return s.hls === 1 || /\.m3u8(\?|$)/i.test(s.url_resolved || '');
}

function playable(s) {
  const url = norm(s.url_resolved);
  if (s.lastcheckok !== 1 || s.ssl_error !== 0) return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (/\.(m3u|pls|asx)(\?|$)/i.test(url)) return false; // playlist files, not streams
  if (!norm(s.name)) return false;
  return true;
}

function tagsOf(s) {
  const seen = new Set();
  const out = [];
  for (const raw of String(s.tags || '').split(',')) {
    const t = norm(raw).toLowerCase();
    if (!t || t.length > 24 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function shape(s) {
  const lat = Number(s.geo_lat);
  const lon = Number(s.geo_long);
  const hasLl = s.geo_lat != null && s.geo_long != null && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const row = {
    id: s.stationuuid,
    name: norm(s.name),
    url: norm(s.url_resolved),
    codec: norm(s.codec).toUpperCase() || null,
    bitrate: Number.isFinite(Number(s.bitrate)) && Number(s.bitrate) > 0 ? Number(s.bitrate) : null,
    tags: tagsOf(s),
    lang: norm(s.language) || null,
    homepage: /^https?:\/\//i.test(norm(s.homepage)) ? norm(s.homepage) : null,
    favicon: /^https:\/\//i.test(norm(s.favicon)) ? norm(s.favicon) : null,
    ll: hasLl ? [round(lat, 4), round(lon, 4)] : null,
    votes: Number(s.votes) || 0,
  };
  if (isHls(s)) row.hls = true;
  return row;
}

// Local culture first: talk, news, public and regional stations in one of the
// country's own languages rank above global pop, and English-language music
// stations are demoted outside anglophone countries. Votes break ties.
const LOCAL_TAGS = /\b(news|noticias|talk|hablad|informa|public|p[uú]blic|cultur|folk|tradicion|regional|community|comunitari|ind[ií]gena|local|rural|educa|universi|estatal|nacional|national|tango|cumbia|ranchera|norte|banda|mariachi|salsa|samba|forr[oó]|sertanejo|fado|flamenco|rebetiko|chanson|schlager|volksmusik|enka|bhajan|qawwali|afrobeat|highlife|soukous|reggae|bachata|merengue|vallenato|andina|andean)/i;
const GLOBAL_TAGS = /\b(pop|hits|top ?40|dance|edm|electronic|house|techno|trance|anime|jpop|kpop|k-pop|j-pop|rock|metal|hip ?hop|rap|rnb|r&b|urban|lounge|chillout|oldies|80s|90s|classic rock|english)/i;
const ENGLISH = new Set(['US', 'GB', 'IE', 'AU', 'NZ', 'CA', 'JM', 'TT', 'BB', 'BS', 'BZ', 'GY', 'ZA', 'NG', 'GH', 'KE', 'UG', 'TZ', 'ZM', 'ZW', 'LR', 'SL', 'GM', 'MW', 'BW', 'NA', 'PH', 'SG', 'IN', 'PK', 'FJ', 'PG', 'MT']);
const LANG_NAMES = { spa: ['spanish', 'español', 'espanol', 'castellano'], eng: ['english', 'inglés'], fra: ['french', 'français', 'francais'], por: ['portuguese', 'português', 'portugues'], deu: ['german', 'deutsch'], ita: ['italian', 'italiano'], jpn: ['japanese', '日本語'], kor: ['korean', '한국어'], zho: ['chinese', 'mandarin', '中文'], ara: ['arabic', 'العربية'], rus: ['russian', 'русский'], hin: ['hindi'], tur: ['turkish', 'türkçe'], nld: ['dutch', 'nederlands'], pol: ['polish', 'polski'], ell: ['greek'], heb: ['hebrew'], fas: ['persian', 'farsi'], tha: ['thai'], vie: ['vietnamese'], ind: ['indonesian', 'bahasa'], msa: ['malay'], swa: ['swahili'], ukr: ['ukrainian'], ces: ['czech'], hun: ['hungarian'], ron: ['romanian'], swe: ['swedish'], nor: ['norwegian'], dan: ['danish'], fin: ['finnish'], cat: ['catalan'], eus: ['basque'], glg: ['galician'], que: ['quechua'], grn: ['guaraní', 'guarani'], nah: ['náhuatl', 'nahuatl'] };

function localScore(s, country) {
  // Raw directory rows: tags is a comma string, language a free-text field.
  const tags = String(s.tags || '').toLowerCase();
  const lang = String(s.language || s.lang || '').toLowerCase();
  const own = (country?.languages || []).flatMap((code) => LANG_NAMES[code] || []);
  let score = 0;
  if (LOCAL_TAGS.test(tags)) score += 3;
  if (GLOBAL_TAGS.test(tags)) score -= 3;
  if (lang && own.some((n) => lang.includes(n))) score += 2;
  if (lang.includes('english') && !ENGLISH.has(country?.iso2) && !own.includes('english')) score -= 2;
  if (!lang) score -= 1;
  if (/\b(quran|christian|gospel|religio|worship|church)\b/i.test(tags)) score -= 1;
  return score;
}

function select(rows, country) {
  const ok = rows.filter(playable);
  ok.sort((a, b) => (localScore(b, country) - localScore(a, country)) || (b.votes - a.votes) || (b.clickcount - a.clickcount));
  if (process.env.RADIO_DEBUG === country?.iso2) for (const s of ok.slice(0, 12)) console.log(localScore(s, country), s.votes, s.name.slice(0, 30), '|', s.language, '|', String(s.tags).slice(0, 60));
  const codecOf = (s) => norm(s.codec).toUpperCase();
  const native = ok.filter((s) => !isHls(s) && NATIVE_CODECS.has(codecOf(s)));
  // Stations whose codec the directory has not identified rank after the known
  // native ones. Anything else named (FLV, MP4, "AAC,H.264" video) is dropped.
  // HLS is used only when a country has nothing else.
  const unknown = ok.filter((s) => !isHls(s) && ['', 'UNKNOWN'].includes(codecOf(s)));
  const hls = ok.filter(isHls);
  const candidates = native.length + unknown.length ? [...native, ...unknown] : hls;
  const names = new Set();
  const urls = new Set();
  const out = [];
  for (const s of candidates) {
    const nk = nameKey(s.name);
    const uk = norm(s.url_resolved).toLowerCase();
    if (names.has(nk) || urls.has(uk)) continue;
    names.add(nk);
    urls.add(uk);
    out.push(shape(s));
    if (out.length >= PER_COUNTRY) break;
  }
  return out;
}

// ------------------------------------------------------------------ size cap

// Trim until the file fits: drop favicons, then shorten tags, then shrink the
// per-country cap one station at a time.
function fit(out) {
  const size = () => Buffer.byteLength(JSON.stringify(out));
  const all = () => Object.values(out.countries).flat();
  const steps = [];
  if (size() > MAX_BYTES) { for (const s of all()) delete s.favicon; steps.push('dropped favicon'); }
  if (size() > MAX_BYTES) { for (const s of all()) s.tags = s.tags.slice(0, 2); steps.push('tags cut to 2'); }
  let cap = PER_COUNTRY;
  while (size() > MAX_BYTES && cap > 1) {
    cap -= 1;
    for (const k of Object.keys(out.countries)) out.countries[k] = out.countries[k].slice(0, cap);
    steps.push(`cap ${cap}`);
  }
  return steps;
}

// ------------------------------------------------------------------ main

if (process.env.RADIO_FRESH) {
  await rm(join(cacheDir, CACHE_SUB), { recursive: true, force: true });
  console.log('cache cleared (RADIO_FRESH)');
}

const server = await pickServer();
console.log(`server: ${server}`);

const { facts } = await loadFacts();
const countries = facts.countries.filter((c) => c.iso2);
const out = {
  built: today(),
  source: 'Radio-Browser (community directory, https://www.radio-browser.info)',
  attribution: 'Station names and streams belong to their broadcasters. Directory data is community-contributed to Radio-Browser. The site plays public stream URLs and never re-hosts audio.',
  server,
  countries: {},
};
const errors = {};
const codecs = new Map();
let raw = 0;
const t0 = Date.now();

await pool(countries, CONCURRENCY, async (c) => {
  try {
    const rows = await fetchStations(server, c.iso2);
    raw += rows.length;
    for (const s of rows) codecs.set(norm(s.codec).toUpperCase() || '(none)', (codecs.get(norm(s.codec).toUpperCase() || '(none)') || 0) + 1);
    out.countries[c.iso2] = select(rows, c);
  } catch (err) {
    out.countries[c.iso2] = [];
    errors[c.iso2] = String(err.message || err).slice(0, 200);
    console.warn(`  ${c.iso2}: ${errors[c.iso2]}`);
  }
});

// Stable key order so diffs stay readable.
out.countries = Object.fromEntries(Object.keys(out.countries).sort().map((k) => [k, out.countries[k]]));
if (Object.keys(errors).length) out.errors = errors;

const steps = fit(out);
await writeFile(OUT, JSON.stringify(out));
const { size } = await stat(OUT);

const lists = Object.values(out.countries);
const withAny = lists.filter((l) => l.length).length;
const total = lists.reduce((n, l) => n + l.length, 0);
const hlsOnly = Object.entries(out.countries).filter(([, l]) => l.length && l.every((s) => s.hls)).map(([k]) => k);
const zero = Object.entries(out.countries).filter(([, l]) => !l.length).map(([k]) => k);

console.log(`fetched ${countries.length} countries, ${raw} raw rows in ${((Date.now() - t0) / 1000).toFixed(1)} s${Object.keys(errors).length ? `, ${Object.keys(errors).length} errors` : ''}`);
console.log(`wrote ${OUT} (${(size / 1024).toFixed(0)} KB)${steps.length ? `; trimmed: ${steps.join(', ')}` : ''}`);
console.log(`stations: ${total} playable in ${withAny} countries; ${zero.length} countries with none${zero.length ? `: ${zero.join(' ')}` : ''}`);
console.log(`hls-only countries: ${hlsOnly.join(' ') || 'none'}`);
console.log(`raw codecs: ${[...codecs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
