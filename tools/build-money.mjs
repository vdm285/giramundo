// Builds public/data/money.json: for every ISO 4217 code used in facts.json,
// photographs or scans of banknotes (first) and coins from Wikimedia Commons,
// with per-file attribution, plus the currency's name and issuer from Wikidata.
//
// Sources: Wikidata (CC0) for the currency item (P498 = ISO 4217 code), its
// label es/en, Commons category (P373), issuer (P562, "central bank/issuer")
// and main image (P18). Wikimedia Commons API for the files: the currency's
// money category is walked one level to find "Banknotes of X" / "Coins of X",
// then CirrusSearch `deepcategory:` flattens the whole tree in one request
// (two sort orders: newest uploads first, which favors the current series, and
// relevance). Titles are scored in JS (obverse, denomination, year, series),
// `imageinfo` gives size and license, and one file per denomination is kept.
// If no category exists, plain search ("banknote <label>", "billete <label>").
// Nothing passes: empty list. Nothing is invented.
//
// Honesty notes. Commons rarely holds the notes of a central bank that keeps
// its copyright (Mexico, for one): the gallery is then older issues, and the
// card must say "as filed on Commons", never "current". `year` and `series`
// are read from the file title when it states them. Licenses are whatever the
// file page says (some are PD only in their country, some are "copyrighted,
// reproduction permitted"); the card shows the license from the file page.
//
// Politeness: pool of 2, 400 ms between request starts, retries and UA from
// net.mjs, every API response cached under data/cache/commons/ (and
// data/cache/wikidata/ for the SPARQL). Re-run: npm run money
// MONEY_ONLY=MXN,JPY npm run money   limits to a few codes; MONEY_DEBUG=1 prints the ranking
//
// Overrides (data/overrides/money.json): per currency, images from an issuer
// with published reuse terms (or a written authorization), downloaded at
// build time to public/data/money/<CODE>/ and listed FIRST in money.json
// with `local`. `npm run money -- --overrides-only` keeps the Commons data
// already in money.json and refreshes only those. See applyOverrides below.

