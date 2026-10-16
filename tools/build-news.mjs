// Collects headlines for the "Ahora / Now" section of every country dossier.
//
//   node tools/build-news.mjs            (npm run news)
//
// For each country in public/data/facts.json it searches Google News RSS twice,
// once in Mexican Spanish and once in US English, and keeps the top 8 headlines
// per language. It also pulls three world feeds once (BBC Mundo, BBC World,
// El País Internacional). Output goes to public/data/news/ (gitignored; the
// Pages workflow runs this before `vite build` so the files ride along in the
// deploy without ever being committed).
//
// Attribution: headlines and links only, no article text. Country searches go
// through Google News, whose feed terms are personal, non-commercial use with
// credit to Google News and to each publisher. See docs/PIPELINES.md.
//
// Politeness: at most 3 requests in flight, a new request at most every 250 ms,
// retries via fetchRetry, and a total time budget. One failing feed never stops
// the run: that country gets empty lists and an `error` string.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, UA, fetchRetry, pool, loadFacts } from './net.mjs';

const outDir = join(root, 'public/data/news');
const PER_LANG = 8;          // headlines per language per country
const WORLD_ITEMS = 12;      // headlines per world feed
const MAX_BYTES = 10 * 1024; // hard cap per output file
const CONCURRENCY = 3;
const SPACING_MS = 250;
const BUDGET_MS = Number(process.env.NEWS_BUDGET_MS) || 12 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

