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
// MONEY_ONLY=MXN,JPY npm run money   limits to a few codes (debug)

import { writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, cacheDir, sparql as sparqlRaw, getJsonCached, loadFacts, today, pool } from './net.mjs';

const OUT = join(root, 'public/data/money.json');
const MAX_BYTES = 600 * 1024;
const MAX_NOTES = 8;
const MAX_COINS = 6;
const MIN_WIDTH = 600;
const SPACING_MS = 400;
const POOL = 2;
const API = 'https://commons.wikimedia.org/w/api.php';
const ONLY = process.env.MONEY_ONLY ? new Set(process.env.MONEY_ONLY.split(',')) : null;

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
const codeList = [...codes.keys()].sort().filter((c) => !ONLY || ONLY.has(c));
console.log(`${codeList.length} currency codes in facts.json`);

const wdRows = await sparql(`
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
}`);

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
    word: /banknote|billete|c[eé]dula|\bbill\b|\bnotes?\b|\bbillet|geldschein|schein|banconota|札|券|紙幣/i,
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
const BAD_CAT = /fantasy|imitation|counterfeit|forger|specimen|commemorative|bullion|token|charm|hoard|pattern|mother coin|countermark|postcard|museum|collection|replacement|signature|security feature|people|in art|\bsign\b|machine|exchange|bureau|mint\b|mints\b|\blocal\b|coloni|confederate|revolution|emergency|overstamp|by (state|period|metal|shape|inscription|collection|type|year|date|mint|country|artist|designer|engraver|author|face value|denomination)|unknown|proposal|reverse sides|straps|shred|gold coins|silver coins|on (banknotes|coins|money|stamps)|charit|wash|payment|chart|stamp|books|trays|crest|unidentified|operated|trees|pipe|cheque|check|certificate|medal|military|notgeld|scrip|private|regional|obsolete|\bold\b|ancient|medieval|\(1[0-8]\d\d|\(19[0-4]\d|printing|engrav|depict|portrait|watermark|holder|wallet|error|misprint|cancelled|uncut|sheets?\b|cut\b|destr|burn|damaged|folded|origami|jewel|art\b|advertis|propaganda|film|video|drawing|illustration|logo/i;

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
const unitWords = (code, e) => unitNoun(e);

// Does a category name denote exactly this currency's banknotes/coins?
// "Banknotes of Brazilian real" yes; "First series Euro banknotes" no;
// "1 Yen banknotes of Japan" no.
function namesCurrency(name, e) {
  const tokens = labelTokens(e);
  const words = name.toLowerCase().replace(/[()]/g, ' ').split(/[\s\-]+/).filter(Boolean);
  const rest = words.filter((w) => !STOP.has(w) && !KIND_WORDS.test(w));
  return rest.length > 0 && rest.every((w) => tokens.has(w) || tokens.has(`${w}s`) || tokens.has(w.replace(/s$/, '')));
}
function leftover(name, e) {
  const tokens = labelTokens(e);
  return name.toLowerCase().replace(/[()]/g, ' ').split(/[\s\-]+/).filter((w) => w && !STOP.has(w) && !KIND_WORDS.test(w) && !tokens.has(w)).length;
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

  // Guesses when Wikidata gave no usable category.
  if (!roots.banknotes.length || !roots.coins.length) {
    const guesses = [];
    const en = e?.name?.en;
    for (const iso of codes.get(code) || []) {
      const n = countryName.get(iso)?.en;
      if (!n) continue;
      guesses.push(`Banknotes of ${n}`, `Banknotes of the ${n}`, `Coins of ${n}`, `Coins of the ${n}`, `Money of ${n}`, `Money of the ${n}`);
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
  // first, then ones that mention its unit, then the fewest stray words.
  const rank = (n) => (namesCurrency(n, e) ? 0 : hasUnit(n) ? 1 : 2) * 100 + leftover(n, e) * 10 + Math.min(9, Math.floor(n.length / 20));
  for (const kind of Object.keys(KIND)) {
    const other = kind === 'banknotes' ? KIND.coins.cat : KIND.banknotes.cat;
    roots[kind] = roots[kind].filter((n) => !other.test(n) || namesCurrency(n, e)).sort((a, b) => rank(a) - rank(b)).slice(0, 2);
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

async function candidates(code, e, kind, roots) {
  const titles = new Set();
  const nouns = unitNoun(e);
  const nounClause = nouns.length ? ` (${[...new Set(nouns.flatMap((n) => [n, `${n}s`, `${n}es`]))].join(' OR ')})` : '';
  const neg = ' -specimen -counterfeit -fantasy -imitation -falschgeld';
  for (const r of roots) {
    const plain = `deepcategory:"${r}"${neg}`;
    // Newest uploads first (favors the current series), then relevance.
    // Big trees (hundreds of files) are narrowed to titles/descriptions
    // that name the unit, otherwise the two pages are mostly noise.
    const first = await searchPage(plain, 'create_timestamp_desc', 0);
    const q = first.total > 200 && nounClause ? `deepcategory:"${r}"${nounClause}${neg}` : plain;
    const pages = [first];
    if (q !== plain) pages.push(await searchPage(q, 'create_timestamp_desc', 0));
    if (pages[pages.length - 1].hits.length === 50) pages.push(await searchPage(q, 'create_timestamp_desc', 50));
    pages.push(await searchPage(q, null, 0));
    if (q !== plain) pages.push(await searchPage(`${q} (obverse OR anverso OR front OR avers OR vorderseite OR recto)`, null, 0));
    for (const p of pages) for (const t of p.hits) titles.add(t);
  }
  if (!roots.length) {
    const en = e?.name?.en;
    const es = e?.name?.es;
    const [wEn, wEs] = KIND[kind].search;
    if (en) for (const t of (await searchPage(`"${wEn}" "${en}"${neg}`, null, 0)).hits) titles.add(t);
    if (es && es !== en) for (const t of (await searchPage(`"${wEs}" "${es}"${neg}`, null, 0)).hits) titles.add(t);
  }
  return [...titles];
}

// ---------------------------------------------------------------------------
// 4. Title scoring.

const OBVERSE = /\bobverse\b|\banverso\b|\bfront\b|\bavers\b|vorderseite|\brecto\b|\bobv\b|\bav\b|\bface\b|表|\bfrente\b/i;
const REVERSE = /\breverse\b|\breverso\b|\bback\b|\brevers\b|rückseite|\bverso\b|\brev\b|\brv\b|裏|\bdorso\b/i;
const JUNK = /specimen|counterfeit|\bfake|falschgeld|\bfalso|fantasy|imitation|replica|play money|\btoy\b|proposal|mock|unissued|essay|cheque|check\b|\bbond\b|\bstamp|postcard|token|medal|coupon|voucher|\bvale\b|certificate|military payment|notgeld|coloni|confederate|overstamp|revolution|provisional|estado de|state of|constitucionalista|comisión|henequén|tesorería|imperial|\bempire\b|\bkingdom\b|\bduchy\b|\bréis\b|\bcruzeiro|cruzado|\bsen\b|\brin\b|\bmon\b|\bbu\b|\bshu\b|cash coin|lincoln|lindbergh|dpla|lccn|urn-3|baker\.ac|collection|museu|museum|exhibit|sammlung|hbs\.|blanket|cake|cookie|costume|dress|pillow|towel|reales\b|treasure|\bcob\b|century|siglo|siècle|jahrhundert|pirate|galleon|shipwreck|ingot|medallion|jeton|gaming|casino|chip|bitcoin|crypto/i;
const SCENE = /wallet|\bhand\b|\bhands\b|\bpile|stack|\bcash\b|shred|bundle|straps?\b|machine|\batm\b|\bsign\b|chart|\bmap\b|cartera|billetera|mano\b|montón|fajo|bolsa|empilhad|neon|street|shop|market|tienda|price|precio|donante|campaign|campaña|wikiconvention|dsc[_ ]?\d|img[_ ]?\d|p0\d{5}|\(\d{7,}\)|^\d{6,}|^dsc|^img|^p\d{7}|screenshot|detail|detalle|closeup|close-up|macro|uv\b|ultraviolet|watermark|透かし|security|seguridad|hilo|firma|signature|serial|微|locker|vending|parking|laundry|arcade|pachinko|station|circulation|millions|graph|statistic|estadística|\bgdp\b|inflation|exchange rate|tipo de cambio|rates?\b|table\b|tabla|modelo|model\b|boceto|sketch|drawing|escudo nacional|coat of arms|press|conference|meeting|minister|president|governor|speech/i;

const COMMEM = /commemorative|conmemorativ|comemorativ|gedenkmünze|collector|colección|coleção|\bproof\b|bullion|olympic|olímpic|expo\s?\d{4}|anniversary|aniversario|aniversário|jahre\b|años\b|anos\b|libertad\b.*\bonza|onza|ounce|\boz\b|silver\b|\bgold\b|\bplata\b|\boro\b|\bouro\b|\bprata\b|pattern|essai|trial|medal/i;
const WORDS = { one: 1, un: 1, uno: 1, um: 1, two: 2, dos: 2, dois: 2, five: 5, cinco: 5, ten: 10, diez: 10, dez: 10, twenty: 20, veinte: 20, vinte: 20, fifty: 50, cincuenta: 50, cinquenta: 50, hundred: 100, cien: 100, cem: 100, thousand: 1000, mil: 1000, 'two hundred': 200, doscientos: 200, duzentos: 200, 'five hundred': 500, quinientos: 500, quinhentos: 500, 'ten thousand': 10000, 'one thousand': 1000, 'five thousand': 5000, 'veinticinco': 25, 'twenty-five': 25, 'twenty five': 25 };
const SUBUNIT = /\b(cents?|centavos?|centimes?|céntimos?|cêntimos?|pence|penny|sen|kopek|kopeck|paise|paisa|fils|halala|piastres?|agorot|lipa|stotinki|öre|ore|øre|groszy|grosz|fen|jiao|chon|jeon|satang|pul|tetri|tyiyn|dirams?|qapik|luma|avos|centimos?|rappen|cent)\b/i;
const ORD = { first: 1, primera: 1, primeira: 1, second: 2, segunda: 2, third: 3, tercera: 3, terceira: 3, fourth: 4, cuarta: 4, fifth: 5, quinta: 5, sixth: 6 };

function parseTitle(title, ctxUnits = []) {
  const t = title.replace(/\.[a-z0-9]+$/i, '');
  const lower = t.toLowerCase();
  let year = null;
  for (const m of t.matchAll(/(?<!\d)(1[6-9]\d\d|20[0-3]\d)(?!\d)/g)) {
    const y = Number(m[1]);
    if (!year || y > year) year = y;
  }
  let series = null;
  const sl = /\bserie[s]?\s*([A-H])\b/i.exec(t);
  if (sl) series = sl[1].toUpperCase();
  else {
    const so = /\b(first|second|third|fourth|fifth|sixth|primera|segunda|tercera|cuarta|quinta|primeira|segunda|terceira)\s+(serie|series|família|familia|family)/i.exec(t);
    if (so) series = String(ORD[so[1].toLowerCase()]);
    else {
      const sn = /\b(serie|series|família|familia)\s+(\d)\b/i.exec(t);
      if (sn) series = sn[2];
    }
  }
  // Denomination: a number followed (within three words) by a unit noun or a
  // currency symbol, or preceded by a kind word ("Billete de 5"). A bare
  // number (photo index, Flickr id, date) is not a denomination.
  let denomination = null;
  let subunit = null;
  let foreign = false;
  const nums = [];
  const isUnit = (w) => UNIT_SET.has(w) || ctxUnits.some((u) => u === w || `${u}s` === w || `${u}es` === w);
  for (const m of t.matchAll(/(?<![\w.,€$£¥])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k(?![\w]))?/gi)) {
    let n = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (m[2]) n *= 1000;
    const after = t.slice(m.index + m[0].length);
    const before = t.slice(0, m.index);
    const toks = after.toLowerCase().match(/[a-záéíóúüñçãõâêôıöşğ円]+|\d+/g) || [];
    const nextWords = [];
    for (const tok of toks) { if (/^\d/.test(tok)) break; nextWords.push(tok); if (nextWords.length === 3) break; }
    const symbolAfter = /^\s?[€$£¥円]/.test(after) || /[€$£¥]\s?$/.test(before);
    const unitNear = nextWords.some(isUnit) || symbolAfter;
    const unitWord = nextWords.find(isUnit);
    if (unitWord && ctxUnits.length && !ctxUnits.some((u) => u === unitWord || `${u}s` === unitWord || `${u}es` === unitWord) && !SUBUNIT.test(unitWord)) foreign = true;
    const kindBefore = /(billete|banknote|note|bill|cédula|cedula|moneda|moeda|coin|münze|pièce|piece)s?\s+(de|of|von|da)?\s*$/i.test(before);
    const isYear = /^(1[6-9]\d\d|20[0-3]\d)$/.test(m[1]) && !nextWords.slice(0, 1).some(isUnit);
    if (isYear || n > 1000000 || n === 0) continue;
    if (!unitNear && !kindBefore) continue;
    nums.push({ n, sub: SUBUNIT.test(nextWords.slice(0, 2).join(' ')), nearUnit: unitNear });
  }
  if (!nums.length) {
    for (const [w, n] of Object.entries(WORDS).sort((a, b) => b[0].length - a[0].length)) {
      const m = new RegExp(`(^|[\\s(])${w}[\\s)\\-]+([a-záéíóúüñç]+)`, 'i').exec(lower);
      if (m && isUnit(m[2])) { nums.push({ n, nearUnit: true, sub: SUBUNIT.test(m[2]) }); break; }
    }
  }
  if (nums.length) {
    const pick = nums.find((x) => x.nearUnit) || nums[0];
    denomination = String(pick.n);
    if (pick.sub) subunit = true;
  }
  const side = OBVERSE.test(t) && !REVERSE.test(t) ? 'obverse' : REVERSE.test(t) && !OBVERSE.test(t) ? 'reverse' : null;
  return { year, series, denomination, subunit, side, foreign };
}

function scoreTitle(title, kind, unit, ctx) {
  const p = parseTitle(title, unit);
  let s = 0;
  if (p.side === 'obverse') s += 6;
  if (p.side === 'reverse') s -= 4;
  if (p.denomination) s += 3;
  if (p.year) {
    if (p.year >= 2000) s += 3 + (p.year - 2000) / 10;
    else if (p.year >= 1990) s += 0;
    else if (p.year >= 1950) s -= 4;
    else s -= 9;
  }
  if (p.series && ctx.maxSeries) {
    s += p.series === ctx.maxSeries ? 3 : -2;
  }
  if (JUNK.test(title)) s -= 7;
  if (p.foreign) s -= 4;
  if (COMMEM.test(title)) s -= 5;
  if (SCENE.test(title)) s -= 4;
  if (KIND[kind].word.test(title)) s += 1;
  if (unit.some((w) => title.toLowerCase().includes(w))) s += 1;
  if (!p.denomination && !KIND[kind].word.test(title)) s -= 2;
  if (kind === 'banknotes' && KIND.coins.word.test(title) && !KIND.banknotes.word.test(title)) s -= 5;
  if (kind === 'coins' && KIND.banknotes.word.test(title) && !KIND.coins.word.test(title)) s -= 5;
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
const stats = { net: 0 };

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
    const titles = (await candidates(code, e, kind, roots[kind])).filter((t) => EXT_OK.test(t));
    if (!titles.length) continue;
    // Series context: the latest letter/ordinal seen across this currency's titles.
    const seriesSeen = titles.map((t) => parseTitle(t, unit).series).filter(Boolean);
    const letters = seriesSeen.filter((x) => /^[A-H]$/.test(x)).sort();
    const ordinals = seriesSeen.filter((x) => /^\d$/.test(x)).sort();
    const ctx = { maxSeries: letters.length >= 2 ? letters[letters.length - 1] : ordinals.length >= 2 ? ordinals[ordinals.length - 1] : null };
    const ranked = titles.map((t) => ({ title: t, ...scoreTitle(t, kind, unit, ctx) })).sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, kind === 'banknotes' ? 40 : 30).filter((r) => r.score >= -3);
    if (!top.length) continue;
    const info = await imageinfo(top.map((r) => r.title));
    const ok = top.filter((r) => {
      const i = info.get(r.title);
      return i && i.w >= MIN_WIDTH && /^image\/(jpeg|png|tiff|webp)$/.test(i.mime || '');
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
    const num = (r) => (r.denomination ? Number(r.denomination) * (r.subunit ? 0.01 : 1) : Infinity);
    picked.sort((a, b) => num(a) - num(b));
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
// 7. Write, keeping the file under MAX_BYTES.

const out = {
  built: today(),
  source: 'Wikidata (CC0), Wikimedia Commons (per-file licenses)',
  attribution: {
    data: 'Currency names and issuers: Wikidata (CC0). Link https://www.wikidata.org/wiki/<qid>.',
    images: 'Each file has its own license on Wikimedia Commons (CC BY, CC BY-SA, public domain, or copyrighted with reproduction permitted by the issuer). Show `license`, `artist` and link the file page https://commons.wikimedia.org/wiki/File:<file>. Banknote designs belong to their issuers.',
  },
  notes: 'Files are what Commons has filed under the currency\'s banknote and coin categories (newest uploads and best title matches, one per denomination, width >= 600). This is not always the current series: when a central bank keeps its copyright, Commons mostly holds older issues. `year` and `series` are read from the file title when it states them. Thumbnail: https://commons.wikimedia.org/wiki/Special:FilePath/<encodeURIComponent(file)>?width=800',
  currencies: Object.fromEntries(codeList.map((c) => [c, result[c]])),
};

let json = JSON.stringify(out);
if (Buffer.byteLength(json) > MAX_BYTES) {
  for (const c of Object.values(out.currencies)) for (const k of ['banknotes', 'coins']) for (const f of c[k]) delete f.credit;
  json = JSON.stringify(out);
  console.log('over cap: dropped credit');
}
for (const cap of [[6, 4], [5, 3], [4, 2]]) {
  if (Buffer.byteLength(json) <= MAX_BYTES) break;
  for (const c of Object.values(out.currencies)) { c.banknotes = c.banknotes.slice(0, cap[0]); c.coins = c.coins.slice(0, cap[1]); }
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