import { writeFile, mkdir, access, readFile, rm, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname, basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { root, cacheDir, sparql as sparqlRaw, getJsonCached, loadFacts, today, pool, fetchRetry, exists } from './net.mjs';

const OUT = join(root, 'public/data/money.json');
const OVERRIDES = join(root, 'data/overrides/money.json');
const MONEY_DIR = join(root, 'public/data/money');
const DL_CACHE = join(cacheDir, 'money');
const OVERRIDES_ONLY = process.argv.includes('--overrides-only');
const MAX_LOCAL_WIDTH = 1200;
const JPEG_QUALITY = 82;
const MAX_BYTES = 600 * 1024;
const MAX_NOTES = 8;
const MAX_COINS = 6;
const MIN_WIDTH = 600;
const MIN_WIDTH_CURRENT = 560;
const SPACING_MS = 400;
const POOL = 2;
const API = 'https://commons.wikimedia.org/w/api.php';
const ONLY = process.env.MONEY_ONLY ? new Set(process.env.MONEY_ONLY.split(',')) : null;
const DEBUG = !!process.env.MONEY_DEBUG;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const v = (b, k) => (b[k] ? b[k].value : null);
const WD = 'http://www.wikidata.org/entity/';
const qidOf = (uri) => (uri ? uri.replace(WD, '') : null);

// ---------------------------------------------------------------------------
// Rate limit: starts spaced SPACING_MS apart, only for requests that will hit
// the network. The cache path mirrors getJsonCached (sha1 of the URL) so a
// cached answer skips the gate.

let lastStart = 0;
let gateChain = Promise.resolve();
function gate() {
  gateChain = gateChain.then(async () => {
    const wait = lastStart + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  return gateChain;
}
async function cached(url, sub) {
  const path = join(cacheDir, sub, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);
  try { await access(path); return true; } catch { return false; }
}
let netCalls = 0;
async function commons(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  if (!(await cached(url, 'commons'))) { await gate(); netCalls += 1; }
  try {
    return await getJsonCached(url, 'commons');
  } catch (err) {
    console.error(`commons: ${err.message}`);
    return null;
  }
}
async function sparql(query) {
  const started = Date.now();
  const rows = await sparqlRaw(query);
  if (Date.now() - started > 50) await sleep(1500);
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Currency codes from facts.json, then Wikidata.

const { facts } = await loadFacts();
const codes = new Map(); // code -> [iso2...]
for (const c of facts.countries) {
  for (const cu of c.currencies || []) {
    if (!cu.code) continue;
    if (!codes.has(cu.code)) codes.set(cu.code, []);
    codes.get(cu.code).push(c.iso2);
  }
}
const countryName = new Map(facts.countries.map((c) => [c.iso2, c.name]));
// --overrides-only: no Wikidata, no Commons; the Commons lists come from the
// money.json already on disk.
const previous = OVERRIDES_ONLY ? JSON.parse(await readFile(OUT, 'utf8')) : null;
const codeList = OVERRIDES_ONLY ? [] : [...codes.keys()].sort().filter((c) => !ONLY || ONLY.has(c));
console.log(OVERRIDES_ONLY ? `overrides only (Commons data kept from ${OUT})` : `${codeList.length} currency codes in facts.json`);

const wdRows = codeList.length ? await sparql(`
SELECT ?code ?c ?links ?l_es ?l_en ?l_mul ?cat ?img ?iss ?iss_es ?iss_en ?iss_mul WHERE {
  VALUES ?code { ${codeList.map((c) => `"${c}"`).join(' ')} }
  ?c wdt:P498 ?code .
  OPTIONAL { ?c wikibase:sitelinks ?links }
  OPTIONAL { ?c rdfs:label ?l_es FILTER(LANG(?l_es) = "es") }
  OPTIONAL { ?c rdfs:label ?l_en FILTER(LANG(?l_en) = "en") }
  OPTIONAL { ?c rdfs:label ?l_mul FILTER(LANG(?l_mul) = "mul") }
  OPTIONAL { ?c wdt:P373 ?cat }
  OPTIONAL { ?c wdt:P18 ?img }
  OPTIONAL { ?c p:P562 ?issSt . ?issSt ps:P562 ?iss . ?issSt wikibase:rank ?rank FILTER(?rank != wikibase:DeprecatedRank)
             FILTER NOT EXISTS { ?issSt pq:P582 ?end }
             OPTIONAL { ?iss rdfs:label ?iss_es FILTER(LANG(?iss_es) = "es") }
             OPTIONAL { ?iss rdfs:label ?iss_en FILTER(LANG(?iss_en) = "en") }
             OPTIONAL { ?iss rdfs:label ?iss_mul FILTER(LANG(?iss_mul) = "mul") } }
}`) : [];

function bi(es, en, mul) {
  if (!es && !en && !mul) return null;
  return { es: es || mul || en, en: en || mul || es };
}
function commonsName(url) {
  if (!url) return null;
  const tail = url.split('/').pop();
  try { return decodeURIComponent(tail).replace(/_/g, ' '); } catch { return tail; }
}

// Group by code; when several items share a code keep the one with most
// sitelinks (and merge its category values).
const wd = new Map();
for (const b of wdRows) {
  const code = v(b, 'code');
  const q = qidOf(v(b, 'c'));
  const links = Number(v(b, 'links') || 0);
  let e = wd.get(code);
  if (!e || (e.qid !== q && links > e.links)) {
    e = { qid: q, links, name: bi(v(b, 'l_es'), v(b, 'l_en'), v(b, 'l_mul')), cats: new Set(), image: null, issuer: null };
    wd.set(code, e);
  }
  if (e.qid !== q) continue;
  if (v(b, 'cat')) e.cats.add(v(b, 'cat'));
  if (!e.image && v(b, 'img')) e.image = commonsName(v(b, 'img'));
  if (!e.issuer && v(b, 'iss')) {
    e.issuer = { qid: qidOf(v(b, 'iss')), ...bi(v(b, 'iss_es'), v(b, 'iss_en'), v(b, 'iss_mul')) };
  }
}
console.log(`Wikidata: ${wd.size} codes matched (missing: ${codeList.filter((c) => !wd.has(c)).join(' ') || 'none'})`);

// ---------------------------------------------------------------------------
// 2. Category discovery on Commons.

const KIND = {
  banknotes: {
    cat: /banknote|paper money|billete|c[eé]dula|\bnotes?\b/i,
    word: /banknote|banknot|billete|c[eé]dula|\bbill\b|\bnotes?\b|\bnotas?\b|\bbillet|biljet|bankjegy|bankovka|\bsedel|\bseddel|geldschein|schein|banconota|банкнот|札|券|紙幣/i,
    search: ['banknote', 'billete'],
    max: MAX_NOTES,
  },
  coins: {
    cat: /\bcoins?\b|moneda|moeda|münze|pièce/i,
    word: /\bcoins?\b|moneda|moeda|münze|pièce|硬貨|coin/i,
    search: ['coin', 'moneda'],
    max: MAX_COINS,
  },
};

// Subcategories that are not the circulating money itself.
const BAD_CAT = /fantasy|imitation|counterfeit|forger|specimen|commemorative|bullion|token|charm|hoard|pattern|mother coin|countermark|postcard|museum|collection|replacement|signature|security feature|people (on|depicted|in)|in art|\bsign\b|machine|exchange|bureau|mint\b|mints\b|\blocal\b|coloni|confederate|revolution|emergency|overstamp|by (state|period|metal|shape|inscription|collection|type|year|date|mint|country|artist|designer|engraver|author|face value|denomination)|unknown|proposal|reverse sides|straps|shred|gold coins|silver coins|on (banknotes|coins|money|stamps)|charit|wash|payment|chart|stamp|books|trays|crest|unidentified|operated|trees|pipe|cheque|check|certificate|medal|military|notgeld|scrip|private|regional|obsolete|\bold\b|ancient|medieval|\(1[0-8]\d\d|\(19[0-4]\d|printing|engrav|depict|portrait|watermark|holder|wallet|error|misprint|cancelled|uncut|sheets?\b|cut\b|destr|burn|damaged|folded|origami|jewel|art\b|advertis|propaganda|film|video|drawing|illustration|logo/i;

async function members(cat, type) {
  const data = await commons({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmtype: type, cmlimit: '200' });
  return data?.query?.categorymembers?.map((m) => m.title.replace(/^Category:/, '')) || [];
}

// Which candidate category names exist? One batched categoryinfo call per 50.
async function existing(names) {
  const out = new Map();
  for (const batch of chunk([...new Set(names)], 50)) {
    const data = await commons({ action: 'query', titles: batch.map((n) => `Category:${n}`).join('|'), prop: 'categoryinfo' });
    for (const p of data?.query?.pages || []) {
      if (p.missing || !p.categoryinfo) continue;
      out.set(p.title.replace(/^Category:/, ''), p.categoryinfo);
    }
  }
  return out;
}

// Generic unit nouns in several languages, for denomination detection.
const UNIT_NOUNS = 'dollar dollars dólar dólares peso pesos franc francs franco francos pound pounds libra libras rupee rupees rupia rupias krona kronor krone kroner króna krónur koruna korun corona coronas dinar dinars dinares dirham dirhams dírham shilling shillings chelín chelines ruble rubles rouble roubles rublo rublos zloty złoty forint hryvnia hryvnias lev leva leu lei lek lekë lari dram manat som somoni tenge afghani afghanis rial rials riyal riyals shekel shekels sheqel sheqalim lira liras lire lilangeni emalangeni loti maloti pula metical meticais escudo escudos dobra dobras ouguiya ariary rufiyaa ngultrum taka baht kyat kyats riel riels kip ringgit rupiah pataca patacas tala vatu kina yen 円 yuan renminbi won dong đồng euro euros real reais reals rand naira cedi cedis birr nakfa dalasi kwanza kwacha quetzal quetzales lempira lempiras córdoba córdobas colón colones balboa balboas boliviano bolivianos sol soles bolívar bolívares guaraní guaraníes gourde gourdes florín florines guilder gulden leone leones sterling cent cents centavo centavos centime centimes céntimo céntimos cêntimo cêntimos pence penny sen kopek kopeks kopeck paise paisa fils halala piastre piastres agorot stotinki öre øre grosz groszy fen jiao chon jeon satang pul tetri tyiyn qapik luma avos rappen'.split(' ');
const UNIT_SET = new Set(UNIT_NOUNS);
const STOP = new Set(['the', 'of', 'de', 'del', 'la', 'el', 'los', 'las', 'and', 'y', 'e', 'da', 'do', 'dos', 'das', 'in', 'by', 'from', 'a', 'an']);
const KIND_WORDS = /^(banknotes?|notes?|coins?|money|currency|paper|billetes?|monedas?|moedas?|cédulas?|cedulas?)$/i;

// Tokens of the currency's labels ("brazilian", "real", "brasileño").
function labelTokens(e) {
  const out = new Set();
  for (const s of [e?.name?.en, e?.name?.es]) {
    if (!s) continue;
    for (const w of s.toLowerCase().replace(/[()]/g, ' ').split(/[\s\-]+/)) if (w && !STOP.has(w)) out.add(w);
  }
  return out;
}

// The noun that names the money ("yen", "dollar", "peso", "real"): any label
// word in UNIT_NOUNS, else the last word of the English label or the first of
// the Spanish one. Never an adjective ("brazilian").
function unitNoun(e) {
  const nouns = new Set();
  const en = (e?.name?.en || '').toLowerCase().replace(/\(.*\)/, '').trim().split(/\s+/).filter(Boolean);
  const es = (e?.name?.es || '').toLowerCase().replace(/\(.*\)/, '').trim().split(/\s+/).filter(Boolean);
  for (const w of [...en, ...es]) if (UNIT_SET.has(w)) nouns.add(w);
  if (en.length && !nouns.size) nouns.add(en[en.length - 1]);
  if (es.length && !nouns.size) nouns.add(es[0]);
  return [...nouns].filter((w) => w.length > 2);
}
// For titles: the nouns plus the ISO code itself ("1000 KRW 2009 rev").
const unitWords = (code, e) => [...unitNoun(e), code.toLowerCase()];

// Does a category name denote exactly this currency's banknotes/coins?
// "Banknotes of Brazilian real" yes; "First series Euro banknotes" no;
// "1 Yen banknotes of Japan" no.
function namesCurrency(name, e) {
  const tokens = labelTokens(e);
  const words = name.toLowerCase().replace(/[()]/g, ' ').split(/[\s\-]+/).filter(Boolean);
  const shape = /^(banknotes?|coins?|paper money|billetes?|monedas?|notes?) (of|de|del) /i.test(name) || /^.+ (banknotes?|coins?|billetes?|monedas?)$/i.test(name);
  const rest = words.filter((w) => !STOP.has(w) && !KIND_WORDS.test(w));
  return shape && rest.length > 0 && rest.every((w) => tokens.has(w) || tokens.has(`${w}s`) || tokens.has(w.replace(/s$/, '')));
}
function leftover(name, e) {
  const tokens = labelTokens(e);
  return name.toLowerCase().replace(/[()]/g, ' ').split(/[\s\-]+/).filter((w) => w && !STOP.has(w) && !KIND_WORDS.test(w) && !tokens.has(w)).length;
}

// The country a code belongs to: the one whose ISO2 opens the code (MXN ->
// MX, GBP -> GB), else the most populous country that uses it.
const population = new Map(facts.countries.map((c) => [c.iso2, c.population || 0]));
function primaryCountry(code) {
  const users = codes.get(code) || [];
  if (users.includes(code.slice(0, 2))) return code.slice(0, 2);
  return users.slice().sort((a, b) => population.get(b) - population.get(a))[0] || null;
}

// Denomination subcategories ("1000 won banknotes", "Euro coins (1 euro)",
// "20 United States dollar banknotes"), directly under a root or under its
// "by denomination" / "by face value" child. Ranked by size; the biggest
// are the ones people photograph, which are the ones in circulation.
function parseDenomCat(name, nouns) {
  if (!/(banknotes?|notes?|bills?|coins?|billetes?|monedas?|cédulas?|paper money|dimes?|quarters?|nickels?|pennies|cents?)\b/i.test(name)) return null;
  const own = (w) => matchesUnit(w, nouns);
  // "Dimes of the United States", "Quarters (United States coin)"
  const named = Object.keys(COIN_NAMES).find((w) => new RegExp(`^${w}s?\\b`, 'i').test(name));
  if (named && !/\d/.test(name)) return { n: COIN_NAMES[named][0], sub: COIN_NAMES[named][1], foreign: false };
  for (const m of name.matchAll(/(?:^|[\s(])(\d+(?:[.,]\d+)?)\s*-?\s*((?:[a-záéíóúüñç円]+\s*){1,3})/gi)) {
    // the unit may sit after a qualifier: "20 United States dollar banknotes"
    const w = m[2].toLowerCase().split(/\s+/).filter(Boolean).find((x) => UNIT_SET.has(x) || own(x));
    if (!w) continue;
    const n = Number(m[1].replace(',', '.'));
    if (!nice(n)) continue;
    const sub = SUBUNIT.test(w);
    return { n, sub, foreign: nouns.length > 0 && !own(w) && !sub };
  }
  return null;
}
async function denominationCats(roots, e, kind) {
  const nouns = unitNoun(e);
  const other = kind === 'banknotes' ? KIND.coins.cat : KIND.banknotes.cat;
  const found = new Map();
  for (const r of roots) {
    let subs = await members(r, 'subcat');
    for (const sub of subs.filter((x) => /by (denomination|face value|name)$/i.test(x))) subs = subs.concat(await members(sub, 'subcat'));
    for (const sub of subs) {
      if (BAD_CAT.test(sub) && !/by (denomination|face value|name)$/i.test(sub)) continue;
      if (other.test(sub) && !KIND[kind].cat.test(sub)) continue;
      const d = parseDenomCat(sub, nouns);
      if (d && !d.foreign && !found.has(sub)) found.set(sub, d);
    }
  }
  if (!found.size) return [];
  const info = await existing([...found.keys()]);
  return [...found.entries()]
    .map(([name, d]) => ({ name, ...d, size: (info.get(name)?.files || 0) + (info.get(name)?.subcats || 0) * 5 }))
    .filter((d) => d.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, KIND[kind].max);
}

// Find the root categories for a currency: { banknotes: [names], coins: [names] }.
async function findRoots(code, e) {
  const unit = unitWords(code, e);
  const hasUnit = (name) => unit.some((w) => new RegExp(`(^|[^a-z])${w}s?([^a-z]|$)`, 'i').test(name.toLowerCase()));
  const roots = { banknotes: [], coins: [] };
  const seen = new Set();

  async function consider(cat, depth) {
    if (seen.has(cat) || depth > 2) return;
    seen.add(cat);
    const subs = await members(cat, 'subcat');
    for (const kind of Object.keys(KIND)) {
      const matches = subs.filter((s) => KIND[kind].cat.test(s) && !BAD_CAT.test(s) && !(kind === 'coins' && KIND.banknotes.cat.test(s)));
      // Prefer the subcategory that names the currency ("Banknotes of
      // Brazilian real" over "Banknotes of Brazil"); keep both when found.
      for (const m of matches) {
        if (!roots[kind].includes(m)) roots[kind].push(m);
      }
    }
    // Go one level into a subcategory named after the currency itself
    // ("Brazilian real", "United States dollar", "Yen").
    for (const s of subs) {
      if (hasUnit(s) && !KIND.banknotes.cat.test(s) && !KIND.coins.cat.test(s) && !BAD_CAT.test(s) && depth < 1) {
        await consider(s, depth + 1);
      }
    }
  }

  for (const cat of e?.cats || []) await consider(cat, 0);

  // Narrow: inside "Banknotes of Brazil", a subcat naming the currency.
  for (const kind of Object.keys(KIND)) {
    const narrowed = [];
    for (const r of roots[kind].slice(0, 2)) {
      if (namesCurrency(r, e)) continue;
      const subs = await members(r, 'subcat');
      const other = kind === 'banknotes' ? KIND.coins.cat : KIND.banknotes.cat;
      const better = subs.filter((s) => namesCurrency(s, e) && KIND[kind].cat.test(s) && !other.test(s) && !BAD_CAT.test(s));
      narrowed.push(...better);
    }
    roots[kind] = [...new Set([...narrowed, ...roots[kind]])];
  }

  // Guessed names, always (one batched call): "Renminbi banknotes" or
  // "Egyptian pound banknotes" beats "Banknotes of China" when it exists.
  {
    const guesses = [];
    const en = e?.name?.en;
    const primary = primaryCountry(code);
    const n = countryName.get(primary)?.en;
    // The official name too: "Banknotes of the People's Republic of China"
    // holds the renminbi, "Banknotes of China" holds every dynasty.
    const official = facts.countries.find((c) => c.iso2 === primary)?.official?.en;
    // Commons spells "People's" with a straight apostrophe; facts.json may not.
    const variants = [n, official].filter(Boolean).flatMap((x) => [...new Set([x, x.replace(/[’‘]/g, "'"), x.replace(/'/g, '’')])]);
    for (const name of variants) {
      guesses.push(`Banknotes of ${name}`, `Banknotes of the ${name}`, `Coins of ${name}`, `Coins of the ${name}`, `Money of ${name}`, `Money of the ${name}`);
    }
    if (en) {
      const cap = en[0].toUpperCase() + en.slice(1);
      guesses.push(`Banknotes of the ${cap}`, `Banknotes of ${cap}`, `${cap} banknotes`, `Coins of the ${cap}`, `Coins of ${cap}`, `${cap} coins`, cap);
    }
    const found = await existing(guesses);
    for (const name of found.keys()) {
      if (BAD_CAT.test(name)) continue;
      if (KIND.banknotes.cat.test(name)) { if (!roots.banknotes.includes(name)) roots.banknotes.push(name); }
      else if (KIND.coins.cat.test(name)) { if (!roots.coins.includes(name)) roots.coins.push(name); }
      else if (!seen.has(name)) await consider(name, 1);
    }
  }
  // Keep at most 2 roots per kind: ones that name exactly this currency
  // first, then "Kind of <country>", then ones that mention the unit, then
  // the fewest stray words. A denomination category ("One dollar coins of
  // Canada", "1 Yen banknotes of Japan") is never a root.
  const primary = primaryCountry(code);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const country = countryName.get(primary)?.en;
  const official = facts.countries.find((c) => c.iso2 === primary)?.official?.en;
  const ofName = (n, name) => !!name && new RegExp(`^(banknotes|coins|paper money) of (the )?${esc(name).replace(/[’']/g, "[’']")}$`, 'i').test(n);
  const isDenom = (n) => /^(one|two|three|five|ten|twenty|fifty|hundred|\d)/i.test(n) || !!parseDenomCat(n, unitNoun(e));
  // 0 names the currency; 1 names the state officially; 2 names the country; 3 mentions the unit; 4 anything else.
  const tier = (n) => (namesCurrency(n, e) ? 0 : official && official !== country && ofName(n, official) ? 1 : ofName(n, country) ? 2 : hasUnit(n) ? 3 : 4);
  const rank = (n) => tier(n) * 100 + Math.min(9, leftover(n, e)) * 10 + Math.min(9, Math.floor(n.length / 20));
  for (const kind of Object.keys(KIND)) {
    const other = kind === 'banknotes' ? KIND.coins.cat : KIND.banknotes.cat;
    roots[kind] = roots[kind].filter((n) => !isDenom(n) && (!other.test(n) || namesCurrency(n, e))).sort((a, b) => rank(a) - rank(b)).slice(0, 2);
    // A root that names the currency or the state officially, and is not
    // tiny, stands alone: "Banknotes of the People's Republic of China" must
    // not be mixed with every dynasty under "Banknotes of China".
    if (roots[kind].length === 2 && tier(roots[kind][0]) <= 1) {
      const info = (await existing([roots[kind][0]])).get(roots[kind][0]);
      if (info && info.files + info.subcats * 10 >= 30) roots[kind] = roots[kind].slice(0, 1);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// 3. Candidate files: deepcategory search (newest first, then relevance),
//    plain search as a fallback.

async function searchPage(srsearch, sort, offset) {
  const params = { action: 'query', list: 'search', srnamespace: '6', srlimit: '50', srsearch: srsearch.normalize('NFC'), sroffset: String(offset), srinfo: 'totalhits', srprop: '' };
  if (sort) params.srsort = sort;
  const data = await commons(params);
  return { hits: (data?.query?.search || []).map((h) => h.title.replace(/^File:/, '')), total: data?.query?.searchinfo?.totalhits || 0 };
}

async function candidates(code, e, kind, roots, denomCats) {
  const titles = new Map();
  const add = (t, from) => { if (!titles.has(t)) titles.set(t, from || null); };
  const nouns = unitNoun(e);
  // Big trees are narrowed to files that name the unit; common subunit words
  // keep the quarters and the centavos in.
  const subunits = kind === 'coins' ? ['cent', 'cents', 'centavo', 'centavos', 'centime', 'centimes', 'pence', 'penny', 'quarter', 'dime', 'nickel'] : [];
  const nounClause = nouns.length ? ` (${[...new Set([...nouns.flatMap((n) => [n, `${n}s`, `${n}es`]), ...subunits])].join(' OR ')})` : '';
  // No negated words here: "-specimen" makes CirrusSearch drop most
  // deepcategory hits (132 -> 7 for the won). Specimens are scored down.
  const neg = '';
  const obv = ' (obverse OR anverso OR front OR avers OR vorderseite OR recto)';
  // Denomination categories first: precise, and the file inherits the
  // denomination when its title does not state one.
  for (const d of denomCats) {
    const q = `deepcategory:"${d.name}"${neg}`;
    const first = await searchPage(q, 'create_timestamp_desc', 0);
    for (const t of first.hits) add(t, d);
    if (first.hits.length === 50) for (const t of (await searchPage(`${q}${obv}`, null, 0)).hits) add(t, d);
  }
  for (const r of roots) {
    const plain = `deepcategory:"${r}"${neg}`;
    // Newest uploads first (favors the current series), then relevance.
    // Big trees (hundreds of files) are narrowed to titles/descriptions
    // that name the unit, otherwise the pages are mostly noise.
    const first = await searchPage(plain, 'create_timestamp_desc', 0);
    for (const t of first.hits) add(t);
    const big = first.total > 200;
    const q = big && nounClause ? `deepcategory:"${r}"${nounClause}${neg}` : plain;
    if (big) {
      if (q !== plain) for (const t of (await searchPage(q, 'create_timestamp_desc', 0)).hits) add(t);
      for (const t of (await searchPage(`${q}${obv}`, null, 0)).hits) add(t);
    } else if (first.hits.length === 50) {
      for (const t of (await searchPage(plain, 'create_timestamp_desc', 50)).hits) add(t);
    }
    for (const t of (await searchPage(q, null, 0)).hits) add(t);
  }
  if (!roots.length && !denomCats.length) {
    const en = e?.name?.en;
    const es = e?.name?.es;
    const [wEn, wEs] = KIND[kind].search;
    if (en) for (const t of (await searchPage(`"${wEn}" "${en}"${neg}`, null, 0)).hits) add(t);
    if (es && es !== en) for (const t of (await searchPage(`"${wEs}" "${es}"${neg}`, null, 0)).hits) add(t);
  }
  return titles;
}

// ---------------------------------------------------------------------------
// 4. Title scoring.

const OBVERSE = /\bobverse\b|\banverso\b|\bfront\b|\bavers\b|vorderseite|\brecto\b|\bobv\b|\bav\b|\bface\b|表|\bfrente\b/i;
const REVERSE = /\breverse\b|\breverso\b|\bback\b|\brevers\b|rückseite|\bverso\b|\brev\b|\brv\b|裏|\bdorso\b/i;
const JUNK = /specimen|counterfeit|\bfake|falschgeld|\bfalso|fantasy|imitation|replica|play money|\btoy\b|proposal|mock|unissued|essay|cheque|check\b|\bbond\b|\bstamp|postcard|token|medal|coupon|voucher|\bvale\b|certificate|military payment|notgeld|coloni|confederate|overstamp|revolution|provisional|estado de|state of|constitucionalista|comisión|henequén|tesorería|imperial|\bempire\b|\bkingdom\b|\bduchy\b|\bréis\b|\bcruzeiro|cruzado|\bsen\b|\brin\b|\bmon\b|\bbu\b|\bshu\b|cash coin|lincoln|lindbergh|dpla|lccn|urn-3|baker\.ac|collection|museu|museum|exhibit|sammlung|hbs\.|demand note|treasury note|interest bearing|free banking|national bank|gold certificate|silver certificate|coin note|continental|philippine|republic of texas|american period|fractional|george v\b|george vi\b|british india|king george|queen victoria|edward vii|\braj\b|hwan\b|blanket|cake|cookie|costume|dress|pillow|towel|reales\b|treasure|\bcob\b|century|siglo|siècle|jahrhundert|pirate|galleon|shipwreck|ingot|medallion|jeton|gaming|casino|chip|bitcoin|crypto|historic|histórico|histórica|quarter eagle|half eagle|double eagle|sovereign|krugerrand|challenge coin|\d+sen\b|czek|chèque|scheck|traveller|travelers?\b|state bank|\b1[6-9]xx\b|bon towarowy|circulation|circulación|millions|statistic|estadística|\bgraph|\bchart|\bscrip\b|accession|\bh\. \d{4}\.\d|\bold\b|antiguo|antigua|\balte[rn]?\b|ancien|dynasty|dinastía|\bwén\b|amulet|tong bao|bao chao|former currency|printing|block|plate|\bdie\b|mould|mold|hutt river|province|micronation|fraud|falsificad|world youth day|ptolem|roman coin|greek coin|byzantine|ottoman|ancient|antique|\bbce?\b|\bb\.c\.|mithradates|abbasid|umayyad|mughal|seleucid|achaemenid|sasanian|parthian|hellenistic|denarius|sestertius|drachm|stater|solidus|follis|\bobol/i;
const SCENE = /wallet|\bhand\b|\bhands\b|\bpile|stack|\bcash\b|shred|bundle|straps?\b|machine|\batm\b|\bsign\b|chart|\bmap\b|cartera|billetera|mano\b|montón|fajo|bolsa|empilhad|neon|street|shop|market|tienda|price|precio|donante|campaign|campaña|wikiconvention|dsc[_ ]?\d|img[_ ]?\d|p0\d{5}|\(\d{7,}\)|^\d{6,}|^dsc|^img|^p\d{7}|screenshot|detail|detalle|closeup|close-up|macro|uv\b|ultraviolet|watermark|透かし|security|seguridad|hilo|firma|signature|serial|微|locker|vending|parking|laundry|arcade|pachinko|station|circulation|millions|graph|statistic|estadística|\bgdp\b|inflation|exchange rate|tipo de cambio|rates?\b|table\b|tabla|modelo|model\b|boceto|sketch|drawing|escudo nacional|coat of arms|press|conference|meeting|minister|president|governor|speech|\bwith\b|\bscale\b|comparison|vergleich|hologram|holograma|raised print|draghi|lagarde|duisenberg|trichet|signatur|microprint|emerald|window|ventana|finestra|\bbill\.jpg$|disordered|pay the/i;

const COMMEM = /commemorative|conmemorativ|comemorativ|gedenkmünze|collector|colección|coleção|\bproof\b|bullion|olympic|olímpic|expo\s?\d{4}|anniversary|aniversario|aniversário|jahre\b|años\b|anos\b|libertad\b.*\bonza|onza|ounce|\boz\b|silver\b|\bgold\b|\bplata\b|\boro\b|\bouro\b|\bprata\b|pattern|essai|trial|medal/i;
// Words that mark the series in circulation.
const CURRENT = /\bcurrent\b|\bactual\b|polymer|polímero|polímer|europa series|serie europa|new series|nueva familia|nuevo billete|nueva serie|nova família|nova série|new design|redesign|\bnew\b|\bnuev[oa]\b|\bnov[oa]\b|9th series|neunte serie/i;
const WORDS = { one: 1, un: 1, uno: 1, um: 1, two: 2, dos: 2, dois: 2, five: 5, cinco: 5, ten: 10, diez: 10, dez: 10, twenty: 20, veinte: 20, vinte: 20, fifty: 50, cincuenta: 50, cinquenta: 50, hundred: 100, cien: 100, cem: 100, thousand: 1000, mil: 1000, 'two hundred': 200, doscientos: 200, duzentos: 200, 'five hundred': 500, quinientos: 500, quinhentos: 500, 'ten thousand': 10000, 'one thousand': 1000, 'five thousand': 5000, 'veinticinco': 25, 'twenty-five': 25, 'twenty five': 25, twee: 2, vijf: 5, tien: 10, twintig: 20, vijftig: 50, honderd: 100, zwei: 2, fünf: 5, zehn: 10, zwanzig: 20, fünfzig: 50, hundert: 100, deux: 2, dix: 10, vingt: 20, cinquante: 50, mille: 1000 };
const SUBUNIT = /\b(cents?|centavos?|centimes?|céntimos?|cêntimos?|pence|penny|sen|kopek|kopeck|paise|paisa|fils|halala|piastres?|agorot|lipa|stotinki|öre|ore|øre|groszy|grosz|fen|jiao|chon|jeon|satang|pul|tetri|tyiyn|dirams?|qapik|luma|avos|centimos?|rappen|cent)\b/i;
const ORD = { first: 1, primera: 1, primeira: 1, second: 2, segunda: 2, third: 3, tercera: 3, terceira: 3, fourth: 4, cuarta: 4, fifth: 5, quinta: 5, sixth: 6 };

const COUNTRY_RE = new RegExp(`\\b(${facts.countries.map((c) => c.name.en).sort((a, b) => b.length - a.length).filter((n) => n.length > 4 && !/^(United|Saint|South|North|Central|Western|Eastern|Northern|Southern)$/.test(n)).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
const countryByName = new Map(facts.countries.map((c) => [c.name.en.toLowerCase(), c.iso2]));

// "Zlotych" is zloty, "krónur" is króna, "lirası" is lira: a word names a
// unit when, accents stripped, it starts with the unit's stem (the noun less
// its last letter when it has five or more). Short nouns need an exact or
// plural match ("yen", "yens", "won").
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ı/g, 'i');
function matchesUnit(word, nouns) {
  const w = fold(word);
  return nouns.some((u) => {
    const n = fold(u);
    if (w === n || w === `${n}s` || w === `${n}es`) return true;
    return n.length >= 5 && w.startsWith(n.slice(0, n.length - 1));
  });
}
// Coins named rather than numbered (English-speaking countries).
const COIN_NAMES = { penny: [1, true], pennies: [1, true], nickel: [5, true], dime: [10, true], quarter: [25, true], 'half dollar': [50, true] };

// Face values are round: 1, 2, 2.5, 5, 20, 25, 500, 100000, 0.05. A number
// whose leading digits are not n.5-ish (1967, 17, 271, 1098) is a year or a
// catalog number.
function nice(n) {
  if (!(n > 0)) return false;
  const m = n / 10 ** Math.floor(Math.log10(n));
  return Math.abs(m * 2 - Math.round(m * 2)) < 1e-9;
}
function parseTitle(title, ctxUnits = [], users = null) {
  const t = title.replace(/\.[a-z0-9]+$/i, '');
  const lower = t.toLowerCase();
  const isUnit = (w) => UNIT_SET.has(w) || matchesUnit(w, ctxUnits);
  let year = null;
  for (const m of t.matchAll(/(?<!\d)(1[6-9]\d\d|20[0-3]\d)(?!\d)/g)) {
    const y = Number(m[1]);
    // "2000 Zlotych", "1000 yen": a face value, not a year
    const next = /^\s*[-–]?\s*([a-záéíóúüñçãõâêôıöşğłżśćń円]+)/i.exec(t.slice(m.index + m[0].length));
    if (next && isUnit(next[1].toLowerCase())) continue;
    if (!year || y > year) year = y;
  }
  // Series: a letter ("Series F", "Familia G"), an ordinal ("Second series",
  // "1 Brazil real Second Obverse", "segunda serie"), a Roman or Arabic
  // numeral ("serieVI", "Serie 2"). Letters and numbers are compared apart.
  let series = null;
  const sl = /\b(?:serie|series|familia|família|family|type|tipo)\s*([A-H])\b/i.exec(t);
  if (sl) series = sl[1].toUpperCase();
  else {
    const so = /\b(first|second|third|fourth|fifth|sixth|primera|segunda|tercera|cuarta|quinta|sexta|primeira|terceira)\b(?=.*\b(serie|series|família|familia|family|obverse|reverse|issue|edition|anverso|reverso|front|back)\b)/i.exec(t);
    if (so) series = String(ORD[so[1].toLowerCase()]);
    else {
      const sn = /\b(?:serie|series|família|familia)\s*(\d|[IVX]{1,4})\b/i.exec(t);
      if (sn) series = /^\d$/.test(sn[1]) ? sn[1] : String({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 }[sn[1].toUpperCase()] || '');
      if (series === '') series = null;
    }
  }
  // Denomination: a number followed (within three words) by a unit noun or a
  // currency symbol, or preceded by a kind word ("Billete de 5"). A bare
  // number (photo index, Flickr id, date) is not a denomination.
  let denomination = null;
  let subunit = null;
  let foreign = false;
  const nums = [];
  const ownUnit = (w) => matchesUnit(w, ctxUnits);
  for (const m of t.matchAll(/(?<![\w.,])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k(?![\w]))?/gi)) {
    let n = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (m[2]) n *= 1000;
    const after = t.slice(m.index + m[0].length);
    const before = t.slice(0, m.index);
    if (/^(st|nd|rd|th|º|ª|er|e)\b/i.test(after)) continue; // "9th series"
    if (!nice(n)) continue; // 1967, 17, 271 are catalog numbers or years, not face values
    const toks = after.toLowerCase().match(/[a-záéíóúüñçãõâêôıöşğłżśćń円]+|\d+/g) || [];
    const nextWords = [];
    for (const tok of toks) { if (/^\d/.test(tok)) break; nextWords.push(tok); if (nextWords.length === 3) break; }
    const symbolAfter = /^\s?[€$£¥円]/.test(after) || /[€$£¥]\s?$/.test(before);
    const unitNear = nextWords.some(isUnit) || symbolAfter;
    const unitWord = nextWords.find(isUnit);
    if (unitWord && ctxUnits.length && !ownUnit(unitWord) && !SUBUNIT.test(unitWord)) foreign = true;
    const kindBefore = /(billete|banknote|note|bill|cédula|cedula|moneda|moeda|coin|münze|pièce|piece)s?\s+(de|of|von|da)\s+$/i.test(before);
    const isYear = /^(1[6-9]\d\d|20[0-3]\d)$/.test(m[1]) && !nextWords.slice(0, 1).some(isUnit);
    if (isYear || n > 1000000 || n === 0) continue;
    if (!unitNear && !kindBefore) continue;
    nums.push({ n, sub: SUBUNIT.test(nextWords.slice(0, 2).join(' ')), nearUnit: unitNear });
  }
  if (!nums.length) {
    for (const [w, n] of Object.entries(WORDS).sort((a, b) => b[0].length - a[0].length)) {
      // the unit may follow an adjective: "twee Zuid-Afrikaanse rand", "cinco pesos oro"
      const m = new RegExp(`(^|[\\s(])${w}[\\s)\\-]+((?:[a-záéíóúüñçãõâêôıöşğłżśćń]+[\\s\\-]*){1,3})`, 'i').exec(lower);
      const unitWord = m && m[2].split(/[\s\-]+/).filter(Boolean).find(isUnit);
      if (unitWord) {
        nums.push({ n, nearUnit: true, sub: SUBUNIT.test(unitWord) });
        if (ctxUnits.length && !ownUnit(unitWord) && !SUBUNIT.test(unitWord)) foreign = true;
        break;
      }
    }
  }
  if (!nums.length) {
    // "Washington quarter", "Jefferson nickel": named coins
    const cn = Object.keys(COIN_NAMES).sort((a, b) => b.length - a.length).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(lower));
    if (cn) nums.push({ n: COIN_NAMES[cn][0], nearUnit: true, sub: COIN_NAMES[cn][1] });
  }
  if (nums.length) {
    const pick = nums.find((x) => x.nearUnit) || nums[0];
    denomination = String(pick.n);
    if (pick.sub) subunit = true;
  }
  const side = OBVERSE.test(t) && !REVERSE.test(t) ? 'obverse' : REVERSE.test(t) && !OBVERSE.test(t) ? 'reverse' : null;
  const cm = COUNTRY_RE.exec(t);
  const foreignCountry = !!(cm && users && !users.has(countryByName.get(cm[1].toLowerCase())));
  return { year, series, denomination, subunit, side, foreign, foreignCountry };
}

function scoreTitle(title, kind, unit, ctx, fromCat) {
  const p = parseTitle(title, unit, ctx.users);
  let s = 0;
  const ownDenomination = p.denomination;
  if (fromCat) {
    s += 2;
    if (!p.denomination) { p.denomination = String(fromCat.n); p.subunit = fromCat.sub || null; }
  }
  if (p.side === 'obverse') s += 6;
  if (p.side === 'reverse') s -= 4;
  if (p.denomination) s += 3;
  if (p.foreignCountry) s -= 6;
  // The money people carry today ranks first: recent years and the newest
  // series up, anything before 1990 well down.
  if (p.year) {
    if (p.year >= 2010) s += 4 + (p.year - 2010) / 5;
    else if (p.year >= 2000) s += 3;
    else if (p.year >= 1990) s += 0;
    else if (p.year >= 1950) s -= 6;
    else s -= 12;
  }
  if (p.series) {
    const max = /^[A-H]$/.test(p.series) ? ctx.maxLetter : ctx.maxOrdinal;
    if (max) s += p.series === max ? 4 : -3;
  }
  if (CURRENT.test(title)) s += 4;
  if (JUNK.test(title)) s -= 9;
  if (p.foreign) s -= 6;
  if (COMMEM.test(title)) s -= 6;
  if (SCENE.test(title)) s -= 4;
  if (KIND[kind].word.test(title)) s += 1;
  if (unit.some((w) => title.toLowerCase().includes(w))) s += 1;
  if (!ownDenomination && !KIND[kind].word.test(title)) s -= 2;
  // A title that names only the other kind is the other kind, whatever the tree says.
  if (kind === 'banknotes' && KIND.coins.word.test(title) && !KIND.banknotes.word.test(title)) s -= 20;
  if (kind === 'coins' && KIND.banknotes.word.test(title) && !KIND.coins.word.test(title)) s -= 20;
  return { score: s, ...p };
}

const EXT_OK = /\.(jpe?g|png|tiff?|webp)$/i;

// ---------------------------------------------------------------------------
// 5. imageinfo for the best candidates.

function stripHtml(s) {
  if (!s) return null;
  const t = s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t || null;
}
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function imageinfo(titles) {
  const out = new Map();
  for (const batch of chunk(titles, 50)) {
    const data = await commons({ action: 'query', titles: batch.map((t) => `File:${t}`).join('|'), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800', iiextmetadatafilter: 'LicenseShortName|Artist|Credit|AttributionRequired|Copyrighted|Restrictions' });
    for (const p of data?.query?.pages || []) {
      const i = p.imageinfo?.[0];
      if (!i) continue;
      const e = i.extmetadata || {};
      const g = (k) => (e[k] ? e[k].value : null);
      out.set(p.title.replace(/^File:/, ''), {
        w: i.width, h: i.height, mime: i.mime,
        license: g('LicenseShortName'),
        artist: clip(stripHtml(g('Artist')), 60),
        credit: clip(stripHtml(g('Credit')), 60),
        attributionRequired: g('AttributionRequired') == null ? null : String(g('AttributionRequired')).toLowerCase() === 'true',
        restrictions: g('Restrictions') || null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Per currency.

const result = {};

async function build(code) {
  const e = wd.get(code) || null;
  const entry = {
    name: e?.name || null,
    issuer: e?.issuer ? { es: e.issuer.es, en: e.issuer.en, qid: e.issuer.qid } : null,
    qid: e?.qid || null,
    image: e?.image || null,
    categories: { banknotes: null, coins: null },
    banknotes: [],
    coins: [],
  };
  result[code] = entry;
  if (!e) { entry.note = 'no Wikidata item with this ISO 4217 code'; return; }
  const unit = unitWords(code, e);
  const roots = await findRoots(code, e);
  for (const kind of Object.keys(KIND)) {
    entry.categories[kind] = roots[kind][0] || null;
    const denomCats = await denominationCats(roots[kind], e, kind);
    const cands = await candidates(code, e, kind, roots[kind], denomCats);
    const titles = [...cands.keys()].filter((t) => EXT_OK.test(t));
    if (DEBUG) console.log(`${code} ${kind}: roots ${JSON.stringify(roots[kind])}; denomination cats ${JSON.stringify(denomCats.map((d) => d.name))}; ${titles.length} candidates`);
    if (!titles.length) continue;
    // Series context: the latest letter/ordinal seen across this currency's titles.
    const seriesSeen = titles.map((t) => parseTitle(t, unit).series).filter(Boolean);
    const letters = [...new Set(seriesSeen.filter((x) => /^[A-H]$/.test(x)))].sort();
    const ordinals = [...new Set(seriesSeen.filter((x) => /^\d+$/.test(x)))].sort((a, b) => Number(a) - Number(b));
    const ctx = {
      users: new Set(codes.get(code) || []),
      maxLetter: letters.length >= 2 ? letters[letters.length - 1] : null,
      maxOrdinal: ordinals.length >= 2 ? ordinals[ordinals.length - 1] : null,
    };
    const ranked = titles.map((t) => ({ title: t, ...scoreTitle(t, kind, unit, ctx, cands.get(t)) })).sort((a, b) => b.score - a.score);
    if (DEBUG) for (const r of ranked.slice(0, 20)) console.log(`   ${r.score.toFixed(1).padStart(5)} ${r.denomination || '-'} ${r.title}`);
    // Floor at 1: a file that earned one penalty (foreign unit, scene, junk
    // word) is left out even when the currency is thin. Empty beats wrong.
    const top = ranked.slice(0, kind === 'banknotes' ? 40 : 30).filter((r) => r.score >= 1);
    if (!top.length) continue;
    const info = await imageinfo(top.map((r) => r.title));
    // Width floor: 600, or 560 for a file the title dates to 2010 or later or
    // places in the newest series (the ECB's own Europa-series scans are 596).
    const current = (r) => (r.year && r.year >= 2010) || (r.series && (r.series === ctx.maxLetter || r.series === ctx.maxOrdinal)) || CURRENT.test(r.title);
    const ok = top.filter((r) => {
      const i = info.get(r.title);
      return i && i.w >= (current(r) ? MIN_WIDTH_CURRENT : MIN_WIDTH) && /^image\/(jpeg|png|tiff|webp)$/.test(i.mime || '');
    });
    // One per denomination; files without a detected denomination are their own group (at most 2 kept).
    const groups = new Map();
    for (const r of ok) {
      const key = r.denomination ? `${r.denomination}${r.subunit ? 'c' : ''}` : `?${r.title}`;
      if (!groups.has(key)) groups.set(key, r);
    }
    const chosen = [...groups.values()];
    let unknown = 0;
    const picked = [];
    for (const r of chosen) {
      if (!r.denomination) { if (unknown >= 2 || !KIND[kind].word.test(r.title) || r.score < 0) continue; unknown += 1; }
      picked.push(r);
      if (picked.length >= KIND[kind].max) break;
    }
    // Today's money first (dated 2000 or later, newest series, or marked
    // current), each block in face-value order; undated or older issues after.
    const num = (r) => (r.denomination ? Number(r.denomination) * (r.subunit ? 0.01 : 1) : Infinity);
    const recent = (r) => ((r.year && r.year >= 2000) || current(r) ? 0 : 1);
    picked.sort((a, b) => recent(a) - recent(b) || num(a) - num(b));
    entry[kind] = picked.map((r) => {
      const i = info.get(r.title);
      const o = { file: r.title, denomination: r.denomination ? (r.subunit ? `${r.denomination} (subunit)` : r.denomination) : null, w: i.w, h: i.h, license: i.license, artist: i.artist, credit: i.credit, attributionRequired: i.attributionRequired };
      if (r.year) o.year = r.year;
      if (r.series) o.series = r.series;
      if (r.side) o.side = r.side;
      return o;
    });
  }
}

const started = Date.now();
let done = 0;
await pool(codeList, POOL, async (code) => {
  try {
    await build(code);
  } catch (err) {
    console.error(`${code}: ${err.message}`);
    result[code] = result[code] || { name: null, issuer: null, qid: null, image: null, categories: {}, banknotes: [], coins: [] };
    result[code].error = err.message;
  }
  done += 1;
  const r = result[code];
  console.log(`${String(done).padStart(3)}/${codeList.length} ${code} notes=${r.banknotes.length} coins=${r.coins.length} cat=${r.categories?.banknotes || '-'} | ${r.categories?.coins || '-'}`);
});

// ---------------------------------------------------------------------------
// 7. Overrides: official files, downloaded, placed first.

// sharp is optional (not a dependency): with it, files are resized to
// MAX_LOCAL_WIDTH and JPEGs re-encoded; without it they are copied as-is.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* copy as-is */ }

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return { mime: 'application/zip', ext: 'zip' };
  return null;
}
// Pixel size without a dependency: PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X.
function dimensions(buf) {
  const k = sniff(buf);
  if (!k) return null;
  if (k.ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (k.ext === 'jpg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (k.ext === 'webp') {
    const tag = buf.toString('ascii', 12, 16);
    if (tag === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (tag === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}
// One entry out of a zip (stored or deflated; no zip64), by exact name.
function unzipEntry(zip, name) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66000); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no central directory)');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28);
    const xlen = zip.readUInt16LE(p + 30);
    const clen = zip.readUInt16LE(p + 32);
    const off = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nlen);
    names.push(entryName);
    if (entryName === name) {
      if (zip.readUInt32LE(off) !== 0x04034b50) throw new Error('bad local header');
      const start = off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28);
      const data = zip.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip method ${method} not supported`);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`entry not in zip: ${name}\n  entries: ${names.filter((x) => !x.endsWith('/')).slice(0, 60).join(' | ')}`);
}
const commonsOriginal = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}`;

// Download (cached under data/cache/money/ by URL) and check it is an image.
async function download(url, expectZip) {
  await mkdir(DL_CACHE, { recursive: true });
  const path = join(DL_CACHE, `${sha(url)}.${expectZip ? 'zip' : 'bin'}`);
  if (await exists(path)) return readFile(path);
  const res = await fetchRetry(url, { headers: { Accept: expectZip ? 'application/zip,*/*' : 'image/*,*/*;q=0.5' } });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  const kind = sniff(buf);
  const okType = expectZip ? kind?.ext === 'zip' : kind && kind.mime.startsWith('image/');
  if (!okType) throw new Error(`${url}: not ${expectZip ? 'a zip' : 'an image'} (content-type ${type || '?'}, magic ${kind?.mime || 'unknown'})`);
  await writeFile(path, buf);
  return buf;
}

// The bytes of one override entry: https URL (optionally an entry in a zip),
// commons:<file>, or a path under data/sources/money/.
async function sourceBytes(entry) {
  const src = String(entry.src || '');
  if (src.startsWith('commons:')) return download(commonsOriginal(src.slice(8).trim()), false);
  if (/^https:\/\//.test(src)) {
    if (!entry.entry) return download(src, false);
    const data = unzipEntry(await download(src, true), entry.entry);
    if (!sniff(data)?.mime.startsWith('image/')) throw new Error(`${entry.entry}: not an image inside ${src}`);
    return data;
  }
  if (/^data\/sources\/money\//.test(src) && !src.includes('..')) {
    const buf = await readFile(join(root, src));
    if (!sniff(buf)?.mime.startsWith('image/')) throw new Error(`${src}: not a JPEG, PNG or WebP`);
    return buf;
  }
  throw new Error(`src must be https://, commons:<file> or data/sources/money/...: ${src}`);
}

// Resize to MAX_LOCAL_WIDTH and, when the terms demand it, stamp SPECIMEN
// diagonally at 30% opacity. Both need sharp; without it the file is copied
// as-is, and an entry that needs the overlay is refused rather than shown bare.
async function finish(buf, wantSpecimen, crop = null) {
  const kind = sniff(buf);
  if (!sharp) {
    if (wantSpecimen) throw new Error('specimen overlay requested but sharp is not installed (npm i -D sharp)');
    if (crop) throw new Error('crop requested but sharp is not installed (npm i -D sharp)');
    return { buf, ext: kind.ext };
  }
  let img = sharp(buf, { animated: false }).rotate();
  // An optional crop box [left, top, width, height] in source pixels, for a
  // note photographed or captured together with others (owner-supplied frames).
  if (crop) {
    const [left, top, width, height] = crop.map((n) => Math.round(n));
    img = sharp(await img.extract({ left, top, width, height }).toBuffer());
  }
  const meta = await img.metadata();
  const w = Math.min(meta.width, MAX_LOCAL_WIDTH);
  const h = Math.round(meta.height * (w / meta.width));
  if (meta.width > MAX_LOCAL_WIDTH) img = img.resize({ width: MAX_LOCAL_WIDTH });
  if (wantSpecimen) {
    const size = Math.round(Math.min(w, h) * 0.32);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${size}" fill="#000" fill-opacity="0.3" stroke="#fff" stroke-opacity="0.3" stroke-width="${Math.max(1, size / 40)}" transform="rotate(-25 ${w / 2} ${h / 2})">SPECIMEN</text></svg>`;
    img = img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  }
  const keepPng = kind.ext === 'png' && meta.hasAlpha;
  const outBuf = keepPng ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  return { buf: outBuf, ext: keepPng ? 'png' : 'jpg' };
}

const emptyCurrency = () => ({ name: null, issuer: null, qid: null, image: null, categories: { banknotes: null, coins: null }, banknotes: [], coins: [] });
const safeName = (s) => String(s).replace(/[^a-z0-9.]+/gi, '_').replace(/^_+|_+$/g, '') || 'x';

async function applyOverrides(currencies) {
  let overrides;
  try { overrides = JSON.parse(await readFile(OVERRIDES, 'utf8')); } catch (err) { console.log(`no overrides (${err.message})`); return; }
  const codesHere = Object.keys(overrides).filter((c) => !c.startsWith('_'));
  for (const code of codesHere) {
    const o = overrides[code];
    if (ONLY && !ONLY.has(code)) continue;
    if (!o.terms || !o.license) { console.error(`${code}: override needs \`terms\` (the page that grants the reuse) and \`license\`; skipped`); continue; }
    const cur = currencies[code] || (currencies[code] = emptyCurrency());
    // Re-runs replace, never duplicate.
    for (const kind of ['banknotes', 'coins']) cur[kind] = (cur[kind] || []).filter((f) => !f.local);
    const dir = join(MONEY_DIR, code);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let bytes = 0;
    for (const kind of ['banknotes', 'coins']) {
      const made = [];
      for (const entry of o[kind] || []) {
        try {
          const raw = await sourceBytes(entry);
          const { buf, ext } = await finish(raw, entry.specimen ?? o.specimen ?? false, entry.crop || null);
          const side = entry.side || 'obverse';
          const name = `${safeName(entry.denomination)}-${safeName(side)}.${ext}`;
          await writeFile(join(dir, name), buf);
          bytes += buf.length;
          const dim = dimensions(buf) || {};
          const isCommons = String(entry.src).startsWith('commons:');
          const row = {
            local: `money/${code}/${name}`,
            denomination: entry.denomination == null ? null : String(entry.denomination),
            w: dim.w ?? null, h: dim.h ?? null,
            license: entry.license || o.license,
            credit: entry.credit || o.credit || null,
            terms: entry.terms || (isCommons ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(String(entry.src).slice(8).trim().replace(/ /g, '_'))}` : o.terms),
            historical: false,
            side,
          };
          if (isCommons) row.file = String(entry.src).slice(8).trim();
          if (entry.year) row.year = entry.year;
          if (entry.series) row.series = entry.series;
          if (entry.page) row.page = entry.page;
          made.push(row);
        } catch (err) {
          console.error(`${code} ${kind} ${entry.denomination}: ${err.message}`);
        }
      }
      cur[kind] = [...made, ...cur[kind]];
    }
    cur.overrides = true;
    cur.terms = o.terms;
    if (o.issuer && (o.issuer.es || o.issuer.en)) cur.issuer = { ...(cur.issuer || {}), ...o.issuer };
    console.log(`${code}: overrides, ${cur.banknotes.filter((f) => f.local).length} notes + ${cur.coins.filter((f) => f.local).length} coins, ${(bytes / 1024).toFixed(0)} KB -> public/data/money/${code}/${sharp ? '' : ' (copied as-is: sharp not installed)'}`);
  }
  // Folders of currencies no longer in the overrides file are stale.
  if (!ONLY && await exists(MONEY_DIR)) {
    for (const d of await readdir(MONEY_DIR)) if (!codesHere.includes(d)) { await rm(join(MONEY_DIR, d), { recursive: true, force: true }); console.log(`removed stale public/data/money/${d}`); }
  }
  let total = 0;
  if (await exists(MONEY_DIR)) for (const d of await readdir(MONEY_DIR)) for (const f of await readdir(join(MONEY_DIR, d))) total += (await stat(join(MONEY_DIR, d, f))).size;
  console.log(`public/data/money/: ${(total / 1024).toFixed(0)} KB in all`);
}

const currencies = OVERRIDES_ONLY ? previous.currencies : Object.fromEntries(codeList.map((c) => [c, result[c]]));
await applyOverrides(currencies);

// ---------------------------------------------------------------------------
// 8. Write, keeping the file under MAX_BYTES.

const out = {
  built: today(),
  source: 'Wikidata (CC0), Wikimedia Commons (per-file licenses), issuer files with published reuse terms (data/overrides/money.json)',
  attribution: {
    data: 'Currency names and issuers: Wikidata (CC0). Link https://www.wikidata.org/wiki/<qid>.',
    images: 'Each file has its own license on Wikimedia Commons (CC BY, CC BY-SA, public domain, or copyrighted with reproduction permitted by the issuer). Show `license`, `artist` and link the file page https://commons.wikimedia.org/wiki/File:<file>. Banknote designs belong to their issuers.',
    overrides: 'Entries with `local` are files served from public/data/<local>, taken from an issuer with published reuse terms (or a written authorization) listed in data/overrides/money.json. Show `license` and `credit` and link `terms`. They come first and are the current issue (`historical: false`). A currency with any such entry has `overrides: true` and `terms`.',
  },
  notes: 'Files are what Commons has filed under the currency\'s banknote and coin categories (newest uploads and best title matches, one per denomination, width >= 600). This is not always the current series: when a central bank keeps its copyright, Commons mostly holds older issues. `year` and `series` are read from the file title when it states them. Thumbnail: https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(file)>?width=800',
  currencies,
};

let json = JSON.stringify(out);
if (Buffer.byteLength(json) > MAX_BYTES) {
  for (const c of Object.values(out.currencies)) for (const k of ['banknotes', 'coins']) for (const f of c[k]) delete f.credit;
  json = JSON.stringify(out);
  console.log('over cap: dropped credit');
}
for (const cap of [[6, 4], [5, 3], [4, 2]]) {
  if (Buffer.byteLength(json) <= MAX_BYTES) break;
  // Override files are never cut: the cap applies to the Commons part.
  const keep = (list, n) => [...list.filter((f) => f.local), ...list.filter((f) => !f.local).slice(0, n)];
  for (const c of Object.values(out.currencies)) { c.banknotes = keep(c.banknotes, cap[0]); c.coins = keep(c.coins, cap[1]); }
  json = JSON.stringify(out);
  console.log(`over cap: ${cap[0]} notes / ${cap[1]} coins`);
}
await mkdir(join(root, 'public/data'), { recursive: true });
await writeFile(OUT, json);

// Summary
const cur = Object.entries(out.currencies);
const withNote = cur.filter(([, c]) => c.banknotes.length >= 1);
const with4 = cur.filter(([, c]) => c.banknotes.length >= 4);
const withCoin = cur.filter(([, c]) => c.coins.length >= 1);
const nothing = cur.filter(([, c]) => !c.banknotes.length && !c.coins.length).map(([k]) => k);
const noWd = cur.filter(([, c]) => !c.qid).map(([k]) => k);
console.log(`\n${cur.length} currencies; ${withNote.length} with >=1 banknote, ${with4.length} with >=4, ${withCoin.length} with coins; ${cur.filter(([, c]) => c.issuer).length} with issuer`);
console.log(`nothing (${nothing.length}): ${nothing.join(' ')}`);
console.log(`no Wikidata item (${noWd.length}): ${noWd.join(' ') || 'none'}`);
console.log(`${(Buffer.byteLength(json) / 1024).toFixed(0)} KB -> ${OUT}; ${netCalls} network calls, ${((Date.now() - started) / 1000).toFixed(0)} s`);