const EDITIONS = {
  es: 'hl=es-419&gl=MX&ceid=MX:es-419',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

// Query overrides for names that are also something else: a US state (Georgia),
// a basketball player (Jordan), a first name (Mauricio, Chad), a pepper (Chile),
// a garment (Jersey, Bermudas), a meeting (Reunión), a Mexican flower (Jamaica),
// a mountain in Catalonia (Montserrat), a Virgin (Guadalupe), a bird (Turkey),
// or one of several Guineas and Congos. Also names where the facts.json label is
// not what newsrooms write ("Congo (Rep. Dem.)", "Arabia Saudí", "Chequia").
// Google News search honors quotes, OR, parentheses and the minus operator.
const QUERY_OVERRIDES = {
  GE: { es: '"Georgia" (Tbilisi OR georgiano OR georgiana OR Cáucaso)', en: '"Georgia" (Tbilisi OR Georgian OR Caucasus)' },
  JO: { en: '"Jordan" (Amman OR Jordanian OR "King Abdullah")' },
  TD: { es: '"Chad" (Yamena OR chadiano OR Sahel OR África)', en: '"Chad" (N\'Djamena OR Chadian OR Sahel OR Africa)' },
  NE: { es: '"Níger" (Niamey OR nigerino OR Sahel OR junta)', en: '"Niger" (Niamey OR Nigerien OR Sahel OR junta)' },
  GN: { es: '"Guinea" (Conakry OR Conakri OR guineano) -Ecuatorial -Bisáu -Papúa', en: '"Guinea" (Conakry OR Guinean) -Equatorial -Bissau -Papua' },
  GQ: { es: '"Guinea Ecuatorial"', en: '"Equatorial Guinea"' },
  GW: { es: '"Guinea-Bisáu" OR "Guinea Bissau"', en: '"Guinea-Bissau"' },
  TR: { en: '("Türkiye" OR "Turkey") (Erdogan OR Ankara OR Istanbul OR Turkish)' },
  JE: { es: '"Jersey" (isla OR "Islas del Canal" OR "Saint Helier")', en: '"Jersey" ("Channel Islands" OR "St Helier" OR Bailiwick) -"New Jersey"' },
  CG: { es: '"Congo" Brazzaville', en: '"Congo" Brazzaville' },
  CD: { es: '"República Democrática del Congo" OR "RD Congo" OR Kinshasa', en: '"DR Congo" OR "Democratic Republic of Congo" OR Kinshasa' },
  DM: { es: '"Dominica" (isla OR Roseau OR Caribe) -Dominicana', en: '"Dominica" (Roseau OR Caribbean OR island) -"Dominican Republic"' },
  GD: { es: '"Granada" (Caribe OR isla OR "Saint George") -Nicaragua -Andalucía', en: '"Grenada"' },
  WS: { es: '"Samoa" -Americana', en: '"Samoa" -"American Samoa"' },
  MF: { es: '"Saint-Martin" OR "San Martín" (Caribe OR isla OR Marigot)', en: '"Saint Martin" (Caribbean OR Marigot OR island)' },
  BL: { es: '"San Bartolomé" (Caribe OR isla OR Gustavia)', en: '"Saint Barthélemy" OR "St. Barts" OR "St Barts"' },
  GS: { en: '"South Georgia" (Sandwich OR Antarctic OR penguins OR Falklands)' },
  GP: { es: '"Guadalupe" (isla OR Caribe OR Antillas OR "Pointe-à-Pitre" OR "Basse-Terre")' },
  RE: { es: '"La Reunión" (isla OR "océano Índico" OR francesa)', en: '"Reunion Island" OR "Réunion Island" OR "La Réunion"' },
  JM: { es: '"Jamaica" (Kingston OR jamaiquino OR jamaicano OR Caribe OR isla)' },
  CL: { es: '"Chile" (chileno OR chilena OR Santiago)' },
  LC: { es: '"Santa Lucía" (Caribe OR isla OR Castries)' },
  BM: { es: '"Bermudas" (isla OR Hamilton OR Atlántico OR territorio)' },
  MS: { es: '"Montserrat" (Caribe OR isla OR Plymouth OR volcán)', en: '"Montserrat" (Caribbean OR island OR volcano)' },
  MU: { es: '"Isla Mauricio" OR "Islas Mauricio"' },
  SH: { es: '"Santa Elena" (isla OR Ascensión OR Tristán)', en: '"Saint Helena" (island OR Ascension OR Tristan)' },
  TF: { es: '"Kerguelen" OR "Tierras Australes Francesas"', en: '"Kerguelen" OR "French Southern"' },
  IO: { es: '"Chagos" OR "Diego García"', en: '"Chagos" OR "Diego Garcia"' },
  UM: { es: '"Isla Wake" OR "Atolón Midway" OR "Atolón Johnston"', en: '"Wake Island" OR "Midway Atoll" OR "Johnston Atoll"' },
  CC: { es: '"Islas Cocos" Australia', en: '"Cocos Islands" OR "Keeling Islands"' },
  VI: { en: '"U.S. Virgin Islands" OR "US Virgin Islands"' },
  VA: { es: '"Vaticano"', en: '"Vatican"' },
  CZ: { es: '"Chequia" OR "República Checa"', en: '"Czechia" OR "Czech Republic"' },
  CI: { en: '"Ivory Coast" OR "Côte d\'Ivoire"' },
  TL: { en: '"Timor-Leste" OR "East Timor"' },
  MM: { es: '"Myanmar" OR "Birmania"', en: '"Myanmar" OR "Burma"' },
  SZ: { es: '"Esuatini" OR "Suazilandia"', en: '"Eswatini" OR "Swaziland"' },
  BQ: { es: '"Bonaire" OR "Caribe Neerlandés"', en: '"Bonaire" OR "Caribbean Netherlands"' },
  AX: { es: '"Åland"', en: '"Åland"' },
  FO: { es: '"Islas Feroe" OR "Islas Faroe"' },
  FK: { es: '"Malvinas"', en: '"Falkland Islands" OR "Falklands"' },
  IR: { es: '"Irán"' },
  DJ: { es: '"Yibuti" OR "Djibouti"' },
  BH: { es: '"Bahréin" OR "Bahrein"' },
  QA: { es: '"Catar" OR "Qatar"' },
  SA: { es: '"Arabia Saudita" OR "Arabia Saudí"' },
  KG: { es: '"Kirguistán" OR "Kirguizistán"' },
  FJ: { es: '"Fiyi" OR "Fiji"' },
  PW: { es: '"Palaos" OR "Palau"' },
  SL: { es: '"Sierra Leona"' },
  SD: { es: '"Sudán" -"Sudán del Sur"', en: '"Sudan" -"South Sudan"' },
};

const WORLD_FEEDS = [
  { id: 'bbc-mundo', name: 'BBC Mundo', lang: 'es', url: 'https://www.bbc.com/mundo', rss: 'https://feeds.bbci.co.uk/mundo/rss.xml' },
  { id: 'bbc-world', name: 'BBC News', lang: 'en', url: 'https://www.bbc.com/news/world', rss: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'elpais-internacional', name: 'El País Internacional', lang: 'es', url: 'https://elpais.com/internacional/', rss: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada' },
];

// ---------------------------------------------------------------- RSS parsing

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', ouml: 'ö', auml: 'ä',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

// Text of the first <tag>...</tag> inside a block, CDATA unwrapped, entities decoded.
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return '';
  let t = m[1].trim();
  const cdata = t.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) t = cdata[1];
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tagText(block, 'title');
    const url = tagText(block, 'link') || tagText(block, 'guid');
    const source = tagText(block, 'source');
    // Google News appends " - Publisher" to every title; drop it when we have
    // the publisher from <source> so the headline reads as the publisher wrote it.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const when = new Date(tagText(block, 'pubDate'));
    const published = Number.isNaN(when.getTime()) ? null : when.toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (!title || !url) continue;
    items.push({ title, url: tidyUrl(url), source: source || null, published });
  }
  return items;
}

// Smaller files. The Google redirect works without ?oc=5; BBC tracking params add nothing.
function tidyUrl(url) {
  return url.replace(/\?oc=5$/, '').replace(/[?&]at_medium=RSS&at_campaign=rss$/, '');
}

// Drop items from the tail of the longest list until the file fits the cap.
function fitToCap(doc, lists) {
  let json = JSON.stringify(doc);
  while (Buffer.byteLength(json) > MAX_BYTES) {
    const longest = lists.map((k) => doc[k]).filter((l) => Array.isArray(l) && l.length).sort((a, b) => b.length - a.length)[0];
    if (!longest) break;
    longest.pop();
    json = JSON.stringify(doc);
  }
  return json;
}

// --------------------------------------------------------------- rate limiting

const startedAt = Date.now();
let nextSlot = 0;
async function politeFetchText(url) {
  // Pace request starts SPACING_MS apart across all workers.
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + SPACING_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  if (Date.now() - startedAt > BUDGET_MS) throw new Error('time budget exhausted');
  const res = await fetchRetry(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }, 3);
  return res.text();
}

// ------------------------------------------------------------------ countries

function queryFor(country, lang) {
  const o = QUERY_OVERRIDES[country.iso2]?.[lang];
  if (o) return o;
  return `"${country.name[lang]}"`;
}

function searchUrl(query, lang) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${EDITIONS[lang]}`;
}

async function buildCountry(country, built) {
  const doc = { iso2: country.iso2, built, es: [], en: [] };
  const errors = [];
  for (const lang of ['es', 'en']) {
    try {
      const xml = await politeFetchText(searchUrl(queryFor(country, lang), lang));
      doc[lang] = parseRss(xml).slice(0, PER_LANG);
    } catch (err) {
      errors.push(`${lang}: ${String(err.message || err).slice(0, 160)}`);
    }
  }
  if (errors.length) doc.error = errors.join('; ');
  await writeFile(join(outDir, `${country.iso2.toLowerCase()}.json`), fitToCap(doc, ['es', 'en']));
  return doc;
}

async function buildWorld(built) {
  const feeds = [];
  for (const f of WORLD_FEEDS) {
    const entry = { id: f.id, name: f.name, lang: f.lang, url: f.url, items: [] };
    try {
      entry.items = parseRss(await politeFetchText(f.rss)).slice(0, WORLD_ITEMS)
        .map(({ title, url, published }) => ({ title, url, source: f.name, published }));
    } catch (err) {
      entry.error = String(err.message || err).slice(0, 160);
    }
    feeds.push(entry);
  }
  const doc = { built, feeds };
  // World items have short publisher URLs; the cap is still enforced in case a feed misbehaves.
  let json = JSON.stringify(doc);
  while (Buffer.byteLength(json) > MAX_BYTES) {
    const longest = feeds.filter((f) => f.items.length).sort((a, b) => b.items.length - a.items.length)[0];
    if (!longest) break;
    longest.items.pop();
    json = JSON.stringify(doc);
  }
  await writeFile(join(outDir, 'world.json'), json);
  return doc;
}

// ----------------------------------------------------------------------- main

async function main() {
  const built = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await mkdir(outDir, { recursive: true });
  const { facts } = await loadFacts();
  const countries = facts.countries.filter((c) => c.iso2 && c.name?.es && c.name?.en);
  console.log(`news: ${countries.length} countries, ${WORLD_FEEDS.length} world feeds, budget ${Math.round(BUDGET_MS / 1000)} s`);

  const world = await buildWorld(built);
  for (const f of world.feeds) console.log(`  ${f.id}: ${f.items.length} items${f.error ? ` (error: ${f.error})` : ''}`);

  const index = { built, countries: {}, attribution: 'Headlines link to their publishers. Country searches via Google News RSS.' };
  let failed = 0;
  let done = 0;
  await pool(countries, CONCURRENCY, async (country) => {
    const doc = await buildCountry(country, built);
    index.countries[country.iso2] = { es: doc.es.length, en: doc.en.length };
    if (doc.error) {
      failed += 1;
      index.countries[country.iso2].error = doc.error;
    }
    done += 1;
    if (done % 25 === 0) console.log(`  ${done}/${countries.length} (${Math.round((Date.now() - startedAt) / 1000)} s)`);
  });

  const indexJson = JSON.stringify(index);
  await writeFile(join(outDir, 'index.json'), indexJson);

  const counts = Object.values(index.countries).map((c) => c.es + c.en).sort((a, b) => a - b);
  const withItems = counts.filter((n) => n > 0).length;
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  console.log(`news: ${withItems}/${countries.length} countries with headlines, median ${median} per country, ${failed} with errors, ${Math.round((Date.now() - startedAt) / 1000)} s`);
  if (Buffer.byteLength(indexJson) > MAX_BYTES) console.log(`  note: index.json is ${Buffer.byteLength(indexJson)} bytes`);
}

// Run only when executed directly (node tools/build-news.mjs), so tests can import parseRss.
const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  main().catch((err) => {
    // Even a catastrophic failure must not break the deploy; the previous build's files (if any) stay.
    console.error('news: run failed:', err);
    process.exitCode = 1;
  });
}
